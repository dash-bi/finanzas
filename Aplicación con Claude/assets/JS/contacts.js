/* ============================================================
   contacts.js — Clientes y proveedores
   Registro completo, control de cupo de crédito y estado de cuenta.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.contactos = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const TIPOS_DOC = ['NIT', 'CC', 'CE', 'Pasaporte'];

    /* ============================================================
       Formulario de creación / edición
       ============================================================ */

    const abrirFormulario = (tipo, registro) => {
        const esCliente = tipo === 'cliente';
        const editando = Boolean(registro);
        const datos = registro || {
            tipoDoc: esCliente ? 'NIT' : 'NIT', documento: '', nombre: '', telefono: '',
            email: '', direccion: '', limiteCredito: 0, activo: true
        };

        const campos = {
            tipoDoc: ui.select(TIPOS_DOC, { valor: datos.tipoDoc }),
            documento: ui.input({ valor: datos.documento, placeholder: '900.123.456-7' }),
            nombre: ui.input({ valor: datos.nombre, placeholder: 'Razón social o nombre completo' }),
            telefono: ui.input({ valor: datos.telefono, placeholder: '(604) 000 0000' }),
            email: ui.input({ tipo: 'email', valor: datos.email, placeholder: 'correo@empresa.com' }),
            direccion: ui.input({ valor: datos.direccion, placeholder: 'Dirección y ciudad' }),
            limiteCredito: ui.input({ tipo: 'number', valor: datos.limiteCredito, numerico: true, min: 0, step: 100000 }),
            activo: el('input', { attrs: { type: 'checkbox' }, props: { checked: datos.activo !== false } })
        };

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            el('div', { class: 'grid-form' }, [
                ui.campo('Tipo de documento', campos.tipoDoc),
                ui.campo('Número de documento', campos.documento),
                ui.campo(esCliente ? 'Nombre del cliente' : 'Nombre del proveedor', campos.nombre, { clase: 'span-full' }),
                ui.campo('Teléfono', campos.telefono),
                ui.campo('Correo electrónico', campos.email),
                ui.campo('Dirección', campos.direccion, { clase: 'span-full' }),
                esCliente ? ui.campo('Límite de crédito', campos.limiteCredito, {
                    ayuda: 'Cupo máximo autorizado para ventas a crédito. Use 0 para exigir pago de contado.'
                }) : null
            ]),
            el('label', { class: 'check' }, [campos.activo, el('span', { text: 'Registro activo' })])
        ]);

        const btnGuardar = el('button', {
            class: 'btn',
            text: editando ? 'Guardar cambios' : 'Crear registro',
            attrs: { type: 'button' }
        });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: editando
                ? `Editar ${esCliente ? 'cliente' : 'proveedor'}`
                : `Nuevo ${esCliente ? 'cliente' : 'proveedor'}`,
            subtitulo: editando ? datos.nombre : 'Complete los datos del tercero',
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
            if (nombre.length < 3) fallas.push('El nombre debe tener al menos 3 caracteres.');
            if (!documento) fallas.push('El número de documento es obligatorio.');

            const duplicado = db.all('terceros').find(
                (t) => t.documento === documento && t.tipo === tipo && (!editando || t.id !== registro.id)
            );
            if (duplicado) fallas.push(`Ya existe un registro con el documento ${documento}.`);

            const correo = campos.email.value.trim();
            if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
                fallas.push('El correo electrónico no tiene un formato válido.');
            }

            const limite = U.toNumber(campos.limiteCredito.value);
            if (esCliente && editando && limite < db.saldoCliente(registro.id)) {
                fallas.push(`El límite no puede ser menor que el saldo actual del cliente (${U.money(db.saldoCliente(registro.id))}).`);
            }

            if (fallas.length) {
                errores.appendChild(ui.banner('Revise los siguientes puntos', fallas.join(' '), 'danger'));
                return;
            }

            const payload = {
                tipo,
                tipoDoc: campos.tipoDoc.value,
                documento,
                nombre,
                telefono: campos.telefono.value.trim(),
                email: correo,
                direccion: campos.direccion.value.trim(),
                limiteCredito: esCliente ? limite : 0,
                activo: campos.activo.checked
            };

            if (editando) {
                db.update('terceros', registro.id, payload);
                ui.toastOk('Registro actualizado', nombre);
            } else {
                db.insert('terceros', payload);
                ui.toastOk(`${esCliente ? 'Cliente' : 'Proveedor'} creado`, nombre);
            }
            ctrl.cerrar();
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ============================================================
       Estado de cuenta
       ============================================================ */

    const estadoCuentaCliente = (cliente) => {
        const ventas = U.sortBy(
            db.all('ventas').filter((v) => v.clienteId === cliente.id && !v.anulada),
            'fecha', 'desc'
        );

        const abonos = db.all('abonos').filter((a) => a.clienteId === cliente.id);
        const facturado = U.sum(ventas, (v) => v.total);
        const abonado = U.sum(abonos, (a) => a.valor);
        const saldo = db.saldoCliente(cliente.id);
        const vencidas = ventas.filter((v) => db.estadoVenta(v).clave === 'vencida');

        const tabla = ui.tabla(ventas, [
            { clave: 'numero', titulo: 'Factura' },
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
            { clave: 'condicion', titulo: 'Condición', valor: (v) => (v.condicion === 'credito' ? `Crédito ${v.diasCredito} días` : 'Contado') },
            { clave: 'fechaVencimiento', titulo: 'Vence', tipo: 'fecha' },
            { clave: 'total', titulo: 'Total', tipo: 'moneda' },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                render: (v) => {
                    const est = db.estadoVenta(v);
                    return ui.badge(est.texto, est.tono);
                }
            }
        ], {
            porPagina: 8,
            buscador: false,
            vacio: ui.estadoVacio('Sin facturas', 'Este cliente todavía no tiene ventas registradas.'),
            totales: (lista) => ({
                numero: 'Totales',
                total: U.sum(lista, (v) => v.total),
                saldo: U.sum(lista, (v) => v.saldo)
            })
        });

        ui.modal({
            titulo: `Estado de cuenta — ${cliente.nombre}`,
            subtitulo: `${cliente.tipoDoc} ${cliente.documento}`,
            ancho: 'ancho',
            contenido: el('div', { class: 'stack' }, [
                el('div', { class: 'grid-kpi' }, [
                    ui.kpi('Total facturado', U.money(facturado), `${ventas.length} facturas`, 'var(--c1)'),
                    ui.kpi('Total abonado', U.money(abonado), `${abonos.length} abonos`, 'var(--c2)'),
                    ui.kpi('Saldo pendiente', U.money(saldo), saldo > 0 ? 'Cartera por cobrar' : 'Sin deuda', saldo > 0 ? 'var(--c3)' : 'var(--c2)'),
                    ui.kpi('Cupo disponible', U.money(db.cupoDisponible(cliente.id)), `Límite ${U.money(cliente.limiteCredito)}`, 'var(--c4)')
                ]),
                vencidas.length
                    ? ui.banner('Cartera vencida',
                        `${vencidas.length} ${vencidas.length === 1 ? 'factura vencida' : 'facturas vencidas'} por ${U.money(U.sum(vencidas, (v) => v.saldo))}.`,
                        'danger')
                    : null,
                tabla.nodo
            ])
        });
    };

    const estadoCuentaProveedor = (proveedor) => {
        const compras = U.sortBy(
            db.all('compras').filter((c) => c.proveedorId === proveedor.id), 'fecha', 'desc'
        );
        const pagos = db.all('pagosCompra').filter((p) => p.proveedorId === proveedor.id);
        const comprado = U.sum(compras, (c) => c.total);
        const pagado = U.sum(pagos, (p) => p.valor);
        const saldo = db.saldoProveedor(proveedor.id);

        const tabla = ui.tabla(compras, [
            { clave: 'numero', titulo: 'Compra' },
            { clave: 'documentoProveedor', titulo: 'Doc. proveedor' },
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
            { clave: 'condicion', titulo: 'Condición', valor: (c) => (c.condicion === 'credito' ? `Crédito ${c.diasCredito} días` : 'Contado') },
            { clave: 'total', titulo: 'Total', tipo: 'moneda' },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' }
        ], {
            porPagina: 8,
            buscador: false,
            vacio: ui.estadoVacio('Sin compras', 'Este proveedor todavía no tiene compras registradas.'),
            totales: (lista) => ({
                numero: 'Totales',
                total: U.sum(lista, (c) => c.total),
                saldo: U.sum(lista, (c) => c.saldo)
            })
        });

        ui.modal({
            titulo: `Estado de cuenta — ${proveedor.nombre}`,
            subtitulo: `${proveedor.tipoDoc} ${proveedor.documento}`,
            ancho: 'ancho',
            contenido: el('div', { class: 'stack' }, [
                el('div', { class: 'grid-kpi' }, [
                    ui.kpi('Total comprado', U.money(comprado), `${compras.length} compras`, 'var(--c1)'),
                    ui.kpi('Total pagado', U.money(pagado), `${pagos.length} pagos`, 'var(--c2)'),
                    ui.kpi('Saldo por pagar', U.money(saldo), saldo > 0 ? 'Cuentas por pagar' : 'Sin deuda', saldo > 0 ? 'var(--c6)' : 'var(--c2)')
                ]),
                tabla.nodo
            ])
        });
    };

    /* ============================================================
       Eliminación con validación de integridad referencial
       ============================================================ */

    const eliminar = async (registro) => {
        const esCliente = registro.tipo === 'cliente';
        const movimientos = esCliente
            ? db.all('ventas').filter((v) => v.clienteId === registro.id).length
            : db.all('compras').filter((c) => c.proveedorId === registro.id).length;

        if (movimientos > 0) {
            ui.toastError('No se puede eliminar',
                `${registro.nombre} tiene ${movimientos} ${movimientos === 1 ? 'movimiento asociado' : 'movimientos asociados'}. Puede marcarlo como inactivo.`);
            return;
        }

        const confirmado = await ui.confirmar({
            titulo: 'Eliminar registro',
            mensaje: `¿Eliminar definitivamente a ${registro.nombre}?`,
            detalle: 'Esta acción no se puede deshacer.',
            textoAceptar: 'Eliminar',
            peligroso: true
        });

        if (confirmado) {
            db.remove('terceros', registro.id);
            ui.toastOk('Registro eliminado', registro.nombre);
        }
    };

    /* ============================================================
       Vistas
       ============================================================ */

    const botonesFila = (registro, verEstado) => el('div', { class: 'row' }, [
        el('button', {
            class: 'btn btn-secondary btn-sm', text: 'Estado de cuenta',
            attrs: { type: 'button' }, on: { click: () => verEstado(registro) }
        }),
        el('button', {
            class: 'btn btn-ghost btn-sm', text: 'Editar',
            attrs: { type: 'button' }, on: { click: () => abrirFormulario(registro.tipo, registro) }
        }),
        el('button', {
            class: 'btn btn-ghost btn-sm', text: 'Eliminar',
            attrs: { type: 'button' }, on: { click: () => eliminar(registro) }
        })
    ]);

    const vistaClientes = (contenedor) => {
        const lista = db.clientes();
        const carteraTotal = U.sum(lista, (c) => db.saldoCliente(c.id));
        const conSaldo = lista.filter((c) => db.saldoCliente(c.id) > 0);
        const cupoTotal = U.sum(lista, (c) => c.limiteCredito);

        const vencidos = db.all('ventas').filter((v) => db.estadoVenta(v).clave === 'vencida');

        const tabla = ui.tabla(lista, [
            { clave: 'nombre', titulo: 'Cliente', ajustar: true },
            { clave: 'documento', titulo: 'Documento', valor: (c) => `${c.tipoDoc} ${c.documento}` },
            { clave: 'telefono', titulo: 'Teléfono' },
            { clave: 'email', titulo: 'Correo' },
            { clave: 'limiteCredito', titulo: 'Límite crédito', tipo: 'moneda' },
            { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda', valor: (c) => db.saldoCliente(c.id) },
            {
                clave: 'uso', titulo: 'Uso del cupo', tipo: 'nodo',
                render: (c) => {
                    const limite = U.toNumber(c.limiteCredito);
                    if (limite <= 0) return el('span', { class: 'text-soft', text: 'Solo contado' });
                    const uso = (db.saldoCliente(c.id) / limite) * 100;
                    const tono = uso >= 90 ? 'var(--danger)' : uso >= 70 ? 'var(--warning)' : 'var(--success)';
                    return el('div', { class: 'row' }, [
                        ui.meter(uso, tono),
                        el('span', { class: 'num text-muted', text: U.pct(uso, 0) })
                    ]);
                }
            },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                render: (c) => ui.badge(c.activo === false ? 'Inactivo' : 'Activo', c.activo === false ? 'neutral' : 'success')
            },
            { clave: 'acciones', titulo: '', tipo: 'nodo', render: (c) => botonesFila(c, estadoCuentaCliente) }
        ], {
            ordenInicial: 'nombre',
            textoBusqueda: 'Buscar por nombre, documento, correo…',
            porPagina: 10,
            totales: (l) => ({ nombre: `${l.length} clientes`, saldo: U.sum(l, (c) => db.saldoCliente(c.id)) })
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Clientes' }),
                    el('p', { text: 'Terceros a quienes se les factura, con su cupo de crédito y su cartera.' })
                ]),
                el('button', {
                    class: 'btn', text: '+ Nuevo cliente', attrs: { type: 'button' },
                    on: { click: () => abrirFormulario('cliente') }
                })
            ]),
            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Clientes registrados', U.num(lista.length),
                    `${lista.filter((c) => c.activo !== false).length} activos`, 'var(--c1)'),
                ui.kpi('Cartera total', U.money(carteraTotal),
                    `${conSaldo.length} clientes con saldo`, 'var(--c3)'),
                ui.kpi('Cupo autorizado', U.money(cupoTotal),
                    `Comprometido ${U.pct(U.safeDiv(carteraTotal, cupoTotal) !== null ? U.safeDiv(carteraTotal, cupoTotal) * 100 : 0, 0)}`, 'var(--c4)'),
                ui.kpi('Facturas vencidas', U.num(vencidos.length),
                    U.money(U.sum(vencidos, (v) => v.saldo)), 'var(--c6)')
            ]),
            ui.card(null, tabla.nodo, { sinRelleno: true })
        ]);
    };

    const vistaProveedores = (contenedor) => {
        const lista = db.proveedores();
        const porPagar = U.sum(lista, (p) => db.saldoProveedor(p.id));
        const compras = db.all('compras');

        const tabla = ui.tabla(lista, [
            { clave: 'nombre', titulo: 'Proveedor', ajustar: true },
            { clave: 'documento', titulo: 'Documento', valor: (p) => `${p.tipoDoc} ${p.documento}` },
            { clave: 'telefono', titulo: 'Teléfono' },
            { clave: 'email', titulo: 'Correo' },
            {
                clave: 'compras', titulo: 'Compras', tipo: 'numero',
                valor: (p) => compras.filter((c) => c.proveedorId === p.id).length
            },
            { clave: 'saldo', titulo: 'Saldo por pagar', tipo: 'moneda', valor: (p) => db.saldoProveedor(p.id) },
            {
                clave: 'estado', titulo: 'Estado', tipo: 'nodo',
                render: (p) => ui.badge(p.activo === false ? 'Inactivo' : 'Activo', p.activo === false ? 'neutral' : 'success')
            },
            { clave: 'acciones', titulo: '', tipo: 'nodo', render: (p) => botonesFila(p, estadoCuentaProveedor) }
        ], {
            ordenInicial: 'nombre',
            textoBusqueda: 'Buscar proveedor…',
            porPagina: 10,
            totales: (l) => ({ nombre: `${l.length} proveedores`, saldo: U.sum(l, (p) => db.saldoProveedor(p.id)) })
        });

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Proveedores' }),
                    el('p', { text: 'Terceros a quienes se les compra, con sus cuentas por pagar.' })
                ]),
                el('button', {
                    class: 'btn', text: '+ Nuevo proveedor', attrs: { type: 'button' },
                    on: { click: () => abrirFormulario('proveedor') }
                })
            ]),
            el('div', { class: 'grid-kpi' }, [
                ui.kpi('Proveedores', U.num(lista.length),
                    `${lista.filter((p) => p.activo !== false).length} activos`, 'var(--c1)'),
                ui.kpi('Cuentas por pagar', U.money(porPagar),
                    `${lista.filter((p) => db.saldoProveedor(p.id) > 0).length} con saldo`, 'var(--c6)'),
                ui.kpi('Compras registradas', U.num(compras.length),
                    U.money(U.sum(compras, (c) => c.total)), 'var(--c5)')
            ]),
            ui.card(null, tabla.nodo, { sinRelleno: true })
        ]);
    };

    return { vistaClientes, vistaProveedores, abrirFormulario, estadoCuentaCliente };
})();
