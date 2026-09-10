/* ============================================================
   lines.js — Editor de líneas de documento
   Componente compartido por compras y ventas: agrega ítems,
   calcula el neto de cada línea y los totales del documento.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.lineas = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    /**
     * modo: 'venta' usa el precio de venta y valida existencias;
     *       'compra' usa el precio de costo y no valida existencias.
     */
    const editor = (modo) => {
        const esVenta = modo === 'venta';
        const filas = [];

        const cuerpo = el('tbody');
        const zonaTotales = el('div', { class: 'totals' });
        const avisos = el('div', { class: 'stack-sm' });

        // En compras solo se listan ítems inventariables: la contratación de
        // servicios se registra como gasto, no como entrada de inventario.
        const disponibles = db.productos().filter(
            (p) => p.activo !== false && (esVenta || p.tipo === 'producto'));

        const opcionesProducto = disponibles.map((p) => ({
            valor: p.id,
            texto: `${p.sku} — ${U.truncate(p.nombre, 46)}`
        }));

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

            // Aviso temprano de existencias, antes de intentar guardar.
            if (esVenta) {
                const requerido = new Map();
                items.forEach((item) => {
                    requerido.set(item.productoId, (requerido.get(item.productoId) || 0) + U.toNumber(item.cantidad));
                });
                requerido.forEach((cantidad, productoId) => {
                    const producto = db.productoPorId(productoId);
                    if (!producto || producto.tipo !== 'producto') return;
                    if (cantidad > U.toNumber(producto.stock)) {
                        avisos.appendChild(ui.banner('Existencias insuficientes',
                            `${producto.nombre}: solicita ${U.num(cantidad)} y hay ${U.num(producto.stock)} ${producto.unidad}.`,
                            'danger'));
                    } else if (U.toNumber(producto.stock) - cantidad <= U.toNumber(producto.stockMinimo)) {
                        avisos.appendChild(ui.banner('Quedará bajo el mínimo',
                            `${producto.nombre} quedará en ${U.num(U.toNumber(producto.stock) - cantidad)} ${producto.unidad} (mínimo ${U.num(producto.stockMinimo)}).`,
                            'warning'));
                    }
                });
            }

            if (typeof editorPublico.onCambio === 'function') editorPublico.onCambio(totales, items);
        };

        const agregarFila = (preset) => {
            const fila = { };

            const selProducto = ui.select(opcionesProducto, {
                placeholder: 'Seleccione un ítem…',
                valor: preset ? preset.productoId : ''
            });
            const inpCantidad = ui.input({ tipo: 'number', valor: preset ? preset.cantidad : 1, numerico: true, min: 0, step: 1 });
            const inpValor = ui.input({ tipo: 'number', valor: preset ? preset.valorUnitario : 0, numerico: true, min: 0, step: 100 });
            const inpDescuento = ui.input({ tipo: 'number', valor: preset ? preset.descuentoPct : 0, numerico: true, min: 0, max: 100, step: 1 });
            const celdaNeto = el('td', { class: 'num strong' });
            const celdaInfo = el('span', { class: 'hint' });

            const actualizarNeto = () => {
                const bruto = U.toNumber(inpCantidad.value) * U.toNumber(inpValor.value);
                const neto = bruto - bruto * (U.toNumber(inpDescuento.value) / 100);
                celdaNeto.textContent = U.money(neto);

                const producto = db.productoPorId(selProducto.value);
                if (producto && producto.tipo === 'producto') {
                    celdaInfo.textContent = esVenta
                        ? `Disponible: ${U.num(producto.stock)} ${producto.unidad}`
                        : `Existencia actual: ${U.num(producto.stock)} ${producto.unidad}`;
                } else if (producto) {
                    celdaInfo.textContent = 'Servicio, no afecta inventario';
                } else {
                    celdaInfo.textContent = '';
                }
                recalcular();
            };

            selProducto.addEventListener('change', () => {
                const producto = db.productoPorId(selProducto.value);
                if (producto) inpValor.value = String(esVenta ? producto.precio : producto.costo);
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
                el('td', { class: 'wrap' }, [selProducto, celdaInfo]),
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
            .filter((fila) => fila.selProducto.value)
            .map((fila) => ({
                productoId: fila.selProducto.value,
                cantidad: U.toNumber(fila.inpCantidad.value),
                valorUnitario: U.toNumber(fila.inpValor.value),
                descuentoPct: U.toNumber(fila.inpDescuento.value)
            }));

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
            get totales() { return db.calcularDocumento(obtener(), db.config().ivaPct); },
            onCambio: null
        };

        agregarFila();
        return editorPublico;
    };

    return { editor };
})();
