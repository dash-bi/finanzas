/* ============================================================
   tools.js — Herramientas de análisis financiero
   Punto de equilibrio y simulador de préstamos.
   ============================================================ */

window.ERP = window.ERP || {};

/* ============================================================
   Punto de equilibrio
   ============================================================ */

ERP.equilibrio = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const fin = ERP.finanzas;

    const calcular = (costosFijos, precio, costoVariable) => {
        const margenUnitario = precio - costoVariable;
        const razonMargen = U.safeDiv(margenUnitario, precio);

        if (margenUnitario <= 0) {
            return {
                margenUnitario, razonMargen, viable: false,
                unidades: null, ingresos: null
            };
        }

        const unidades = costosFijos / margenUnitario;
        return {
            margenUnitario,
            razonMargen,
            viable: true,
            unidades,
            ingresos: unidades * precio
        };
    };

    /** Valores sugeridos a partir de la operación real de los últimos 3 meses. */
    const sugerirDesdeDatos = () => {
        const desde = U.startOfMonth(U.addMonths(U.today(), -2));
        const hasta = U.today();
        const pyg = fin.estadoResultados(desde, hasta);
        const meses = U.periodRange(desde, hasta).length || 1;

        const ventas = ERP.db.all('ventas').filter((v) => !v.anulada && v.fecha >= desde && v.fecha <= hasta);
        let unidades = 0;
        ventas.forEach((v) => v.items.forEach((i) => { unidades += U.toNumber(i.cantidad); }));

        return {
            costosFijos: U.roundCop(pyg.gastosTotales / meses),
            precio: U.roundCop(unidades ? pyg.ingresos / unidades : 0),
            costoVariable: U.roundCop(unidades ? pyg.costoVentas / unidades : 0),
            meses,
            unidades
        };
    };

    const vista = (contenedor) => {
        const sugerido = sugerirDesdeDatos();

        const valores = {
            costosFijos: sugerido.costosFijos || 5000000,
            precio: sugerido.precio || 100000,
            costoVariable: sugerido.costoVariable || 60000
        };

        const campos = {
            costosFijos: ui.input({ tipo: 'number', valor: valores.costosFijos, numerico: true, min: 0, step: 100000 }),
            precio: ui.input({ tipo: 'number', valor: valores.precio, numerico: true, min: 0, step: 1000 }),
            costoVariable: ui.input({ tipo: 'number', valor: valores.costoVariable, numerico: true, min: 0, step: 1000 })
        };

        const zonaResultado = el('div', { class: 'stack' });

        const pintar = () => {
            U.clear(zonaResultado);

            const costosFijos = U.toNumber(campos.costosFijos.value);
            const precio = U.toNumber(campos.precio.value);
            const costoVariable = U.toNumber(campos.costoVariable.value);
            const r = calcular(costosFijos, precio, costoVariable);

            if (!r.viable) {
                zonaResultado.appendChild(ui.banner('No existe punto de equilibrio',
                    'El costo variable unitario es mayor o igual al precio de venta: cada unidad vendida aumenta la pérdida. Suba el precio o baje el costo variable.',
                    'danger'));
                return;
            }

            const unidadesEnteras = Math.ceil(r.unidades);

            U.appendAll(zonaResultado, [
                el('div', { class: 'grid-kpi' }, [
                    ui.kpi('Punto de equilibrio', `${U.num(unidadesEnteras)} unidades`,
                        'Unidades a vender para no ganar ni perder', 'var(--c1)'),
                    ui.kpi('En dinero', U.money(r.ingresos),
                        'Ingreso necesario en el periodo', 'var(--c4)'),
                    ui.kpi('Margen de contribución', U.money(r.margenUnitario),
                        `${U.pct((r.razonMargen || 0) * 100)} del precio de venta`, 'var(--c2)'),
                    ui.kpi('Ventas diarias necesarias', `${U.num(Math.ceil(unidadesEnteras / 30))} unidades`,
                        'Suponiendo 30 días de operación', 'var(--c5)')
                ]),

                ui.card('Ingresos contra costos totales',
                    ERP.charts.puntoEquilibrio({
                        costosFijos, precio, costoVariable, unidadesEquilibrio: r.unidades
                    }),
                    { subtitulo: 'A la izquierda del punto hay pérdida; a la derecha, utilidad' }),

                ui.card('Qué pasa si vendo más o menos',
                    el('div', { class: 'table-wrap' }, [
                        el('table', { class: 'data' }, [
                            el('thead', {}, [el('tr', {}, [
                                el('th', { text: 'Escenario', attrs: { scope: 'col' } }),
                                el('th', { class: 'num', text: 'Unidades', attrs: { scope: 'col' } }),
                                el('th', { class: 'num', text: 'Ingresos', attrs: { scope: 'col' } }),
                                el('th', { class: 'num', text: 'Costo total', attrs: { scope: 'col' } }),
                                el('th', { class: 'num', text: 'Resultado', attrs: { scope: 'col' } })
                            ])]),
                            el('tbody', {}, [
                                ['60 % del equilibrio', 0.6], ['80 % del equilibrio', 0.8],
                                ['Punto de equilibrio', 1], ['120 % del equilibrio', 1.2],
                                ['150 % del equilibrio', 1.5], ['200 % del equilibrio', 2]
                            ].map(([etiqueta, factor]) => {
                                const u = Math.round(r.unidades * factor);
                                const ingresos = u * precio;
                                const costos = costosFijos + u * costoVariable;
                                const resultado = ingresos - costos;
                                return el('tr', {}, [
                                    el('td', { text: etiqueta }),
                                    el('td', { class: 'num', text: U.num(u) }),
                                    el('td', { class: 'num', text: U.money(ingresos) }),
                                    el('td', { class: 'num', text: U.money(costos) }),
                                    el('td', {
                                        class: `num strong ${resultado >= 0 ? 'pos' : 'neg'}`,
                                        text: U.money(resultado)
                                    })
                                ]);
                            }))
                        ])
                    ]),
                    { sinRelleno: true })
            ]);
        };

        Object.values(campos).forEach((campo) => campo.addEventListener('input', U.debounce(pintar, 220)));

        const btnSugerir = el('button', {
            class: 'btn btn-secondary', text: 'Usar mis datos reales', attrs: { type: 'button' },
            on: {
                click: () => {
                    const s = sugerirDesdeDatos();
                    if (!s.unidades) {
                        ui.toastWarn('Sin datos suficientes',
                            'No hay ventas en los últimos 3 meses para estimar el precio y el costo promedio.');
                        return;
                    }
                    campos.costosFijos.value = String(s.costosFijos);
                    campos.precio.value = String(s.precio);
                    campos.costoVariable.value = String(s.costoVariable);
                    pintar();
                    ui.toastOk('Valores cargados',
                        `Promedios de los últimos ${s.meses} meses: ${U.num(s.unidades)} unidades vendidas.`);
                }
            }
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Punto de equilibrio' }),
                    el('p', { text: 'Cuántas unidades hay que vender para cubrir exactamente todos los costos.' })
                ])
            ]),
            ui.card('Datos de entrada', el('div', { class: 'stack' }, [
                el('div', { class: 'grid-form' }, [
                    ui.campo('Costos fijos mensuales', campos.costosFijos, {
                        ayuda: 'Arriendo, nómina, servicios: lo que se paga aunque no se venda nada.'
                    }),
                    ui.campo('Precio de venta promedio', campos.precio, {
                        ayuda: 'Precio unitario sin IVA.'
                    }),
                    ui.campo('Costo variable unitario', campos.costoVariable, {
                        ayuda: 'Lo que cuesta producir o comprar cada unidad vendida.'
                    })
                ]),
                el('div', { class: 'row row-wrap' }, [btnSugerir])
            ])),
            zonaResultado
        ]);

        pintar();
    };

    return { vista, calcular, sugerirDesdeDatos };
})();

/* ============================================================
   Simulador de préstamos
   ============================================================ */

ERP.prestamos = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;

    /**
     * Método francés: cuota fija.
     * cuota = P · i / (1 − (1+i)^−n)
     */
    const amortizacionFrancesa = (monto, tasaMensual, meses) => {
        const cuota = tasaMensual === 0
            ? monto / meses
            : (monto * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -meses));

        const filas = [];
        let saldo = monto;

        for (let periodo = 1; periodo <= meses; periodo += 1) {
            const interes = saldo * tasaMensual;
            let capital = cuota - interes;
            // El último periodo absorbe el residuo de redondeo.
            if (periodo === meses) capital = saldo;
            const cuotaPeriodo = capital + interes;
            saldo = Math.max(0, saldo - capital);
            filas.push({ periodo, cuota: cuotaPeriodo, interes, capital, saldo });
        }
        return filas;
    };

    /** Método alemán: abono a capital constante, cuota decreciente. */
    const amortizacionAlemana = (monto, tasaMensual, meses) => {
        const capitalFijo = monto / meses;
        const filas = [];
        let saldo = monto;

        for (let periodo = 1; periodo <= meses; periodo += 1) {
            const interes = saldo * tasaMensual;
            const capital = periodo === meses ? saldo : capitalFijo;
            saldo = Math.max(0, saldo - capital);
            filas.push({ periodo, cuota: capital + interes, interes, capital, saldo });
        }
        return filas;
    };

    const vista = (contenedor) => {
        const campos = {
            monto: ui.input({ tipo: 'number', valor: 50000000, numerico: true, min: 0, step: 1000000 }),
            tasa: ui.input({ tipo: 'number', valor: 1.8, numerico: true, min: 0, step: 0.1 }),
            tipoTasa: ui.select([
                { valor: 'mensual', texto: 'Mensual (nominal)' },
                { valor: 'anual', texto: 'Anual efectiva' }
            ], { valor: 'mensual' }),
            meses: ui.input({ tipo: 'number', valor: 36, numerico: true, min: 1, max: 480, step: 1 }),
            metodo: ui.select([
                { valor: 'frances', texto: 'Francés — cuota fija' },
                { valor: 'aleman', texto: 'Alemán — abono a capital constante' }
            ], { valor: 'frances' })
        };

        const zonaResultado = el('div', { class: 'stack' });

        const tasaMensual = () => {
            const tasa = U.toNumber(campos.tasa.value) / 100;
            return campos.tipoTasa.value === 'anual' ? Math.pow(1 + tasa, 1 / 12) - 1 : tasa;
        };

        const pintar = () => {
            U.clear(zonaResultado);

            const monto = U.toNumber(campos.monto.value);
            const meses = Math.round(U.toNumber(campos.meses.value));
            const i = tasaMensual();

            if (monto <= 0 || meses <= 0) {
                zonaResultado.appendChild(ui.estadoVacio('Datos incompletos',
                    'Ingrese un monto y un plazo mayores que cero para simular el crédito.'));
                return;
            }
            if (meses > 480) {
                zonaResultado.appendChild(ui.estadoError('Plazo demasiado largo',
                    'El simulador admite hasta 480 cuotas (40 años).'));
                return;
            }

            const filas = campos.metodo.value === 'frances'
                ? amortizacionFrancesa(monto, i, meses)
                : amortizacionAlemana(monto, i, meses);

            const totalIntereses = U.sum(filas, (f) => f.interes);
            const totalPagado = U.sum(filas, (f) => f.cuota);
            const tasaAnual = (Math.pow(1 + i, 12) - 1) * 100;

            const btnPdf = el('button', {
                class: 'btn btn-secondary btn-sm', text: '⤓ Exportar tabla a PDF', attrs: { type: 'button' },
                on: {
                    click: () => ERP.pdf.reporteTabla({
                        titulo: 'Tabla de amortización',
                        subtitulo: `${campos.metodo.value === 'frances' ? 'Método francés (cuota fija)' : 'Método alemán (capital constante)'} · ${meses} cuotas`,
                        archivo: `amortizacion-${campos.metodo.value}-${meses}m.pdf`,
                        resumen: [
                            { etiqueta: 'MONTO', valor: U.money(monto) },
                            { etiqueta: 'TASA MENSUAL', valor: U.pct(i * 100, 3) },
                            { etiqueta: 'TOTAL INTERESES', valor: U.money(totalIntereses) },
                            { etiqueta: 'TOTAL PAGADO', valor: U.money(totalPagado) }
                        ],
                        columnas: [
                            { titulo: 'CUOTA', ancho: 60, align: 'right' },
                            { titulo: 'VALOR CUOTA', ancho: 114, align: 'right' },
                            { titulo: 'INTERÉS', ancho: 114, align: 'right' },
                            { titulo: 'ABONO A CAPITAL', ancho: 114, align: 'right' },
                            { titulo: 'SALDO', ancho: 113.28, align: 'right' }
                        ],
                        filas: filas.map((f) => [
                            U.num(f.periodo), U.money(f.cuota), U.money(f.interes),
                            U.money(f.capital), U.money(f.saldo)
                        ]),
                        nota: `Tasa efectiva anual equivalente: ${U.pct(tasaAnual, 2)}. Simulación con fines de planeación financiera; no constituye una oferta de crédito.`
                    })
                }
            });

            const tabla = ui.tabla(filas, [
                { clave: 'periodo', titulo: 'Cuota', tipo: 'numero' },
                { clave: 'cuota', titulo: 'Valor cuota', tipo: 'moneda' },
                { clave: 'interes', titulo: 'Interés', tipo: 'moneda' },
                { clave: 'capital', titulo: 'Abono a capital', tipo: 'moneda' },
                { clave: 'saldo', titulo: 'Saldo restante', tipo: 'moneda' }
            ], {
                buscador: false,
                porPagina: 12,
                totales: (l) => ({
                    periodo: `${l.length} cuotas`,
                    cuota: U.sum(l, (f) => f.cuota),
                    interes: U.sum(l, (f) => f.interes),
                    capital: U.sum(l, (f) => f.capital)
                })
            });

            const saltoGrafico = Math.max(1, Math.ceil(filas.length / 40));
            const muestra = filas.filter((f, idx) => idx % saltoGrafico === 0 || idx === filas.length - 1);

            U.appendAll(zonaResultado, [
                el('div', { class: 'grid-kpi' }, [
                    ui.kpi('Cuota', campos.metodo.value === 'frances'
                        ? U.money(filas[0].cuota)
                        : `${U.money(filas[0].cuota)} → ${U.money(filas[filas.length - 1].cuota)}`,
                        campos.metodo.value === 'frances' ? 'Fija durante todo el plazo' : 'Decreciente', 'var(--c1)'),
                    ui.kpi('Total intereses', U.money(totalIntereses),
                        U.pct((totalIntereses / monto) * 100, 1) + ' del monto prestado', 'var(--c6)'),
                    ui.kpi('Total pagado', U.money(totalPagado), `En ${meses} cuotas`, 'var(--c4)'),
                    ui.kpi('Tasa efectiva anual', U.pct(tasaAnual, 2),
                        `Equivale a ${U.pct(i * 100, 3)} mensual`, 'var(--c3)')
                ]),

                ui.card('Composición de la deuda en el tiempo',
                    ERP.charts.lineas({
                        etiquetas: muestra.map((f) => `#${f.periodo}`),
                        series: [
                            { nombre: 'Saldo pendiente', datos: muestra.map((f) => f.saldo) },
                            { nombre: 'Interés de la cuota', datos: muestra.map((f) => f.interes) },
                            { nombre: 'Abono a capital', datos: muestra.map((f) => f.capital) }
                        ]
                    }),
                    { subtitulo: 'El interés se calcula siempre sobre el saldo pendiente' }),

                ui.card('Tabla de amortización', tabla.nodo, {
                    subtitulo: campos.metodo.value === 'frances'
                        ? 'Cuota fija: al principio se paga más interés y menos capital'
                        : 'Abono a capital constante: la cuota baja mes a mes',
                    acciones: btnPdf,
                    sinRelleno: true
                })
            ]);
        };

        Object.values(campos).forEach((campo) => {
            campo.addEventListener('input', U.debounce(pintar, 260));
            campo.addEventListener('change', pintar);
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Simulador de préstamos' }),
                    el('p', { text: 'Compare el método francés y el alemán antes de tomar una obligación financiera.' })
                ])
            ]),
            ui.card('Condiciones del crédito', el('div', { class: 'grid-form' }, [
                ui.campo('Monto del préstamo', campos.monto),
                ui.campo('Tasa de interés (%)', campos.tasa),
                ui.campo('Tipo de tasa', campos.tipoTasa),
                ui.campo('Plazo (meses)', campos.meses),
                ui.campo('Método de amortización', campos.metodo, {
                    ayuda: 'El francés mantiene la cuota fija; el alemán abona siempre el mismo capital.'
                })
            ])),
            zonaResultado
        ]);

        pintar();
    };

    return { vista, amortizacionFrancesa, amortizacionAlemana };
})();
