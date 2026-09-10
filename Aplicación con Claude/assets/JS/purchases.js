/* ============================================================
   purchases.js — Compras (entrada de inventario) y gastos
   Una compra incrementa existencias y recalcula el costo promedio
   ponderado; a crédito abre la cuenta por pagar del proveedor.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.compras = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    /* ============================================================
       Registro de compra
       ============================================================ */

    const abrirFormulario = () => {
        const proveedores = db.proveedores().filter((p) => p.activo !== false);

        if (proveedores.length === 0) {
            ui.toastError('No hay proveedores', 'Registre al menos un proveedor antes de comprar.');
            return;
        }

        const editor = ERP.lineas.editor('compra');

        const campos = {
            fecha: ui.input({ tipo: 'date', valor: U.today() }),
            proveedor: ui.select(
                proveedores.map((p) => ({ valor: p.id, texto: p.nombre })),
                { placeholder: 'Seleccione el proveedor…' }
            ),
            documento: ui.input({ placeholder: 'Número de factura del proveedor' }),
            condicion: ui.select([
                { valor: 'contado', texto: 'Contado' },
                { valor: 'credito', texto: 'Crédito' }
            ], { valor: 'contado' }),
            dias: ui.select([15, 30, 45, 60, 90], { valor: 30 }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: 'Transferencia' }),
            observaciones: el('textarea', { class: 'textarea', attrs: { rows: 2, placeholder: 'Observaciones (opcional)' } })
        };

        const campoDias = ui.campo('Plazo (días)', campos.dias);
        const campoMedio = ui.campo('Medio de pago', campos.medio);

        const alternarCondicion = () => {
            const credito = campos.condicion.value === 'credito';
            campoDias.classList.toggle('is-hidden', !credito);
            campoMedio.classList.toggle('is-hidden', credito);
        };
        campos.condicion.addEventListener('change', alternarCondicion);

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            el('div', { class: 'grid-form' }, [
                ui.campo('Fecha', campos.fecha),
                ui.campo('Proveedor', campos.proveedor),
                ui.campo('Documento del proveedor', campos.documento),
                ui.campo('Condición', campos.condicion),
                campoDias,
                campoMedio
            ]),
            ui.banner('Efecto en el inventario',
                'Al guardar, las existencias suben y el costo promedio ponderado de cada ítem se recalcula automáticamente.',
                'info'),
            editor.nodo,
            ui.campo('Observaciones', campos.observaciones)
        ]);

        const btnGuardar = el('button', { class: 'btn', text: 'Registrar compra', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: 'Nueva compra',
            subtitulo: `Consecutivo ${db.siguienteNumero('compra')}`,
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
                errores.appendChild(ui.banner('Documento vacío', 'Agregue al menos un ítem a la compra.', 'danger'));
                return;
            }
            if (!campos.proveedor.value) {
                errores.appendChild(ui.banner('Falta el proveedor', 'Seleccione a quién se le compró.', 'danger'));
                return;
            }
            if (campos.fecha.value > U.today()) {
                errores.appendChild(ui.banner('Fecha futura', 'La compra no puede tener una fecha posterior a hoy.', 'danger'));
                return;
            }

            const res = db.registrarCompra({
                fecha: campos.fecha.value,
                proveedorId: campos.proveedor.value,
                documentoProveedor: campos.documento.value,
                condicion: campos.condicion.value,
                diasCredito: U.toNumber(campos.dias.value),
                medioPago: campos.medio.value,
                observaciones: campos.observaciones.value,
                items
            });

            if (!res.ok) {
                errores.appendChild(ui.banner('No se pudo registrar', res.error, 'danger'));
                return;
            }

            ui.toastOk(`Compra ${res.compra.numero} registrada`,
                `${U.money(res.compra.total)} — existencias actualizadas.`);
            ctrl.cerrar();
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ============================================================
       Pago a proveedor
       ============================================================ */

    const abrirPago = (compra) => {
        const campos = {
            fecha: ui.input({ tipo: 'date', valor: U.today() }),
            valor: ui.input({ tipo: 'number', valor: compra.saldo, numerico: true, min: 0 }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: 'Transferencia' })
        };

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            ui.banner('Saldo pendiente',
                `${db.nombreTercero(compra.proveedorId)} — compra ${compra.numero} por ${U.money(compra.total)}. Saldo: ${U.money(compra.saldo)}.`,
                'info'),
            el('div', { class: 'grid-form' }, [
                ui.campo('Fecha del pago', campos.fecha),
                ui.campo('Valor', campos.valor),
                ui.campo('Medio de pago', campos.medio)
            ])
        ]);

        const btnGuardar = el('button', { class: 'btn', text: 'Registrar pago', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: 'Pago a proveedor',
            subtitulo: compra.numero,
            ancho: 'estrecho',
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const res = db.registrarPagoCompra({
                compraId: compra.id,
                fecha: campos.fecha.value,
                valor: campos.valor.value,
                medio: campos.medio.value
            });

            if (!res.ok) {
                errores.appendChild(ui.banner('No se pudo registrar el pago', res.error, 'danger'));
                return;
            }

            ui.toastOk('Pago registrado',
                `${U.money(res.pago.valor)} — saldo restante ${U.money(res.compra.saldo)}.`);
            ctrl.cerrar();
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ============================================================
       Detalle de compra
       ============================================================ */

    const verDetalle = (compra) => {
        const pagos = db.pagosDeCompra(compra.id);

        const filas = compra.items.map((item) => {
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

        ui.modal({
            titulo: `Compra ${compra.numero}`,
            subtitulo: `${db.nombreTercero(compra.proveedorId)} · ${U.fmtDate(compra.fecha)}`,
            ancho: 'ancho',
            contenido: el('div', { class: 'stack' }, [
                el('div', { class: 'grid-kpi' }, [
                    ui.kpi('Total', U.money(compra.total), compra.condicion === 'credito' ? `Crédito ${compra.diasCredito} días` : 'Contado', 'var(--c1)'),
                    ui.kpi('Pagado', U.money(U.sum(pagos, (p) => p.valor)), `${pagos.length} pagos`, 'var(--c2)'),
                    ui.kpi('Saldo', U.money(compra.saldo), compra.saldo > 0 ? `Vence ${U.fmtDate(compra.fechaVencimiento)}` : 'Cancelada', compra.saldo > 0 ? 'var(--c6)' : 'var(--c2)')
                ]),
                el('div', { class: 'table-wrap' }, [
                    el('table', { class: 'data' }, [
                        el('thead', {}, [el('tr', {}, [
                            el('th', { text: 'SKU', attrs: { scope: 'col' } }),
                            el('th', { text: 'Ítem', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Cantidad', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Costo unit.', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Dto.', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Neto', attrs: { scope: 'col' } })
                        ])]),
                        el('tbody', {}, filas)
                    ])
                ]),
                el('div', { class: 'totals' }, [
                    el('div', { class: 'totals-line' }, [el('span', { text: 'Subtotal' }), el('span', { class: 'num', text: U.money(compra.subtotal) })]),
                    el('div', { class: 'totals-line' }, [el('span', { text: `IVA (${U.num(db.config().ivaPct)} %)` }), el('span', { class: 'num', text: U.money(compra.iva) })]),
                    el('div', { class: 'totals-line total' }, [el('span', { text: 'Total' }), el('span', { class: 'num', text: U.money(compra.total) })])
                ]),
                pagos.length ? ui.card('Pagos registrados', el('div', { class: 'table-wrap' }, [
                    el('table', { class: 'data' }, [
                        el('thead', {}, [el('tr', {}, [
                            el('th', { text: 'Fecha', attrs: { scope: 'col' } }),
                            el('th', { text: 'Medio', attrs: { scope: 'col' } }),
                            el('th', { class: 'num', text: 'Valor', attrs: { scope: 'col' } })
                        ])]),
                        el('tbody', {}, U.sortBy(pagos, 'fecha').map((p) => el('tr', {}, [
                            el('td', { text: U.fmtDate(p.fecha) }),
                            el('td', { text: p.medio }),
                            el('td', { class: 'num', text: U.money(p.valor) })
                        ])))
                    ])
                ]), { sinRelleno: true }) : null
            ])
        });
    };

    /* ============================================================
       Vista de compras
       ============================================================ */

    const vista = (contenedor) => {
        const compras = U.sortBy(db.all('compras'), 'fecha', 'desc');
        const periodoActual = U.periodOf(U.today());
        const delMes = compras.filter((c) => U.periodOf(c.fecha) === periodoActual);
        const porPagar = compras.filter((c) => U.toNumber(c.saldo) > 0);
        const vencidas = porPagar.filter((c) => c.fechaVencimiento < U.today());

        const tabla = ui.tabla(compras, [
            { clave: 'numero', titulo: 'Número' },
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
            { clave: 'proveedor', titulo: 'Proveedor', ajustar: true, valor: (c) => db.nombreTercero(c.proveedorId) },
            { clave: 'documentoProveedor', titulo: 'Doc. proveedor' },
            { clave: 'condicion', titulo: 'Condición', valor: (c) => (c.condicion === 'credito' ? `Crédito ${c.diasCredito} d` : 'Contado') },
            { clave: 'items', titulo: 'Ítems', tipo: 'numero', valor: (c) => c.items.length },
            { clave: 'total', titulo: 'Total', tipo: 'moneda' },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                render: (c) => {
                    if (U.toNumber(c.saldo) <= 0) return ui.badge('Pagada', 'success');
                    if (c.fechaVencimiento < U.today()) return ui.badge('Vencida', 'danger');
                    return ui.badge('Pendiente', 'warning');
                }
            },
            {
                clave: 'acciones', titulo: '', tipo: 'nodo',
                render: (c) => el('div', { class: 'row' }, [
                    el('button', {
                        class: 'btn btn-secondary btn-sm', text: 'Detalle', attrs: { type: 'button' },
                        on: { click: () => verDetalle(c) }
                    }),
                    U.toNumber(c.saldo) > 0 ? el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'Pagar', attrs: { type: 'button' },
                        on: { click: () => abrirPago(c) }
                    }) : null
                ])
            }
        ], {
            ordenInicial: 'fecha',
            dirInicial: 'desc',
            textoBusqueda: 'Buscar por número, proveedor o documento…',
            porPagina: 12,
            totales: (l) => ({
                numero: `${l.length} compras`,
                total: U.sum(l, (c) => c.total),
                saldo: U.sum(l, (c) => c.saldo)
            })
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Compras' }),
                    el('p', { text: 'Entradas de inventario. Cada compra actualiza las existencias y el costo promedio ponderado.' })
                ]),
                el('button', {
                    class: 'btn', text: '+ Nueva compra', attrs: { type: 'button' },
                    on: { click: abrirFormulario }
                })
            ]),
            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Compras del mes', U.money(U.sum(delMes, (c) => c.total)),
                    `${delMes.length} documentos en ${U.fmtPeriod(periodoActual)}`, 'var(--c1)'),
                ui.kpi('Compras acumuladas', U.money(U.sum(compras, (c) => c.total)),
                    `${compras.length} documentos`, 'var(--c5)'),
                ui.kpi('Cuentas por pagar', U.money(U.sum(porPagar, (c) => c.saldo)),
                    `${porPagar.length} facturas con saldo`, 'var(--c6)'),
                ui.kpi('Vencidas', U.money(U.sum(vencidas, (c) => c.saldo)),
                    `${vencidas.length} facturas vencidas`, vencidas.length ? 'var(--c6)' : 'var(--c2)')
            ]),
            ui.card(null, tabla.nodo, { sinRelleno: true })
        ]);
    };

    return { vista, abrirFormulario, abrirPago, verDetalle };
})();

/* ============================================================
   Gastos operativos y administrativos
   ============================================================ */

ERP.gastos = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const abrirFormulario = (gasto) => {
        const editando = Boolean(gasto);
        const datos = gasto || {
            fecha: U.today(), categoria: '', descripcion: '', valor: 0, pagado: true, medio: 'Transferencia'
        };

        const campos = {
            fecha: ui.input({ tipo: 'date', valor: datos.fecha }),
            categoria: ui.select(db.CATEGORIAS_GASTO, { placeholder: 'Seleccione la categoría…', valor: datos.categoria }),
            descripcion: ui.input({ valor: datos.descripcion, placeholder: 'Concepto del gasto' }),
            valor: ui.input({ tipo: 'number', valor: datos.valor, numerico: true, min: 0, step: 1000 }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: datos.medio }),
            pagado: el('input', { attrs: { type: 'checkbox' }, props: { checked: datos.pagado !== false } })
        };

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            el('div', { class: 'grid-form' }, [
                ui.campo('Fecha', campos.fecha),
                ui.campo('Categoría', campos.categoria),
                ui.campo('Descripción', campos.descripcion, { clase: 'span-full' }),
                ui.campo('Valor', campos.valor),
                ui.campo('Medio de pago', campos.medio)
            ]),
            el('label', { class: 'check' }, [
                campos.pagado,
                el('span', { text: 'Ya fue pagado (afecta el flujo de caja)' })
            ]),
            ui.banner('Cómo se contabiliza',
                'El gasto siempre afecta el estado de resultados en su fecha. Solo afecta el flujo de caja si está marcado como pagado.',
                'info')
        ]);

        const btnGuardar = el('button', { class: 'btn', text: editando ? 'Guardar cambios' : 'Registrar gasto', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: editando ? 'Editar gasto' : 'Nuevo gasto',
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const payload = {
                fecha: campos.fecha.value,
                categoria: campos.categoria.value,
                descripcion: campos.descripcion.value,
                valor: campos.valor.value,
                pagado: campos.pagado.checked,
                medio: campos.medio.value
            };

            if (editando) {
                if (U.toNumber(payload.valor) <= 0 || !payload.categoria) {
                    errores.appendChild(ui.banner('Datos incompletos',
                        'Seleccione una categoría y escriba un valor mayor que cero.', 'danger'));
                    return;
                }
                db.update('gastos', gasto.id, {
                    ...payload,
                    valor: U.roundCop(payload.valor),
                    descripcion: payload.descripcion.trim() || payload.categoria
                });
                ui.toastOk('Gasto actualizado', payload.descripcion || payload.categoria);
            } else {
                const res = db.registrarGasto(payload);
                if (!res.ok) {
                    errores.appendChild(ui.banner('No se pudo registrar', res.error, 'danger'));
                    return;
                }
                ui.toastOk('Gasto registrado', `${payload.categoria} — ${U.money(payload.valor)}`);
            }
            ctrl.cerrar();
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    const eliminar = async (gasto) => {
        if (gasto.origen === 'nomina') {
            ui.toastError('Gasto protegido',
                'Este gasto proviene de una liquidación de nómina. Elimine la liquidación desde el módulo de nómina.');
            return;
        }
        const confirmado = await ui.confirmar({
            titulo: 'Eliminar gasto',
            mensaje: `¿Eliminar el gasto "${gasto.descripcion}" por ${U.money(gasto.valor)}?`,
            detalle: 'Se recalcularán el estado de resultados y el flujo de caja.',
            textoAceptar: 'Eliminar',
            peligroso: true
        });
        if (confirmado) {
            db.remove('gastos', gasto.id);
            ui.toastOk('Gasto eliminado');
        }
    };

    const vista = (contenedor) => {
        const gastos = U.sortBy(db.all('gastos'), 'fecha', 'desc');
        const periodoActual = U.periodOf(U.today());
        const delMes = gastos.filter((g) => U.periodOf(g.fecha) === periodoActual);
        const pendientes = gastos.filter((g) => g.pagado === false);

        const porCategoria = [...U.groupBy(delMes, 'categoria').entries()]
            .map(([categoria, lista]) => ({ etiqueta: categoria, valor: U.sum(lista, (g) => g.valor) }))
            .sort((a, b) => b.valor - a.valor);

        const filtros = { categoria: '', periodo: '' };
        const zonaTabla = el('div');

        const periodosDisponibles = [...new Set(gastos.map((g) => U.periodOf(g.fecha)))]
            .sort().reverse()
            .map((p) => ({ valor: p, texto: U.fmtPeriod(p) }));

        const pintarTabla = () => {
            U.clear(zonaTabla);

            const lista = gastos.filter((g) => {
                if (filtros.categoria && g.categoria !== filtros.categoria) return false;
                if (filtros.periodo && U.periodOf(g.fecha) !== filtros.periodo) return false;
                return true;
            });

            const tabla = ui.tabla(lista, [
                { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
                { clave: 'categoria', titulo: 'Categoría' },
                { clave: 'descripcion', titulo: 'Descripción', ajustar: true },
                { clave: 'medio', titulo: 'Medio' },
                { clave: 'valor', titulo: 'Valor', tipo: 'moneda' },
                {
                    clave: 'pagado', titulo: 'Estado', tipo: 'nodo',
                    render: (g) => ui.badge(g.pagado === false ? 'Por pagar' : 'Pagado',
                        g.pagado === false ? 'warning' : 'success')
                },
                {
                    clave: 'acciones', titulo: '', tipo: 'nodo',
                    render: (g) => el('div', { class: 'row' }, [
                        el('button', {
                            class: 'btn btn-ghost btn-sm', text: 'Editar', attrs: { type: 'button' },
                            on: { click: () => abrirFormulario(g) }
                        }),
                        el('button', {
                            class: 'btn btn-ghost btn-sm', text: 'Eliminar', attrs: { type: 'button' },
                            on: { click: () => eliminar(g) }
                        })
                    ])
                }
            ], {
                ordenInicial: 'fecha',
                dirInicial: 'desc',
                textoBusqueda: 'Buscar por descripción o categoría…',
                porPagina: 12,
                totales: (l) => ({ fecha: `${l.length} gastos`, valor: U.sum(l, (g) => g.valor) })
            });

            zonaTabla.appendChild(ui.card(null, tabla.nodo, { sinRelleno: true }));
        };

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Gastos' }),
                    el('p', { text: 'Gastos operativos y administrativos categorizados para su imputación a los estados financieros.' })
                ]),
                el('button', {
                    class: 'btn', text: '+ Nuevo gasto', attrs: { type: 'button' },
                    on: { click: () => abrirFormulario() }
                })
            ]),

            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Gastos del mes', U.money(U.sum(delMes, (g) => g.valor)),
                    `${delMes.length} registros en ${U.fmtPeriod(periodoActual)}`, 'var(--c3)'),
                ui.kpi('Gastos acumulados', U.money(U.sum(gastos, (g) => g.valor)),
                    `${gastos.length} registros`, 'var(--c5)'),
                ui.kpi('Pendientes de pago', U.money(U.sum(pendientes, (g) => g.valor)),
                    `${pendientes.length} sin pagar`, pendientes.length ? 'var(--c6)' : 'var(--c2)'),
                ui.kpi('Mayor categoría del mes',
                    porCategoria.length ? U.money(porCategoria[0].valor) : U.money(0),
                    porCategoria.length ? porCategoria[0].etiqueta : 'Sin gastos', 'var(--c4)')
            ]),

            el('div', { class: 'grid-2' }, [
                ui.card('Distribución de gastos del mes',
                    ERP.charts.dona({ items: porCategoria, titulo: U.fmtPeriod(periodoActual) })),
                ui.card('Ranking de categorías del mes',
                    ERP.charts.barras({ items: porCategoria.slice(0, 7), nombreSerie: 'Gasto' }))
            ]),

            el('div', { class: 'filters' }, [
                ui.campo('Categoría', ui.select(db.CATEGORIAS_GASTO, {
                    placeholder: 'Todas',
                    on: { change: (e) => { filtros.categoria = e.target.value; pintarTabla(); } }
                })),
                ui.campo('Periodo', ui.select(periodosDisponibles, {
                    placeholder: 'Todos los periodos',
                    on: { change: (e) => { filtros.periodo = e.target.value; pintarTabla(); } }
                }))
            ]),

            zonaTabla
        ]);

        pintarTabla();
    };

    return { vista, abrirFormulario };
})();
