/* ============================================================
   lines.js — Editor de líneas de documento
   Componente compartido por compras y ventas: agrega ítems,
   calcula el neto de cada línea y los totales del documento.
   Admite filas precargadas (edición e importación desde PDF).
   ============================================================ */

window.ERP = window.ERP || {};

ERP.lineas = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const CREAR = '__crear__';

    /**
     * modo: 'venta' usa el precio de venta y valida existencias;
     *       'compra' usa el precio de costo y no valida existencias.
     * opciones:
     *   items         filas iniciales [{ productoId, cantidad, valorUnitario, descuentoPct, leido }]
     *   reservado     { productoId: cantidad } unidades que ya tiene el documento que se edita
     *   permitirCrear agrega la opción de crear un producto desde la línea
     */
    const editor = (modo, opciones = {}) => {
        const esVenta = modo === 'venta';
        const reservado = opciones.reservado || {};
        const filas = [];

        const cuerpo = el('tbody');
        const zonaTotales = el('div', { class: 'totals' });
        const avisos = el('div', { class: 'stack-sm' });

        // En compras solo se listan ítems inventariables: la contratación de
        // servicios se registra como gasto, no como entrada de inventario.
        const disponibles = () => db.productos().filter(
            (p) => p.activo !== false && (esVenta || p.tipo === 'producto'));

        // Al editar una venta, sus propias unidades vuelven a estar disponibles.
        const existenciaDisponible = (producto) => U.toNumber(producto.stock) + U.toNumber(reservado[producto.id]);

        const llenarSelector = (select, valor) => {
            U.clear(select);
            select.appendChild(el('option', { text: 'Seleccione un ítem…', attrs: { value: '' } }));
            const lista = disponibles();
            lista.forEach((p) => select.appendChild(el('option', {
                text: `${p.sku} — ${U.truncate(p.nombre, 46)}`,
                attrs: { value: p.id }
            })));
            // Un ítem ya inactivo que figura en el documento debe seguir visible al editarlo.
            if (valor && !lista.some((p) => p.id === valor)) {
                const producto = db.productoPorId(valor);
                if (producto) {
                    select.appendChild(el('option', {
                        text: `${producto.sku} — ${U.truncate(producto.nombre, 38)} (inactivo)`,
                        attrs: { value: producto.id }
                    }));
                }
            }
            if (opciones.permitirCrear) {
                select.appendChild(el('option', { text: '+ Crear producto nuevo…', attrs: { value: CREAR } }));
            }
            select.value = valor || '';
        };

        const recalcular = () => {
            U.clear(zonaTotales);
            U.clear(avisos);

            const items = obtener();
            const totales = db.calcularDocumento(items, db.config().ivaPct);

            [
                ['Subtotal', totales.subtotal, false],
                [`IVA (${U.num(db.config().ivaPct)} %)`, totales.iva, false],
                ['Total', totales.total, true]
            ].forEach(([etiqueta, valor, esTotal]) => {
                zonaTotales.appendChild(el('div', { class: `totals-line${esTotal ? ' total' : ''}` }, [
                    el('span', { text: etiqueta }),
                    el('span', { class: 'num', text: U.money(valor) })
                ]));
            });

            const pendientes = lineasSinProducto();
            if (pendientes > 0) {
                avisos.appendChild(ui.banner('Líneas sin producto',
                    `${pendientes} ${pendientes === 1 ? 'línea leída del PDF no tiene' : 'líneas leídas del PDF no tienen'} producto asignado. Elíjalo o créelo antes de guardar.`,
                    'warning'));
            }

            // Aviso temprano de existencias, antes de intentar guardar.
            if (esVenta) {
                const requerido = new Map();
                items.forEach((item) => {
                    requerido.set(item.productoId, (requerido.get(item.productoId) || 0) + U.toNumber(item.cantidad));
                });
                requerido.forEach((cantidad, productoId) => {
                    const producto = db.productoPorId(productoId);
                    if (!producto || producto.tipo !== 'producto') return;
                    const disponible = existenciaDisponible(producto);
                    if (cantidad > disponible) {
                        avisos.appendChild(ui.banner('Existencias insuficientes',
                            `${producto.nombre}: solicita ${U.num(cantidad)} y hay ${U.num(disponible)} ${producto.unidad}.`,
                            'danger'));
                    } else if (disponible - cantidad <= U.toNumber(producto.stockMinimo)) {
                        avisos.appendChild(ui.banner('Quedará bajo el mínimo',
                            `${producto.nombre} quedará en ${U.num(disponible - cantidad)} ${producto.unidad} (mínimo ${U.num(producto.stockMinimo)}).`,
                            'warning'));
                    }
                });
            }

            if (typeof editorPublico.onCambio === 'function') editorPublico.onCambio(totales, items);
        };

        const crearProductoDesde = (fila) => {
            if (!ERP.inventario || typeof ERP.inventario.abrirFormulario !== 'function') return;
            const valor = U.toNumber(fila.inpValor.value);
            ERP.inventario.abrirFormulario(null, {
                prefill: {
                    nombre: String(fila.descripcion || fila.leido || '').slice(0, 80),
                    tipo: 'producto',
                    costo: esVenta ? 0 : valor,
                    precio: esVenta ? valor : 0
                },
                onGuardado: (producto) => {
                    refrescarProductos();
                    fila.selProducto.value = producto.id;
                    fila.productoPrevio = producto.id;
                    fila.actualizar();
                }
            });
        };

        const agregarFila = (preset) => {
            const fila = {
                leido: preset && preset.leido ? String(preset.leido) : '',
                // Sin el código del proveedor: es el nombre que tendrá un producto creado desde la línea.
                descripcion: preset && preset.descripcion ? String(preset.descripcion) : '',
                productoPrevio: preset && preset.productoId ? preset.productoId : ''
            };

            const selProducto = el('select', { class: 'select', attrs: { 'aria-label': 'Ítem de la línea' } });
            llenarSelector(selProducto, fila.productoPrevio);

            const inpCantidad = ui.input({ tipo: 'number', valor: preset ? preset.cantidad : 1, numerico: true, min: 0, step: 'any' });
            const inpValor = ui.input({ tipo: 'number', valor: preset ? preset.valorUnitario : 0, numerico: true, min: 0, step: 'any' });
            const inpDescuento = ui.input({ tipo: 'number', valor: preset ? (preset.descuentoPct || 0) : 0, numerico: true, min: 0, max: 100, step: 'any' });
            inpCantidad.setAttribute('aria-label', 'Cantidad');
            inpValor.setAttribute('aria-label', esVenta ? 'Precio unitario' : 'Costo unitario');
            inpDescuento.setAttribute('aria-label', 'Descuento en porcentaje');

            const celdaNeto = el('td', { class: 'num strong' });
            const celdaInfo = el('span', { class: 'hint' });
            const celdaLeido = fila.leido ? el('span', { class: 'leido-hint' }) : null;

            const actualizarNeto = () => {
                const bruto = U.toNumber(inpCantidad.value) * U.toNumber(inpValor.value);
                const neto = bruto - bruto * (U.toNumber(inpDescuento.value) / 100);
                celdaNeto.textContent = U.money(neto);

                const producto = db.productoPorId(selProducto.value);
                if (producto && producto.tipo === 'producto') {
                    celdaInfo.textContent = esVenta
                        ? `Disponible: ${U.num(existenciaDisponible(producto))} ${producto.unidad}`
                        : `Existencia actual: ${U.num(producto.stock)} ${producto.unidad}`;
                } else if (producto) {
                    celdaInfo.textContent = 'Servicio, no afecta inventario';
                } else {
                    celdaInfo.textContent = '';
                }

                if (celdaLeido) {
                    celdaLeido.textContent = producto
                        ? `PDF: «${U.truncate(fila.leido, 70)}»`
                        : `Leído en el PDF: «${U.truncate(fila.leido, 70)}». Elija el producto o créelo.`;
                    celdaLeido.classList.toggle('is-ok', Boolean(producto));
                }
                recalcular();
            };
            fila.actualizar = actualizarNeto;

            selProducto.addEventListener('change', () => {
                if (selProducto.value === CREAR) {
                    selProducto.value = fila.productoPrevio;
                    crearProductoDesde(fila);
                    return;
                }
                fila.productoPrevio = selProducto.value;
                const producto = db.productoPorId(selProducto.value);
                // En líneas leídas de un PDF manda el valor de la factura, no el del catálogo.
                if (producto && !fila.leido) inpValor.value = String(esVenta ? producto.precio : producto.costo);
                actualizarNeto();
            });

            [inpCantidad, inpValor, inpDescuento].forEach((campo) => {
                campo.addEventListener('input', actualizarNeto);
            });

            const btnQuitar = el('button', {
                class: 'icon-btn', text: '✕',
                attrs: { type: 'button', 'aria-label': 'Quitar línea' },
                on: {
                    click: () => {
                        const idx = filas.indexOf(fila);
                        if (idx >= 0) filas.splice(idx, 1);
                        nodoFila.remove();
                        if (filas.length === 0) agregarFila();
                        recalcular();
                    }
                }
            });

            const nodoFila = el('tr', {}, [
                el('td', { class: 'wrap' }, [selProducto, celdaInfo, celdaLeido]),
                el('td', {}, [inpCantidad]),
                el('td', {}, [inpValor]),
                el('td', {}, [inpDescuento]),
                celdaNeto,
                el('td', {}, [btnQuitar])
            ]);

            Object.assign(fila, { selProducto, inpCantidad, inpValor, inpDescuento, nodoFila });
            filas.push(fila);
            cuerpo.appendChild(nodoFila);
            actualizarNeto();
            return fila;
        };

        const obtener = () => filas
            .filter((fila) => fila.selProducto.value && fila.selProducto.value !== CREAR)
            .map((fila) => ({
                productoId: fila.selProducto.value,
                cantidad: U.toNumber(fila.inpCantidad.value),
                valorUnitario: U.toNumber(fila.inpValor.value),
                descuentoPct: U.toNumber(fila.inpDescuento.value)
            }));

        /** Líneas con datos leídos o valor digitado pero sin producto elegido. */
        const lineasSinProducto = () => filas.filter((fila) => !fila.selProducto.value
            && (fila.leido || U.toNumber(fila.inpValor.value) > 0)).length;

        const refrescarProductos = () => {
            filas.forEach((fila) => llenarSelector(fila.selProducto, fila.selProducto.value));
        };

        const btnAgregar = el('button', {
            class: 'btn btn-secondary btn-sm', text: '+ Agregar línea',
            attrs: { type: 'button' },
            on: { click: () => agregarFila() }
        });

        const tabla = el('div', { class: 'table-wrap' }, [
            el('table', { class: 'data' }, [
                el('thead', {}, [
                    el('tr', {}, [
                        el('th', { text: 'Ítem', attrs: { scope: 'col' } }),
                        el('th', { text: 'Cantidad', attrs: { scope: 'col' }, style: { width: '110px' } }),
                        el('th', { text: esVenta ? 'Precio' : 'Costo', attrs: { scope: 'col' }, style: { width: '140px' } }),
                        el('th', { text: 'Dto. %', attrs: { scope: 'col' }, style: { width: '90px' } }),
                        el('th', { class: 'num', text: 'Neto', attrs: { scope: 'col' } }),
                        el('th', { attrs: { scope: 'col' }, style: { width: '48px' } })
                    ])
                ]),
                cuerpo
            ])
        ]);

        const nodo = el('div', { class: 'stack' }, [
            tabla,
            el('div', { class: 'row-between row-wrap' }, [btnAgregar]),
            avisos,
            zonaTotales
        ]);

        const editorPublico = {
            nodo,
            obtener,
            agregarFila,
            recalcular,
            lineasSinProducto,
            refrescarProductos,
            get totales() { return db.calcularDocumento(obtener(), db.config().ivaPct); },
            onCambio: null
        };

        if (Array.isArray(opciones.items) && opciones.items.length) {
            opciones.items.forEach((item) => agregarFila(item));
        } else {
            agregarFila();
        }
        return editorPublico;
    };

    return { editor };
})();
