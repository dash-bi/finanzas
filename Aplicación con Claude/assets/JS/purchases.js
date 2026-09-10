/* ============================================================
   purchases.js — Compras (entrada de inventario) y gastos
   Una compra incrementa existencias y recalcula el costo promedio
   ponderado; a crédito abre la cuenta por pagar del proveedor.
   Ambos documentos se pueden registrar a mano, cargar desde una
   factura en PDF, editar y exportar a Excel.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.compras = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const NUEVO_TERCERO = '__nuevo_tercero__';

    /** Los manejadores de clic pasan el evento como primer argumento: se descarta. */
    const opcionesDe = (valor) => (valor && typeof valor === 'object' && !(valor instanceof Event) ? valor : {});

    const estadoCompra = (compra) => {
        if (U.toNumber(compra.saldo) <= 0) return { texto: 'Pagada', tono: 'success' };
        if (compra.fechaVencimiento < U.today()) return { texto: 'Vencida', tono: 'danger' };
        return { texto: 'Pendiente', tono: 'warning' };
    };

    const plazosCon = (valor) => {
        const plazos = [15, 30, 45, 60, 90];
        const n = U.toNumber(valor);
        if (n > 0 && !plazos.includes(n)) plazos.push(n);
        return plazos.sort((a, b) => a - b);
    };

    /* ============================================================
       Registro, edición e importación de compras
       opciones.compra   documento a editar
       opciones.prefill  datos leídos de un PDF (ver importer.js)
       ============================================================ */

    const abrirFormulario = (entrada) => {
        const opciones = opcionesDe(entrada);
        const compra = opciones.compra || null;
        const prefill = compra ? null : (opciones.prefill || null);
        const editando = Boolean(compra);
        const importacion = prefill && prefill.importacion ? prefill.importacion : null;
        const proveedorNuevo = prefill && prefill.proveedorNuevo ? prefill.proveedorNuevo : null;

        const proveedores = db.proveedores().filter((p) => p.activo !== false || (compra && p.id === compra.proveedorId));
        if (proveedores.length === 0 && !proveedorNuevo) {
            ui.toastError('No hay proveedores', 'Registre al menos un proveedor antes de comprar.');
            return;
        }

        const base = compra || prefill || {};
        const editor = ERP.lineas.editor('compra', {
            items: compra ? compra.items : (prefill ? prefill.items : null),
            permitirCrear: true
        });

        const opcionesProveedor = proveedores.map((p) => ({ valor: p.id, texto: p.nombre }));
        if (proveedorNuevo) {
            opcionesProveedor.unshift({
                valor: NUEVO_TERCERO,
                texto: `+ Crear proveedor «${proveedorNuevo.nombre || 'sin nombre'}»${proveedorNuevo.documento ? ` — ${proveedorNuevo.tipoDoc || 'NIT'} ${proveedorNuevo.documento}` : ''}`
            });
        }

        const campos = {
            fecha: ui.input({ tipo: 'date', valor: base.fecha || U.today() }),
            proveedor: ui.select(opcionesProveedor, {
                placeholder: 'Seleccione el proveedor…',
                valor: base.proveedorId || (proveedorNuevo ? NUEVO_TERCERO : '')
            }),
            documento: ui.input({ valor: base.documentoProveedor || '', placeholder: 'Número de factura del proveedor' }),
            condicion: ui.select([
                { valor: 'contado', texto: 'Contado' },
                { valor: 'credito', texto: 'Crédito' }
            ], { valor: base.condicion || 'contado' }),
            dias: ui.select(plazosCon(base.diasCredito), { valor: base.diasCredito || 30 }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: base.medioPago || 'Transferencia' }),
            observaciones: el('textarea', {
                class: 'textarea',
                attrs: { rows: 2, placeholder: 'Observaciones (opcional)' },
                props: { value: base.observaciones || '' }
            })
        };

        const campoDias = ui.campo('Plazo (días)', campos.dias);
        const campoMedio = ui.campo('Medio de pago', campos.medio);

        const alternarCondicion = () => {
            const credito = campos.condicion.value === 'credito';
            campoDias.classList.toggle('is-hidden', !credito);
            campoMedio.classList.toggle('is-hidden', credito);
        };
        campos.condicion.addEventListener('change', alternarCondicion);

        let explicacion;
        if (editando) {
            const pagos = db.pagosDeCompra(compra.id);
            explicacion = ui.banner('Corrección de un documento registrado',
                pagos.length
                    ? `La compra tiene ${pagos.length} ${pagos.length === 1 ? 'pago' : 'pagos'} por ${U.money(U.sum(pagos, (p) => p.valor))}. Al guardar se revierte la entrada original al inventario, se aplica la nueva y el saldo se recalcula sobre el nuevo total.`
                    : 'Al guardar se revierte la entrada original al inventario y se aplica la nueva, con el costo promedio recalculado.',
                'info');
        } else {
            explicacion = ui.banner('Efecto en el inventario',
                'Al guardar, las existencias suben y el costo promedio ponderado de cada ítem se recalcula automáticamente.',
                'info');
        }

        const panel = importacion ? ERP.importador.panelLectura(importacion, () => editor.totales) : null;
        if (panel) {
            editor.onCambio = () => panel.actualizar();
            panel.actualizar();
        }

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            panel ? panel.nodo : null,
            el('div', { class: 'grid-form' }, [
                ui.campo('Fecha', campos.fecha),
                ui.campo('Proveedor', campos.proveedor),
                ui.campo('Documento del proveedor', campos.documento),
                ui.campo('Condición', campos.condicion),
                campoDias,
                campoMedio
            ]),
            explicacion,
            editor.nodo,
            ui.campo('Observaciones', campos.observaciones)
        ]);

        const textoGuardar = editando ? 'Guardar cambios' : 'Registrar compra';
        const btnGuardar = el('button', { class: 'btn', text: textoGuardar, attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: editando ? `Editar compra ${compra.numero}` : (importacion ? 'Registrar factura de compra' : 'Nueva compra'),
            subtitulo: editando
                ? `${db.nombreTercero(compra.proveedorId)} · ${U.fmtDate(compra.fecha)}`
                : `Consecutivo ${db.siguienteNumero('compra')}`,
            ancho: 'ancho',
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        alternarCondicion();
        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        // Las advertencias (posible duplicado, total distinto al del PDF) piden
        // un segundo clic; cualquier cambio en el formulario las vuelve a evaluar.
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
                mostrarError('Documento vacío', 'Agregue al menos un ítem a la compra.');
                return;
            }
            if (!campos.proveedor.value) {
                mostrarError('Falta el proveedor', 'Seleccione a quién se le compró.');
                return;
            }
            if (campos.fecha.value > U.today()) {
                mostrarError('Fecha futura', 'La compra no puede tener una fecha posterior a hoy.');
                return;
            }

            const documento = campos.documento.value.trim();
            const cufe = importacion && importacion.datos ? importacion.datos.cufe : '';

            if (!editando) {
                const terceroId = campos.proveedor.value === NUEVO_TERCERO ? null : campos.proveedor.value;
                const duplicado = db.buscarDuplicado({ tipo: 'compra', cufe, terceroId, referencia: documento });
                if (duplicado && duplicado.certeza === 'cufe') {
                    mostrarError('Factura ya registrada',
                        `El código CUFE de este PDF ya está en ${duplicado.doc.numero || duplicado.doc.descripcion}. No se registra dos veces.`);
                    return;
                }

                if (!advertenciasAceptadas) {
                    const avisos = [];
                    if (duplicado) {
                        avisos.push(`Ya existe la compra ${duplicado.doc.numero} de este proveedor con el documento ${documento}.`);
                    }
                    const totalLeido = importacion && importacion.datos ? U.toNumber(importacion.datos.total) : 0;
                    if (totalLeido > 0) {
                        const diferencia = editor.totales.total - totalLeido;
                        if (Math.abs(diferencia) > Math.max(1000, totalLeido * 0.01)) {
                            avisos.push(`El total calculado (${U.money(editor.totales.total)}) no coincide con el de la factura (${U.money(totalLeido)}).`);
                        }
                    }
                    if (avisos.length) {
                        errores.appendChild(ui.banner('Revise antes de registrar', avisos.join(' '), 'warning'));
                        advertenciasAceptadas = true;
                        btnGuardar.textContent = 'Registrar de todos modos';
                        return;
                    }
                }
            }

            let proveedorId = campos.proveedor.value;
            if (proveedorId === NUEVO_TERCERO) {
                const res = db.asegurarTercero('proveedor', proveedorNuevo);
                if (!res.ok) {
                    mostrarError('No se pudo crear el proveedor', res.error);
                    return;
                }
                proveedorId = res.tercero.id;
                // Si el registro falla más adelante, un reintento no vuelve a crearlo.
                const opcion = campos.proveedor.querySelector(`option[value="${NUEVO_TERCERO}"]`);
                if (opcion) {
                    opcion.value = proveedorId;
                    opcion.textContent = res.tercero.nombre;
                }
                campos.proveedor.value = proveedorId;
                if (res.creado) ui.toastInfo('Proveedor creado', `${res.tercero.nombre}. Complete sus datos en el módulo de proveedores.`);
            }

            const payload = {
                fecha: campos.fecha.value,
                proveedorId,
                documentoProveedor: documento,
                condicion: campos.condicion.value,
                diasCredito: U.toNumber(campos.dias.value),
                medioPago: campos.medio.value,
                observaciones: campos.observaciones.value,
                items
            };

            const res = editando
                ? db.editarCompra(compra.id, payload)
                : db.registrarCompra({
                    ...payload,
                    origen: importacion ? 'pdf' : 'manual',
                    archivoOrigen: importacion ? importacion.archivo : '',
                    cufe
                });

            if (!res.ok) {
                mostrarError(editando ? 'No se pudo guardar' : 'No se pudo registrar', res.error);
                return;
            }

            ui.toastOk(editando ? `Compra ${res.compra.numero} actualizada` : `Compra ${res.compra.numero} registrada`,
                `${U.money(res.compra.total)} — existencias actualizadas.`);
            ctrl.cerrar();
            if (prefill && typeof prefill.onRegistrado === 'function') prefill.onRegistrado(res.compra);
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
                el('td', { class: 'num', text: U.num(item.cantidad, 2) }),
                el('td', { class: 'num', text: U.money(item.valorUnitario) }),
                el('td', { class: 'num', text: item.descuentoPct ? U.pct(item.descuentoPct, 0) : '—' }),
                el('td', { class: 'num strong', text: U.money(neto) })
            ]);
        });

        const btnEditar = el('button', { class: 'btn btn-secondary', text: 'Editar compra', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: `Compra ${compra.numero}`,
            subtitulo: `${db.nombreTercero(compra.proveedorId)} · ${U.fmtDate(compra.fecha)}`,
            ancho: 'ancho',
            contenido: el('div', { class: 'stack' }, [
                compra.origen === 'pdf'
                    ? ui.banner('Registrada desde PDF', `${compra.archivoOrigen || 'Archivo sin nombre'}${compra.cufe ? ` · CUFE ${U.truncate(compra.cufe, 24)}` : ''}`, 'info')
                    : null,
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
            ]),
            acciones: [btnEditar]
        });

        btnEditar.addEventListener('click', () => {
            ctrl.cerrar();
            abrirFormulario({ compra });
        });
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
            const ids = new Set(lista.map((c) => c.id));
            const pagos = db.all('pagosCompra').filter((p) => ids.has(p.compraId));

            ERP.excel.descargar({
                archivo: ERP.excel.nombreArchivo('compras'),
                titulo: 'Compras',
                hojas: [
                    {
                        nombre: 'Compras',
                        totales: true,
                        columnas: [
                            { titulo: 'Número' }, { titulo: 'Doc. proveedor' }, { titulo: 'Fecha', tipo: 'fecha' },
                            { titulo: 'Proveedor' }, { titulo: 'NIT' }, { titulo: 'Condición' },
                            { titulo: 'Plazo (días)', tipo: 'entero' }, { titulo: 'Vence', tipo: 'fecha' },
                            { titulo: 'Ítems', tipo: 'entero' }, { titulo: 'Subtotal', tipo: 'moneda' },
                            { titulo: 'IVA', tipo: 'moneda' }, { titulo: 'Total', tipo: 'moneda' },
                            { titulo: 'Pagado', tipo: 'moneda' }, { titulo: 'Saldo', tipo: 'moneda' },
                            { titulo: 'Estado' }, { titulo: 'Origen' }
                        ],
                        filas: lista.map((c) => {
                            const proveedor = db.terceroPorId(c.proveedorId);
                            const pagado = U.sum(pagos.filter((p) => p.compraId === c.id), (p) => p.valor);
                            return [
                                c.numero, c.documentoProveedor, c.fecha, proveedor ? proveedor.nombre : '',
                                proveedor ? proveedor.documento : '', c.condicion === 'credito' ? 'Crédito' : 'Contado',
                                c.diasCredito, c.fechaVencimiento, c.items.length, c.subtotal, c.iva, c.total,
                                pagado, c.saldo, estadoCompra(c).texto,
                                c.origen === 'pdf' ? `PDF: ${c.archivoOrigen || ''}` : 'Manual'
                            ];
                        })
                    },
                    {
                        nombre: 'Detalle de ítems',
                        totales: true,
                        columnas: [
                            { titulo: 'Compra' }, { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Proveedor' },
                            { titulo: 'SKU' }, { titulo: 'Ítem' }, { titulo: 'Cantidad', tipo: 'numero' },
                            { titulo: 'Costo unitario', tipo: 'moneda' }, { titulo: 'Descuento', tipo: 'porcentaje' },
                            { titulo: 'Neto', tipo: 'moneda' }
                        ],
                        filas: lista.flatMap((c) => c.items.map((item) => {
                            const producto = db.productoPorId(item.productoId);
                            const bruto = U.toNumber(item.cantidad) * U.toNumber(item.valorUnitario);
                            return [
                                c.numero, c.fecha, db.nombreTercero(c.proveedorId),
                                producto ? producto.sku : '', producto ? producto.nombre : 'Ítem eliminado',
                                U.toNumber(item.cantidad), U.toNumber(item.valorUnitario),
                                U.toNumber(item.descuentoPct) / 100, bruto * (1 - U.toNumber(item.descuentoPct) / 100)
                            ];
                        }))
                    },
                    {
                        nombre: 'Pagos',
                        totales: true,
                        columnas: [
                            { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Compra' }, { titulo: 'Proveedor' },
                            { titulo: 'Medio' }, { titulo: 'Valor', tipo: 'moneda' }
                        ],
                        filas: U.sortBy(pagos, 'fecha').map((p) => {
                            const c = db.get('compras', p.compraId);
                            return [p.fecha, c ? c.numero : '', db.nombreTercero(p.proveedorId), p.medio, p.valor];
                        })
                    }
                ]
            });
            ui.toastOk('Excel generado', `${lista.length} compras exportadas.`);
        } catch (error) {
            console.error(error);
            ui.toastError('No se pudo generar el Excel', 'Revise la consola para más detalle.');
        }
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
            {
                clave: 'numero', titulo: 'Número', tipo: 'nodo', ordenable: true,
                valor: (c) => `${c.numero}${c.origen === 'pdf' ? ' pdf' : ''}`,
                render: (c) => el('div', { class: 'row' }, [
                    el('span', { class: 'strong', text: c.numero }),
                    c.origen === 'pdf' ? ui.badge('PDF', 'info') : null
                ])
            },
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
            { clave: 'proveedor', titulo: 'Proveedor', ajustar: true, valor: (c) => db.nombreTercero(c.proveedorId) },
            { clave: 'documentoProveedor', titulo: 'Doc. proveedor' },
            { clave: 'condicion', titulo: 'Condición', valor: (c) => (c.condicion === 'credito' ? `Crédito ${c.diasCredito} d` : 'Contado') },
            { clave: 'items', titulo: 'Ítems', tipo: 'numero', valor: (c) => c.items.length },
            { clave: 'total', titulo: 'Total', tipo: 'moneda' },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                valor: (c) => estadoCompra(c).texto,
                render: (c) => {
                    const estado = estadoCompra(c);
                    return ui.badge(estado.texto, estado.tono);
                }
            },
            {
                clave: 'acciones', titulo: '', tipo: 'nodo',
                render: (c) => el('div', { class: 'row' }, [
                    el('button', {
                        class: 'btn btn-secondary btn-sm', text: 'Detalle', attrs: { type: 'button' },
                        on: { click: () => verDetalle(c) }
                    }),
                    el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'Editar', attrs: { type: 'button' },
                        on: { click: () => abrirFormulario({ compra: c }) }
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
                el('div', { class: 'view-actions' }, [
                    el('button', {
                        class: 'btn btn-secondary', text: '⤓ Descargar Excel', attrs: { type: 'button' },
                        on: { click: () => exportar(tabla.filas()) }
                    }),
                    el('button', {
                        class: 'btn btn-secondary', text: 'Cargar factura PDF', attrs: { type: 'button' },
                        on: { click: () => ERP.importador.abrir('compra') }
                    }),
                    el('button', {
                        class: 'btn', text: '+ Nueva compra', attrs: { type: 'button' },
                        on: { click: () => abrirFormulario() }
                    })
                ])
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

    return { vista, abrirFormulario, abrirPago, verDetalle, exportar };
})();

/* ============================================================
   Gastos operativos y administrativos
   ============================================================ */

ERP.gastos = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    /**
     * gasto    registro a editar (o null)
     * prefill  datos leídos de un PDF (ver importer.js)
     */
    const abrirFormulario = (gasto, prefill) => {
        const editando = Boolean(gasto) && !(gasto instanceof Event);
        const lectura = !editando && prefill ? prefill : null;
        const importacion = lectura && lectura.importacion ? lectura.importacion : null;
        const datos = editando ? gasto : {
            fecha: U.today(), categoria: '', descripcion: '', valor: 0, pagado: true,
            medio: 'Transferencia', referencia: '', proveedor: '', ...(lectura || {})
        };

        const campos = {
            fecha: ui.input({ tipo: 'date', valor: datos.fecha }),
            categoria: ui.select(db.CATEGORIAS_GASTO, { placeholder: 'Seleccione la categoría…', valor: datos.categoria }),
            descripcion: ui.input({ valor: datos.descripcion, placeholder: 'Concepto del gasto' }),
            proveedor: ui.input({ valor: datos.proveedor || '', placeholder: 'A quién se le pagó (opcional)' }),
            referencia: ui.input({ valor: datos.referencia || '', placeholder: 'N.º de factura o comprobante (opcional)' }),
            valor: ui.input({ tipo: 'number', valor: datos.valor, numerico: true, min: 0, step: 'any' }),
            medio: ui.select(db.MEDIOS_PAGO, { valor: datos.medio || 'Transferencia' }),
            pagado: el('input', { attrs: { type: 'checkbox' }, props: { checked: datos.pagado !== false } })
        };

        // La nómina guarda en "referencia" el vínculo con su liquidación: no se edita a mano.
        const esNomina = editando && gasto.origen === 'nomina';
        if (esNomina) campos.referencia.readOnly = true;

        const panel = importacion
            ? ERP.importador.panelLectura(importacion, () => ({ total: U.toNumber(campos.valor.value) }))
            : null;
        if (panel) {
            campos.valor.addEventListener('input', () => panel.actualizar());
            panel.actualizar();
        }

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            panel ? panel.nodo : null,
            el('div', { class: 'grid-form' }, [
                ui.campo('Fecha', campos.fecha),
                ui.campo('Categoría', campos.categoria),
                ui.campo('Descripción', campos.descripcion, { clase: 'span-full' }),
                ui.campo('Proveedor', campos.proveedor),
                ui.campo('Referencia', campos.referencia),
                ui.campo('Valor total', campos.valor, { ayuda: importacion ? 'Total de la factura, IVA incluido.' : '' }),
                ui.campo('Medio de pago', campos.medio)
            ]),
            el('label', { class: 'check' }, [
                campos.pagado,
                el('span', { text: 'Ya fue pagado (afecta el flujo de caja)' })
            ]),
            esNomina ? ui.banner('Gasto de nómina',
                'Proviene de una liquidación. Si cambia el valor aquí, no se corrige la liquidación: lo recomendable es eliminarla y liquidar de nuevo en Nómina.',
                'warning') : null,
            ui.banner('Cómo se contabiliza',
                'El gasto siempre afecta el estado de resultados en su fecha. Solo afecta el flujo de caja si está marcado como pagado.',
                'info')
        ]);

        const textoGuardar = editando ? 'Guardar cambios' : 'Registrar gasto';
        const btnGuardar = el('button', { class: 'btn', text: textoGuardar, attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: editando ? 'Editar gasto' : (importacion ? 'Registrar factura como gasto' : 'Nuevo gasto'),
            ancho: importacion ? 'ancho' : undefined,
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        let advertenciasAceptadas = false;
        formulario.addEventListener('input', () => {
            if (!advertenciasAceptadas) return;
            advertenciasAceptadas = false;
            btnGuardar.textContent = textoGuardar;
        });

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const payload = {
                fecha: campos.fecha.value,
                categoria: campos.categoria.value,
                descripcion: campos.descripcion.value,
                proveedor: campos.proveedor.value.trim(),
                referencia: campos.referencia.value.trim(),
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
                if (!U.isValidISO(payload.fecha)) {
                    errores.appendChild(ui.banner('Fecha inválida', 'Revise la fecha del gasto.', 'danger'));
                    return;
                }
                const cambios = {
                    ...payload,
                    valor: U.roundCop(payload.valor),
                    descripcion: payload.descripcion.trim() || payload.categoria
                };
                if (esNomina) delete cambios.referencia;
                db.update('gastos', gasto.id, cambios);
                ui.toastOk('Gasto actualizado', cambios.descripcion);
                ctrl.cerrar();
                return;
            }

            const cufe = importacion && importacion.datos ? importacion.datos.cufe : '';
            const duplicado = db.buscarDuplicado({ tipo: 'gasto', cufe, referencia: payload.referencia });
            if (duplicado && duplicado.certeza === 'cufe') {
                errores.appendChild(ui.banner('Factura ya registrada',
                    `El código CUFE de este PDF ya está registrado (${duplicado.doc.numero || duplicado.doc.descripcion}). No se registra dos veces.`,
                    'danger'));
                return;
            }

            if (!advertenciasAceptadas) {
                const avisos = [];
                if (duplicado) avisos.push(`Ya existe el gasto «${duplicado.doc.descripcion}» con la referencia ${payload.referencia}.`);
                const totalLeido = importacion && importacion.datos ? U.toNumber(importacion.datos.total) : 0;
                if (totalLeido > 0 && Math.abs(U.toNumber(payload.valor) - totalLeido) > Math.max(1000, totalLeido * 0.01)) {
                    avisos.push(`El valor digitado (${U.money(payload.valor)}) no coincide con el total de la factura (${U.money(totalLeido)}).`);
                }
                if (avisos.length) {
                    errores.appendChild(ui.banner('Revise antes de registrar', avisos.join(' '), 'warning'));
                    advertenciasAceptadas = true;
                    btnGuardar.textContent = 'Registrar de todos modos';
                    return;
                }
            }

            const res = db.registrarGasto({
                ...payload,
                origen: importacion ? 'pdf' : 'manual',
                archivoOrigen: importacion ? importacion.archivo : '',
                cufe
            });
            if (!res.ok) {
                errores.appendChild(ui.banner('No se pudo registrar', res.error, 'danger'));
                return;
            }
            ui.toastOk('Gasto registrado', `${payload.categoria} — ${U.money(payload.valor)}`);
            ctrl.cerrar();
            if (lectura && typeof lectura.onRegistrado === 'function') lectura.onRegistrado(res.gasto);
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

    const ORIGENES = { pdf: 'PDF', nomina: 'Nómina', fijo: 'Fijo', variable: 'Variable', manual: 'Manual' };

    const exportar = (lista) => {
        if (!lista.length) {
            ui.toastWarn('Nada que exportar', 'La tabla no tiene registros con los filtros actuales.');
            return;
        }
        try {
            const total = U.sum(lista, (g) => g.valor);
            const porCategoria = [...U.groupBy(lista, 'categoria').entries()]
                .map(([categoria, grupo]) => ({ categoria, registros: grupo.length, valor: U.sum(grupo, (g) => g.valor) }))
                .sort((a, b) => b.valor - a.valor);

            ERP.excel.descargar({
                archivo: ERP.excel.nombreArchivo('gastos'),
                titulo: 'Gastos',
                hojas: [
                    {
                        nombre: 'Gastos',
                        totales: true,
                        columnas: [
                            { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Periodo' }, { titulo: 'Categoría' },
                            { titulo: 'Descripción' }, { titulo: 'Proveedor' }, { titulo: 'Referencia' },
                            { titulo: 'Medio' }, { titulo: 'Estado' }, { titulo: 'Valor', tipo: 'moneda' }, { titulo: 'Origen' }
                        ],
                        filas: lista.map((g) => [
                            g.fecha, U.fmtPeriod(U.periodOf(g.fecha)), g.categoria, g.descripcion, g.proveedor || '',
                            g.origen === 'nomina' ? '' : (g.referencia || ''), g.medio,
                            g.pagado === false ? 'Por pagar' : 'Pagado', g.valor,
                            g.origen === 'pdf' ? `PDF: ${g.archivoOrigen || ''}` : (ORIGENES[g.origen] || 'Manual')
                        ])
                    },
                    {
                        nombre: 'Por categoría',
                        totales: true,
                        columnas: [
                            { titulo: 'Categoría' }, { titulo: 'Registros', tipo: 'entero' },
                            { titulo: 'Total', tipo: 'moneda' }, { titulo: 'Participación', tipo: 'porcentaje' }
                        ],
                        filas: porCategoria.map((c) => [c.categoria, c.registros, c.valor, total ? c.valor / total : 0])
                    }
                ]
            });
            ui.toastOk('Excel generado', `${lista.length} gastos exportados.`);
        } catch (error) {
            console.error(error);
            ui.toastError('No se pudo generar el Excel', 'Revise la consola para más detalle.');
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
        let tablaActual = null;

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
                {
                    clave: 'descripcion', titulo: 'Descripción', tipo: 'nodo', ordenable: true, ajustar: true,
                    valor: (g) => `${g.descripcion} ${g.proveedor || ''} ${g.origen === 'pdf' ? 'pdf' : ''}`,
                    render: (g) => el('div', { class: 'row row-wrap' }, [
                        el('span', { text: g.descripcion }),
                        g.origen === 'pdf' ? ui.badge('PDF', 'info') : null
                    ])
                },
                { clave: 'medio', titulo: 'Medio' },
                { clave: 'valor', titulo: 'Valor', tipo: 'moneda' },
                {
                    clave: 'pagado', titulo: 'Estado', tipo: 'nodo',
                    valor: (g) => (g.pagado === false ? 'Por pagar' : 'Pagado'),
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
                textoBusqueda: 'Buscar por descripción, proveedor o categoría…',
                porPagina: 12,
                totales: (l) => ({ fecha: `${l.length} gastos`, valor: U.sum(l, (g) => g.valor) })
            });

            zonaTabla.appendChild(ui.card(null, tabla.nodo, { sinRelleno: true }));
            tablaActual = tabla;
        };

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Gastos' }),
                    el('p', { text: 'Gastos operativos y administrativos categorizados para su imputación a los estados financieros.' })
                ]),
                el('div', { class: 'view-actions' }, [
                    el('button', {
                        class: 'btn btn-secondary', text: '⤓ Descargar Excel', attrs: { type: 'button' },
                        on: { click: () => exportar(tablaActual ? tablaActual.filas() : []) }
                    }),
                    el('button', {
                        class: 'btn btn-secondary', text: 'Cargar factura PDF', attrs: { type: 'button' },
                        on: { click: () => ERP.importador.abrir('gasto') }
                    }),
                    el('button', {
                        class: 'btn', text: '+ Nuevo gasto', attrs: { type: 'button' },
                        on: { click: () => abrirFormulario() }
                    })
                ])
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

    return { vista, abrirFormulario, exportar };
})();
