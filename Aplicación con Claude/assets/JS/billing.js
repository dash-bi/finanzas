/* ============================================================
   billing.js — Ventas, facturación, cartera y abonos
   Una venta descuenta existencias, congela el costo del momento
   y, si es a crédito, abre la cuenta por cobrar del cliente.
   Las facturas y los abonos se pueden editar, exportar a Excel y
   las ventas cargarse desde un PDF.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.ventas = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const NUEVO_TERCERO = '__nuevo_tercero__';
    const VENDEDOR_ANTERIOR = '__vendedor_anterior__';

    const opcionesDe = (valor) => (valor && typeof valor === 'object' && !(valor instanceof Event) ? valor : {});

    const costoDeVenta = (venta) => U.sum(venta.items, (i) => U.toNumber(i.cantidad) * U.toNumber(i.costoUnitario));
    const utilidadBruta = (venta) => U.toNumber(venta.subtotal) - costoDeVenta(venta);

    /** Empleado de nómina cuyo nombre corresponde al del usuario conectado. */
    const empleadoDelUsuario = (empleados) => {
        const usuario = ERP.auth.usuario();
        if (!usuario) return null;
        const nombre = U.normalize(usuario.nombre).trim();
        return empleados.find((e) => {
            const completo = U.normalize(e.nombre).trim();
            return completo === nombre || completo.startsWith(`${nombre} `) || nombre.startsWith(`${completo} `);
        }) || null;
    };

    const plazosCon = (valor) => {
        const plazos = [15, 30, 45, 60];
        const n = U.toNumber(valor);
        if (n > 0 && !plazos.includes(n)) plazos.push(n);
        return plazos.sort((a, b) => a - b);
    };

    /* ============================================================
       Emisión, edición e importación de una venta
       opciones.venta    factura a editar
       opciones.prefill  datos leídos de un PDF (ver importer.js)
       ============================================================ */

    const abrirFormulario = (entrada) => {
        const opciones = opcionesDe(entrada);
        const venta = opciones.venta || null;
        const prefill = venta ? null : (opciones.prefill || null);
        const editando = Boolean(venta);
        const importacion = prefill && prefill.importacion ? prefill.importacion : null;
        const clienteNuevo = prefill && prefill.clienteNuevo ? prefill.clienteNuevo : null;

        if (editando && venta.anulada) {
            ui.toastError('Factura anulada', 'Una factura anulada no se puede editar.');
            return;
        }

        const clientes = db.clientes().filter((c) => c.activo !== false || (venta && c.id === venta.clienteId));
        if (clientes.length === 0 && !clienteNuevo) {
            ui.toastError('No hay clientes', 'Registre al menos un cliente antes de facturar.');
            return;
        }

        const base = venta || prefill || {};

        // Al editar, las unidades que ya tiene la factura siguen disponibles para ella.
        const reservado = {};
        if (editando) {
            venta.items.forEach((item) => {
                reservado[item.productoId] = (reservado[item.productoId] || 0) + U.toNumber(item.cantidad);
            });
        }

        const editor = ERP.lineas.editor('venta', {
            items: venta ? venta.items : (prefill ? prefill.items : null),
            reservado,
            permitirCrear: Boolean(importacion)
        });

        const abonado = editando ? U.roundCop(U.sum(db.abonosDeVenta(venta.id), (a) => a.valor)) : 0;

        /* --- Cliente --- */
        const opcionesCliente = clientes.map((c) => ({ valor: c.id, texto: `${c.nombre} — ${c.tipoDoc} ${c.documento}` }));
        if (clienteNuevo) {
            opcionesCliente.unshift({
                valor: NUEVO_TERCERO,
                texto: `+ Crear cliente «${clienteNuevo.nombre || 'sin nombre'}»${clienteNuevo.documento ? ` — ${clienteNuevo.tipoDoc || 'NIT'} ${clienteNuevo.documento}` : ''}`
            });
        }

        /* --- Vendedor: empleados de nómina --- */
        const empleados = db.all('empleados')
            .filter((e) => e.activo !== false || (venta && e.id === venta.vendedorId));
        const opcionesVendedor = empleados.map((e) => ({
            valor: e.id,
            texto: `${e.nombre}${e.cargo ? ` — ${e.cargo}` : ''}${e.activo === false ? ' (inactivo)' : ''}`
        }));

        let vendedorInicial = '';
        if (editando) {
            if (venta.vendedorId && empleados.some((e) => e.id === venta.vendedorId)) {
                vendedorInicial = venta.vendedorId;
            } else if (venta.vendedor) {
                // Ventas antiguas con un vendedor que no está en nómina: se conserva tal cual.
                opcionesVendedor.push({ valor: VENDEDOR_ANTERIOR, texto: `${venta.vendedor} (registro anterior)` });
                vendedorInicial = VENDEDOR_ANTERIOR;
            }
        } else {
            const propio = empleadoDelUsuario(empleados);
            if (propio) vendedorInicial = propio.id;
        }

        const campos = {
            fecha: ui.input({ tipo: 'date', valor: base.fecha || U.today() }),
            cliente: ui.select(opcionesCliente, {
                placeholder: 'Seleccione el cliente…',
                valor: base.clienteId || (clienteNuevo ? NUEVO_TERCERO : '')
            }),
            condicion: ui.select([
                { valor: 'contado', texto: 'Contado' },
                { valor: 'credito', texto: 'Crédito' }
            ], { valor: base.condicion || 'contado' }),
            dias: ui.select(plazosCon(base.diasCredito), { valor: base.diasCredito || 30 }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: base.medioPago || 'Efectivo' }),
            vendedor: ui.select(opcionesVendedor, {
                placeholder: empleados.length ? 'Seleccione el vendedor…' : 'No hay empleados en nómina',
                valor: vendedorInicial
            }),
            referencia: ui.input({ valor: base.referenciaExterna || '', placeholder: 'Número de la factura original' }),
            observaciones: el('textarea', {
                class: 'textarea',
                attrs: { rows: 2, placeholder: 'Observaciones (opcional)' },
                props: { value: base.observaciones || '' }
            })
        };

        const campoDias = ui.campo('Plazo (días)', campos.dias);
        const campoMedio = ui.campo('Medio de pago', campos.medio);
        const infoCupo = el('div');

        const refrescarCupo = () => {
            U.clear(infoCupo);
            const idCliente = campos.cliente.value;

            if (campos.condicion.value !== 'credito') {
                if (abonado > 0) {
                    infoCupo.appendChild(ui.banner('La factura tiene abonos',
                        `Ya se abonaron ${U.money(abonado)}: debe seguir siendo a crédito. Para pasarla a contado, revierta primero los abonos.`, 'danger'));
                    return;
                }
                infoCupo.appendChild(ui.banner('Venta de contado',
                    'El total ingresa a caja el mismo día. No se genera cuenta por cobrar.', 'info'));
                return;
            }

            if (idCliente === NUEVO_TERCERO) {
                infoCupo.appendChild(ui.banner('Cliente nuevo sin cupo',
                    'Un cliente creado desde el PDF empieza con cupo de crédito cero. Regístrela de contado o asígnele un límite en Clientes.', 'warning'));
                return;
            }

            const cliente = db.terceroPorId(idCliente);
            if (!cliente) return;

            if (U.toNumber(cliente.limiteCredito) <= 0) {
                infoCupo.appendChild(ui.banner('Cliente sin cupo de crédito',
                    `${cliente.nombre} está configurado solo para ventas de contado. Asigne un límite de crédito en el módulo de clientes.`,
                    'danger'));
                return;
            }

            const liberado = editando && venta.clienteId === cliente.id ? U.toNumber(venta.saldo) : 0;
            const disponible = db.cupoDisponible(cliente.id) + liberado;
            const ocupa = Math.max(0, editor.totales.total - abonado);

            infoCupo.appendChild(ui.banner(
                ocupa > disponible ? 'Cupo insuficiente' : 'Cupo disponible',
                `${cliente.nombre}: ${U.money(disponible)} disponibles de ${U.money(cliente.limiteCredito)}. Esta factura ocupa ${U.money(ocupa)}${abonado ? ` (ya descontados ${U.money(abonado)} abonados)` : ''}.`,
                ocupa > disponible ? 'danger' : 'success'
            ));
        };

        const alternarCondicion = () => {
            const credito = campos.condicion.value === 'credito';
            campoDias.classList.toggle('is-hidden', !credito);
            campoMedio.classList.toggle('is-hidden', credito);
            refrescarCupo();
        };

        const panel = importacion ? ERP.importador.panelLectura(importacion, () => editor.totales) : null;

        campos.condicion.addEventListener('change', alternarCondicion);
        campos.cliente.addEventListener('change', refrescarCupo);
        editor.onCambio = () => {
            refrescarCupo();
            if (panel) panel.actualizar();
        };
        if (panel) panel.actualizar();

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            panel ? panel.nodo : null,
            editando ? ui.banner('Corrección de una factura emitida',
                'Se conserva el número y el costo congelado de los productos que ya tenía. Las existencias y el saldo se recalculan con los nuevos valores.',
                'info') : null,
            el('div', { class: 'grid-form' }, [
                ui.campo('Fecha', campos.fecha),
                ui.campo('Cliente', campos.cliente),
                ui.campo('Condición', campos.condicion),
                campoDias,
                campoMedio,
                ui.campo('Vendedor', campos.vendedor, {
                    ayuda: empleados.length ? 'Empleados activos registrados en Nómina.' : 'Registre empleados en Nómina para poder asignar el vendedor.'
                }),
                (importacion || base.referenciaExterna) ? ui.campo('Referencia externa', campos.referencia) : null
            ]),
            infoCupo,
            editor.nodo,
            ui.campo('Observaciones', campos.observaciones)
        ]);

        const textoGuardar = editando ? 'Guardar cambios' : (importacion ? 'Registrar venta' : 'Emitir factura');
        const btnGuardar = el('button', { class: 'btn', text: textoGuardar, attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: editando ? `Editar factura ${venta.numero}` : (importacion ? 'Registrar factura de venta' : 'Nueva venta'),
            subtitulo: editando
                ? `${db.nombreTercero(venta.clienteId)} · ${U.fmtDate(venta.fecha)}`
                : `Consecutivo ${db.siguienteNumero('venta')}`,
            ancho: 'ancho',
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        alternarCondicion();
        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        let advertenciasAceptadas = false;
        formulario.addEventListener('input', () => {
            if (!advertenciasAceptadas) return;
            advertenciasAceptadas = false;
            btnGuardar.textContent = textoGuardar;
        });

        const mostrarError = (titulo, mensaje) => {
            U.clear(errores);
            errores.appendChild(ui.banner(titulo, mensaje, 'danger'));
            errores.scrollIntoView({ block: 'nearest' });
        };

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const items = editor.obtener();
            if (editor.lineasSinProducto() > 0) {
                mostrarError('Líneas sin producto', 'Asigne un producto a todas las líneas leídas del PDF o quítelas.');
                return;
            }
            if (items.length === 0) {
                mostrarError('Factura vacía', 'Agregue al menos un ítem.');
                return;
            }
            if (!campos.cliente.value) {
                mostrarError('Falta el cliente', 'Seleccione a quién se le factura.');
                return;
            }
            if (campos.fecha.value > U.today()) {
                mostrarError('Fecha futura', 'La factura no puede tener una fecha posterior a hoy.');
                return;
            }
            if (!editando && empleados.length && !campos.vendedor.value) {
                mostrarError('Falta el vendedor', 'Seleccione el empleado que realizó la venta.');
                return;
            }

            const referencia = campos.referencia.value.trim();
            const cufe = importacion && importacion.datos ? importacion.datos.cufe : '';

            if (!editando && importacion) {
                const terceroId = campos.cliente.value === NUEVO_TERCERO ? null : campos.cliente.value;
                const duplicado = db.buscarDuplicado({ tipo: 'venta', cufe, terceroId, referencia });
                if (duplicado && duplicado.certeza === 'cufe') {
                    mostrarError('Factura ya registrada',
                        `El código CUFE de este PDF ya está en ${duplicado.doc.numero || duplicado.doc.descripcion}. No se registra dos veces.`);
                    return;
                }
                if (!advertenciasAceptadas) {
                    const avisos = [];
                    if (duplicado) avisos.push(`La venta ${duplicado.doc.numero} ya tiene la referencia ${referencia} para este cliente.`);
                    const totalLeido = U.toNumber(importacion.datos && importacion.datos.total);
                    if (totalLeido > 0 && Math.abs(editor.totales.total - totalLeido) > Math.max(1000, totalLeido * 0.01)) {
                        avisos.push(`El total calculado (${U.money(editor.totales.total)}) no coincide con el de la factura (${U.money(totalLeido)}).`);
                    }
                    if (avisos.length) {
                        errores.appendChild(ui.banner('Revise antes de registrar', avisos.join(' '), 'warning'));
                        advertenciasAceptadas = true;
                        btnGuardar.textContent = 'Registrar de todos modos';
                        return;
                    }
                }
            }

            let clienteId = campos.cliente.value;
            if (clienteId === NUEVO_TERCERO) {
                const res = db.asegurarTercero('cliente', clienteNuevo);
                if (!res.ok) {
                    mostrarError('No se pudo crear el cliente', res.error);
                    return;
                }
                clienteId = res.tercero.id;
                const opcion = campos.cliente.querySelector(`option[value="${NUEVO_TERCERO}"]`);
                if (opcion) {
                    opcion.value = clienteId;
                    opcion.textContent = res.tercero.nombre;
                }
                campos.cliente.value = clienteId;
                if (res.creado) ui.toastInfo('Cliente creado', `${res.tercero.nombre}. Complete sus datos en el módulo de clientes.`);
            }

            let vendedorId = '';
            let vendedor = '';
            if (campos.vendedor.value === VENDEDOR_ANTERIOR) {
                vendedor = venta.vendedor;
            } else if (campos.vendedor.value) {
                const empleado = db.get('empleados', campos.vendedor.value);
                vendedorId = empleado ? empleado.id : '';
                vendedor = empleado ? empleado.nombre : '';
            }

            const payload = {
                fecha: campos.fecha.value,
                clienteId,
                condicion: campos.condicion.value,
                diasCredito: U.toNumber(campos.dias.value),
                medioPago: campos.medio.value,
                vendedorId,
                vendedor,
                observaciones: campos.observaciones.value,
                items
            };

            const res = editando
                ? db.editarVenta(venta.id, payload)
                : db.registrarVenta({
                    ...payload,
                    origen: importacion ? 'pdf' : 'manual',
                    archivoOrigen: importacion ? importacion.archivo : '',
                    referenciaExterna: referencia,
                    cufe
                });

            if (!res.ok) {
                mostrarError(editando ? 'No se pudo guardar' : 'No se pudo registrar la factura', res.error);
                return;
            }

            ui.toastOk(editando ? `Factura ${res.venta.numero} actualizada` : `Factura ${res.venta.numero} registrada`,
                U.money(res.venta.total));
            (res.alertas || []).forEach((alerta) => ui.toastWarn('Existencias en el mínimo', alerta));
            ctrl.cerrar();

            if (prefill && typeof prefill.onRegistrado === 'function') {
                prefill.onRegistrado(res.venta);
            } else if (!editando) {
                verDetalle(res.venta);
            }
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ============================================================
       Abonos: registro y corrección
       ============================================================ */

    const abrirAbono = (venta, abono) => {
        const editando = Boolean(abono);
        // Al corregir, el abono actual no cuenta contra el saldo disponible.
        const maximo = U.roundCop(U.toNumber(venta.saldo) + (editando ? U.toNumber(abono.valor) : 0));

        const campos = {
            fecha: ui.input({ tipo: 'date', valor: editando ? abono.fecha : U.today() }),
            valor: ui.input({ tipo: 'number', valor: editando ? abono.valor : venta.saldo, numerico: true, min: 0 }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: editando ? abono.medio : 'Efectivo' }),
            observaciones: ui.input({
                valor: editando ? (abono.observaciones || '') : '',
                placeholder: 'Referencia o comprobante (opcional)'
            })
        };

        const errores = el('div');
        const restante = el('p', { class: 'hint' });

        const actualizarRestante = () => {
            const nuevo = U.roundCop(maximo - U.toNumber(campos.valor.value));
            restante.textContent = nuevo <= 0
                ? 'Con este valor la factura queda totalmente pagada.'
                : `Saldo de la factura después del abono: ${U.money(nuevo)}`;
        };
        campos.valor.addEventListener('input', actualizarRestante);

        const botonesRapidos = el('div', { class: 'row row-wrap' }, [
            el('button', {
                class: 'btn btn-secondary btn-sm', text: 'El 50 % del saldo', attrs: { type: 'button' },
                on: { click: () => { campos.valor.value = String(U.roundCop(maximo / 2)); actualizarRestante(); } }
            }),
            el('button', {
                class: 'btn btn-secondary btn-sm', text: 'Todo el saldo', attrs: { type: 'button' },
                on: { click: () => { campos.valor.value = String(maximo); actualizarRestante(); } }
            })
        ]);

        const formulario = el('form', { class: 'stack' }, [
            errores,
            ui.banner('Factura',
                `${venta.numero} — ${db.nombreTercero(venta.clienteId)}. Total ${U.money(venta.total)}, saldo ${editando ? `sin este abono ${U.money(maximo)}` : U.money(venta.saldo)}.`,
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

        const btnGuardar = el('button', { class: 'btn', text: editando ? 'Guardar cambios' : 'Registrar abono', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: editando ? 'Editar abono' : 'Registrar abono',
            subtitulo: venta.numero,
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        actualizarRestante();
        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const datos = {
                fecha: campos.fecha.value,
                valor: campos.valor.value,
                medio: campos.medio.value,
                observaciones: campos.observaciones.value
            };

            const res = editando
                ? db.editarAbono(abono.id, datos)
                : db.registrarAbono({ ventaId: venta.id, ...datos });

            if (!res.ok) {
                errores.appendChild(ui.banner(editando ? 'No se pudo guardar el abono' : 'No se pudo registrar el abono', res.error, 'danger'));
                return;
            }

            ui.toastOk(editando ? 'Abono actualizado' : 'Abono registrado',
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

    const descargarPdf = (venta) => {
        try {
            ERP.pdf.facturaVenta(venta);
            ui.toastOk('Factura generada', `${venta.numero}.pdf se está descargando.`);
        } catch (error) {
            console.error(error);
            ui.toastError('No se pudo generar el PDF', 'Revise la consola para más detalle.');
        }
    };

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
                el('td', { class: 'num', text: U.num(item.cantidad, 2) }),
                el('td', { class: 'num', text: U.money(item.valorUnitario) }),
                el('td', { class: 'num', text: item.descuentoPct ? U.pct(item.descuentoPct, 0) : '—' }),
                el('td', { class: 'num strong', text: U.money(neto) })
            ]);
        });

        const btnPdf = el('button', { class: 'btn', text: '⤓ Descargar factura PDF', attrs: { type: 'button' } });
        const btnEditar = venta.anulada ? null : el('button', { class: 'btn btn-secondary', text: 'Editar factura', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: `Factura ${venta.numero}`,
            subtitulo: `${cliente ? cliente.nombre : 'Cliente eliminado'} · ${U.fmtDate(venta.fecha)}${venta.vendedor ? ` · Vendedor: ${venta.vendedor}` : ''}`,
            ancho: 'ancho',
            contenido: el('div', { class: 'stack' }, [
                venta.anulada ? ui.banner('Factura anulada', venta.motivoAnulacion || '', 'danger') : null,
                venta.origen === 'pdf'
                    ? ui.banner('Registrada desde PDF', `${venta.archivoOrigen || 'Archivo sin nombre'}${venta.referenciaExterna ? ` · Referencia ${venta.referenciaExterna}` : ''}`, 'info')
                    : null,
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
            acciones: [btnEditar, btnPdf].filter(Boolean)
        });

        btnPdf.addEventListener('click', () => descargarPdf(venta));
        if (btnEditar) {
            btnEditar.addEventListener('click', () => {
                ctrl.cerrar();
                abrirFormulario({ venta });
            });
        }
    };

    /* ============================================================
       Exportación a Excel
       ============================================================ */

    const exportar = (lista) => {
        if (!lista.length) {
            ui.toastWarn('Nada que exportar', 'La tabla no tiene registros con la búsqueda actual.');
            return;
        }
        try {
            const ids = new Set(lista.map((v) => v.id));
            const abonos = db.all('abonos').filter((a) => ids.has(a.ventaId));

            ERP.excel.descargar({
                archivo: ERP.excel.nombreArchivo('ventas'),
                titulo: 'Ventas y facturación',
                hojas: [
                    {
                        nombre: 'Ventas',
                        totales: true,
                        columnas: [
                            { titulo: 'Factura' }, { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Cliente' },
                            { titulo: 'Documento' }, { titulo: 'Vendedor' }, { titulo: 'Condición' },
                            { titulo: 'Plazo (días)', tipo: 'entero' }, { titulo: 'Vence', tipo: 'fecha' },
                            { titulo: 'Subtotal', tipo: 'moneda' }, { titulo: 'IVA', tipo: 'moneda' },
                            { titulo: 'Total', tipo: 'moneda' }, { titulo: 'Costo de ventas', tipo: 'moneda' },
                            { titulo: 'Utilidad bruta', tipo: 'moneda' }, { titulo: 'Margen', tipo: 'porcentaje' },
                            { titulo: 'Abonado', tipo: 'moneda' }, { titulo: 'Saldo', tipo: 'moneda' },
                            { titulo: 'Estado' }, { titulo: 'Origen' }, { titulo: 'Nota' }
                        ],
                        filas: lista.map((v) => {
                            const cliente = db.terceroPorId(v.clienteId);
                            // Las anuladas no suman: se dejan en cero y el valor original va en la nota.
                            const vigente = !v.anulada;
                            const abonado = U.sum(abonos.filter((a) => a.ventaId === v.id), (a) => a.valor);
                            const utilidad = utilidadBruta(v);
                            return [
                                v.numero, v.fecha, cliente ? cliente.nombre : 'Cliente eliminado',
                                cliente ? `${cliente.tipoDoc} ${cliente.documento}` : '', v.vendedor || '',
                                v.condicion === 'credito' ? 'Crédito' : 'Contado', v.diasCredito, v.fechaVencimiento,
                                vigente ? v.subtotal : 0, vigente ? v.iva : 0, vigente ? v.total : 0,
                                vigente ? costoDeVenta(v) : 0, vigente ? utilidad : 0,
                                vigente && v.subtotal ? utilidad / v.subtotal : null,
                                abonado, v.saldo, db.estadoVenta(v).texto,
                                v.origen === 'pdf' ? `PDF: ${v.archivoOrigen || ''}` : 'Manual',
                                v.anulada ? `Anulada. Total original ${U.money(v.total)}. ${v.motivoAnulacion || ''}`.trim() : (v.referenciaExterna ? `Referencia ${v.referenciaExterna}` : '')
                            ];
                        })
                    },
                    {
                        nombre: 'Detalle de ítems',
                        totales: true,
                        columnas: [
                            { titulo: 'Factura' }, { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Cliente' },
                            { titulo: 'Vendedor' }, { titulo: 'SKU' }, { titulo: 'Ítem' }, { titulo: 'Categoría' },
                            { titulo: 'Cantidad', tipo: 'numero' }, { titulo: 'Precio unitario', tipo: 'moneda' },
                            { titulo: 'Descuento', tipo: 'porcentaje' }, { titulo: 'Neto', tipo: 'moneda' },
                            { titulo: 'Costo unitario', tipo: 'moneda' }, { titulo: 'Costo total', tipo: 'moneda' },
                            { titulo: 'Utilidad', tipo: 'moneda' }
                        ],
                        filas: lista.filter((v) => !v.anulada).flatMap((v) => v.items.map((item) => {
                            const producto = db.productoPorId(item.productoId);
                            const bruto = U.toNumber(item.cantidad) * U.toNumber(item.valorUnitario);
                            const neto = bruto * (1 - U.toNumber(item.descuentoPct) / 100);
                            const costo = U.toNumber(item.cantidad) * U.toNumber(item.costoUnitario);
                            return [
                                v.numero, v.fecha, db.nombreTercero(v.clienteId), v.vendedor || '',
                                producto ? producto.sku : '', producto ? producto.nombre : 'Ítem eliminado',
                                producto ? producto.categoria : '', U.toNumber(item.cantidad),
                                U.toNumber(item.valorUnitario), U.toNumber(item.descuentoPct) / 100,
                                neto, U.toNumber(item.costoUnitario), costo, neto - costo
                            ];
                        }))
                    },
                    {
                        nombre: 'Abonos',
                        totales: true,
                        columnas: [
                            { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Factura' }, { titulo: 'Cliente' },
                            { titulo: 'Medio' }, { titulo: 'Referencia' }, { titulo: 'Valor', tipo: 'moneda' }
                        ],
                        filas: U.sortBy(abonos, 'fecha').map((a) => {
                            const v = db.get('ventas', a.ventaId);
                            return [a.fecha, v ? v.numero : '', db.nombreTercero(a.clienteId), a.medio, a.observaciones || '', a.valor];
                        })
                    }
                ]
            });
            ui.toastOk('Excel generado', `${lista.length} facturas exportadas.`);
        } catch (error) {
            console.error(error);
            ui.toastError('No se pudo generar el Excel', 'Revise la consola para más detalle.');
        }
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
            {
                clave: 'numero', titulo: 'Factura', tipo: 'nodo',
                valor: (v) => `${v.numero}${v.origen === 'pdf' ? ' pdf' : ''}`,
                render: (v) => el('div', { class: 'row' }, [
                    el('span', { class: 'strong', text: v.numero }),
                    v.origen === 'pdf' ? ui.badge('PDF', 'info') : null
                ])
            },
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
            { clave: 'cliente', titulo: 'Cliente', ajustar: true, valor: (v) => db.nombreTercero(v.clienteId) },
            { clave: 'vendedor', titulo: 'Vendedor', valor: (v) => v.vendedor || '—' },
            { clave: 'condicion', titulo: 'Condición', valor: (v) => (v.condicion === 'credito' ? `Crédito ${v.diasCredito} d` : 'Contado') },
            { clave: 'total', titulo: 'Total', tipo: 'moneda' },
            { clave: 'utilidad', titulo: 'Utilidad bruta', tipo: 'moneda', valor: (v) => (v.anulada ? 0 : utilidadBruta(v)) },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                valor: (v) => db.estadoVenta(v).texto,
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
                    !v.anulada ? el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'Editar', attrs: { type: 'button' },
                        on: { click: () => abrirFormulario({ venta: v }) }
                    }) : null,
                    el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'PDF',
                        attrs: { type: 'button', title: 'Descargar factura en PDF' },
                        on: { click: () => descargarPdf(v) }
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
            textoBusqueda: 'Buscar por factura, cliente, vendedor o estado…',
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
                el('div', { class: 'view-actions' }, [
                    el('button', {
                        class: 'btn btn-secondary', text: '⤓ Descargar Excel', attrs: { type: 'button' },
                        on: { click: () => exportar(tabla.filas()) }
                    }),
                    el('button', {
                        class: 'btn btn-secondary', text: 'Cargar factura PDF', attrs: { type: 'button' },
                        on: { click: () => ERP.importador.abrir('venta') }
                    }),
                    el('button', {
                        class: 'btn', text: '+ Nueva venta', attrs: { type: 'button' },
                        on: { click: () => abrirFormulario() }
                    })
                ])
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

    return { vista, abrirFormulario, abrirAbono, verDetalle, anular, costoDeVenta, utilidadBruta, exportar };
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

    const rangoDe = (venta) => {
        const d = diasVencido(venta);
        const rango = RANGOS.find((r) => d >= r.min && d <= r.max);
        return rango ? rango.etiqueta : '';
    };

    const exportar = (pendientes, abonos) => {
        if (!pendientes.length && !abonos.length) {
            ui.toastWarn('Nada que exportar', 'No hay cartera ni abonos con la búsqueda actual.');
            return;
        }
        try {
            const abonosTodos = db.all('abonos');
            ERP.excel.descargar({
                archivo: ERP.excel.nombreArchivo('cartera-y-abonos'),
                titulo: 'Cartera y abonos',
                hojas: [
                    {
                        nombre: 'Cartera pendiente',
                        totales: true,
                        columnas: [
                            { titulo: 'Factura' }, { titulo: 'Cliente' }, { titulo: 'Documento' },
                            { titulo: 'Emitida', tipo: 'fecha' }, { titulo: 'Vence', tipo: 'fecha' },
                            { titulo: 'Días vencida', tipo: 'entero' }, { titulo: 'Antigüedad' },
                            { titulo: 'Total', tipo: 'moneda' }, { titulo: 'Abonado', tipo: 'moneda' },
                            { titulo: 'Saldo', tipo: 'moneda' }, { titulo: 'Estado' }, { titulo: 'Vendedor' }
                        ],
                        filas: pendientes.map((v) => {
                            const cliente = db.terceroPorId(v.clienteId);
                            const abonado = U.sum(abonosTodos.filter((a) => a.ventaId === v.id), (a) => a.valor);
                            return [
                                v.numero, cliente ? cliente.nombre : '', cliente ? `${cliente.tipoDoc} ${cliente.documento}` : '',
                                v.fecha, v.fechaVencimiento, Math.max(0, diasVencido(v)), rangoDe(v),
                                v.total, abonado, v.saldo, db.estadoVenta(v).texto, v.vendedor || ''
                            ];
                        })
                    },
                    {
                        nombre: 'Antigüedad',
                        totales: true,
                        columnas: [{ titulo: 'Rango' }, { titulo: 'Facturas', tipo: 'entero' }, { titulo: 'Saldo', tipo: 'moneda' }],
                        filas: RANGOS.map((r) => {
                            const grupo = pendientes.filter((v) => rangoDe(v) === r.etiqueta);
                            return [r.etiqueta, grupo.length, U.sum(grupo, (v) => v.saldo)];
                        })
                    },
                    {
                        nombre: 'Abonos',
                        totales: true,
                        columnas: [
                            { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Factura' }, { titulo: 'Cliente' },
                            { titulo: 'Medio' }, { titulo: 'Referencia' }, { titulo: 'Valor', tipo: 'moneda' }
                        ],
                        filas: abonos.map((a) => {
                            const v = db.get('ventas', a.ventaId);
                            return [a.fecha, v ? v.numero : '', db.nombreTercero(a.clienteId), a.medio, a.observaciones || '', a.valor];
                        })
                    }
                ]
            });
            ui.toastOk('Excel generado', `${pendientes.length} facturas y ${abonos.length} abonos exportados.`);
        } catch (error) {
            console.error(error);
            ui.toastError('No se pudo generar el Excel', 'Revise la consola para más detalle.');
        }
    };

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
                valor: (v) => db.estadoVenta(v).texto,
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
                    }),
                    el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'Editar', attrs: { type: 'button' },
                        on: { click: () => ERP.ventas.abrirFormulario({ venta: v }) }
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
            { clave: 'referencia', titulo: 'Referencia', valor: (a) => a.observaciones || '—' },
            { clave: 'valor', titulo: 'Valor', tipo: 'moneda' },
            {
                clave: 'acciones', titulo: '', tipo: 'nodo',
                render: (a) => {
                    const venta = db.get('ventas', a.ventaId);
                    return el('div', { class: 'row' }, [
                        venta && !venta.anulada ? el('button', {
                            class: 'btn btn-ghost btn-sm', text: 'Editar', attrs: { type: 'button' },
                            on: { click: () => ERP.ventas.abrirAbono(venta, a) }
                        }) : null,
                        el('button', {
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
                    ]);
                }
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
                ]),
                el('div', { class: 'view-actions' }, [
                    el('button', {
                        class: 'btn btn-secondary', text: '⤓ Descargar Excel', attrs: { type: 'button' },
                        on: { click: () => exportar(tablaCartera.filas(), tablaAbonos.filas()) }
                    })
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

    return { vista, diasVencido, exportar };
})();
