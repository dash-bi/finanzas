/* ============================================================
   auth.js — Sesión local, roles y permisos por módulo
   La autenticación es local y sirve para separar responsabilidades
   dentro de la aplicación. NO es un control de seguridad real:
   cuando el sistema se conecte a Supabase debe delegarse en
   Supabase Auth con Row Level Security (Agents.md, sección 14).
   ============================================================ */

window.ERP = window.ERP || {};

ERP.auth = (() => {
    const U = ERP.util;
    const SESION_KEY = 'erp_finanzas_sesion';

    let usuarioActual = null;

    const ROLES = {
        administrador: {
            etiqueta: 'Administrador',
            descripcion: 'Acceso total al sistema, incluida la configuración.'
        },
        contador: {
            etiqueta: 'Contador',
            descripcion: 'Operación contable y financiera.'
        },
        vendedor: {
            etiqueta: 'Vendedor',
            descripcion: 'Operación comercial.'
        }
    };

    /**
     * Módulos por defecto de cada rol, usados mientras el administrador no guarde
     * otra selección en Configuración. La lista del administrador es la lista
     * completa de módulos: un módulo que no esté en ella no lo ve nadie.
     */
    const PERMISOS = {
        administrador: ['dashboard', 'clientes', 'proveedores', 'inventario', 'compras', 'gastos',
            'ventas', 'cartera', 'financieros', 'equilibrio', 'prestamos', 'nomina', 'configuracion'],
        contador: ['dashboard', 'clientes', 'proveedores', 'inventario', 'compras', 'gastos',
            'ventas', 'cartera', 'financieros', 'equilibrio', 'prestamos', 'nomina'],
        vendedor: ['dashboard', 'clientes', 'inventario', 'ventas', 'cartera']
    };

    /** Módulos que nunca se delegan a otro rol. */
    const SOLO_ADMINISTRADOR = ['configuracion'];

    /**
     * Módulos vigentes de un rol. El administrador los tiene todos; los demás roles
     * ven la selección guardada en Configuración o, si no existe, la de PERMISOS.
     * Se filtra contra la lista completa para ignorar claves desconocidas y para
     * que un dato alterado no pueda abrir Configuración a otro rol.
     */
    const modulosDeRol = (rol) => {
        const todos = PERMISOS.administrador;
        if (rol === 'administrador') return todos;
        if (!ROLES[rol]) return [];
        const guardados = (ERP.db.config().permisosRol || {})[rol];
        const base = Array.isArray(guardados) ? guardados : PERMISOS[rol];
        return todos.filter((clave) => base.includes(clave) && !SOLO_ADMINISTRADOR.includes(clave));
    };

    const puede = (modulo) => {
        if (!usuarioActual) return false;
        return modulosDeRol(usuarioActual.rol).includes(modulo);
    };

    const modulosPermitidos = () => (usuarioActual ? modulosDeRol(usuarioActual.rol) : []);

    /**
     * Guarda los módulos de cada rol distinto del administrador.
     * permisos: { contador: ['ventas', ...], vendedor: [...] }
     */
    const guardarPermisos = (permisos) => {
        if (!usuarioActual || usuarioActual.rol !== 'administrador') {
            return { ok: false, error: 'Solo el administrador puede cambiar los permisos.' };
        }
        const todos = PERMISOS.administrador;
        const limpio = {};
        for (const rol of Object.keys(ROLES).filter((r) => r !== 'administrador')) {
            const lista = Array.isArray(permisos[rol]) ? permisos[rol] : [];
            const modulos = todos.filter((clave) => lista.includes(clave) && !SOLO_ADMINISTRADOR.includes(clave));
            if (modulos.length === 0) {
                return { ok: false, error: `El rol ${ROLES[rol].etiqueta} debe tener al menos un módulo.` };
            }
            limpio[rol] = modulos;
        }
        ERP.db.updateConfig({ permisosRol: limpio });
        return { ok: true, permisos: limpio };
    };

    const usuario = () => usuarioActual;

    const etiquetaRol = (rol) => (ROLES[rol] ? ROLES[rol].etiqueta : rol);

    const iniciarSesion = (nombreUsuario, clave) => {
        const entrada = String(nombreUsuario || '').trim().toLowerCase();
        if (!entrada || !clave) {
            return { ok: false, error: 'Escriba el usuario y la contraseña.' };
        }

        const encontrado = ERP.db.all('usuarios').find(
            (u) => u.usuario.toLowerCase() === entrada
        );

        // Mensaje genérico: no se revela si el usuario existe.
        if (!encontrado || encontrado.clave !== ERP.db.hashClave(clave)) {
            return { ok: false, error: 'Usuario o contraseña incorrectos.' };
        }
        if (encontrado.activo === false) {
            return { ok: false, error: 'El usuario está inactivo. Contacte al administrador.' };
        }

        usuarioActual = {
            id: encontrado.id,
            usuario: encontrado.usuario,
            nombre: encontrado.nombre,
            rol: encontrado.rol
        };

        guardarSesion();
        U.bus.emit('auth:login', usuarioActual);
        return { ok: true, usuario: usuarioActual };
    };

    const cerrarSesion = () => {
        usuarioActual = null;
        try {
            window.sessionStorage.removeItem(SESION_KEY);
        } catch (error) {
            // Sin sessionStorage la sesión simplemente no sobrevive a la recarga.
        }
        U.bus.emit('auth:logout', null);
    };

    const guardarSesion = () => {
        try {
            window.sessionStorage.setItem(SESION_KEY, JSON.stringify(usuarioActual));
        } catch (error) {
            // La aplicación sigue funcionando aunque no se pueda recordar la sesión.
        }
    };

    /** Recupera la sesión de la pestaña actual, si existe y sigue siendo válida. */
    const restaurarSesion = () => {
        try {
            const raw = window.sessionStorage.getItem(SESION_KEY);
            if (!raw) return null;
            const guardado = JSON.parse(raw);
            const vigente = ERP.db.all('usuarios').find((u) => u.id === guardado.id);
            if (!vigente || vigente.activo === false) return null;
            usuarioActual = {
                id: vigente.id, usuario: vigente.usuario, nombre: vigente.nombre, rol: vigente.rol
            };
            return usuarioActual;
        } catch (error) {
            return null;
        }
    };

    /** Refleja en la sesión abierta los cambios hechos al propio usuario (nombre, rol, usuario). */
    const sincronizarSesion = () => {
        if (!usuarioActual) return null;
        const vigente = ERP.db.all('usuarios').find((u) => u.id === usuarioActual.id);
        if (!vigente || vigente.activo === false) {
            cerrarSesion();
            return null;
        }
        usuarioActual = { id: vigente.id, usuario: vigente.usuario, nombre: vigente.nombre, rol: vigente.rol };
        guardarSesion();
        return usuarioActual;
    };

    return {
        ROLES, PERMISOS, SOLO_ADMINISTRADOR,
        iniciarSesion, cerrarSesion, restaurarSesion, sincronizarSesion,
        usuario, puede, modulosPermitidos, modulosDeRol, guardarPermisos, etiquetaRol
    };
})();
