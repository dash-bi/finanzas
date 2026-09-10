/* ============================================================
   billing.js — Ventas, facturación, cartera y abonos
   Una venta descuenta existencias, congela el costo del momento
   y, si es a crédito, abre la cuenta por cobrar del cliente.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.ventas = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const costoDeVenta = (venta) => U.sum(venta.items, (i) => U.toNumber(i.cantidad) * U.toNumber(i.costoUnitario));
    const utilidadBruta = (venta) => U.toNumber(venta.subtotal) - costoDeVenta(venta);

    /* ============================================================
       Emisión de una venta
       ============================================================ */

    const abrirFormulario = () => {
        const clientes = db.clientes().filter((c) => c.activo !== false);

        if (clientes.length === 0) {
            ui.toastError('No hay clientes', 'Registre al menos un cliente antes de facturar.');
            return;
        }

        const editor = ERP.lineas.editor('venta');
        const usuario = ERP.auth.usuario();

        const campos = {
            fecha: ui.input({ tipo: 'date', valor: U.today() }),
            cliente: ui.select(
                clientes.map((c) => ({ valor: c.id, texto: `${c.nombre} — ${c.tipoDoc} ${c.documento}` })),
                { placeholder: 'Seleccione el cliente…' }
            ),
            condicion: ui.select([
                { valor: 'contado', texto: 'Contado' },
                { valor: 'credito', texto: 'Crédito' }
            ], { valor: 'contado' }),
            dias: ui.select([15, 30, 45, 60], { valor: 30 }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: 'Efectivo' }),
            vendedor: ui.input({ valor: usuario ? usuario.nombre : '' }),
            observaciones: el('textarea', { class: 'textarea', attrs: { rows: 2, placeholder: 'Observaciones (opcional)' } })
        };

        const campoDias = ui.campo('Plazo (días)', campos.dias);
        const campoMedio = ui.campo('Medio de pago', campos.medio);
        const infoCupo = el('div');

        const refrescarCupo = () => {
            U.clear(infoCupo);
            const cliente = db.terceroPorId(campos.cliente.value);
            if (!cliente) return;

            const disponible = db.cupoDisponible(cliente.id);
            const total = editor.totales.total;

            if (campos.condicion.value !== 'credito') {
                infoCupo.appendChild(ui.banner('Venta de contado',
                    'El total ingresa a caja el mismo día. No se genera cuenta por cobrar.', 'info'));
                return;
            }

            if (U.toNumber(cliente.limiteCredito) <= 0) {
                infoCupo.appendChild(ui.banner('Cliente sin cupo de crédito',
                    `${cliente.nombre} está configurado solo para ventas de contado. Asigne un límite de crédito en el módulo de clientes.`,
                    'danger'));
                return;
            }

            infoCupo.appendChild(ui.banner(
                total > disponible ? 'Cupo insuficiente' : 'Cupo disponible',
                `${cliente.nombre}: ${U.money(disponible)} disponibles de ${U.money(cliente.limiteCredito)}. Esta factura suma ${U.money(total)}.`,
                total > disponible ? 'danger' : 'success'
            ));
        };

        const alternarCondicion = () => {
            const credito = campos.condicion.value === 'credito';
            campoDias.classList.toggle('is-hidden', !credito);
            campoMedio.classList.toggle('is-hidden', credito);
            refrescarCupo();
        };

        campos.condicion.addEventListener('change', alternarCondicion);
        campos.cliente.addEventListener('change', refrescarCupo);
        editor.onCambio = refrescarCupo;

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            el('div', { class: 'grid-form' }, [
                ui.campo('Fecha', campos.fecha),
                ui.campo('Cliente', campos.cliente),
                ui.campo('Condición', campos.condicion),
                campoDias,
                campoMedio,
                ui.campo('Vendedor', campos.vendedor)
            ]),
            infoCupo,
            editor.nodo,
            ui.campo('Observaciones', campos.observaciones)
        ]);

        const btnGuardar = el('button', { class: 'btn', text: 'Emitir factura', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: 'Nueva venta',
            subtitulo: `Consecutivo ${db.siguienteNumero('venta')}`,
            ancho: 'ancho',
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        alternarCondicion();
        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const items = editor.obtener();
            if (items.length === 0) {
                errores.appendChild(ui.banner('Factura vacía', 'Agregue al menos un ítem.', 'danger'));
                return;
            }
            if (!campos.cliente.value) {
                errores.appendChild(ui.banner('Falta el cliente', 'Seleccione a quién se le factura.', 'danger'));
                return;
            }
            if (campos.fecha.value > U.today()) {
                errores.appendChild(ui.banner('Fecha futura', 'La factura no puede tener una fecha posterior a hoy.', 'danger'));
                return;
            }

            const res = db.registrarVenta({
                fecha: campos.fecha.value,
                clienteId: campos.cliente.value,
                condicion: campos.condicion.value,
                diasCredito: U.toNumber(campos.dias.value),
                medioPago: campos.medio.value,
                vendedor: campos.vendedor.value.trim(),
                observaciones: campos.observaciones.value,
                items
            });

            if (!res.ok) {
                errores.appendChild(ui.banner('No se pudo emitir la factura', res.error, 'danger'));
                return;
            }

            ui.toastOk(`Factura ${res.venta.numero} emitida`, U.money(res.venta.total));
            (res.alertas || []).forEach((alerta) => ui.toastWarn('Existencias en el mínimo', alerta));
            ctrl.cerrar();
            verDetalle(res.venta);
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ============================================================
       Abonos
       ============================================================ */

    const abrirAbono = (venta) => {
        const campos = {
            fecha: ui.input({ tipo: 'date', valor: U.today() }),
            valor: ui.input({ tipo: 'number', valor: venta.saldo, numerico: true, min: 0 }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: 'Efectivo' }),
            observaciones: ui.input({ placeholder: 'Referencia o comprobante (opcional)' })
        };

        const errores = el('div');
        const restante = el('p', { class: 'hint' });

        const actualizarRestante = () => {
            const nuevo = U.roundCop(U.toNumber(venta.saldo) - U.toNumber(campos.valor.value));
            restante.textContent = nuevo <= 0
                ? 'Con este abono la factura queda totalmente pagada.'
                : `Saldo restante después del abono: ${U.money(nuevo)}`;
        };
        campos.valor.addEventListener('input', actualizarRestante);

        const botonesRapidos = el('div', { class: 'row row-wrap' }, [
            el('button', {
                class: 'btn btn-secondary btn-sm', text: 'Abonar el 50 %', attrs: { type: 'button' },
                on: { click: () => { campos.valor.value = String(U.roundCop(venta.saldo / 2)); actualizarRestante(); } }
            }),
            el('button', {
                class: 'btn btn-secondary btn-sm', text: 'Cancelar el saldo total', attrs: { type: 'button' },
                on: { click: () => { campos.valor.value = String(U.roundCop(venta.saldo)); actualizarRestante(); } }
            })
        ]);

        const formulario = el('form', { class: 'stack' }, [
            errores,
            ui.banner('Factura',
                `${venta.numero} — ${db.nombreTercero(venta.clienteId)}. Total ${U.money(venta.total)}, saldo ${U.money(venta.saldo)}.`,
                'info'),
            el('div', { class: 'grid-form' }, [
                ui.campo('Fecha del abono', campos.fecha),
                ui.campo('Valor del abono', campos.valor),
                ui.campo('Medio de pago', campos.medio),
                ui.campo('Referencia', campos.observaciones)
            ]),
            botonesRapidos,
            restante
        ]);

        const btnGuardar = el('button', { class: 'btn', text: 'Registrar abono', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: 'Registrar abono',
            subtitulo: venta.numero,
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        actualizarRestante();
        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const res = db.registrarAbono({
                ventaId: venta.id,
                fecha: campos.fecha.value,
                valor: campos.valor.value,
                medio: campos.medio.value,
                observaciones: campos.observaciones.value
            });

            if (!res.ok) {
                errores.appendChild(ui.banner('No se pudo registrar el abono', res.error, 'danger'));
                return;
            }

            ui.toastOk('Abono registrado',
                res.venta.saldo <= 0
                    ? `${venta.numero} queda totalmente pagada.`
                    : `Saldo restante ${U.money(res.venta.saldo)}.`);
            ctrl.cerrar();
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ============================================================
       Anulación
       ============================================================ */

    const anular = async (venta) => {
        const confirmado = await ui.confirmar({
            titulo: 'Anular factura',
            mensaje: `¿Anular la factura ${venta.numero} por ${U.money(venta.total)}?`,
            detalle: 'Las existencias vuelven al inventario y la cuenta por cobrar se cierra. La factura queda visible marcada como anulada.',
            textoAceptar: 'Anular factura',
            peligroso: true
        });

        if (!confirmado) return;

        const res = db.anularVenta(venta.id, 'Anulación manual desde el módulo de ventas');
        if (!res.ok) {
            ui.toastError('No se pudo anular', res.error);
            return;
        }
        ui.toastOk('Factura anulada', `${venta.numero} — existencias devueltas al inventario.`);
    };

    /* ============================================================
       Detalle de la factura
       ============================================================ */

    const verDetalle = (venta) => {
        const cliente = db.terceroPorId(venta.clienteId);
        const abonos = U.sortBy(db.abonosDeVenta(venta.id), 'fecha');
        const estado = db.estadoVenta(venta);

        const filas = venta.items.map((item) => {
            const producto = db.productoPorId(item.productoId);
            const bruto = item.cantidad * item.valorUnitario;
            const neto = bruto - bruto * (U.toNumber(item.descuentoPct) / 100);
            return el('tr', {}, [
                el('td', { text: producto ? producto.sku : '—' }),
                el('td', { class: 'wrap', text: producto ? producto.nombre : 'Ítem eliminado' }),
                el('td', { class: 'num', text: U.num(item.cantidad) }),
                el('td', { class: 'num', text: U.money(item.valorUnitario) }),
                el('td', { class: 'num', text: item.descuentoPct ? U.pct(item.descuentoPct, 0) : '—' }),
                el('td', { class: 'num strong', text: U.money(neto) })
            ]);
        });

        const btnPdf = el('button', {
            class: 'btn', text: '⤓ Descargar factura PDF', attrs: { type: 'button' },
            on: {
                click: () => {
                    try {
                        ERP.pdf.facturaVenta(venta);
                        ui.toastOk('Factura generada', `${venta.numero}.pdf se está descargando.`);
                    } catch (error) {
                        console.error(error);
                        ui.toastError('No se pudo generar el PDF', 'Revise la consola para más detalle.');
                    }
                }
            }
        });

        ui.modal({
            titulo: `Factura ${venta.numero}`,
            subtitulo: `${cliente ? cliente.nombre : 'Cliente eliminado'} · ${U.fmtDate(venta.fecha)}`,
            ancho: 'ancho',
            contenido: el('div', { class: 'stack' }, [
                venta.anulada ? ui.banner('Factura anulada', venta.motivoAnulacion || '', 'danger') : null,
                el('div', { class: 'grid-kpi' }, [
                    ui.kpi('Total facturado', U.money(venta.total),
                        venta.condicion === 'credito' ? `Crédito ${venta.diasCredito} días` : `Contado (${venta.medioPago})`, 'var(--c1)'),
                    ui.kpi('Costo de la venta', U.money(costoDeVenta(venta)), 'Costo congelado al emitir', 'var(--c6)'),
                    ui.kpi('Utilidad bruta', U.money(utilidadBruta(venta)),
                        U.pct(U.safeDiv(utilidadBruta(venta), venta.subtotal) !== null
                            ? U.safeDiv(utilidadBruta(venta), venta.subtotal) * 100 : 0), 'var(--c2)'),
                    ui.kpi('Saldo pendiente', U.money(venta.saldo), estado.texto,
                        venta.saldo > 0 ? 'var(--c3)' : 'var(--c2)')
                ]),
                el('div', { class: 'table-wrap' }, [
                    el('table', { class: 'data' }, [
                        el('thead', {}, [el('tr', {}, [
                            el('th', { text: 'SKU', attrs: { scope: 'col' } }),
                            el('th', { text: 'Ítem', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Cantidad', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'V. unitario', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Dto.', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Neto', attrs: { scope: 'col' } })
                        ])]),
                        el('tbody', {}, filas)
                    ])
                ]),
                el('div', { class: 'totals' }, [
                    el('div', { class: 'totals-line' }, [el('span', { text: 'Subtotal' }), el('span', { class: 'num', text: U.money(venta.subtotal) })]),
                    el('div', { class: 'totals-line' }, [el('span', { text: `IVA (${U.num(db.config().ivaPct)} %)` }), el('span', { class: 'num', text: U.money(venta.iva) })]),
                    el('div', { class: 'totals-line total' }, [el('span', { text: 'Total' }), el('span', { class: 'num', text: U.money(venta.total) })])
                ]),
                abonos.length ? ui.card('Abonos registrados', el('div', { class: 'table-wrap' }, [
                    el('table', { class: 'data' }, [
                        el('thead', {}, [el('tr', {}, [
                            el('th', { text: 'Fecha', attrs: { scope: 'col' } }),
                            el('th', { text: 'Medio', attrs: { scope: 'col' } }),
                            el('th', { text: 'Referencia', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Valor', attrs: { scope: 'col' } })
                        ])]),
                        el('tbody', {}, abonos.map((a) => el('tr', {}, [
                            el('td', { text: U.fmtDate(a.fecha) }),
                            el('td', { text: a.medio }),
                            el('td', { text: a.observaciones || '—' }),
                            el('td', { class: 'num', text: U.money(a.valor) })
                        ])))
                    ])
                ]), { sinRelleno: true }) : null,
                venta.observaciones ? el('p', { class: 'text-muted', text: `Observaciones: ${venta.observaciones}` }) : null
            ]),
            acciones: [btnPdf]
        });
    };

    /* ============================================================
       Vista de ventas
       ============================================================ */

    const vista = (contenedor) => {
        const ventas = U.sortBy(db.all('ventas'), 'fecha', 'desc');
        const vigentes = ventas.filter((v) => !v.anulada);
        const periodoActual = U.periodOf(U.today());
        const delMes = vigentes.filter((v) => U.periodOf(v.fecha) === periodoActual);

        const ingresosMes = U.sum(delMes, (v) => v.subtotal);
        const utilidadMes = U.sum(delMes, utilidadBruta);
        const ticket = delMes.length ? ingresosMes / delMes.length : 0;

        const tabla = ui.tabla(ventas, [
            { clave: 'numero', titulo: 'Factura' },
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
            { clave: 'cliente', titulo: 'Cliente', ajustar: true, valor: (v) => db.nombreTercero(v.clienteId) },
            { clave: 'condicion', titulo: 'Condición', valor: (v) => (v.condicion === 'credito' ? `Crédito ${v.diasCredito} d` : 'Contado') },
            { clave: 'total', titulo: 'Total', tipo: 'moneda' },
            { clave: 'utilidad', titulo: 'Utilidad bruta', tipo: 'moneda', valor: (v) => (v.anulada ? 0 : utilidadBruta(v)) },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                render: (v) => {
                    const est = db.estadoVenta(v);
                    return ui.badge(est.texto, est.tono);
                }
            },
            {
                clave: 'acciones', titulo: '', tipo: 'nodo',
                render: (v) => el('div', { class: 'row' }, [
                    el('button', {
                        class: 'btn btn-secondary btn-sm', text: 'Detalle', attrs: { type: 'button' },
                        on: { click: () => verDetalle(v) }
                    }),
                    el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'PDF',
                        attrs: { type: 'button', title: 'Descargar factura en PDF' },
                        on: {
                            click: () => {
                                try {
                                    ERP.pdf.facturaVenta(v);
                                    ui.toastOk('Factura generada', `${v.numero}.pdf`);
                                } catch (error) {
                                    console.error(error);
                                    ui.toastError('No se pudo generar el PDF', 'Revise la consola.');
                                }
                            }
                        }
                    }),
                    (!v.anulada && U.toNumber(v.saldo) > 0) ? el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'Abonar', attrs: { type: 'button' },
                        on: { click: () => abrirAbono(v) }
                    }) : null,
                    !v.anulada ? el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'Anular', attrs: { type: 'button' },
                        on: { click: () => anular(v) }
                    }) : null
                ])
            }
        ], {
            ordenInicial: 'fecha',
            dirInicial: 'desc',
            textoBusqueda: 'Buscar por factura, cliente o estado…',
            porPagina: 12,
            totales: (l) => ({
                numero: `${l.length} facturas`,
                total: U.sum(l.filter((v) => !v.anulada), (v) => v.total),
                utilidad: U.sum(l.filter((v) => !v.anulada), utilidadBruta),
                saldo: U.sum(l, (v) => v.saldo)
            })
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Ventas y facturación' }),
                    el('p', { text: 'Cada factura descuenta inventario en tiempo real y, si es a crédito, abre la cuenta por cobrar.' })
                ]),
                el('button', {
                    class: 'btn', text: '+ Nueva venta', attrs: { type: 'button' },
                    on: { click: abrirFormulario }
                })
            ]),
            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Ventas del mes', U.money(ingresosMes),
                    `${delMes.length} facturas en ${U.fmtPeriod(periodoActual)}`, 'var(--c1)'),
                ui.kpi('Utilidad bruta del mes', U.money(utilidadMes),
                    U.pct(U.safeDiv(utilidadMes, ingresosMes) !== null ? U.safeDiv(utilidadMes, ingresosMes) * 100 : 0), 'var(--c2)'),
                ui.kpi('Ticket promedio', U.money(ticket), 'Sin IVA, por factura del mes', 'var(--c4)'),
                ui.kpi('Cartera abierta', U.money(U.sum(vigentes, (v) => v.saldo)),
                    `${vigentes.filter((v) => v.saldo > 0).length} facturas con saldo`, 'var(--c3)')
            ]),
            ui.card(null, tabla.nodo, { sinRelleno: true })
        ]);
    };

    return { vista, abrirFormulario, abrirAbono, verDetalle, anular, costoDeVenta, utilidadBruta };
})();

/* ============================================================
   Cartera: cuentas por cobrar y seguimiento de abonos
   ============================================================ */

ERP.cartera = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const RANGOS = [
        { etiqueta: 'Por vencer', min: -99999, max: 0 },
        { etiqueta: '1 a 30 días', min: 1, max: 30 },
        { etiqueta: '31 a 60 días', min: 31, max: 60 },
        { etiqueta: '61 a 90 días', min: 61, max: 90 },
        { etiqueta: 'Más de 90 días', min: 91, max: 999999 }
    ];

    const diasVencido = (venta) => U.daysBetween(venta.fechaVencimiento, U.today());

    const vista = (contenedor) => {
        const pendientes = db.all('ventas').filter((v) => !v.anulada && U.toNumber(v.saldo) > 0);
        const total = U.sum(pendientes, (v) => v.saldo);
        const vencidas = pendientes.filter((v) => diasVencido(v) > 0);
        const abonos = U.sortBy(db.all('abonos'), 'fecha', 'desc');

        const periodoActual = U.periodOf(U.today());
        const abonosMes = abonos.filter((a) => U.periodOf(a.fecha) === periodoActual);

        const antiguedad = RANGOS.map((rango) => {
            const grupo = pendientes.filter((v) => {
                const d = diasVencido(v);
                return d >= rango.min && d <= rango.max;
            });
            return { etiqueta: rango.etiqueta, valor: U.sum(grupo, (v) => v.saldo), cantidad: grupo.length };
        });

        const porCliente = [...U.groupBy(pendientes, 'clienteId').entries()]
            .map(([clienteId, lista]) => ({
                etiqueta: db.nombreTercero(clienteId),
                valor: U.sum(lista, (v) => v.saldo)
            }))
            .sort((a, b) => b.valor - a.valor)
            .slice(0, 8);

        const tablaCartera = ui.tabla(pendientes, [
            { clave: 'numero', titulo: 'Factura' },
            { clave: 'cliente', titulo: 'Cliente', ajustar: true, valor: (v) => db.nombreTercero(v.clienteId) },
            { clave: 'fecha', titulo: 'Emitida', tipo: 'fecha' },
            { clave: 'fechaVencimiento', titulo: 'Vence', tipo: 'fecha' },
            {
                clave: 'dias', titulo: 'Días vencida', tipo: 'nodo',
                valor: (v) => diasVencido(v),
                render: (v) => {
                    const d = diasVencido(v);
                    if (d <= 0) return el('span', { class: 'text-muted num', text: `Faltan ${Math.abs(d)} d` });
                    return el('span', { class: 'neg num strong', text: `${d} d` });
                }
            },
            { clave: 'total', titulo: 'Total', tipo: 'moneda' },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                render: (v) => {
                    const est = db.estadoVenta(v);
                    return ui.badge(est.texto, est.tono);
                }
            },
            {
                clave: 'acciones', titulo: '', tipo: 'nodo',
                render: (v) => el('div', { class: 'row' }, [
                    el('button', {
                        class: 'btn btn-sm', text: 'Abonar', attrs: { type: 'button' },
                        on: { click: () => ERP.ventas.abrirAbono(v) }
                    }),
                    el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'Detalle', attrs: { type: 'button' },
                        on: { click: () => ERP.ventas.verDetalle(v) }
                    })
                ])
            }
        ], {
            ordenInicial: 'dias',
            dirInicial: 'desc',
            textoBusqueda: 'Buscar factura o cliente…',
            porPagina: 10,
            vacio: ui.estadoVacio('Cartera al día', 'No hay facturas con saldo pendiente.'),
            totales: (l) => ({ numero: `${l.length} facturas`, total: U.sum(l, (v) => v.total), saldo: U.sum(l, (v) => v.saldo) })
        });

        const tablaAbonos = ui.tabla(abonos, [
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
            { clave: 'factura', titulo: 'Factura', valor: (a) => { const v = db.get('ventas', a.ventaId); return v ? v.numero : '—'; } },
            { clave: 'cliente', titulo: 'Cliente', ajustar: true, valor: (a) => db.nombreTercero(a.clienteId) },
            { clave: 'medio', titulo: 'Medio' },
            { clave: 'valor', titulo: 'Valor', tipo: 'moneda' },
            {
                clave: 'acciones', titulo: '', tipo: 'nodo',
                render: (a) => el('button', {
                    class: 'btn btn-ghost btn-sm', text: 'Revertir', attrs: { type: 'button' },
                    on: {
                        click: async () => {
                            const ok = await ui.confirmar({
                                titulo: 'Revertir abono',
                                mensaje: `¿Revertir el abono de ${U.money(a.valor)}?`,
                                detalle: 'El saldo volverá a sumarse a la factura.',
                                textoAceptar: 'Revertir',
                                peligroso: true
                            });
                            if (!ok) return;
                            const res = db.eliminarAbono(a.id);
                            if (res.ok) ui.toastOk('Abono revertido');
                            else ui.toastError('No se pudo revertir', res.error);
                        }
                    }
                })
            }
        ], {
            ordenInicial: 'fecha',
            dirInicial: 'desc',
            textoBusqueda: 'Buscar abono…',
            porPagina: 10,
            vacio: ui.estadoVacio('Sin abonos', 'Todavía no se han registrado abonos.'),
            totales: (l) => ({ fecha: `${l.length} abonos`, valor: U.sum(l, (a) => a.valor) })
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Cartera y abonos' }),
                    el('p', { text: 'Cuentas por cobrar por antigüedad. Cada abono amortiza el saldo del cliente en tiempo real.' })
                ])
            ]),

            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Cartera total', U.money(total), `${pendientes.length} facturas abiertas`, 'var(--c1)'),
                ui.kpi('Cartera vencida', U.money(U.sum(vencidas, (v) => v.saldo)),
                    `${vencidas.length} facturas vencidas`, vencidas.length ? 'var(--c6)' : 'var(--c2)'),
                ui.kpi('Recaudo del mes', U.money(U.sum(abonosMes, (a) => a.valor)),
                    `${abonosMes.length} abonos en ${U.fmtPeriod(periodoActual)}`, 'var(--c2)'),
                ui.kpi('Concentración', porCliente.length ? U.money(porCliente[0].valor) : U.money(0),
                    porCliente.length ? `Mayor deudor: ${U.truncate(porCliente[0].etiqueta, 24)}` : 'Sin deudores', 'var(--c4)')
            ]),

            vencidas.length
                ? ui.banner('Atención a la cartera vencida',
                    `${vencidas.length} facturas suman ${U.money(U.sum(vencidas, (v) => v.saldo))} por encima del plazo pactado.`,
                    'danger')
                : ui.banner('Cartera bajo control', 'No hay facturas vencidas en este momento.', 'success'),

            el('div', { class: 'grid-2' }, [
                ui.card('Antigüedad de la cartera',
                    ERP.charts.barras({
                        items: antiguedad.map((r) => ({
                            etiqueta: r.etiqueta, valor: r.valor,
                            detalle: { etiqueta: 'Facturas', valor: U.num(r.cantidad) }
                        })),
                        nombreSerie: 'Saldo'
                    })),
                ui.card('Mayores deudores',
                    ERP.charts.barras({ items: porCliente, nombreSerie: 'Saldo' }))
            ]),

            ui.card('Facturas con saldo pendiente', tablaCartera.nodo, { sinRelleno: true }),
            ui.card('Historial de abonos', tablaAbonos.nodo, { sinRelleno: true })
        ]);
    };

    return { vista, diasVencido };
})();
