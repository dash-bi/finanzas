/* ============================================================
   financials.js — Motor de estados financieros en tiempo real
   Todo se deriva de las transacciones: nada se digita a mano.
   ============================================================ */

window.ERP = window.ERP || {};

/* ============================================================
   1. Motor de cálculo (sin interfaz)
   ============================================================ */

ERP.finanzas = (() => {
    const U = ERP.util;
    const db = ERP.db;

    /** Categorías que no son gasto operacional del negocio. */
    const NO_OPERACIONALES = ['Gastos bancarios'];
    const IMPUESTOS = ['Impuestos y tasas'];

    const enRango = (fecha, desde, hasta) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta);

    const ventasVigentes = (desde, hasta) => db.all('ventas')
        .filter((v) => !v.anulada && enRango(v.fecha, desde, hasta));

    const comprasEn = (desde, hasta) => db.all('compras')
        .filter((c) => enRango(c.fecha, desde, hasta));

    const gastosEn = (desde, hasta) => db.all('gastos')
        .filter((g) => enRango(g.fecha, desde, hasta));

    const costoDeVenta = (venta) => U.sum(venta.items,
        (i) => U.toNumber(i.cantidad) * U.toNumber(i.costoUnitario));

    /* ---------- Estado de resultados ---------- */

    const estadoResultados = (desde, hasta) => {
        const ventas = ventasVigentes(desde, hasta);
        const gastos = gastosEn(desde, hasta);

        const ingresos = U.sum(ventas, (v) => v.subtotal);
        const costoVentas = U.sum(ventas, costoDeVenta);
        const utilidadBruta = ingresos - costoVentas;

        const porCategoria = [...U.groupBy(gastos, 'categoria').entries()]
            .map(([categoria, lista]) => ({ categoria, valor: U.sum(lista, (g) => g.valor) }))
            .sort((a, b) => b.valor - a.valor);

        const operacionales = porCategoria.filter(
            (c) => !NO_OPERACIONALES.includes(c.categoria) && !IMPUESTOS.includes(c.categoria));
        const noOperacionales = porCategoria.filter((c) => NO_OPERACIONALES.includes(c.categoria));
        const impuestos = porCategoria.filter((c) => IMPUESTOS.includes(c.categoria));

        const totalOperacionales = U.sum(operacionales, (c) => c.valor);
        const totalNoOperacionales = U.sum(noOperacionales, (c) => c.valor);
        const totalImpuestos = U.sum(impuestos, (c) => c.valor);

        const utilidadOperacional = utilidadBruta - totalOperacionales;
        const utilidadNeta = utilidadOperacional - totalNoOperacionales - totalImpuestos;

        return {
            ingresos, costoVentas, utilidadBruta,
            operacionales, totalOperacionales,
            noOperacionales, totalNoOperacionales,
            impuestos, totalImpuestos,
            utilidadOperacional, utilidadNeta,
            gastosTotales: totalOperacionales + totalNoOperacionales + totalImpuestos,
            margenBruto: U.safeDiv(utilidadBruta, ingresos),
            margenOperacional: U.safeDiv(utilidadOperacional, ingresos),
            margenNeto: U.safeDiv(utilidadNeta, ingresos),
            numeroFacturas: ventas.length,
            porCategoria
        };
    };

    /* ---------- Movimientos de efectivo ---------- */

    const movimientosCaja = (desde, hasta) => {
        const ventasContado = ventasVigentes(desde, hasta).filter((v) => v.condicion === 'contado');
        const abonos = db.all('abonos').filter((a) => enRango(a.fecha, desde, hasta));
        const comprasContado = comprasEn(desde, hasta).filter((c) => c.condicion === 'contado');
        const pagosProveedor = db.all('pagosCompra').filter((p) => enRango(p.fecha, desde, hasta));
        const gastosPagados = gastosEn(desde, hasta).filter((g) => g.pagado !== false);

        const entradaVentas = U.sum(ventasContado, (v) => v.total);
        const entradaAbonos = U.sum(abonos, (a) => a.valor);
        const salidaCompras = U.sum(comprasContado, (c) => c.total);
        const salidaPagos = U.sum(pagosProveedor, (p) => p.valor);
        const salidaGastos = U.sum(gastosPagados, (g) => g.valor);

        return {
            entradaVentas, entradaAbonos, salidaCompras, salidaPagos, salidaGastos,
            entradas: entradaVentas + entradaAbonos,
            salidas: salidaCompras + salidaPagos + salidaGastos,
            neto: (entradaVentas + entradaAbonos) - (salidaCompras + salidaPagos + salidaGastos),
            conteos: {
                ventasContado: ventasContado.length,
                abonos: abonos.length,
                comprasContado: comprasContado.length,
                pagosProveedor: pagosProveedor.length,
                gastosPagados: gastosPagados.length
            }
        };
    };

    const saldoCaja = (hasta) => {
        const mov = movimientosCaja(null, hasta);
        return U.toNumber(db.config().capitalInicial) + mov.neto;
    };

    const flujoCaja = (desde, hasta) => {
        const mov = movimientosCaja(desde, hasta);
        const inicial = desde
            ? saldoCaja(U.addDays(desde, -1))
            : U.toNumber(db.config().capitalInicial);
        return { ...mov, saldoInicial: inicial, saldoFinal: inicial + mov.neto };
    };

    /* ---------- Balance general ---------- */

    const cuentasPorCobrar = (hasta) => {
        const credito = db.all('ventas')
            .filter((v) => !v.anulada && v.condicion === 'credito' && enRango(v.fecha, null, hasta));
        const abonos = db.all('abonos').filter((a) => enRango(a.fecha, null, hasta));
        return U.sum(credito, (v) => v.total) - U.sum(abonos, (a) => a.valor);
    };

    const cuentasPorPagar = (hasta) => {
        const credito = comprasEn(null, hasta).filter((c) => c.condicion === 'credito');
        const pagos = db.all('pagosCompra').filter((p) => enRango(p.fecha, null, hasta));
        return U.sum(credito, (c) => c.total) - U.sum(pagos, (p) => p.valor);
    };

    /**
     * Valor del inventario según el mayor: compras netas acumuladas
     * menos el costo de ventas acumulado. Es el saldo contable exacto.
     */
    const esInventariable = (productoId) => {
        const producto = db.productoPorId(productoId);
        return Boolean(producto) && producto.tipo === 'producto';
    };

    const inventarioContable = (hasta) => {
        const entradas = U.sum(comprasEn(null, hasta), (compra) => U.sum(
            compra.items.filter((i) => esInventariable(i.productoId)),
            (i) => {
                const bruto = U.toNumber(i.cantidad) * U.toNumber(i.valorUnitario);
                return bruto - bruto * (U.toNumber(i.descuentoPct) / 100);
            }
        ));
        const salidas = U.sum(ventasVigentes(null, hasta), costoDeVenta);
        return entradas - salidas;
    };

    /** Valorización operativa: existencias actuales por costo promedio. */
    const inventarioFisico = () => U.sum(
        db.productos().filter((p) => p.tipo === 'producto'),
        (p) => U.toNumber(p.stock) * U.toNumber(p.costo)
    );

    const ivaPorPagar = (hasta) => {
        const ivaVentas = U.sum(ventasVigentes(null, hasta), (v) => v.iva);
        const ivaCompras = U.sum(comprasEn(null, hasta), (c) => c.iva);
        return ivaVentas - ivaCompras;
    };

    const gastosPorPagar = (hasta) => U.sum(
        gastosEn(null, hasta).filter((g) => g.pagado === false), (g) => g.valor);

    const balanceGeneral = (hasta) => {
        const caja = saldoCaja(hasta);
        const cxc = cuentasPorCobrar(hasta);
        const inventario = inventarioContable(hasta);
        const activoCorriente = caja + cxc + inventario;

        const cxp = cuentasPorPagar(hasta);
        const iva = ivaPorPagar(hasta);
        const gastosPend = gastosPorPagar(hasta);
        const pasivoCorriente = cxp + iva + gastosPend;

        const capital = U.toNumber(db.config().capitalInicial);
        const resultado = estadoResultados(null, hasta);
        const patrimonio = capital + resultado.utilidadNeta;

        return {
            caja, cxc, inventario, activoCorriente,
            activoTotal: activoCorriente,
            cxp, iva, gastosPendientes: gastosPend, pasivoCorriente,
            pasivoTotal: pasivoCorriente,
            capital, utilidadAcumulada: resultado.utilidadNeta, patrimonio,
            pasivoMasPatrimonio: pasivoCorriente + patrimonio,
            descuadre: activoCorriente - (pasivoCorriente + patrimonio),
            inventarioFisico: inventarioFisico(),
            diferenciaInventario: inventarioFisico() - inventario
        };
    };

    /* ---------- Indicadores ---------- */

    const indicadores = (desde, hasta) => {
        const pyg = estadoResultados(desde, hasta);
        const bal = balanceGeneral(hasta);

        const cxcInicial = cuentasPorCobrar(desde ? U.addDays(desde, -1) : null);
        const carteraPromedio = (cxcInicial + bal.cxc) / 2;
        const ventasCredito = U.sum(
            ventasVigentes(desde, hasta).filter((v) => v.condicion === 'credito'), (v) => v.total);

        const dias = desde && hasta ? Math.max(1, U.daysBetween(desde, hasta) + 1) : 365;
        const rotacion = U.safeDiv(ventasCredito, carteraPromedio);

        const inventarioPromedio = bal.inventario;
        const rotacionInventario = U.safeDiv(pyg.costoVentas, inventarioPromedio);

        return {
            margenBruto: pyg.margenBruto,
            margenOperacional: pyg.margenOperacional,
            margenNeto: pyg.margenNeto,
            razonCorriente: U.safeDiv(bal.activoCorriente, bal.pasivoCorriente),
            pruebaAcida: U.safeDiv(bal.activoCorriente - bal.inventario, bal.pasivoCorriente),
            capitalTrabajo: bal.activoCorriente - bal.pasivoCorriente,
            rotacionCartera: rotacion,
            diasCartera: rotacion ? dias / rotacion : null,
            rotacionInventario,
            diasInventario: rotacionInventario ? dias / rotacionInventario : null,
            endeudamiento: U.safeDiv(bal.pasivoTotal, bal.activoTotal),
            dias
        };
    };

    /* ---------- Series temporales ---------- */

    const serieMensual = (desde, hasta) => {
        const periodos = U.periodRange(desde, hasta);
        return periodos.map((periodo) => {
            const inicio = `${periodo}-01`;
            const fin = U.endOfMonth(inicio);
            const pyg = estadoResultados(inicio, fin);
            const caja = movimientosCaja(inicio, fin);
            return {
                periodo,
                etiqueta: U.fmtPeriod(periodo),
                ingresos: pyg.ingresos,
                costoVentas: pyg.costoVentas,
                utilidadBruta: pyg.utilidadBruta,
                gastos: pyg.gastosTotales,
                utilidadNeta: pyg.utilidadNeta,
                entradas: caja.entradas,
                salidas: caja.salidas
            };
        });
    };

    /* ---------- Presupuesto contra ejecución ---------- */

    const presupuestoVsReal = (periodo) => {
        const inicio = `${periodo}-01`;
        const fin = U.endOfMonth(inicio);
        const gastos = gastosEn(inicio, fin);
        const presupuestos = db.all('presupuestos').filter((p) => p.periodo === periodo);

        const categorias = [...new Set([
            ...db.CATEGORIAS_GASTO,
            ...presupuestos.map((p) => p.categoria),
            ...gastos.map((g) => g.categoria)
        ])];

        return categorias.map((categoria) => {
            const presupuestado = U.sum(
                presupuestos.filter((p) => p.categoria === categoria), (p) => p.monto);
            const real = U.sum(gastos.filter((g) => g.categoria === categoria), (g) => g.valor);
            const desviacion = real - presupuestado;
            return {
                categoria,
                presupuesto: presupuestado,
                real,
                desviacion,
                cumplimiento: U.safeDiv(real, presupuestado)
            };
        }).filter((fila) => fila.presupuesto > 0 || fila.real > 0);
    };

    const definirPresupuesto = (periodo, categoria, monto) => {
        const existente = db.all('presupuestos').find(
            (p) => p.periodo === periodo && p.categoria === categoria);
        if (existente) {
            db.update('presupuestos', existente.id, { monto: U.roundCop(monto) });
        } else {
            db.insert('presupuestos', { periodo, categoria, monto: U.roundCop(monto) });
        }
    };

    /* ---------- Rankings ---------- */

    const productosMasVendidos = (desde, hasta, limite = 8, filtroCategoria = '') => {
        const acumulado = new Map();

        ventasVigentes(desde, hasta).forEach((venta) => {
            venta.items.forEach((item) => {
                const producto = db.productoPorId(item.productoId);
                if (!producto) return;
                if (filtroCategoria && producto.categoria !== filtroCategoria) return;

                const bruto = U.toNumber(item.cantidad) * U.toNumber(item.valorUnitario);
                const neto = bruto - bruto * (U.toNumber(item.descuentoPct) / 100);
                const previo = acumulado.get(producto.id) || {
                    nombre: producto.nombre, categoria: producto.categoria,
                    unidades: 0, ingresos: 0, costo: 0
                };
                previo.unidades += U.toNumber(item.cantidad);
                previo.ingresos += neto;
                previo.costo += U.toNumber(item.cantidad) * U.toNumber(item.costoUnitario);
                acumulado.set(producto.id, previo);
            });
        });

        return [...acumulado.values()]
            .map((fila) => ({ ...fila, utilidad: fila.ingresos - fila.costo }))
            .sort((a, b) => b.ingresos - a.ingresos)
            .slice(0, limite);
    };

    return {
        estadoResultados, balanceGeneral, flujoCaja, movimientosCaja, saldoCaja,
        indicadores, serieMensual, presupuestoVsReal, definirPresupuesto,
        productosMasVendidos, costoDeVenta,
        cuentasPorCobrar, cuentasPorPagar, inventarioContable, inventarioFisico
    };
})();

/* ============================================================
   2. Vista de estados financieros
   ============================================================ */

ERP.estadosFinancieros = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const fin = ERP.finanzas;

    const estado = {
        pestana: 'resultados',
        desde: U.startOfMonth(U.addMonths(U.today(), -5)),
        hasta: U.today(),
        periodoPresupuesto: U.periodOf(U.today())
    };

    const linea = (etiqueta, valor, opts = {}) => el('div', {
        class: `fin-line${opts.clase ? ` ${opts.clase}` : ''}`
    }, [
        el('span', { text: etiqueta }),
        el('span', {
            class: `num${U.toNumber(valor) < 0 ? ' neg' : ''}`,
            text: opts.texto || U.money(valor)
        })
    ]);

    /* ---------- Estado de resultados ---------- */

    const panelResultados = () => {
        const pyg = fin.estadoResultados(estado.desde, estado.hasta);
        const serie = fin.serieMensual(estado.desde, estado.hasta);

        const detalle = el('div', {}, [
            linea('Ingresos operacionales (sin IVA)', pyg.ingresos),
            linea('(−) Costo de ventas', -pyg.costoVentas),
            linea('= UTILIDAD BRUTA', pyg.utilidadBruta, { clase: 'total' }),
            el('p', { class: 'text-soft', style: { padding: '10px 0 2px' }, text: 'Gastos operacionales' }),
            ...pyg.operacionales.map((c) => linea(c.categoria, -c.valor, { clase: 'sub' })),
            linea('Total gastos operacionales', -pyg.totalOperacionales, { clase: 'total' }),
            linea('= UTILIDAD OPERACIONAL', pyg.utilidadOperacional, { clase: 'total' }),
            ...(pyg.noOperacionales.length
                ? pyg.noOperacionales.map((c) => linea(`(−) ${c.categoria}`, -c.valor, { clase: 'sub' }))
                : []),
            ...(pyg.impuestos.length
                ? pyg.impuestos.map((c) => linea(`(−) ${c.categoria}`, -c.valor, { clase: 'sub' }))
                : []),
            linea('= UTILIDAD NETA', pyg.utilidadNeta, { clase: 'total grand' })
        ]);

        const btnPdf = el('button', {
            class: 'btn btn-secondary btn-sm', text: '⤓ Exportar PDF', attrs: { type: 'button' },
            on: {
                click: () => ERP.pdf.reporteTabla({
                    titulo: 'Estado de resultados',
                    subtitulo: `Del ${U.fmtDate(estado.desde)} al ${U.fmtDate(estado.hasta)}`,
                    archivo: `estado-resultados-${estado.desde}-a-${estado.hasta}.pdf`,
                    resumen: [
                        { etiqueta: 'INGRESOS', valor: U.money(pyg.ingresos) },
                        { etiqueta: 'UTILIDAD BRUTA', valor: U.money(pyg.utilidadBruta) },
                        { etiqueta: 'UTILIDAD NETA', valor: U.money(pyg.utilidadNeta) },
                        { etiqueta: 'MARGEN NETO', valor: U.pct((pyg.margenNeto || 0) * 100) }
                    ],
                    columnas: [
                        { titulo: 'CONCEPTO', ancho: 360 },
                        { titulo: 'VALOR', ancho: 155.28, align: 'right' }
                    ],
                    filas: [
                        ['Ingresos operacionales', U.money(pyg.ingresos)],
                        ['Costo de ventas', U.money(-pyg.costoVentas)],
                        [{ texto: 'UTILIDAD BRUTA', negrita: true }, { texto: U.money(pyg.utilidadBruta), negrita: true }],
                        ...pyg.operacionales.map((c) => [`  ${c.categoria}`, U.money(-c.valor)]),
                        [{ texto: 'TOTAL GASTOS OPERACIONALES', negrita: true }, { texto: U.money(-pyg.totalOperacionales), negrita: true }],
                        [{ texto: 'UTILIDAD OPERACIONAL', negrita: true }, { texto: U.money(pyg.utilidadOperacional), negrita: true }],
                        ...pyg.noOperacionales.map((c) => [`  ${c.categoria}`, U.money(-c.valor)]),
                        ...pyg.impuestos.map((c) => [`  ${c.categoria}`, U.money(-c.valor)]),
                        [{ texto: 'UTILIDAD NETA', negrita: true }, { texto: U.money(pyg.utilidadNeta), negrita: true }]
                    ],
                    nota: 'Los ingresos se presentan sin IVA. El costo de ventas se calcula con el costo promedio ponderado congelado en el momento de cada venta.'
                })
            }
        });

        return el('div', { class: 'stack' }, [
            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Ingresos', U.money(pyg.ingresos), `${pyg.numeroFacturas} facturas`, 'var(--c1)'),
                ui.kpi('Utilidad bruta', U.money(pyg.utilidadBruta), U.pct((pyg.margenBruto || 0) * 100), 'var(--c2)'),
                ui.kpi('Gastos totales', U.money(pyg.gastosTotales), `${pyg.porCategoria.length} categorías`, 'var(--c3)'),
                ui.kpi('Utilidad neta', U.money(pyg.utilidadNeta), U.pct((pyg.margenNeto || 0) * 100),
                    pyg.utilidadNeta >= 0 ? 'var(--c2)' : 'var(--c6)')
            ]),
            ui.card('Estado de resultados', detalle, {
                subtitulo: `Del ${U.fmtDate(estado.desde)} al ${U.fmtDate(estado.hasta)}`,
                acciones: btnPdf
            }),
            ui.card('Evolución mensual del resultado', ERP.charts.lineas({
                etiquetas: serie.map((s) => s.etiqueta),
                series: [
                    { nombre: 'Ingresos', datos: serie.map((s) => s.ingresos) },
                    { nombre: 'Costo de ventas', datos: serie.map((s) => s.costoVentas) },
                    { nombre: 'Gastos', datos: serie.map((s) => s.gastos) }
                ]
            }))
        ]);
    };

    /* ---------- Balance general ---------- */

    const panelBalance = () => {
        const bal = fin.balanceGeneral(estado.hasta);
        const descuadre = Math.abs(bal.descuadre);

        const activos = el('div', {}, [
            el('p', { class: 'text-soft', text: 'Activo corriente' }),
            linea('Caja y bancos', bal.caja, { clase: 'sub' }),
            linea('Cuentas por cobrar (clientes)', bal.cxc, { clase: 'sub' }),
            linea('Inventario de mercancías', bal.inventario, { clase: 'sub' }),
            linea('TOTAL ACTIVO', bal.activoTotal, { clase: 'total grand' })
        ]);

        const pasivos = el('div', {}, [
            el('p', { class: 'text-soft', text: 'Pasivo corriente' }),
            linea('Cuentas por pagar (proveedores)', bal.cxp, { clase: 'sub' }),
            linea('IVA por pagar', bal.iva, { clase: 'sub' }),
            linea('Gastos por pagar', bal.gastosPendientes, { clase: 'sub' }),
            linea('TOTAL PASIVO', bal.pasivoTotal, { clase: 'total' }),
            el('p', { class: 'text-soft', style: { paddingTop: '10px' }, text: 'Patrimonio' }),
            linea('Capital social', bal.capital, { clase: 'sub' }),
            linea('Resultados acumulados', bal.utilidadAcumulada, { clase: 'sub' }),
            linea('TOTAL PATRIMONIO', bal.patrimonio, { clase: 'total' }),
            linea('PASIVO + PATRIMONIO', bal.pasivoMasPatrimonio, { clase: 'total grand' })
        ]);

        return el('div', { class: 'stack' }, [
            descuadre > 1
                ? ui.banner('El balance no cuadra',
                    `Diferencia de ${U.money(bal.descuadre)} entre el activo y el pasivo más patrimonio. Revise los movimientos del periodo.`,
                    'danger')
                : ui.banner('Balance cuadrado',
                    `Activo ${U.money(bal.activoTotal)} = Pasivo + Patrimonio ${U.money(bal.pasivoMasPatrimonio)}.`,
                    'success'),

            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Caja y bancos', U.money(bal.caja), 'Efectivo disponible', 'var(--c2)'),
                ui.kpi('Por cobrar', U.money(bal.cxc), 'Cartera de clientes', 'var(--c3)'),
                ui.kpi('Inventario', U.money(bal.inventario), 'Mercancía al costo', 'var(--c5)'),
                ui.kpi('Patrimonio', U.money(bal.patrimonio), 'Capital + resultados', 'var(--c1)')
            ]),

            el('div', { class: 'grid-2' }, [
                ui.card('Activos', activos, { subtitulo: `Corte al ${U.fmtDate(estado.hasta)}` }),
                ui.card('Pasivos y patrimonio', pasivos, { subtitulo: `Corte al ${U.fmtDate(estado.hasta)}` })
            ]),

            ui.card('Estructura financiera', ERP.charts.dona({
                items: [
                    { etiqueta: 'Caja y bancos', valor: Math.max(0, bal.caja) },
                    { etiqueta: 'Cuentas por cobrar', valor: Math.max(0, bal.cxc) },
                    { etiqueta: 'Inventario', valor: Math.max(0, bal.inventario) }
                ],
                titulo: 'Activo total'
            }), {
                subtitulo: 'Composición del activo',
                pie: Math.abs(bal.diferenciaInventario) > 1000
                    ? el('p', { class: 'text-muted', text: `Nota: la valorización física del inventario (${U.money(bal.inventarioFisico)}) difiere en ${U.money(bal.diferenciaInventario)} del saldo contable por redondeo del costo promedio.` })
                    : el('p', { class: 'text-muted', text: `La valorización física del inventario coincide con el saldo contable (${U.money(bal.inventarioFisico)}).` })
            })
        ]);
    };

    /* ---------- Flujo de caja ---------- */

    const panelFlujo = () => {
        const flujo = fin.flujoCaja(estado.desde, estado.hasta);
        const serie = fin.serieMensual(estado.desde, estado.hasta);

        const detalle = el('div', {}, [
            linea('Saldo inicial de caja', flujo.saldoInicial, { clase: 'total' }),
            el('p', { class: 'text-soft', style: { padding: '10px 0 2px' }, text: 'Entradas de efectivo' }),
            linea(`Ventas de contado (${flujo.conteos.ventasContado})`, flujo.entradaVentas, { clase: 'sub' }),
            linea(`Abonos de clientes (${flujo.conteos.abonos})`, flujo.entradaAbonos, { clase: 'sub' }),
            linea('Total entradas', flujo.entradas, { clase: 'total' }),
            el('p', { class: 'text-soft', style: { padding: '10px 0 2px' }, text: 'Salidas de efectivo' }),
            linea(`Compras de contado (${flujo.conteos.comprasContado})`, -flujo.salidaCompras, { clase: 'sub' }),
            linea(`Pagos a proveedores (${flujo.conteos.pagosProveedor})`, -flujo.salidaPagos, { clase: 'sub' }),
            linea(`Gastos pagados (${flujo.conteos.gastosPagados})`, -flujo.salidaGastos, { clase: 'sub' }),
            linea('Total salidas', -flujo.salidas, { clase: 'total' }),
            linea('= FLUJO NETO DEL PERIODO', flujo.neto, { clase: 'total' }),
            linea('= SALDO FINAL DE CAJA', flujo.saldoFinal, { clase: 'total grand' })
        ]);

        return el('div', { class: 'stack' }, [
            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Saldo inicial', U.money(flujo.saldoInicial), 'Al inicio del periodo', 'var(--c7)'),
                ui.kpi('Entradas', U.money(flujo.entradas), 'Ventas de contado y abonos', 'var(--c2)'),
                ui.kpi('Salidas', U.money(flujo.salidas), 'Compras, pagos y gastos', 'var(--c6)'),
                ui.kpi('Saldo final', U.money(flujo.saldoFinal),
                    flujo.neto >= 0 ? `Generó ${U.money(flujo.neto)}` : `Consumió ${U.money(Math.abs(flujo.neto))}`,
                    flujo.neto >= 0 ? 'var(--c2)' : 'var(--c6)')
            ]),
            ui.card('Flujo de caja', detalle, {
                subtitulo: `Del ${U.fmtDate(estado.desde)} al ${U.fmtDate(estado.hasta)}`,
                pie: el('p', { class: 'text-muted', text: 'Solo se registran movimientos reales de efectivo: las ventas a crédito entran cuando el cliente abona, y los gastos cuando se pagan.' })
            }),
            ui.card('Entradas contra salidas por mes', ERP.charts.lineas({
                etiquetas: serie.map((s) => s.etiqueta),
                series: [
                    { nombre: 'Entradas', datos: serie.map((s) => s.entradas) },
                    { nombre: 'Salidas', datos: serie.map((s) => s.salidas) }
                ]
            }))
        ]);
    };

    /* ---------- Presupuesto contra real ---------- */

    const panelPresupuesto = (repintar) => {
        const filas = fin.presupuestoVsReal(estado.periodoPresupuesto);
        const totalPre = U.sum(filas, (f) => f.presupuesto);
        const totalReal = U.sum(filas, (f) => f.real);

        const periodos = U.periodRange(U.addMonths(U.today(), -11), U.addMonths(U.today(), 2))
            .map((p) => ({ valor: p, texto: U.fmtPeriod(p) }));

        const selPeriodo = ui.select(periodos, {
            valor: estado.periodoPresupuesto,
            on: {
                change: (event) => {
                    estado.periodoPresupuesto = event.target.value;
                    repintar();
                }
            }
        });

        const cuerpo = el('tbody', {}, filas.map((fila) => {
            const inputMonto = ui.input({
                tipo: 'number', valor: fila.presupuesto, numerico: true, min: 0, step: 50000
            });
            inputMonto.setAttribute('aria-label', `Presupuesto de ${fila.categoria}`);

            inputMonto.addEventListener('change', () => {
                fin.definirPresupuesto(estado.periodoPresupuesto, fila.categoria, inputMonto.value);
                ui.toastOk('Presupuesto actualizado',
                    `${fila.categoria}: ${U.money(inputMonto.value)} para ${U.fmtPeriod(estado.periodoPresupuesto)}.`);
                repintar();
            });

            const excedido = fila.desviacion > 0;
            const uso = fila.presupuesto > 0 ? (fila.real / fila.presupuesto) * 100 : (fila.real > 0 ? 100 : 0);

            return el('tr', {}, [
                el('td', { class: 'wrap', text: fila.categoria }),
                el('td', {}, [inputMonto]),
                el('td', { class: 'num', text: U.money(fila.real) }),
                el('td', { class: `num strong ${excedido ? 'neg' : 'pos'}`, text: U.money(fila.desviacion) }),
                el('td', {}, [
                    el('div', { class: 'row' }, [
                        ui.meter(uso, excedido ? 'var(--danger)' : uso > 85 ? 'var(--warning)' : 'var(--success)'),
                        el('span', { class: 'num text-muted', text: fila.presupuesto > 0 ? U.pct(uso, 0) : '—' })
                    ])
                ])
            ]);
        }));

        const tabla = el('div', { class: 'table-wrap' }, [
            el('table', { class: 'data' }, [
                el('thead', {}, [el('tr', {}, [
                    el('th', { text: 'Categoría', attrs: { scope: 'col' } }),
                    el('th', { text: 'Presupuesto', attrs: { scope: 'col' }, style: { width: '160px' } }),
                    el('th', { class: 'num', text: 'Ejecutado', attrs: { scope: 'col' } }),
                    el('th', { class: 'num', text: 'Desviación', attrs: { scope: 'col' } }),
                    el('th', { text: 'Cumplimiento', attrs: { scope: 'col' }, style: { width: '190px' } })
                ])]),
                cuerpo,
                el('tfoot', {}, [el('tr', {}, [
                    el('td', { text: 'Totales' }),
                    el('td', { class: 'num', text: U.money(totalPre) }),
                    el('td', { class: 'num', text: U.money(totalReal) }),
                    el('td', { class: `num ${totalReal > totalPre ? 'neg' : 'pos'}`, text: U.money(totalReal - totalPre) }),
                    el('td', { text: totalPre > 0 ? U.pct((totalReal / totalPre) * 100, 0) : '—' })
                ])])
            ])
        ]);

        return el('div', { class: 'stack' }, [
            el('div', { class: 'filters' }, [
                ui.campo('Periodo presupuestal', selPeriodo),
                el('div', { class: 'grow filter-status' }, [
                    ui.badge(`Presupuesto ${U.money(totalPre)}`, 'info'),
                    ui.badge(`Ejecutado ${U.money(totalReal)}`, totalReal > totalPre ? 'danger' : 'success')
                ])
            ]),
            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Presupuesto del mes', U.money(totalPre), U.fmtPeriod(estado.periodoPresupuesto), 'var(--c7)'),
                ui.kpi('Ejecución real', U.money(totalReal),
                    totalPre > 0 ? `${U.pct((totalReal / totalPre) * 100, 0)} del presupuesto` : 'Sin presupuesto definido', 'var(--c1)'),
                ui.kpi('Disponible', U.money(totalPre - totalReal),
                    totalReal > totalPre ? 'Presupuesto excedido' : 'Margen restante',
                    totalReal > totalPre ? 'var(--c6)' : 'var(--c2)')
            ]),
            ui.card('Matriz de presupuesto', tabla, {
                subtitulo: 'Edite cualquier monto y la comparación se recalcula al instante',
                sinRelleno: true
            }),
            ui.card('Presupuesto contra ejecución', ERP.charts.barrasComparadas({
                items: filas
                    .filter((f) => f.presupuesto > 0 || f.real > 0)
                    .map((f) => ({ etiqueta: f.categoria, presupuesto: f.presupuesto, real: f.real }))
            }))
        ]);
    };

    /* ---------- Indicadores ---------- */

    const panelIndicadores = () => {
        const ind = fin.indicadores(estado.desde, estado.hasta);

        const ficha = (titulo, valor, interpretacion, tono) => ui.card(titulo,
            el('div', { class: 'stack-sm' }, [
                el('p', { class: 'kpi-value', text: valor }),
                el('p', { class: 'text-muted', text: interpretacion })
            ]), { subtitulo: tono });

        const fmtRatio = (v, sufijo = '') => (v === null || !Number.isFinite(v) ? 'No aplica' : `${U.num(v, 2)}${sufijo}`);

        return el('div', { class: 'stack' }, [
            el('div', { class: 'grid-3' }, [
                ficha('Margen bruto', U.pct((ind.margenBruto || 0) * 100),
                    'Porcentaje de cada peso vendido que queda después de pagar el costo de la mercancía.',
                    'Rentabilidad'),
                ficha('Margen operacional', U.pct((ind.margenOperacional || 0) * 100),
                    'Lo que queda después de cubrir también los gastos de operación del negocio.',
                    'Rentabilidad'),
                ficha('Margen neto', U.pct((ind.margenNeto || 0) * 100),
                    'Utilidad final sobre las ventas, ya descontados todos los gastos.',
                    'Rentabilidad'),
                ficha('Razón corriente', fmtRatio(ind.razonCorriente),
                    ind.razonCorriente === null ? 'No hay pasivos corrientes registrados.'
                        : ind.razonCorriente >= 1.5 ? 'Buena liquidez: el activo corriente cubre holgadamente las deudas de corto plazo.'
                            : ind.razonCorriente >= 1 ? 'Liquidez ajustada: alcanza a cubrir las deudas de corto plazo.'
                                : 'Riesgo de liquidez: el activo corriente no cubre las deudas de corto plazo.',
                    'Liquidez'),
                ficha('Prueba ácida', fmtRatio(ind.pruebaAcida),
                    'Igual que la razón corriente pero sin contar el inventario, que es lo más difícil de convertir en efectivo.',
                    'Liquidez'),
                ficha('Capital de trabajo', U.money(ind.capitalTrabajo),
                    'Recursos propios disponibles para operar después de cubrir las obligaciones de corto plazo.',
                    'Liquidez'),
                ficha('Rotación de cartera', fmtRatio(ind.rotacionCartera, ' veces'),
                    'Cuántas veces se recuperó la cartera en el periodo analizado.',
                    'Eficiencia'),
                ficha('Días de cartera', ind.diasCartera === null ? 'No aplica' : `${U.num(ind.diasCartera, 0)} días`,
                    'Tiempo promedio que tarda un cliente en pagar. Compárelo con el plazo que usted otorga.',
                    'Eficiencia'),
                ficha('Nivel de endeudamiento', U.pct((ind.endeudamiento || 0) * 100),
                    'Proporción del activo que está financiada con deuda en lugar de patrimonio.',
                    'Estructura')
            ]),
            ui.banner('Cómo leer estos indicadores',
                `Calculados sobre ${ind.dias} días, del ${U.fmtDate(estado.desde)} al ${U.fmtDate(estado.hasta)}. Los indicadores de liquidez y endeudamiento usan el balance a la fecha de corte.`,
                'info')
        ]);
    };

    /* ---------- Vista ---------- */

    const vista = (contenedor) => {
        const zonaPanel = el('div');

        const repintar = () => {
            U.clear(zonaPanel);
            const paneles = {
                resultados: panelResultados,
                balance: panelBalance,
                flujo: panelFlujo,
                presupuesto: () => panelPresupuesto(repintar),
                indicadores: panelIndicadores
            };
            zonaPanel.appendChild((paneles[estado.pestana] || panelResultados)());
        };

        const PESTANAS = [
            ['resultados', 'Estado de resultados'],
            ['balance', 'Balance general'],
            ['flujo', 'Flujo de caja'],
            ['presupuesto', 'Presupuesto vs. real'],
            ['indicadores', 'Indicadores']
        ];

        const tabs = el('div', { class: 'tabs', attrs: { role: 'tablist' } },
            PESTANAS.map(([clave, texto]) => el('button', {
                text: texto,
                attrs: { type: 'button', role: 'tab', 'aria-selected': String(estado.pestana === clave) },
                on: {
                    click: (event) => {
                        estado.pestana = clave;
                        tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', 'false'));
                        event.currentTarget.setAttribute('aria-selected', 'true');
                        repintar();
                    }
                }
            })));

        const inpDesde = ui.input({
            tipo: 'date', valor: estado.desde,
            on: { change: (e) => { estado.desde = e.target.value; repintar(); } }
        });
        const inpHasta = ui.input({
            tipo: 'date', valor: estado.hasta,
            on: { change: (e) => { estado.hasta = e.target.value; repintar(); } }
        });

        const atajos = el('div', { class: 'row row-wrap' }, [
            ['Mes actual', () => { estado.desde = U.startOfMonth(U.today()); estado.hasta = U.today(); }],
            ['Últimos 3 meses', () => { estado.desde = U.startOfMonth(U.addMonths(U.today(), -2)); estado.hasta = U.today(); }],
            ['Últimos 6 meses', () => { estado.desde = U.startOfMonth(U.addMonths(U.today(), -5)); estado.hasta = U.today(); }],
            ['Año en curso', () => { estado.desde = `${U.today().slice(0, 4)}-01-01`; estado.hasta = U.today(); }]
        ].map(([texto, accion]) => el('button', {
            class: 'btn btn-secondary btn-sm', text: texto, attrs: { type: 'button' },
            on: {
                click: () => {
                    accion();
                    inpDesde.value = estado.desde;
                    inpHasta.value = estado.hasta;
                    repintar();
                }
            }
        })));

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Estados financieros' }),
                    el('p', { text: 'Generados en tiempo real a partir de las transacciones registradas. Ningún valor se digita a mano.' })
                ])
            ]),
            el('div', { class: 'filters' }, [
                ui.campo('Desde', inpDesde),
                ui.campo('Hasta', inpHasta),
                el('div', { class: 'grow' }, [atajos])
            ]),
            tabs,
            zonaPanel
        ]);

        repintar();
    };

    return { vista, estado };
})();
