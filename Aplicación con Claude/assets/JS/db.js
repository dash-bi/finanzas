/* ============================================================
   db.js — CAPA DE DATOS ÚNICA
   Ningún módulo de negocio accede al almacenamiento directamente:
   todos consumen esta capa. El motor actual es localStorage y el
   modelo es relacional, para que reemplazarlo por Supabase sea un
   cambio localizado en este archivo (ver Agents.md, sección 13).
   ============================================================ */

window.ERP = window.ERP || {};

ERP.db = (() => {
    const U = ERP.util;
    const STORAGE_KEY = 'erp_finanzas_v1';
    const SCHEMA_VERSION = 2;

    /** Estado en memoria. Se lee una sola vez y se escribe al persistir. */
    let data = null;

    /* ============================================================
       Esquema
       ============================================================ */

    const emptySchema = () => ({
        version: SCHEMA_VERSION,
        usuarios: [],
        terceros: [],
        productos: [],
        compras: [],
        ventas: [],
        gastos: [],
        abonos: [],
        pagosCompra: [],
        presupuestos: [],
        empleados: [],
        nominas: [],
        config: {
            empresa: 'Distribuciones Andina S.A.S.',
            nit: '901.455.782-1',
            direccion: 'Carrera 43A # 18 Sur - 135, Oficina 402',
            ciudad: 'Medellín, Antioquia',
            telefono: '(604) 448 2210',
            email: 'facturacion@distribucionesandina.com.co',
            ivaPct: 19,
            capitalInicial: 120000000,
            // Valores legales de referencia: son editables desde Configuración
            // porque cambian cada año por decreto.
            salarioMinimo: 1423500,
            auxilioTransporte: 200000,
            topeAuxilioSmmlv: 2,
            aporteSaludPct: 4,
            aportePensionPct: 4,
            consecutivoVenta: 1,
            consecutivoCompra: 1
        }
    });

    const CATEGORIAS_GASTO = [
        'Arrendamiento', 'Servicios públicos', 'Nómina', 'Honorarios',
        'Transporte y fletes', 'Publicidad y mercadeo', 'Papelería y aseo',
        'Mantenimiento', 'Impuestos y tasas', 'Seguros', 'Gastos bancarios', 'Otros gastos'
    ];

    const MEDIOS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque'];

    /* ============================================================
       Persistencia
       ============================================================ */

    /** Hash ligero. NO es seguridad real: la autenticación definitiva
     *  debe delegarse a Supabase Auth. Evita guardar claves en claro. */
    const hashClave = (texto) => {
        let h = 5381;
        const s = String(texto ?? '');
        for (let i = 0; i < s.length; i += 1) {
            h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        }
        return `h${h.toString(36)}`;
    };

    const storageDisponible = () => {
        try {
            const probe = '__erp_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            return true;
        } catch (error) {
            return false;
        }
    };

    let persistenciaActiva = true;
    // Durante la carga de la semilla se ejecutan cientos de transacciones:
    // se difiere la escritura y la notificación hasta el final.
    let sembrando = false;

    const persist = () => {
        if (sembrando) return true;
        if (!persistenciaActiva) return false;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            return true;
        } catch (error) {
            persistenciaActiva = false;
            console.error('No fue posible guardar en localStorage', error);
            U.bus.emit('db:persist-error', error);
            return false;
        }
    };

    const load = () => {
        persistenciaActiva = storageDisponible();

        if (persistenciaActiva) {
            try {
                const raw = window.localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.ventas)) {
                        data = { ...emptySchema(), ...parsed };
                        data.config = { ...emptySchema().config, ...(parsed.config || {}) };
                        return { ok: true, seeded: false, persistente: true };
                    }
                }
            } catch (error) {
                console.warn('Datos locales ilegibles; se regenera la demostración.', error);
            }
        }

        data = emptySchema();
        seed();
        persist();
        return { ok: true, seeded: true, persistente: persistenciaActiva };
    };

    const reset = () => {
        data = emptySchema();
        seed();
        persist();
        U.bus.emit('db:changed', { motivo: 'reset' });
        return true;
    };

    const exportJSON = () => JSON.stringify(data, null, 2);

    /* ============================================================
       Acceso genérico (CRUD)
       ============================================================ */

    const all = (coleccion) => (Array.isArray(data[coleccion]) ? data[coleccion] : []);

    const get = (coleccion, id) => all(coleccion).find((row) => row.id === id) || null;

    const insert = (coleccion, registro) => {
        const row = { ...registro, id: registro.id || U.uid(coleccion.slice(0, 3)) };
        data[coleccion].push(row);
        persist();
        U.bus.emit('db:changed', { coleccion, motivo: 'insert' });
        return row;
    };

    const update = (coleccion, id, cambios) => {
        const row = get(coleccion, id);
        if (!row) return null;
        Object.assign(row, cambios);
        persist();
        U.bus.emit('db:changed', { coleccion, motivo: 'update' });
        return row;
    };

    const remove = (coleccion, id) => {
        const idx = all(coleccion).findIndex((row) => row.id === id);
        if (idx < 0) return false;
        data[coleccion].splice(idx, 1);
        persist();
        U.bus.emit('db:changed', { coleccion, motivo: 'delete' });
        return true;
    };

    const config = () => data.config;

    const updateConfig = (cambios) => {
        Object.assign(data.config, cambios);
        persist();
        U.bus.emit('db:changed', { coleccion: 'config', motivo: 'update' });
        return data.config;
    };

    /* ============================================================
       Consultas de dominio
       ============================================================ */

    const clientes = () => all('terceros').filter((t) => t.tipo === 'cliente');
    const proveedores = () => all('terceros').filter((t) => t.tipo === 'proveedor');
    const productos = () => all('productos');
    const productoPorId = (id) => get('productos', id);
    const terceroPorId = (id) => get('terceros', id);

    const nombreTercero = (id) => {
        const t = terceroPorId(id);
        return t ? t.nombre : 'Tercero eliminado';
    };

    const nombreProducto = (id) => {
        const p = productoPorId(id);
        return p ? p.nombre : 'Producto eliminado';
    };

    const abonosDeVenta = (ventaId) => all('abonos').filter((a) => a.ventaId === ventaId);
    const pagosDeCompra = (compraId) => all('pagosCompra').filter((p) => p.compraId === compraId);

    /** Saldo total pendiente de un cliente (suma de facturas no anuladas). */
    const saldoCliente = (clienteId) => U.round2(U.sum(
        all('ventas').filter((v) => v.clienteId === clienteId && !v.anulada),
        (v) => v.saldo
    ));

    const saldoProveedor = (proveedorId) => U.round2(U.sum(
        all('compras').filter((c) => c.proveedorId === proveedorId),
        (c) => c.saldo
    ));

    const cupoDisponible = (clienteId) => {
        const cliente = terceroPorId(clienteId);
        if (!cliente) return 0;
        return U.round2(U.toNumber(cliente.limiteCredito) - saldoCliente(clienteId));
    };

    const estadoVenta = (venta) => {
        if (!venta) return { clave: 'desconocido', texto: 'Desconocido', tono: 'neutral' };
        if (venta.anulada) return { clave: 'anulada', texto: 'Anulada', tono: 'neutral' };
        if (U.round2(venta.saldo) <= 0) return { clave: 'pagada', texto: 'Pagada', tono: 'success' };
        const vencida = venta.fechaVencimiento && venta.fechaVencimiento < U.today();
        if (vencida) return { clave: 'vencida', texto: 'Vencida', tono: 'danger' };
        if (U.round2(venta.saldo) < U.round2(venta.total)) {
            return { clave: 'parcial', texto: 'Abono parcial', tono: 'warning' };
        }
        return { clave: 'pendiente', texto: 'Pendiente', tono: 'info' };
    };

    const productosBajoMinimo = () => productos().filter(
        (p) => p.tipo === 'producto' && U.toNumber(p.stock) <= U.toNumber(p.stockMinimo)
    );

    /* ============================================================
       Consecutivos
       ============================================================ */

    const siguienteNumero = (tipo) => {
        const key = tipo === 'venta' ? 'consecutivoVenta' : 'consecutivoCompra';
        const prefijo = tipo === 'venta' ? 'FV' : 'FC';
        const valor = U.toNumber(data.config[key]) || 1;
        return `${prefijo}-${String(valor).padStart(4, '0')}`;
    };

    const consumirNumero = (tipo) => {
        const key = tipo === 'venta' ? 'consecutivoVenta' : 'consecutivoCompra';
        const numero = siguienteNumero(tipo);
        data.config[key] = (U.toNumber(data.config[key]) || 1) + 1;
        return numero;
    };

    /* ============================================================
       Cálculo de documentos
       ============================================================ */

    /**
     * Calcula subtotal, IVA y total de una lista de ítems.
     * El IVA solo se aplica sobre productos marcados como gravados.
     */
    const calcularDocumento = (items, ivaPct) => {
        const tasa = U.toNumber(ivaPct) / 100;
        let subtotal = 0;
        let baseGravada = 0;

        items.forEach((item) => {
            const producto = productoPorId(item.productoId);
            const bruto = U.toNumber(item.cantidad) * U.toNumber(item.valorUnitario);
            const descuento = bruto * (U.toNumber(item.descuentoPct) / 100);
            const neto = U.round2(bruto - descuento);
            subtotal += neto;
            if (producto && producto.gravado !== false) baseGravada += neto;
        });

        const iva = U.roundCop(baseGravada * tasa);
        return {
            subtotal: U.roundCop(subtotal),
            iva,
            total: U.roundCop(subtotal) + iva
        };
    };

    /* ============================================================
       Reglas transaccionales
       ============================================================ */

    const validarItems = (items) => {
        if (!Array.isArray(items) || items.length === 0) {
            return 'El documento debe tener al menos un ítem.';
        }
        for (const item of items) {
            if (!productoPorId(item.productoId)) return 'Uno de los ítems apunta a un producto inexistente.';
            if (U.toNumber(item.cantidad) <= 0) return 'Las cantidades deben ser mayores que cero.';
            if (U.toNumber(item.valorUnitario) < 0) return 'Los valores unitarios no pueden ser negativos.';
        }
        return null;
    };

    /**
     * Registra una compra: aumenta existencias y recalcula el costo
     * promedio ponderado de cada producto. Si es a crédito, abre la CxP.
     */
    const registrarCompra = (payload) => {
        const errorItems = validarItems(payload.items);
        if (errorItems) return { ok: false, error: errorItems };
        if (!terceroPorId(payload.proveedorId)) return { ok: false, error: 'Debe seleccionar un proveedor válido.' };
        if (!U.isValidISO(payload.fecha)) return { ok: false, error: 'La fecha de la compra no es válida.' };

        const items = payload.items.map((item) => ({
            productoId: item.productoId,
            cantidad: U.toNumber(item.cantidad),
            valorUnitario: U.roundCop(item.valorUnitario),
            descuentoPct: U.toNumber(item.descuentoPct)
        }));

        const totales = calcularDocumento(items, data.config.ivaPct);
        const credito = payload.condicion === 'credito';
        const diasCredito = credito ? (U.toNumber(payload.diasCredito) || 30) : 0;

        const compra = {
            id: U.uid('com'),
            numero: consumirNumero('compra'),
            documentoProveedor: String(payload.documentoProveedor || '').trim(),
            fecha: payload.fecha,
            proveedorId: payload.proveedorId,
            condicion: credito ? 'credito' : 'contado',
            diasCredito,
            fechaVencimiento: credito ? U.addDays(payload.fecha, diasCredito) : payload.fecha,
            items,
            subtotal: totales.subtotal,
            iva: totales.iva,
            total: totales.total,
            saldo: credito ? totales.total : 0,
            medioPago: payload.medioPago || 'Transferencia',
            observaciones: String(payload.observaciones || '').trim()
        };

        // Entrada a inventario con costo promedio ponderado.
        items.forEach((item) => {
            const producto = productoPorId(item.productoId);
            if (!producto || producto.tipo !== 'producto') return;
            const stockPrevio = U.toNumber(producto.stock);
            const costoPrevio = U.toNumber(producto.costo);
            const stockNuevo = stockPrevio + item.cantidad;
            const costoUnitario = U.toNumber(item.valorUnitario);
            producto.costo = stockNuevo > 0
                ? U.roundCop(((stockPrevio * costoPrevio) + (item.cantidad * costoUnitario)) / stockNuevo)
                : costoUnitario;
            producto.stock = stockNuevo;
        });

        data.compras.push(compra);
        persist();
        U.bus.emit('db:changed', { coleccion: 'compras', motivo: 'compra' });
        return { ok: true, compra };
    };

    /**
     * Registra una venta: valida stock y cupo de crédito, descuenta
     * existencias y congela el costo unitario del momento.
     */
    const registrarVenta = (payload) => {
        const errorItems = validarItems(payload.items);
        if (errorItems) return { ok: false, error: errorItems };

        const cliente = terceroPorId(payload.clienteId);
        if (!cliente) return { ok: false, error: 'Debe seleccionar un cliente válido.' };
        if (!U.isValidISO(payload.fecha)) return { ok: false, error: 'La fecha de la venta no es válida.' };

        // Validación de existencias agrupando por producto.
        const requerido = new Map();
        payload.items.forEach((item) => {
            requerido.set(item.productoId, (requerido.get(item.productoId) || 0) + U.toNumber(item.cantidad));
        });

        for (const [productoId, cantidad] of requerido) {
            const producto = productoPorId(productoId);
            if (producto.tipo !== 'producto') continue;
            if (U.toNumber(producto.stock) < cantidad) {
                return {
                    ok: false,
                    error: `Existencias insuficientes de "${producto.nombre}". Disponible: ${U.num(producto.stock)} ${producto.unidad}.`
                };
            }
        }

        const items = payload.items.map((item) => {
            const producto = productoPorId(item.productoId);
            return {
                productoId: item.productoId,
                cantidad: U.toNumber(item.cantidad),
                valorUnitario: U.roundCop(item.valorUnitario),
                descuentoPct: U.toNumber(item.descuentoPct),
                // El costo se congela: el costo de ventas no puede cambiar retroactivamente.
                // Los servicios no llevan costo de ventas: el costo de prestarlos
                // ya está recogido en la nómina y en los gastos operativos, y
                // contarlo aquí lo duplicaría.
                costoUnitario: producto.tipo === 'servicio' ? 0 : U.roundCop(producto.costo)
            };
        });

        const totales = calcularDocumento(items, data.config.ivaPct);
        const credito = payload.condicion === 'credito';

        if (credito) {
            const disponible = cupoDisponible(payload.clienteId);
            if (totales.total > disponible) {
                return {
                    ok: false,
                    error: `La venta a crédito supera el cupo del cliente. Disponible: ${U.money(disponible)} de ${U.money(cliente.limiteCredito)}.`
                };
            }
        }

        const diasCredito = credito ? (U.toNumber(payload.diasCredito) || 30) : 0;

        const venta = {
            id: U.uid('ven'),
            numero: consumirNumero('venta'),
            fecha: payload.fecha,
            clienteId: payload.clienteId,
            vendedor: payload.vendedor || '',
            condicion: credito ? 'credito' : 'contado',
            diasCredito,
            fechaVencimiento: credito ? U.addDays(payload.fecha, diasCredito) : payload.fecha,
            items,
            subtotal: totales.subtotal,
            iva: totales.iva,
            total: totales.total,
            saldo: credito ? totales.total : 0,
            medioPago: credito ? '' : (payload.medioPago || 'Efectivo'),
            observaciones: String(payload.observaciones || '').trim(),
            anulada: false
        };

        // Salida de inventario en tiempo real.
        const alertas = [];
        items.forEach((item) => {
            const producto = productoPorId(item.productoId);
            if (!producto || producto.tipo !== 'producto') return;
            producto.stock = U.round2(U.toNumber(producto.stock) - item.cantidad);
            if (producto.stock <= U.toNumber(producto.stockMinimo)) {
                alertas.push(`"${producto.nombre}" quedó en ${U.num(producto.stock)} ${producto.unidad} (mínimo ${U.num(producto.stockMinimo)}).`);
            }
        });

        data.ventas.push(venta);
        persist();
        U.bus.emit('db:changed', { coleccion: 'ventas', motivo: 'venta' });
        return { ok: true, venta, alertas };
    };

    /** Anula una venta: devuelve el inventario y elimina la CxC asociada. */
    const anularVenta = (ventaId, motivo) => {
        const venta = get('ventas', ventaId);
        if (!venta) return { ok: false, error: 'La factura no existe.' };
        if (venta.anulada) return { ok: false, error: 'La factura ya está anulada.' };
        if (abonosDeVenta(ventaId).length > 0) {
            return { ok: false, error: 'No se puede anular una factura con abonos registrados. Elimine primero los abonos.' };
        }

        venta.items.forEach((item) => {
            const producto = productoPorId(item.productoId);
            if (!producto || producto.tipo !== 'producto') return;
            producto.stock = U.round2(U.toNumber(producto.stock) + item.cantidad);
        });

        venta.anulada = true;
        venta.motivoAnulacion = String(motivo || '').trim();
        venta.saldo = 0;
        persist();
        U.bus.emit('db:changed', { coleccion: 'ventas', motivo: 'anulacion' });
        return { ok: true, venta };
    };

    /** Registra un abono que amortiza el saldo de una factura de venta. */
    const registrarAbono = (payload) => {
        const venta = get('ventas', payload.ventaId);
        if (!venta) return { ok: false, error: 'La factura no existe.' };
        if (venta.anulada) return { ok: false, error: 'No se pueden registrar abonos sobre una factura anulada.' };

        const valor = U.roundCop(payload.valor);
        if (valor <= 0) return { ok: false, error: 'El valor del abono debe ser mayor que cero.' };
        if (valor > U.round2(venta.saldo)) {
            return { ok: false, error: `El abono excede el saldo pendiente (${U.money(venta.saldo)}).` };
        }
        if (!U.isValidISO(payload.fecha)) return { ok: false, error: 'La fecha del abono no es válida.' };
        if (payload.fecha < venta.fecha) {
            return { ok: false, error: 'El abono no puede tener una fecha anterior a la factura.' };
        }

        const abono = {
            id: U.uid('abo'),
            ventaId: venta.id,
            clienteId: venta.clienteId,
            fecha: payload.fecha,
            valor,
            medio: payload.medio || 'Efectivo',
            observaciones: String(payload.observaciones || '').trim()
        };

        venta.saldo = U.roundCop(U.toNumber(venta.saldo) - valor);
        data.abonos.push(abono);
        persist();
        U.bus.emit('db:changed', { coleccion: 'abonos', motivo: 'abono' });
        return { ok: true, abono, venta };
    };

    const eliminarAbono = (abonoId) => {
        const abono = get('abonos', abonoId);
        if (!abono) return { ok: false, error: 'El abono no existe.' };
        const venta = get('ventas', abono.ventaId);
        if (venta) venta.saldo = U.roundCop(U.toNumber(venta.saldo) + U.toNumber(abono.valor));
        remove('abonos', abonoId);
        return { ok: true };
    };

    /** Registra un pago a proveedor que amortiza una CxP. */
    const registrarPagoCompra = (payload) => {
        const compra = get('compras', payload.compraId);
        if (!compra) return { ok: false, error: 'La compra no existe.' };

        const valor = U.roundCop(payload.valor);
        if (valor <= 0) return { ok: false, error: 'El valor del pago debe ser mayor que cero.' };
        if (valor > U.round2(compra.saldo)) {
            return { ok: false, error: `El pago excede el saldo pendiente (${U.money(compra.saldo)}).` };
        }
        if (!U.isValidISO(payload.fecha)) return { ok: false, error: 'La fecha del pago no es válida.' };

        const pago = {
            id: U.uid('pag'),
            compraId: compra.id,
            proveedorId: compra.proveedorId,
            fecha: payload.fecha,
            valor,
            medio: payload.medio || 'Transferencia'
        };

        compra.saldo = U.roundCop(U.toNumber(compra.saldo) - valor);
        data.pagosCompra.push(pago);
        persist();
        U.bus.emit('db:changed', { coleccion: 'pagosCompra', motivo: 'pago' });
        return { ok: true, pago, compra };
    };

    const registrarGasto = (payload) => {
        if (!U.isValidISO(payload.fecha)) return { ok: false, error: 'La fecha del gasto no es válida.' };
        if (U.toNumber(payload.valor) <= 0) return { ok: false, error: 'El valor del gasto debe ser mayor que cero.' };
        if (!payload.categoria) return { ok: false, error: 'Debe elegir una categoría de gasto.' };

        const gasto = insert('gastos', {
            fecha: payload.fecha,
            categoria: payload.categoria,
            descripcion: String(payload.descripcion || '').trim() || payload.categoria,
            valor: U.roundCop(payload.valor),
            pagado: payload.pagado !== false,
            medio: payload.medio || 'Transferencia',
            origen: payload.origen || 'manual',
            referencia: payload.referencia || ''
        });
        return { ok: true, gasto };
    };

    /* ============================================================
       Semilla de demostración
       ============================================================ */

    /** Generador congruencial: la demostración es reproducible. */
    let rngState = 987654321;
    const rnd = () => {
        rngState = (rngState * 48271) % 2147483647;
        return rngState / 2147483647;
    };
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const between = (min, max) => min + Math.floor(rnd() * (max - min + 1));

    const seed = () => {
        sembrando = true;
        try {
            sembrarDatos();
        } finally {
            sembrando = false;
        }
    };

    const sembrarDatos = () => {
        rngState = 987654321;
        const cfg = data.config;

        data.usuarios = [
            { id: 'usr_admin', usuario: 'admin', clave: hashClave('admin123'), nombre: 'Laura Restrepo', rol: 'administrador', activo: true },
            { id: 'usr_conta', usuario: 'contador', clave: hashClave('conta123'), nombre: 'Julián Ospina', rol: 'contador', activo: true },
            { id: 'usr_vende', usuario: 'vendedor', clave: hashClave('venta123'), nombre: 'Marcela Gómez', rol: 'vendedor', activo: true }
        ];

        const clientesSemilla = [
            ['NIT', '900.412.556-3', 'Ferretería El Tornillo S.A.S.', '(604) 512 3344', 'compras@eltornillo.co', 'Calle 30 # 65-12, Medellín', 36000000],
            ['NIT', '901.220.784-1', 'Comercializadora Sur Ltda.', '(604) 448 9012', 'cartera@comersur.co', 'Cra 48 # 20-45, Itagüí', 54000000],
            ['NIT', '830.115.092-7', 'Oficinas Modernas S.A.', '(601) 745 8890', 'pagos@oficinasmodernas.com', 'Av. 68 # 24-30, Bogotá', 75000000],
            ['CC', '71.884.203', 'Andrés Villegas Mora', '312 445 7788', 'avillegas@correo.com', 'Cra 70 # 44-18, Medellín', 9000000],
            ['NIT', '900.987.331-5', 'Grupo Logístico Aburrá', '(604) 322 1100', 'admin@logisticaburra.co', 'Calle 10 # 43-90, Medellín', 45000000],
            ['CC', '43.556.912', 'Paula Cardona Ruiz', '301 778 2210', 'paula.cardona@correo.com', 'Cra 80 # 32-14, Medellín', 7500000],
            ['NIT', '901.556.019-2', 'Suministros del Valle S.A.S.', '(602) 668 4412', 'compras@sumivalle.co', 'Calle 5 # 38-22, Cali', 60000000],
            ['NIT', '900.331.788-9', 'Inversiones Rionegro S.A.S.', '(604) 561 7788', 'contabilidad@invrionegro.co', 'Km 2 vía Llanogrande, Rionegro', 30000000]
        ];

        clientesSemilla.forEach(([tipoDoc, documento, nombre, telefono, email, direccion, limite], i) => {
            data.terceros.push({
                id: `ter_c${i + 1}`, tipo: 'cliente', tipoDoc, documento, nombre,
                telefono, email, direccion, limiteCredito: limite, activo: true
            });
        });

        const proveedoresSemilla = [
            ['NIT', '890.900.608-9', 'Importadora Tecno Andes S.A.', '(601) 425 6600', 'ventas@tecnoandes.com', 'Zona Franca Bogotá'],
            ['NIT', '900.155.442-8', 'Papelera Nacional Ltda.', '(604) 361 2200', 'pedidos@papeleranacional.co', 'Calle 44 # 55-90, Medellín'],
            ['NIT', '811.204.775-1', 'Distribuidora Mobiliaria S.A.S.', '(604) 285 4433', 'facturacion@dismobiliaria.co', 'Cra 52 # 14-88, Medellín'],
            ['NIT', '830.554.201-6', 'Insumos Digitales de Colombia', '(601) 610 3344', 'contacto@insumosdigitales.co', 'Cra 15 # 88-40, Bogotá'],
            ['NIT', '901.008.117-4', 'Logística Express Andina', '(604) 444 9911', 'servicio@logexpress.co', 'Calle 12 Sur # 50-30, Medellín'],
            ['NIT', '900.742.336-2', 'Empaques y Cajas del Norte', '(605) 371 2020', 'ventas@empaquesnorte.co', 'Vía 40 # 73-22, Barranquilla']
        ];

        proveedoresSemilla.forEach(([tipoDoc, documento, nombre, telefono, email, direccion], i) => {
            data.terceros.push({
                id: `ter_p${i + 1}`, tipo: 'proveedor', tipoDoc, documento, nombre,
                telefono, email, direccion, limiteCredito: 0, activo: true
            });
        });

        const productosSemilla = [
            // sku, nombre, categoria, unidad, unidad min, costo, precio, tipo
            ['TEC-1001', 'Portátil empresarial 14" i5 16GB', 'Tecnología', 'unidad', 4, 2450000, 3390000],
            ['TEC-1002', 'Monitor LED 24" Full HD', 'Tecnología', 'unidad', 6, 480000, 719000],
            ['TEC-1003', 'Teclado y mouse inalámbrico', 'Tecnología', 'unidad', 10, 78000, 129000],
            ['TEC-1004', 'Disco sólido SSD 1 TB', 'Tecnología', 'unidad', 8, 265000, 399000],
            ['TEC-1005', 'Impresora multifuncional láser', 'Tecnología', 'unidad', 3, 890000, 1349000],
            ['MOB-2001', 'Silla ergonómica con soporte lumbar', 'Mobiliario', 'unidad', 5, 395000, 649000],
            ['MOB-2002', 'Escritorio en L 150x150 cm', 'Mobiliario', 'unidad', 3, 620000, 989000],
            ['MOB-2003', 'Archivador metálico 4 gavetas', 'Mobiliario', 'unidad', 4, 410000, 665000],
            ['PAP-3001', 'Resma papel carta 75 g (500 hojas)', 'Papelería', 'resma', 40, 14200, 21900],
            ['PAP-3002', 'Caja de esferos negros x 12', 'Papelería', 'caja', 25, 9800, 17500],
            ['PAP-3003', 'Carpeta legajadora oficio x 25', 'Papelería', 'paquete', 20, 18500, 31000],
            ['PAP-3004', 'Tóner compatible negro alta duración', 'Papelería', 'unidad', 10, 96000, 168000],
            ['ASE-4001', 'Kit de aseo y desinfección oficina', 'Aseo', 'kit', 12, 52000, 89000],
            ['ASE-4002', 'Caja de guantes de nitrilo x 100', 'Aseo', 'caja', 15, 34000, 58000]
        ];

        productosSemilla.forEach(([sku, nombre, categoria, unidad, stockMinimo, costo, precio], i) => {
            data.productos.push({
                id: `prod_${i + 1}`, sku, nombre, categoria, unidad, tipo: 'producto',
                stock: 0, stockMinimo, costo, precio, gravado: true, activo: true
            });
        });

        data.productos.push({
            id: 'prod_serv1', sku: 'SRV-9001', nombre: 'Instalación y configuración de equipos',
            categoria: 'Servicios', unidad: 'servicio', tipo: 'servicio',
            stock: 0, stockMinimo: 0, costo: 55000, precio: 180000, gravado: true, activo: true
        });
        data.productos.push({
            id: 'prod_serv2', sku: 'SRV-9002', nombre: 'Soporte técnico mensual (bolsa 10 h)',
            categoria: 'Servicios', unidad: 'servicio', tipo: 'servicio',
            stock: 0, stockMinimo: 0, costo: 320000, precio: 890000, gravado: true, activo: true
        });

        data.empleados = [
            { id: 'emp_1', documento: '43.118.774', nombre: 'Marcela Gómez Arango', cargo: 'Asesora comercial', salario: 1900000, auxilioTransporte: true, activo: true, ingreso: '2023-03-01' },
            { id: 'emp_2', documento: '71.556.201', nombre: 'Julián Ospina Vélez', cargo: 'Contador', salario: 4200000, auxilioTransporte: false, activo: true, ingreso: '2022-08-15' },
            { id: 'emp_3', documento: '1.017.552.884', nombre: 'Camilo Restrepo Díaz', cargo: 'Auxiliar de bodega', salario: 1423500, auxilioTransporte: true, activo: true, ingreso: '2024-01-10' },
            { id: 'emp_4', documento: '39.884.112', nombre: 'Diana Pérez Loaiza', cargo: 'Servicio al cliente', salario: 1650000, auxilioTransporte: true, activo: true, ingreso: '2024-06-03' }
        ];

        const hoy = U.today();
        const inicio = '2026-01-01';
        const periodos = U.periodRange(inicio, hoy);

        const proveedorIds = proveedores().map((p) => p.id);
        const clienteIds = clientes().map((c) => c.id);
        const inventariables = data.productos.filter((p) => p.tipo === 'producto');
        const vendibles = data.productos.filter((p) => p.activo !== false);
        const vendedores = ['Marcela Gómez', 'Diana Pérez', 'Laura Restrepo'];

        // --- Compra de apertura: constituye el inventario inicial ---
        registrarCompra({
            fecha: '2025-12-28',
            proveedorId: proveedorIds[0],
            condicion: 'contado',
            medioPago: 'Transferencia',
            documentoProveedor: 'FE-APERTURA',
            observaciones: 'Inventario inicial de apertura',
            items: inventariables.map((p) => ({
                productoId: p.id,
                cantidad: Math.max(2, Math.round(p.stockMinimo * 1.5)),
                valorUnitario: p.costo,
                descuentoPct: 0
            }))
        });

        /**
         * Las compras se disparan por la demanda, no al azar: así el
         * inventario rota de verdad y la caja no se desfonda comprando
         * mercancía que nunca se vende.
         */
        const reponer = (producto, cantidadNecesaria, fecha) => {
            const lote = Math.ceil(cantidadNecesaria + producto.stockMinimo * 2);
            registrarCompra({
                fecha,
                proveedorId: pick(proveedorIds),
                condicion: rnd() > 0.45 ? 'credito' : 'contado',
                diasCredito: pick([30, 45, 60]),
                medioPago: pick(MEDIOS_PAGO),
                documentoProveedor: `FE-${between(1000, 9999)}`,
                observaciones: `Reposición de ${producto.nombre}`,
                items: [{
                    productoId: producto.id,
                    cantidad: lote,
                    // Ligera variación del costo para que el promedio ponderado se mueva.
                    valorUnitario: U.roundCop(producto.costo * (0.96 + rnd() * 0.09)),
                    descuentoPct: 0
                }]
            });
        };

        // --- Ventas ---
        periodos.forEach((periodo) => {
            // Volumen calibrado para que la operación simulada cubra su
            // estructura de costos y arroje una utilidad creíble.
            const cuantasVentas = between(26, 34);

            for (let i = 0; i < cuantasVentas; i += 1) {
                const dia = between(1, 28);
                const fecha = `${periodo}-${String(dia).padStart(2, '0')}`;
                if (fecha > hoy) continue;

                const items = [];
                const lineas = between(1, 3);

                for (let k = 0; k < lineas; k += 1) {
                    const producto = pick(vendibles);
                    if (items.some((it) => it.productoId === producto.id)) continue;

                    const cantidad = producto.tipo === 'servicio'
                        ? between(1, 2)
                        : between(1, Math.max(2, Math.ceil(producto.stockMinimo / 2)));

                    if (producto.tipo === 'producto' && U.toNumber(producto.stock) < cantidad) {
                        reponer(producto, cantidad, U.addDays(fecha, -between(1, 5)));
                    }

                    items.push({
                        productoId: producto.id,
                        cantidad,
                        valorUnitario: producto.precio,
                        descuentoPct: rnd() > 0.82 ? pick([3, 5, 8]) : 0
                    });
                }

                if (items.length === 0) continue;

                const base = {
                    fecha,
                    clienteId: pick(clienteIds),
                    vendedor: pick(vendedores),
                    diasCredito: pick([15, 30, 45]),
                    medioPago: pick(MEDIOS_PAGO),
                    items
                };

                const intentaCredito = rnd() > 0.45;
                let res = registrarVenta({ ...base, condicion: intentaCredito ? 'credito' : 'contado' });

                // Si el cliente no tiene cupo disponible, la venta se cierra de contado.
                if (!res.ok && intentaCredito) {
                    res = registrarVenta({ ...base, condicion: 'contado' });
                }
            }
        });

        // --- Abonos sobre la cartera ---
        data.ventas
            .filter((v) => v.condicion === 'credito' && !v.anulada)
            .forEach((venta) => {
                // La cartera antigua se recauda casi toda: dejar sin pagar
                // facturas de hace meses daría una cartera vencida irreal.
                const antiguedad = U.daysBetween(venta.fechaVencimiento, hoy);
                const suerte = rnd();
                const proporcion = antiguedad > 45
                    ? (suerte < 0.88 ? 1 : 0.4 + rnd() * 0.4)
                    : (suerte < 0.22 ? 0 : (suerte > 0.62 ? 1 : 0.3 + rnd() * 0.5));

                if (proporcion <= 0) return;

                // El abono se sitúa siempre entre la factura y hoy: si la ventana
                // se saliera del presente, el mes en curso quedaría sin recaudo.
                const margen = U.daysBetween(venta.fecha, hoy);
                if (margen < 5) return;
                const tope = Math.min(margen, venta.diasCredito + 45);

                const valor = U.roundCop(venta.total * proporcion);
                const fecha = U.addDays(venta.fecha, between(5, Math.max(5, tope)));
                registrarAbono({ ventaId: venta.id, fecha, valor, medio: pick(MEDIOS_PAGO) });
            });

        // --- Pagos a proveedores ---
        data.compras
            .filter((c) => c.condicion === 'credito')
            .forEach((compra) => {
                const antiguedad = U.daysBetween(compra.fechaVencimiento, hoy);
                if (antiguedad <= 30 && rnd() < 0.28) return;
                const proporcion = (antiguedad > 45 || rnd() > 0.55) ? 1 : (0.4 + rnd() * 0.4);
                const margen = U.daysBetween(compra.fecha, hoy);
                if (margen < 10) return;
                const tope = Math.min(margen, compra.diasCredito + 20);

                const valor = U.roundCop(compra.total * proporcion);
                const fecha = U.addDays(compra.fecha, between(10, Math.max(10, tope)));
                registrarPagoCompra({ compraId: compra.id, fecha, valor, medio: 'Transferencia' });
            });

        /**
         * Costo mensual de la nómina con la misma fórmula del módulo de
         * nómina: devengado más provisiones a cargo del empleador.
         */
        const costoNominaMensual = () => U.sum(
            data.empleados.filter((e) => e.activo !== false),
            (e) => {
                const tope = U.toNumber(cfg.salarioMinimo) * U.toNumber(cfg.topeAuxilioSmmlv);
                const auxilio = (e.auxilioTransporte && e.salario <= tope) ? U.toNumber(cfg.auxilioTransporte) : 0;
                const base = U.toNumber(e.salario) + auxilio;
                // Cesantías 8,33 % + prima 8,33 % + intereses (12 % de las cesantías)
                // sobre la base; vacaciones 4,17 % solo sobre el salario.
                const provisiones = base * 0.176596 + U.toNumber(e.salario) * 0.0417;
                return base + provisiones;
            }
        );

        // --- Gastos fijos, nómina y gastos variables ---
        const fijos = [
            ['Arrendamiento', 'Canon de arrendamiento oficina y bodega', 4200000],
            ['Servicios públicos', 'Energía, acueducto e internet', 780000],
            ['Seguros', 'Póliza multirriesgo empresarial', 320000],
            ['Gastos bancarios', 'Comisiones y cuota de manejo', 145000]
        ];

        periodos.forEach((periodo) => {
            fijos.forEach(([categoria, descripcion, base]) => {
                const fecha = `${periodo}-05`;
                if (fecha > hoy) return;
                registrarGasto({
                    fecha, categoria, descripcion,
                    valor: U.roundCop(base * (0.94 + rnd() * 0.14)),
                    pagado: true, medio: 'Transferencia', origen: 'fijo'
                });
            });

            // La nómina del mes se causa al cierre del periodo.
            const fechaNomina = U.endOfMonth(`${periodo}-01`);
            registrarGasto({
                fecha: fechaNomina > hoy ? hoy : fechaNomina,
                categoria: 'Nómina',
                descripcion: `Nómina y prestaciones — ${U.fmtPeriod(periodo)}`,
                valor: U.roundCop(costoNominaMensual()),
                pagado: true,
                medio: 'Transferencia',
                origen: 'fijo'
            });

            const variables = between(3, 6);
            for (let i = 0; i < variables; i += 1) {
                const dia = between(2, 27);
                const fecha = `${periodo}-${String(dia).padStart(2, '0')}`;
                if (fecha > hoy) continue;
                const categoria = pick(['Transporte y fletes', 'Publicidad y mercadeo', 'Papelería y aseo',
                    'Mantenimiento', 'Honorarios', 'Impuestos y tasas', 'Otros gastos']);
                registrarGasto({
                    fecha, categoria,
                    descripcion: `${categoria} — ${U.fmtPeriod(periodo)}`,
                    valor: U.roundCop(between(120, 1900) * 1000),
                    pagado: rnd() > 0.12,
                    medio: pick(MEDIOS_PAGO),
                    origen: 'variable'
                });
            }
        });

        // --- Presupuesto por categoría ---
        const presupuestoBase = {
            'Arrendamiento': 4200000,
            'Servicios públicos': 800000,
            'Nómina': 12500000,
            'Transporte y fletes': 900000,
            'Publicidad y mercadeo': 1500000,
            'Papelería y aseo': 600000,
            'Mantenimiento': 700000,
            'Honorarios': 1200000,
            'Seguros': 320000,
            'Impuestos y tasas': 900000,
            'Gastos bancarios': 150000,
            'Otros gastos': 500000
        };

        periodos.forEach((periodo) => {
            Object.entries(presupuestoBase).forEach(([categoria, monto]) => {
                data.presupuestos.push({
                    id: U.uid('pre'), periodo, categoria, monto: U.roundCop(monto)
                });
            });
        });

        cfg.fechaSemilla = hoy;
    };

    /* ============================================================
       API pública
       ============================================================ */

    return {
        load, reset, persist, exportJSON, hashClave,
        all, get, insert, update, remove,
        config, updateConfig,
        clientes, proveedores, productos, productoPorId, terceroPorId,
        nombreTercero, nombreProducto,
        abonosDeVenta, pagosDeCompra,
        saldoCliente, saldoProveedor, cupoDisponible, estadoVenta, productosBajoMinimo,
        siguienteNumero, calcularDocumento,
        registrarCompra, registrarVenta, anularVenta,
        registrarAbono, eliminarAbono, registrarPagoCompra, registrarGasto,
        CATEGORIAS_GASTO, MEDIOS_PAGO,
        get persistente() { return persistenciaActiva; }
    };
})();
