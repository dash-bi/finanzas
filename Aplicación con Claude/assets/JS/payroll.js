/* ============================================================
   payroll.js — Liquidación de nómina
   Devengados, deducciones de ley y provisiones prestacionales.
   Los porcentajes y topes viven en Configuración porque cambian
   por decreto cada año: nunca se codifican como constantes fijas.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.nomina = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    // Recargos legales sobre el valor de la hora ordinaria.
    const FACTORES = {
        extraDiurna: 1.25,
        extraNocturna: 1.75,
        recargoNocturno: 0.35,
        dominical: 1.75
    };

    // Provisiones a cargo del empleador.
    const PROVISIONES = {
        cesantias: 8.33,
        interesesCesantias: 1,
        prima: 8.33,
        vacaciones: 4.17
    };

    const HORAS_MES = 240; // 30 días × 8 horas

    /* ============================================================
       Cálculo
       ============================================================ */

    const liquidar = (entrada) => {
        const cfg = db.config();
        const salario = U.toNumber(entrada.salario);
        const dias = Math.min(30, Math.max(0, U.toNumber(entrada.dias)));

        const valorHora = salario / HORAS_MES;
        const sueldoProporcional = (salario / 30) * dias;

        // El auxilio de transporte solo aplica hasta el tope legal en SMMLV.
        const tope = U.toNumber(cfg.salarioMinimo) * U.toNumber(cfg.topeAuxilioSmmlv);
        const aplicaAuxilio = entrada.auxilioTransporte && salario <= tope;
        const auxilio = aplicaAuxilio ? (U.toNumber(cfg.auxilioTransporte) / 30) * dias : 0;

        const extraDiurna = U.toNumber(entrada.horasExtraDiurna) * valorHora * FACTORES.extraDiurna;
        const extraNocturna = U.toNumber(entrada.horasExtraNocturna) * valorHora * FACTORES.extraNocturna;
        const recargoNocturno = U.toNumber(entrada.horasRecargoNocturno) * valorHora * FACTORES.recargoNocturno;
        const dominical = U.toNumber(entrada.horasDominical) * valorHora * FACTORES.dominical;
        const bonificaciones = U.toNumber(entrada.bonificaciones);

        const totalExtras = extraDiurna + extraNocturna + recargoNocturno + dominical;

        // El auxilio de transporte no es salario: no hace base para seguridad social.
        const baseSeguridad = sueldoProporcional + totalExtras + bonificaciones;
        const devengado = baseSeguridad + auxilio;

        const salud = baseSeguridad * (U.toNumber(cfg.aporteSaludPct) / 100);
        const pension = baseSeguridad * (U.toNumber(cfg.aportePensionPct) / 100);
        const otrasDeducciones = U.toNumber(entrada.otrasDeducciones);
        const totalDeducciones = salud + pension + otrasDeducciones;

        const neto = devengado - totalDeducciones;

        // Las provisiones no se descuentan al empleado: son costo del empleador.
        const basePrestacional = baseSeguridad + auxilio;
        const provisiones = {
            cesantias: basePrestacional * (PROVISIONES.cesantias / 100),
            interesesCesantias: basePrestacional * (PROVISIONES.cesantias / 100) * (PROVISIONES.interesesCesantias / 100) * 12,
            prima: basePrestacional * (PROVISIONES.prima / 100),
            vacaciones: baseSeguridad * (PROVISIONES.vacaciones / 100)
        };
        provisiones.total = provisiones.cesantias + provisiones.interesesCesantias
            + provisiones.prima + provisiones.vacaciones;

        return {
            valorHora: U.roundCop(valorHora),
            sueldoProporcional: U.roundCop(sueldoProporcional),
            auxilio: U.roundCop(auxilio),
            aplicaAuxilio,
            extraDiurna: U.roundCop(extraDiurna),
            extraNocturna: U.roundCop(extraNocturna),
            recargoNocturno: U.roundCop(recargoNocturno),
            dominical: U.roundCop(dominical),
            bonificaciones: U.roundCop(bonificaciones),
            totalExtras: U.roundCop(totalExtras),
            devengado: U.roundCop(devengado),
            salud: U.roundCop(salud),
            pension: U.roundCop(pension),
            otrasDeducciones: U.roundCop(otrasDeducciones),
            totalDeducciones: U.roundCop(totalDeducciones),
            neto: U.roundCop(neto),
            provisiones: {
                cesantias: U.roundCop(provisiones.cesantias),
                interesesCesantias: U.roundCop(provisiones.interesesCesantias),
                prima: U.roundCop(provisiones.prima),
                vacaciones: U.roundCop(provisiones.vacaciones),
                total: U.roundCop(provisiones.total)
            },
            costoEmpleador: U.roundCop(devengado + provisiones.total)
        };
    };

    /* ============================================================
       Empleados
       ============================================================ */

    const abrirEmpleado = (empleado) => {
        const editando = Boolean(empleado);
        const cfg = db.config();
        const datos = empleado || {
            documento: '', nombre: '', cargo: '', salario: cfg.salarioMinimo,
            auxilioTransporte: true, activo: true, ingreso: U.today()
        };

        const campos = {
            documento: ui.input({ valor: datos.documento, placeholder: '1.017.000.000' }),
            nombre: ui.input({ valor: datos.nombre, placeholder: 'Nombre completo' }),
            cargo: ui.input({ valor: datos.cargo, placeholder: 'Cargo' }),
            salario: ui.input({ tipo: 'number', valor: datos.salario, numerico: true, min: 0, step: 50000 }),
            ingreso: ui.input({ tipo: 'date', valor: datos.ingreso }),
            auxilioTransporte: el('input', { attrs: { type: 'checkbox' }, props: { checked: datos.auxilioTransporte !== false } }),
            activo: el('input', { attrs: { type: 'checkbox' }, props: { checked: datos.activo !== false } })
        };

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            el('div', { class: 'grid-form' }, [
                ui.campo('Documento', campos.documento),
                ui.campo('Nombre completo', campos.nombre, { clase: 'span-full' }),
                ui.campo('Cargo', campos.cargo),
                ui.campo('Salario básico mensual', campos.salario),
                ui.campo('Fecha de ingreso', campos.ingreso)
            ]),
            el('div', { class: 'row row-wrap' }, [
                el('label', { class: 'check' }, [campos.auxilioTransporte, el('span', { text: 'Tiene derecho a auxilio de transporte' })]),
                el('label', { class: 'check' }, [campos.activo, el('span', { text: 'Empleado activo' })])
            ]),
            ui.banner('Auxilio de transporte',
                `Solo se liquida si el salario es igual o menor a ${U.money(U.toNumber(cfg.salarioMinimo) * U.toNumber(cfg.topeAuxilioSmmlv))} (${cfg.topeAuxilioSmmlv} salarios mínimos).`,
                'info')
        ]);

        const btnGuardar = el('button', { class: 'btn', text: editando ? 'Guardar cambios' : 'Crear empleado', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: editando ? 'Editar empleado' : 'Nuevo empleado',
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const nombre = campos.nombre.value.trim();
            const documento = campos.documento.value.trim();
            const fallas = [];

            if (nombre.length < 3) fallas.push('El nombre es obligatorio.');
            if (!documento) fallas.push('El documento es obligatorio.');
            if (U.toNumber(campos.salario.value) <= 0) fallas.push('El salario debe ser mayor que cero.');

            const duplicado = db.all('empleados').find(
                (e) => e.documento === documento && (!editando || e.id !== empleado.id));
            if (duplicado) fallas.push(`Ya existe un empleado con el documento ${documento}.`);

            if (fallas.length) {
                errores.appendChild(ui.banner('Revise los siguientes puntos', fallas.join(' '), 'danger'));
                return;
            }

            const payload = {
                documento, nombre,
                cargo: campos.cargo.value.trim(),
                salario: U.roundCop(campos.salario.value),
                ingreso: campos.ingreso.value,
                auxilioTransporte: campos.auxilioTransporte.checked,
                activo: campos.activo.checked
            };

            if (editando) {
                db.update('empleados', empleado.id, payload);
                ui.toastOk('Empleado actualizado', nombre);
            } else {
                db.insert('empleados', payload);
                ui.toastOk('Empleado creado', nombre);
            }
            ctrl.cerrar();
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ============================================================
       Liquidación
       ============================================================ */

    const abrirLiquidacion = (empleado) => {
        const activos = db.all('empleados').filter((e) => e.activo !== false);
        if (activos.length === 0) {
            ui.toastError('No hay empleados activos', 'Registre al menos un empleado para liquidar nómina.');
            return;
        }

        const campos = {
            empleado: ui.select(
                activos.map((e) => ({ valor: e.id, texto: `${e.nombre} — ${e.cargo}` })),
                { valor: empleado ? empleado.id : activos[0].id }
            ),
            periodo: ui.input({ tipo: 'month', valor: U.periodOf(U.today()) }),
            dias: ui.input({ tipo: 'number', valor: 30, numerico: true, min: 0, max: 30 }),
            horasExtraDiurna: ui.input({ tipo: 'number', valor: 0, numerico: true, min: 0 }),
            horasExtraNocturna: ui.input({ tipo: 'number', valor: 0, numerico: true, min: 0 }),
            horasRecargoNocturno: ui.input({ tipo: 'number', valor: 0, numerico: true, min: 0 }),
            horasDominical: ui.input({ tipo: 'number', valor: 0, numerico: true, min: 0 }),
            bonificaciones: ui.input({ tipo: 'number', valor: 0, numerico: true, min: 0, step: 10000 }),
            otrasDeducciones: ui.input({ tipo: 'number', valor: 0, numerico: true, min: 0, step: 10000 })
        };

        const zonaResumen = el('div', { class: 'stack' });
        const errores = el('div');

        const entradaActual = () => {
            const emp = db.get('empleados', campos.empleado.value);
            return {
                salario: emp ? emp.salario : 0,
                auxilioTransporte: emp ? emp.auxilioTransporte : false,
                dias: campos.dias.value,
                horasExtraDiurna: campos.horasExtraDiurna.value,
                horasExtraNocturna: campos.horasExtraNocturna.value,
                horasRecargoNocturno: campos.horasRecargoNocturno.value,
                horasDominical: campos.horasDominical.value,
                bonificaciones: campos.bonificaciones.value,
                otrasDeducciones: campos.otrasDeducciones.value
            };
        };

        const fila = (etiqueta, valor, clase) => el('div', { class: `fin-line${clase ? ` ${clase}` : ''}` }, [
            el('span', { text: etiqueta }),
            el('span', { class: 'num', text: U.money(valor) })
        ]);

        const refrescar = () => {
            U.clear(zonaResumen);
            const emp = db.get('empleados', campos.empleado.value);
            if (!emp) return;

            const r = liquidar(entradaActual());

            U.appendAll(zonaResumen, [
                el('div', { class: 'grid-2' }, [
                    ui.card('Devengado', el('div', {}, [
                        fila('Sueldo del periodo', r.sueldoProporcional, 'sub'),
                        r.auxilio > 0 ? fila('Auxilio de transporte', r.auxilio, 'sub') : null,
                        r.extraDiurna > 0 ? fila('Horas extra diurnas (25 %)', r.extraDiurna, 'sub') : null,
                        r.extraNocturna > 0 ? fila('Horas extra nocturnas (75 %)', r.extraNocturna, 'sub') : null,
                        r.recargoNocturno > 0 ? fila('Recargo nocturno (35 %)', r.recargoNocturno, 'sub') : null,
                        r.dominical > 0 ? fila('Dominicales y festivos (75 %)', r.dominical, 'sub') : null,
                        r.bonificaciones > 0 ? fila('Bonificaciones', r.bonificaciones, 'sub') : null,
                        fila('Total devengado', r.devengado, 'total')
                    ])),
                    ui.card('Deducciones', el('div', {}, [
                        fila(`Salud (${U.num(db.config().aporteSaludPct)} %)`, r.salud, 'sub'),
                        fila(`Pensión (${U.num(db.config().aportePensionPct)} %)`, r.pension, 'sub'),
                        r.otrasDeducciones > 0 ? fila('Otras deducciones', r.otrasDeducciones, 'sub') : null,
                        fila('Total deducciones', r.totalDeducciones, 'total'),
                        fila('NETO A PAGAR', r.neto, 'total grand')
                    ]))
                ]),
                ui.card('Provisiones prestacionales a cargo del empleador', el('div', {}, [
                    fila('Cesantías (8,33 %)', r.provisiones.cesantias, 'sub'),
                    fila('Intereses sobre cesantías (12 % anual)', r.provisiones.interesesCesantias, 'sub'),
                    fila('Prima de servicios (8,33 %)', r.provisiones.prima, 'sub'),
                    fila('Vacaciones (4,17 %)', r.provisiones.vacaciones, 'sub'),
                    fila('Total provisiones', r.provisiones.total, 'total'),
                    fila('COSTO TOTAL PARA LA EMPRESA', r.costoEmpleador, 'total grand')
                ]), {
                    subtitulo: 'No se descuentan al empleado: son costo adicional del empleador'
                }),
                !r.aplicaAuxilio && emp.auxilioTransporte
                    ? ui.banner('Sin auxilio de transporte',
                        `El salario de ${emp.nombre} supera el tope legal, por lo que no se liquida auxilio de transporte.`,
                        'info')
                    : null
            ]);
        };

        Object.values(campos).forEach((campo) => {
            campo.addEventListener('input', refrescar);
            campo.addEventListener('change', refrescar);
        });

        const formulario = el('form', { class: 'stack' }, [
            errores,
            el('div', { class: 'grid-form' }, [
                ui.campo('Empleado', campos.empleado, { clase: 'span-full' }),
                ui.campo('Periodo', campos.periodo),
                ui.campo('Días trabajados', campos.dias, { ayuda: 'Base de 30 días por mes.' }),
                ui.campo('Horas extra diurnas', campos.horasExtraDiurna),
                ui.campo('Horas extra nocturnas', campos.horasExtraNocturna),
                ui.campo('Horas recargo nocturno', campos.horasRecargoNocturno),
                ui.campo('Horas dominicales/festivas', campos.horasDominical),
                ui.campo('Bonificaciones', campos.bonificaciones),
                ui.campo('Otras deducciones', campos.otrasDeducciones)
            ]),
            zonaResumen
        ]);

        const btnGuardar = el('button', { class: 'btn', text: 'Liquidar y registrar gasto', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: 'Liquidación de nómina',
            subtitulo: 'El costo total se registra automáticamente como gasto de nómina',
            ancho: 'ancho',
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        refrescar();
        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            const emp = db.get('empleados', campos.empleado.value);
            const periodo = campos.periodo.value;

            if (!emp) {
                errores.appendChild(ui.banner('Falta el empleado', 'Seleccione a quién se liquida.', 'danger'));
                return;
            }
            if (!periodo || periodo.length < 7) {
                errores.appendChild(ui.banner('Periodo inválido', 'Seleccione el mes que se liquida.', 'danger'));
                return;
            }

            const yaExiste = db.all('nominas').find(
                (n) => n.empleadoId === emp.id && n.periodo === periodo);
            if (yaExiste) {
                errores.appendChild(ui.banner('Periodo ya liquidado',
                    `${emp.nombre} ya tiene una liquidación registrada para ${U.fmtPeriod(periodo)}. Elimínela antes de volver a liquidar.`,
                    'danger'));
                return;
            }

            const r = liquidar(entradaActual());
            const fechaGasto = U.endOfMonth(`${periodo}-01`);

            const nomina = db.insert('nominas', {
                empleadoId: emp.id,
                empleadoNombre: emp.nombre,
                periodo,
                dias: U.toNumber(campos.dias.value),
                salarioBase: emp.salario,
                horasExtraDiurna: U.toNumber(campos.horasExtraDiurna.value),
                horasExtraNocturna: U.toNumber(campos.horasExtraNocturna.value),
                horasRecargoNocturno: U.toNumber(campos.horasRecargoNocturno.value),
                horasDominical: U.toNumber(campos.horasDominical.value),
                ...r
            });

            const gasto = db.registrarGasto({
                fecha: fechaGasto > U.today() ? U.today() : fechaGasto,
                categoria: 'Nómina',
                descripcion: `Nómina ${U.fmtPeriod(periodo)} — ${emp.nombre}`,
                valor: r.costoEmpleador,
                pagado: true,
                medio: 'Transferencia',
                origen: 'nomina',
                referencia: nomina.id
            });

            if (!gasto.ok) {
                ui.toastWarn('Liquidación guardada sin gasto', gasto.error);
            }

            ui.toastOk('Nómina liquidada',
                `${emp.nombre} — neto ${U.money(r.neto)}, costo total ${U.money(r.costoEmpleador)}.`);
            ctrl.cerrar();
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    const eliminarLiquidacion = async (nomina) => {
        const confirmado = await ui.confirmar({
            titulo: 'Eliminar liquidación',
            mensaje: `¿Eliminar la nómina de ${nomina.empleadoNombre} del periodo ${U.fmtPeriod(nomina.periodo)}?`,
            detalle: 'También se eliminará el gasto de nómina asociado.',
            textoAceptar: 'Eliminar',
            peligroso: true
        });
        if (!confirmado) return;

        const gasto = db.all('gastos').find((g) => g.referencia === nomina.id);
        if (gasto) db.remove('gastos', gasto.id);
        db.remove('nominas', nomina.id);
        ui.toastOk('Liquidación eliminada');
    };

    /* ============================================================
       Vista
       ============================================================ */

    const vista = (contenedor) => {
        const empleados = db.all('empleados');
        const activos = empleados.filter((e) => e.activo !== false);
        const nominas = U.sortBy(db.all('nominas'), 'periodo', 'desc');
        const periodoActual = U.periodOf(U.today());
        const delMes = nominas.filter((n) => n.periodo === periodoActual);

        const costoMensualEstimado = U.sum(activos, (e) => liquidar({
            salario: e.salario, auxilioTransporte: e.auxilioTransporte, dias: 30,
            horasExtraDiurna: 0, horasExtraNocturna: 0, horasRecargoNocturno: 0,
            horasDominical: 0, bonificaciones: 0, otrasDeducciones: 0
        }).costoEmpleador);

        const tablaEmpleados = ui.tabla(empleados, [
            { clave: 'nombre', titulo: 'Empleado', ajustar: true },
            { clave: 'documento', titulo: 'Documento' },
            { clave: 'cargo', titulo: 'Cargo' },
            { clave: 'ingreso', titulo: 'Ingreso', tipo: 'fecha' },
            { clave: 'salario', titulo: 'Salario básico', tipo: 'moneda' },
            {
                clave: 'costo', titulo: 'Costo mensual', tipo: 'moneda',
                valor: (e) => liquidar({
                    salario: e.salario, auxilioTransporte: e.auxilioTransporte, dias: 30,
                    horasExtraDiurna: 0, horasExtraNocturna: 0, horasRecargoNocturno: 0,
                    horasDominical: 0, bonificaciones: 0, otrasDeducciones: 0
                }).costoEmpleador
            },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                render: (e) => ui.badge(e.activo === false ? 'Inactivo' : 'Activo',
                    e.activo === false ? 'neutral' : 'success')
            },
            {
                clave: 'acciones', titulo: '', tipo: 'nodo',
                render: (e) => el('div', { class: 'row' }, [
                    el('button', {
                        class: 'btn btn-sm', text: 'Liquidar', attrs: { type: 'button' },
                        on: { click: () => abrirLiquidacion(e) }
                    }),
                    el('button', {
                        class: 'btn btn-ghost btn-sm', text: 'Editar', attrs: { type: 'button' },
                        on: { click: () => abrirEmpleado(e) }
                    })
                ])
            }
        ], {
            ordenInicial: 'nombre',
            textoBusqueda: 'Buscar empleado…',
            porPagina: 10,
            totales: (l) => ({
                nombre: `${l.length} empleados`,
                salario: U.sum(l, (e) => e.salario)
            })
        });

        const tablaNominas = ui.tabla(nominas, [
            { clave: 'periodo', titulo: 'Periodo', valor: (n) => U.fmtPeriod(n.periodo) },
            { clave: 'empleadoNombre', titulo: 'Empleado', ajustar: true },
            { clave: 'dias', titulo: 'Días', tipo: 'numero' },
            { clave: 'devengado', titulo: 'Devengado', tipo: 'moneda' },
            { clave: 'totalDeducciones', titulo: 'Deducciones', tipo: 'moneda' },
            { clave: 'neto', titulo: 'Neto pagado', tipo: 'moneda' },
            { clave: 'costoEmpleador', titulo: 'Costo empresa', tipo: 'moneda' },
            {
                clave: 'acciones', titulo: '', tipo: 'nodo',
                render: (n) => el('button', {
                    class: 'btn btn-ghost btn-sm', text: 'Eliminar', attrs: { type: 'button' },
                    on: { click: () => eliminarLiquidacion(n) }
                })
            }
        ], {
            ordenInicial: 'periodo',
            dirInicial: 'desc',
            textoBusqueda: 'Buscar liquidación…',
            porPagina: 10,
            vacio: ui.estadoVacio('Sin liquidaciones',
                'Todavía no se ha liquidado nómina. Use el botón "Liquidar" de un empleado.'),
            totales: (l) => ({
                periodo: `${l.length} liquidaciones`,
                devengado: U.sum(l, (n) => n.devengado),
                neto: U.sum(l, (n) => n.neto),
                costoEmpleador: U.sum(l, (n) => n.costoEmpleador)
            })
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Nómina' }),
                    el('p', { text: 'Liquidación periódica por empleado. Cada liquidación se imputa como gasto de nómina.' })
                ]),
                el('div', { class: 'row' }, [
                    el('button', {
                        class: 'btn btn-secondary', text: '+ Empleado', attrs: { type: 'button' },
                        on: { click: () => abrirEmpleado() }
                    }),
                    el('button', {
                        class: 'btn', text: 'Liquidar nómina', attrs: { type: 'button' },
                        on: { click: () => abrirLiquidacion() }
                    })
                ])
            ]),

            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Empleados activos', U.num(activos.length),
                    `${empleados.length} en total`, 'var(--c1)'),
                ui.kpi('Costo mensual estimado', U.money(costoMensualEstimado),
                    'Incluye provisiones prestacionales', 'var(--c6)'),
                ui.kpi('Liquidado este mes', U.money(U.sum(delMes, (n) => n.costoEmpleador)),
                    `${delMes.length} de ${activos.length} empleados`, 'var(--c3)'),
                ui.kpi('Neto pagado este mes', U.money(U.sum(delMes, (n) => n.neto)),
                    U.fmtPeriod(periodoActual), 'var(--c2)')
            ]),

            delMes.length < activos.length
                ? ui.banner('Nómina pendiente',
                    `Faltan ${activos.length - delMes.length} empleados por liquidar en ${U.fmtPeriod(periodoActual)}.`,
                    'warning')
                : ui.banner('Nómina del mes completa',
                    `Los ${activos.length} empleados activos ya fueron liquidados en ${U.fmtPeriod(periodoActual)}.`,
                    'success'),

            ui.card('Empleados', tablaEmpleados.nodo, { sinRelleno: true }),
            ui.card('Historial de liquidaciones', tablaNominas.nodo, { sinRelleno: true })
        ]);
    };

    return { vista, liquidar, abrirEmpleado, abrirLiquidacion, FACTORES, PROVISIONES };
})();
