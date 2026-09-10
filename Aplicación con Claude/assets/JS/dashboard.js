/* ============================================================
   dashboard.js — Tablero ejecutivo
   Los filtros son la pieza central: KPIs, gráficos y tablas
   se alimentan siempre del MISMO conjunto de datos filtrado.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.dashboard = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;
    const fin = ERP.finanzas;

    const estado = {
        rango: 'mes',
        desde: U.startOfMonth(U.today()),
        hasta: U.today(),
        categoria: '',
        productoId: ''
    };

    const RANGOS = [
        { valor: 'hoy', texto: 'Hoy' },
        { valor: 'semana', texto: 'Esta semana' },
        { valor: 'mes', texto: 'Mes actual' },
        { valor: 'trimestre', texto: 'Últimos 3 meses' },
        { valor: 'ano', texto: 'Año en curso' },
        { valor: 'personalizado', texto: 'Rango personalizado' }
    ];

    const aplicarRango = (clave) => {
        const hoy = U.today();
        estado.rango = clave;
        if (clave === 'hoy') { estado.desde = hoy; estado.hasta = hoy; }
        if (clave === 'semana') { estado.desde = U.startOfWeek(hoy); estado.hasta = hoy; }
        if (clave === 'mes') { estado.desde = U.startOfMonth(hoy); estado.hasta = hoy; }
        if (clave === 'trimestre') { estado.desde = U.startOfMonth(U.addMonths(hoy, -2)); estado.hasta = hoy; }
        if (clave === 'ano') { estado.desde = `${hoy.slice(0, 4)}-01-01`; estado.hasta = hoy; }
    };

    /* ============================================================
       Selección de datos: una sola función alimenta todo el tablero
       ============================================================ */

    const coincideItem = (item) => {
        if (!estado.categoria && !estado.productoId) return true;
        const producto = db.productoPorId(item.productoId);
        if (!producto) return false;
        if (estado.productoId && producto.id !== estado.productoId) return false;
        if (estado.categoria && producto.categoria !== estado.categoria) return false;
        return true;
    };

    const netoItem = (item) => {
        const bruto = U.toNumber(item.cantidad) * U.toNumber(item.valorUnitario);
        return bruto - bruto * (U.toNumber(item.descuentoPct) / 100);
    };

    const datosFiltrados = (desde, hasta) => {
        const ventas = db.all('ventas').filter(
            (v) => !v.anulada && v.fecha >= desde && v.fecha <= hasta);

        let ingresos = 0;
        let costoVentas = 0;
        let unidades = 0;
        const facturas = new Set();

        ventas.forEach((venta) => {
            venta.items.filter(coincideItem).forEach((item) => {
                ingresos += netoItem(item);
                costoVentas += U.toNumber(item.cantidad) * U.toNumber(item.costoUnitario);
                unidades += U.toNumber(item.cantidad);
                facturas.add(venta.id);
            });
        });

        // Los gastos no se pueden repartir por categoría de producto:
        // cuando hay filtro de producto se informa explícitamente.
        const gastos = db.all('gastos').filter((g) => g.fecha >= desde && g.fecha <= hasta);

        return {
            ventas: ventas.filter((v) => facturas.has(v.id)),
            ingresos: U.roundCop(ingresos),
            costoVentas: U.roundCop(costoVentas),
            utilidadBruta: U.roundCop(ingresos - costoVentas),
            unidades,
            numeroFacturas: facturas.size,
            gastos: U.sum(gastos, (g) => g.valor),
            listaGastos: gastos
        };
    };

    /** Serie diaria si el rango es corto, mensual si es largo. */
    const construirSerie = (desde, hasta) => {
        const dias = U.daysBetween(desde, hasta);

        if (dias <= 62) {
            const etiquetas = [];
            const ingresos = [];
            const gastos = [];
            let cursor = desde;
            let guardia = 0;
            while (cursor <= hasta && guardia < 200) {
                const dia = datosFiltrados(cursor, cursor);
                etiquetas.push(U.fmtDate(cursor).slice(0, 6));
                ingresos.push(dia.ingresos);
                gastos.push(dia.gastos);
                cursor = U.addDays(cursor, 1);
                guardia += 1;
            }
            return { etiquetas, ingresos, gastos, granularidad: 'diaria' };
        }

        const periodos = U.periodRange(desde, hasta);
        const etiquetas = [];
        const ingresos = [];
        const gastos = [];
        periodos.forEach((periodo) => {
            const inicio = `${periodo}-01` < desde ? desde : `${periodo}-01`;
            const finMes = U.endOfMonth(`${periodo}-01`);
            const fin = finMes > hasta ? hasta : finMes;
            const mes = datosFiltrados(inicio, fin);
            etiquetas.push(U.fmtPeriod(periodo));
            ingresos.push(mes.ingresos);
            gastos.push(mes.gastos);
        });
        return { etiquetas, ingresos, gastos, granularidad: 'mensual' };
    };

    /* ============================================================
       Vista
       ============================================================ */

    const vista = (contenedor) => {
        const zonaContenido = el('div', { class: 'stack' });

        const inpDesde = ui.input({ tipo: 'date', valor: estado.desde });
        const inpHasta = ui.input({ tipo: 'date', valor: estado.hasta });

        const selRango = ui.select(RANGOS, { valor: estado.rango });
        const selCategoria = ui.select(ERP.inventario.categorias(), {
            placeholder: 'Todas las categorías', valor: estado.categoria
        });
        const selProducto = ui.select([], { placeholder: 'Todos los productos' });

        const campoDesde = ui.campo('Desde', inpDesde);
        const campoHasta = ui.campo('Hasta', inpHasta);

        const refrescarProductos = () => {
            const lista = db.productos()
                .filter((p) => !estado.categoria || p.categoria === estado.categoria)
                .map((p) => ({ valor: p.id, texto: `${p.sku} — ${U.truncate(p.nombre, 34)}` }));
            U.clear(selProducto);
            selProducto.appendChild(el('option', { text: 'Todos los productos', attrs: { value: '' } }));
            lista.forEach((op) => selProducto.appendChild(
                el('option', { text: op.texto, attrs: { value: op.valor } })));
            selProducto.value = estado.productoId;
        };

        const alternarPersonalizado = () => {
            const personalizado = estado.rango === 'personalizado';
            campoDesde.classList.toggle('is-hidden', !personalizado);
            campoHasta.classList.toggle('is-hidden', !personalizado);
        };

        selRango.addEventListener('change', (event) => {
            aplicarRango(event.target.value);
            inpDesde.value = estado.desde;
            inpHasta.value = estado.hasta;
            alternarPersonalizado();
            pintar();
        });

        inpDesde.addEventListener('change', (event) => {
            estado.desde = event.target.value;
            estado.rango = 'personalizado';
            selRango.value = 'personalizado';
            alternarPersonalizado();
            pintar();
        });

        inpHasta.addEventListener('change', (event) => {
            estado.hasta = event.target.value;
            estado.rango = 'personalizado';
            selRango.value = 'personalizado';
            alternarPersonalizado();
            pintar();
        });

        selCategoria.addEventListener('change', (event) => {
            estado.categoria = event.target.value;
            estado.productoId = '';
            refrescarProductos();
            pintar();
        });

        selProducto.addEventListener('change', (event) => {
            estado.productoId = event.target.value;
            pintar();
        });

        const btnLimpiar = el('button', {
            class: 'btn btn-secondary btn-sm', text: 'Limpiar filtros', attrs: { type: 'button' },
            on: {
                click: () => {
                    estado.categoria = '';
                    estado.productoId = '';
                    aplicarRango('mes');
                    selRango.value = 'mes';
                    selCategoria.value = '';
                    inpDesde.value = estado.desde;
                    inpHasta.value = estado.hasta;
                    refrescarProductos();
                    alternarPersonalizado();
                    pintar();
                }
            }
        });

        const pintar = () => {
            U.clear(zonaContenido);

            if (estado.desde > estado.hasta) {
                zonaContenido.appendChild(ui.estadoError('Rango de fechas inválido',
                    'La fecha inicial es posterior a la final. Corrija el rango para ver la información.'));
                return;
            }

            const datos = datosFiltrados(estado.desde, estado.hasta);
            const serie = construirSerie(estado.desde, estado.hasta);
            const hayFiltroProducto = Boolean(estado.categoria || estado.productoId);

            const pendientes = db.all('ventas').filter((v) => !v.anulada && U.toNumber(v.saldo) > 0);
            const carteraTotal = U.sum(pendientes, (v) => v.saldo);
            const inventarioValor = fin.inventarioFisico();
            const bajoMinimo = db.productosBajoMinimo();

            const ranking = fin.productosMasVendidos(estado.desde, estado.hasta, 8, estado.categoria)
                .filter((p) => !estado.productoId || p.nombre === db.nombreProducto(estado.productoId));

            const gastosPorCategoria = [...U.groupBy(datos.listaGastos, 'categoria').entries()]
                .map(([categoria, lista]) => ({ etiqueta: categoria, valor: U.sum(lista, (g) => g.valor) }))
                .sort((a, b) => b.valor - a.valor);

            const utilidadOperacional = datos.utilidadBruta - datos.gastos;

            /* --- Estado de filtros activos --- */
            const chips = [];
            chips.push(ui.badge(`${U.fmtDate(estado.desde)} → ${U.fmtDate(estado.hasta)}`, 'info'));
            if (estado.categoria) chips.push(ui.badge(`Categoría: ${estado.categoria}`, 'info'));
            if (estado.productoId) chips.push(ui.badge(`Producto: ${U.truncate(db.nombreProducto(estado.productoId), 28)}`, 'info'));
            chips.push(ui.badge(`${datos.numeroFacturas} facturas`, 'neutral'));

            U.appendAll(zonaContenido, [
                el('div', { class: 'filter-status' }, [
                    el('span', { class: 'strong', text: 'Filtros activos:' }),
                    ...chips
                ]),

                hayFiltroProducto
                    ? ui.banner('Alcance del filtro de producto',
                        'Los ingresos, el costo de ventas y la utilidad bruta corresponden solo a los ítems filtrados. Los gastos operativos no son atribuibles a un producto, por lo que se muestran completos del periodo.',
                        'info')
                    : null,

                // Diez indicadores en dos filas de cinco (en pantallas angostas se reacomodan).
                el('div', { class: 'grid-kpi grid-kpi-5' }, [
                    ui.kpi('Ingresos totales', U.money(datos.ingresos),
                        `${datos.numeroFacturas} facturas · ${U.num(datos.unidades)} unidades`, 'var(--c1)'),
                    ui.kpi('Costo de ventas', U.money(datos.costoVentas),
                        'Costo congelado en cada venta', 'var(--c6)'),
                    ui.kpi('Utilidad bruta', U.money(datos.utilidadBruta),
                        U.pct((U.safeDiv(datos.utilidadBruta, datos.ingresos) || 0) * 100), 'var(--c2)'),
                    ui.kpi('Gastos operativos', U.money(datos.gastos),
                        `${datos.listaGastos.length} registros del periodo`, 'var(--c3)'),
                    ui.kpi('Cuentas por cobrar', U.money(carteraTotal),
                        `${pendientes.length} facturas con saldo`, 'var(--c4)'),
                    ui.kpi('Valor del inventario', U.money(inventarioValor),
                        bajoMinimo.length ? `${bajoMinimo.length} ítems por reponer` : 'Existencias en nivel adecuado',
                        'var(--c5)'),
                    ui.kpi('Resultado del periodo', U.money(utilidadOperacional),
                        utilidadOperacional >= 0 ? 'Utilidad después de gastos' : 'Pérdida después de gastos',
                        utilidadOperacional >= 0 ? 'var(--c2)' : 'var(--c6)'),
                    ui.kpi('Ticket promedio',
                        U.money(datos.numeroFacturas ? datos.ingresos / datos.numeroFacturas : 0),
                        'Ingreso medio por factura', 'var(--c7)'),
                    ui.kpi('Saldo en caja', U.money(fin.saldoCaja(estado.hasta)),
                        `Al ${U.fmtDate(estado.hasta)}`, 'var(--c2)'),
                    ui.kpi('Cartera vencida',
                        U.money(U.sum(pendientes.filter((v) => v.fechaVencimiento < U.today()), (v) => v.saldo)),
                        `${pendientes.filter((v) => v.fechaVencimiento < U.today()).length} facturas fuera de plazo`,
                        'var(--c6)')
                ]),

                bajoMinimo.length
                    ? ui.banner('Reposición de inventario',
                        `${bajoMinimo.length} ${bajoMinimo.length === 1 ? 'ítem está' : 'ítems están'} en o por debajo del mínimo. Revise el módulo de inventario.`,
                        'warning')
                    : null,

                ui.card('Ventas contra gastos en el tiempo',
                    ERP.charts.lineas({
                        etiquetas: serie.etiquetas,
                        series: [
                            { nombre: 'Ventas', datos: serie.ingresos },
                            { nombre: 'Gastos', datos: serie.gastos }
                        ]
                    }),
                    { subtitulo: `Agrupación ${serie.granularidad}` }),

                el('div', { class: 'grid-2' }, [
                    ui.card('Productos más vendidos',
                        ERP.charts.barras({
                            items: ranking.map((p) => ({
                                etiqueta: p.nombre,
                                valor: p.ingresos,
                                detalle: { etiqueta: 'Unidades', valor: U.num(p.unidades) }
                            })),
                            nombreSerie: 'Ingresos'
                        }),
                        { subtitulo: 'Por ingresos generados en el periodo' }),

                    ui.card('Distribución de gastos',
                        ERP.charts.dona({ items: gastosPorCategoria, titulo: 'Gastos del periodo' }),
                        { subtitulo: 'Participación de cada categoría' })
                ]),

                ui.card('Detalle de productos vendidos',
                    ranking.length
                        ? ui.tabla(ranking, [
                            { clave: 'nombre', titulo: 'Producto', ajustar: true },
                            { clave: 'categoria', titulo: 'Categoría' },
                            { clave: 'unidades', titulo: 'Unidades', tipo: 'numero' },
                            { clave: 'ingresos', titulo: 'Ingresos', tipo: 'moneda' },
                            { clave: 'costo', titulo: 'Costo', tipo: 'moneda' },
                            { clave: 'utilidad', titulo: 'Utilidad bruta', tipo: 'moneda' },
                            {
                                clave: 'margen', titulo: 'Margen', tipo: 'nodo',
                                valor: (p) => (U.safeDiv(p.utilidad, p.ingresos) || 0) * 100,
                                render: (p) => {
                                    const m = (U.safeDiv(p.utilidad, p.ingresos) || 0) * 100;
                                    return el('span', { class: `num ${m < 15 ? 'neg' : 'pos'}`, text: U.pct(m) });
                                }
                            }
                        ], {
                            buscador: false,
                            porPagina: 8,
                            totales: (l) => ({
                                nombre: `${l.length} productos`,
                                unidades: U.sum(l, (p) => p.unidades),
                                ingresos: U.sum(l, (p) => p.ingresos),
                                costo: U.sum(l, (p) => p.costo),
                                utilidad: U.sum(l, (p) => p.utilidad)
                            })
                        }).nodo
                        : ui.estadoVacio('Sin ventas en el periodo',
                            'No hay facturas que cumplan los filtros seleccionados. Amplíe el rango de fechas o quite el filtro de producto.'),
                    { sinRelleno: true })
            ]);
        };

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Tablero ejecutivo' }),
                    el('p', { text: 'Indicadores, gráficos y detalle alimentados por los mismos filtros.' })
                ])
            ]),
            el('div', { class: 'filters' }, [
                ui.campo('Rango de fechas', selRango),
                campoDesde,
                campoHasta,
                ui.campo('Categoría', selCategoria),
                ui.campo('Producto', selProducto),
                el('div', { style: { paddingBottom: '1px' } }, [btnLimpiar])
            ]),
            zonaContenido
        ]);

        refrescarProductos();
        alternarPersonalizado();
        pintar();
    };

    return { vista, estado };
})();
