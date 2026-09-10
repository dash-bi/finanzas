/* ============================================================
   inventory.js — Catálogo, existencias y kardex
   El stock nunca se edita a mano: se mueve por compras y ventas.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.inventario = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const UNIDADES = ['unidad', 'caja', 'resma', 'paquete', 'kit', 'kg', 'litro', 'metro', 'servicio', 'hora'];

    const categorias = () => [...new Set(db.productos().map((p) => p.categoria))].sort();

    const margenPct = (producto) => {
        const precio = U.toNumber(producto.precio);
        if (precio <= 0) return 0;
        return ((precio - U.toNumber(producto.costo)) / precio) * 100;
    };

    /* ============================================================
       Formulario
       ============================================================ */

    /** Sugiere un SKU libre a partir del nombre: "Monitor LED 24" → "MON-0001". */
    const sugerirSku = (nombre) => {
        const prefijo = (U.normalize(nombre).replace(/[^a-z]/g, '').slice(0, 3) || 'ITM').toUpperCase();
        const usados = new Set(db.productos().map((p) => p.sku));
        let n = 1;
        while (usados.has(`${prefijo}-${String(n).padStart(4, '0')}`)) n += 1;
        return `${prefijo}-${String(n).padStart(4, '0')}`;
    };

    /**
     * opciones.prefill     valores iniciales para un ítem nuevo
     * opciones.onGuardado  recibe el ítem creado (creación desde una factura)
     */
    const abrirFormulario = (producto, opciones = {}) => {
        const editando = Boolean(producto);
        const desdeDocumento = !editando && typeof opciones.onGuardado === 'function';
        const prefill = opciones.prefill || {};
        const datos = producto || {
            sku: prefill.nombre ? sugerirSku(prefill.nombre) : '',
            nombre: prefill.nombre || '',
            categoria: prefill.categoria || '',
            unidad: prefill.unidad || 'unidad',
            tipo: prefill.tipo || 'producto',
            stock: 0,
            stockMinimo: 0,
            costo: U.toNumber(prefill.costo),
            precio: U.toNumber(prefill.precio),
            gravado: true,
            activo: true
        };

        const campos = {
            sku: ui.input({ valor: datos.sku, placeholder: 'TEC-1001' }),
            nombre: ui.input({ valor: datos.nombre, placeholder: 'Nombre comercial del ítem' }),
            categoria: ui.input({ valor: datos.categoria, placeholder: 'Tecnología, Papelería…' }),
            unidad: ui.select(UNIDADES, { valor: datos.unidad }),
            tipo: ui.select([
                { valor: 'producto', texto: 'Producto (maneja inventario)' },
                { valor: 'servicio', texto: 'Servicio (no maneja inventario)' }
            ], { valor: datos.tipo }),
            stockMinimo: ui.input({ tipo: 'number', valor: datos.stockMinimo, numerico: true, min: 0 }),
            costo: ui.input({ tipo: 'number', valor: datos.costo, numerico: true, min: 0, step: 100 }),
            precio: ui.input({ tipo: 'number', valor: datos.precio, numerico: true, min: 0, step: 100 }),
            stockInicial: ui.input({ tipo: 'number', valor: 0, numerico: true, min: 0 }),
            gravado: el('input', { attrs: { type: 'checkbox' }, props: { checked: datos.gravado !== false } }),
            activo: el('input', { attrs: { type: 'checkbox' }, props: { checked: datos.activo !== false } })
        };

        const lecturaMargen = el('p', { class: 'hint' });

        const recalcularMargen = () => {
            const costo = U.toNumber(campos.costo.value);
            const precio = U.toNumber(campos.precio.value);
            if (precio <= 0) {
                lecturaMargen.textContent = 'Defina un precio de venta para calcular el margen.';
                lecturaMargen.className = 'hint';
                return;
            }
            const margen = ((precio - costo) / precio) * 100;
            lecturaMargen.textContent = `Margen bruto: ${U.pct(margen)} · Utilidad por unidad: ${U.money(precio - costo)}`;
            lecturaMargen.className = margen < 0 ? 'error-text' : 'hint';
        };

        campos.costo.addEventListener('input', recalcularMargen);
        campos.precio.addEventListener('input', recalcularMargen);

        const filaStockInicial = ui.campo('Existencia inicial', campos.stockInicial, {
            ayuda: 'Se registra como una compra de apertura para que el inventario cuadre contablemente.'
        });

        const alternarTipo = () => {
            const esServicio = campos.tipo.value === 'servicio';
            filaStockInicial.classList.toggle('is-hidden', esServicio || editando || desdeDocumento);
            campos.stockMinimo.disabled = esServicio;
        };
        campos.tipo.addEventListener('change', alternarTipo);

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            el('div', { class: 'grid-form' }, [
                ui.campo('SKU / código', campos.sku),
                ui.campo('Tipo de ítem', campos.tipo),
                ui.campo('Nombre', campos.nombre, { clase: 'span-full' }),
                ui.campo('Categoría', campos.categoria),
                ui.campo('Unidad de medida', campos.unidad),
                ui.campo('Existencia mínima', campos.stockMinimo, { ayuda: 'Umbral que dispara la alerta de reposición.' }),
                ui.campo('Precio de costo', campos.costo),
                ui.campo('Precio de venta', campos.precio),
                (editando || desdeDocumento) ? null : filaStockInicial
            ]),
            desdeDocumento ? ui.banner('Existencias',
                'El ítem se crea sin existencias: las unidades entran con el documento que está registrando.', 'info') : null,
            lecturaMargen,
            el('div', { class: 'row row-wrap' }, [
                el('label', { class: 'check' }, [campos.gravado, el('span', { text: 'Grava IVA' })]),
                el('label', { class: 'check' }, [campos.activo, el('span', { text: 'Ítem activo' })])
            ]),
            editando ? ui.banner('Existencias',
                `Stock actual: ${U.num(datos.stock)} ${datos.unidad}. El stock solo cambia con compras, ventas o anulaciones.`,
                'info') : null
        ]);

        const btnGuardar = el('button', { class: 'btn', text: editando ? 'Guardar cambios' : 'Crear ítem', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: editando ? 'Editar ítem' : 'Nuevo ítem de inventario',
            subtitulo: editando ? `${datos.sku} — ${datos.nombre}` : 'Producto o servicio del catálogo',
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        recalcularMargen();
        alternarTipo();
        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const sku = campos.sku.value.trim().toUpperCase();
            const nombre = campos.nombre.value.trim();
            const costo = U.toNumber(campos.costo.value);
            const precio = U.toNumber(campos.precio.value);

            const fallas = [];
            if (!sku) fallas.push('El SKU es obligatorio.');
            if (nombre.length < 3) fallas.push('El nombre debe tener al menos 3 caracteres.');
            if (!campos.categoria.value.trim()) fallas.push('La categoría es obligatoria.');
            if (precio <= 0) fallas.push('El precio de venta debe ser mayor que cero.');
            if (costo < 0) fallas.push('El costo no puede ser negativo.');

            const duplicado = db.productos().find((p) => p.sku === sku && (!editando || p.id !== producto.id));
            if (duplicado) fallas.push(`Ya existe un ítem con el SKU ${sku}.`);

            if (fallas.length) {
                errores.appendChild(ui.banner('Revise los siguientes puntos', fallas.join(' '), 'danger'));
                return;
            }

            const payload = {
                sku,
                nombre,
                categoria: campos.categoria.value.trim(),
                unidad: campos.unidad.value,
                tipo: campos.tipo.value,
                stockMinimo: campos.tipo.value === 'servicio' ? 0 : U.toNumber(campos.stockMinimo.value),
                costo,
                precio,
                gravado: campos.gravado.checked,
                activo: campos.activo.checked
            };

            let creado = null;
            if (editando) {
                db.update('productos', producto.id, payload);
                ui.toastOk('Ítem actualizado', nombre);
            } else {
                const nuevo = db.insert('productos', { ...payload, stock: 0 });
                const inicial = U.toNumber(campos.stockInicial.value);

                if (!desdeDocumento && inicial > 0 && payload.tipo === 'producto') {
                    const proveedor = db.proveedores()[0];
                    if (!proveedor) {
                        ui.toastWarn('Ítem creado sin existencias',
                            'Registre primero un proveedor para poder cargar la existencia inicial.');
                    } else {
                        const res = db.registrarCompra({
                            fecha: U.today(),
                            proveedorId: proveedor.id,
                            condicion: 'contado',
                            medioPago: 'Transferencia',
                            documentoProveedor: 'APERTURA',
                            observaciones: `Existencia inicial de ${nombre}`,
                            items: [{ productoId: nuevo.id, cantidad: inicial, valorUnitario: costo, descuentoPct: 0 }]
                        });
                        if (!res.ok) ui.toastError('No se cargó la existencia inicial', res.error);
                    }
                }
                ui.toastOk('Ítem creado', `${sku} — ${nombre}`);
                // Se notifica después de cerrar, para devolver el foco al documento de origen.
                creado = nuevo;
            }
            ctrl.cerrar();
            // Se notifica después de cerrar: el foco ya volvió al documento de origen.
            if (desdeDocumento && creado) opciones.onGuardado(creado);
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ============================================================
       Kardex: reconstruye los movimientos del ítem
       ============================================================ */

    const abrirKardex = (producto) => {
        const movimientos = [];

        db.all('compras').forEach((compra) => {
            compra.items
                .filter((item) => item.productoId === producto.id)
                .forEach((item) => movimientos.push({
                    fecha: compra.fecha,
                    documento: compra.numero,
                    concepto: `Compra a ${db.nombreTercero(compra.proveedorId)}`,
                    entrada: item.cantidad,
                    salida: 0,
                    valorUnitario: item.valorUnitario
                }));
        });

        db.all('ventas').filter((v) => !v.anulada).forEach((venta) => {
            venta.items
                .filter((item) => item.productoId === producto.id)
                .forEach((item) => movimientos.push({
                    fecha: venta.fecha,
                    documento: venta.numero,
                    concepto: `Venta a ${db.nombreTercero(venta.clienteId)}`,
                    entrada: 0,
                    salida: item.cantidad,
                    valorUnitario: item.valorUnitario
                }));
        });

        const ordenados = U.sortBy(movimientos, 'fecha');
        let saldo = 0;
        ordenados.forEach((mov) => {
            saldo += mov.entrada - mov.salida;
            mov.saldo = saldo;
        });

        const tabla = ui.tabla([...ordenados].reverse(), [
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
            { clave: 'documento', titulo: 'Documento' },
            { clave: 'concepto', titulo: 'Concepto', ajustar: true },
            { clave: 'entrada', titulo: 'Entrada', tipo: 'numero' },
            { clave: 'salida', titulo: 'Salida', tipo: 'numero' },
            { clave: 'valorUnitario', titulo: 'V. unitario', tipo: 'moneda' },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'numero' }
        ], {
            porPagina: 10,
            buscador: false,
            vacio: ui.estadoVacio('Sin movimientos', 'Este ítem todavía no registra entradas ni salidas.')
        });

        ui.modal({
            titulo: `Kardex — ${producto.nombre}`,
            subtitulo: `${producto.sku} · ${producto.categoria}`,
            ancho: 'ancho',
            contenido: el('div', { class: 'stack' }, [
                el('div', { class: 'grid-kpi' }, [
                    ui.kpi('Existencia actual', `${U.num(producto.stock)} ${producto.unidad}`,
                        `Mínimo ${U.num(producto.stockMinimo)}`, 'var(--c1)'),
                    ui.kpi('Costo promedio', U.money(producto.costo), 'Promedio ponderado', 'var(--c3)'),
                    ui.kpi('Valor en inventario', U.money(U.toNumber(producto.stock) * U.toNumber(producto.costo)),
                        'Al costo', 'var(--c5)'),
                    ui.kpi('Unidades vendidas', U.num(U.sum(ordenados, (m) => m.salida)),
                        `${U.num(U.sum(ordenados, (m) => m.entrada))} compradas`, 'var(--c2)')
                ]),
                tabla.nodo
            ])
        });
    };

    /* ============================================================
       Exportación a Excel
       ============================================================ */

    const exportar = (lista) => {
        if (!lista.length) {
            ui.toastWarn('Nada que exportar', 'La tabla no tiene registros con los filtros actuales.');
            return;
        }
        try {
            ERP.excel.descargar({
                archivo: ERP.excel.nombreArchivo('inventario'),
                titulo: 'Inventario',
                hojas: [{
                    nombre: 'Inventario',
                    totales: true,
                    columnas: [
                        { titulo: 'SKU' }, { titulo: 'Ítem' }, { titulo: 'Categoría' }, { titulo: 'Tipo' },
                        { titulo: 'Unidad' }, { titulo: 'Existencia', tipo: 'numero' }, { titulo: 'Mínimo', tipo: 'numero' },
                        { titulo: 'Estado' }, { titulo: 'Costo promedio', tipo: 'moneda' }, { titulo: 'Precio de venta', tipo: 'moneda' },
                        { titulo: 'Margen', tipo: 'porcentaje' }, { titulo: 'Valor al costo', tipo: 'moneda' },
                        { titulo: 'Valor a precio de venta', tipo: 'moneda' }, { titulo: 'Activo' }
                    ],
                    filas: lista.map((p) => {
                        const inventariable = p.tipo === 'producto';
                        const estado = !inventariable ? 'Servicio'
                            : (U.toNumber(p.stock) <= U.toNumber(p.stockMinimo) ? 'Reponer' : 'En nivel');
                        return [
                            p.sku, p.nombre, p.categoria, inventariable ? 'Producto' : 'Servicio', p.unidad,
                            inventariable ? U.toNumber(p.stock) : null, inventariable ? U.toNumber(p.stockMinimo) : null,
                            estado, U.toNumber(p.costo), U.toNumber(p.precio), margenPct(p) / 100,
                            inventariable ? U.toNumber(p.stock) * U.toNumber(p.costo) : 0,
                            inventariable ? U.toNumber(p.stock) * U.toNumber(p.precio) : 0,
                            p.activo === false ? 'No' : 'Sí'
                        ];
                    })
                }]
            });
            ui.toastOk('Excel generado', `${lista.length} ítems exportados.`);
        } catch (error) {
            console.error(error);
            ui.toastError('No se pudo generar el Excel', 'Revise la consola para más detalle.');
        }
    };

    /* ============================================================
       Vista
       ============================================================ */

    const vista = (contenedor) => {
        const productos = db.productos();
        const inventariables = productos.filter((p) => p.tipo === 'producto');
        const bajoMinimo = db.productosBajoMinimo();

        const valorCosto = U.sum(inventariables, (p) => U.toNumber(p.stock) * U.toNumber(p.costo));
        const valorVenta = U.sum(inventariables, (p) => U.toNumber(p.stock) * U.toNumber(p.precio));

        const filtros = { categoria: '', soloAlerta: false };
        const zonaTabla = el('div');
        let tablaActual = null;

        const pintarTabla = () => {
            U.clear(zonaTabla);

            const lista = productos.filter((p) => {
                if (filtros.categoria && p.categoria !== filtros.categoria) return false;
                if (filtros.soloAlerta && !(p.tipo === 'producto' && U.toNumber(p.stock) <= U.toNumber(p.stockMinimo))) return false;
                return true;
            });

            const tabla = ui.tabla(lista, [
                { clave: 'sku', titulo: 'SKU' },
                { clave: 'nombre', titulo: 'Ítem', ajustar: true },
                { clave: 'categoria', titulo: 'Categoría' },
                {
                    clave: 'stock', titulo: 'Existencia', tipo: 'nodo',
                    valor: (p) => U.toNumber(p.stock),
                    render: (p) => {
                        if (p.tipo === 'servicio') return el('span', { class: 'text-soft', text: 'Servicio' });
                        const bajo = U.toNumber(p.stock) <= U.toNumber(p.stockMinimo);
                        return el('div', { class: 'row' }, [
                            el('span', { class: `num strong${bajo ? ' neg' : ''}`, text: `${U.num(p.stock)} ${p.unidad}` }),
                            bajo ? ui.badge('Reponer', 'danger') : null
                        ]);
                    }
                },
                { clave: 'stockMinimo', titulo: 'Mínimo', tipo: 'numero' },
                { clave: 'costo', titulo: 'Costo', tipo: 'moneda' },
                { clave: 'precio', titulo: 'Precio', tipo: 'moneda' },
                {
                    clave: 'margen', titulo: 'Margen', tipo: 'nodo',
                    valor: (p) => margenPct(p),
                    render: (p) => {
                        const m = margenPct(p);
                        return el('span', { class: `num ${m < 15 ? 'neg' : 'pos'}`, text: U.pct(m) });
                    }
                },
                {
                    clave: 'valorizado', titulo: 'Valor al costo', tipo: 'moneda',
                    valor: (p) => U.toNumber(p.stock) * U.toNumber(p.costo)
                },
                {
                    clave: 'acciones', titulo: '', tipo: 'nodo',
                    render: (p) => el('div', { class: 'row' }, [
                        el('button', {
                            class: 'btn btn-secondary btn-sm', text: 'Kardex', attrs: { type: 'button' },
                            on: { click: () => abrirKardex(p) }
                        }),
                        el('button', {
                            class: 'btn btn-ghost btn-sm', text: 'Editar', attrs: { type: 'button' },
                            on: { click: () => abrirFormulario(p) }
                        })
                    ])
                }
            ], {
                ordenInicial: 'nombre',
                textoBusqueda: 'Buscar por SKU, nombre o categoría…',
                porPagina: 12,
                totales: (l) => ({
                    sku: `${l.length} ítems`,
                    valorizado: U.sum(l, (p) => U.toNumber(p.stock) * U.toNumber(p.costo))
                })
            });

            zonaTabla.appendChild(ui.card(null, tabla.nodo, { sinRelleno: true }));
            tablaActual = tabla;
        };

        const selectCategoria = ui.select(categorias(), {
            placeholder: 'Todas las categorías',
            on: { change: (e) => { filtros.categoria = e.target.value; pintarTabla(); } }
        });

        const checkAlerta = el('input', {
            attrs: { type: 'checkbox' },
            on: { change: (e) => { filtros.soloAlerta = e.target.checked; pintarTabla(); } }
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Inventario' }),
                    el('p', { text: 'Catálogo de productos y servicios. Las existencias se mueven automáticamente con las compras y las ventas.' })
                ]),
                el('div', { class: 'view-actions' }, [
                    el('button', {
                        class: 'btn btn-secondary', text: '⤓ Descargar Excel', attrs: { type: 'button' },
                        on: { click: () => exportar(tablaActual ? tablaActual.filas() : []) }
                    }),
                    el('button', {
                        class: 'btn', text: '+ Nuevo ítem', attrs: { type: 'button' },
                        on: { click: () => abrirFormulario() }
                    })
                ])
            ]),

            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Ítems en catálogo', U.num(productos.length),
                    `${inventariables.length} con inventario`, 'var(--c1)'),
                ui.kpi('Valor del inventario', U.money(valorCosto), 'Valorado al costo promedio', 'var(--c5)'),
                ui.kpi('Valor a precio de venta', U.money(valorVenta),
                    `Utilidad potencial ${U.money(valorVenta - valorCosto)}`, 'var(--c2)'),
                ui.kpi('Ítems bajo el mínimo', U.num(bajoMinimo.length),
                    bajoMinimo.length ? 'Requieren reposición' : 'Todo en nivel adecuado',
                    bajoMinimo.length ? 'var(--c6)' : 'var(--c2)')
            ]),

            bajoMinimo.length
                ? ui.banner('Alerta de existencias',
                    `${bajoMinimo.length} ${bajoMinimo.length === 1 ? 'ítem está' : 'ítems están'} en o por debajo del mínimo: ${bajoMinimo.slice(0, 4).map((p) => p.nombre).join(', ')}${bajoMinimo.length > 4 ? '…' : ''}`,
                    'warning')
                : null,

            el('div', { class: 'filters' }, [
                ui.campo('Categoría', selectCategoria),
                el('label', { class: 'check', style: { paddingBottom: '9px' } }, [
                    checkAlerta, el('span', { text: 'Solo ítems por reponer' })
                ])
            ]),

            zonaTabla
        ]);

        pintarTabla();
    };

    return { vista, abrirFormulario, abrirKardex, margenPct, categorias, exportar };
})();
