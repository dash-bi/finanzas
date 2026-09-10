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
            descripcion: 'Operación contable y financiera completa, sin configuración del sistema.'
        },
        vendedor: {
            etiqueta: 'Vendedor',
            descripcion: 'Ventas, clientes, cartera y consulta de inventario.'
        }
    };

    /** Módulos accesibles por rol. El orden define el menú lateral. */
    const PERMISOS = {
        administrador: ['dashboard', 'clientes', 'proveedores', 'inventario', 'compras', 'gastos',
            'ventas', 'cartera', 'financieros', 'equilibrio', 'prestamos', 'nomina', 'configuracion'],
        contador: ['dashboard', 'clientes', 'proveedores', 'inventario', 'compras', 'gastos',
            'ventas', 'cartera', 'financieros', 'equilibrio', 'prestamos', 'nomina'],
        vendedor: ['dashboard', 'clientes', 'inventario', 'ventas', 'cartera']
    };

    const puede = (modulo) => {
        if (!usuarioActual) return false;
        return (PERMISOS[usuarioActual.rol] || []).includes(modulo);
    };

    const modulosPermitidos = () => (usuarioActual ? PERMISOS[usuarioActual.rol] || [] : []);

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

    return {
        ROLES, PERMISOS,
        iniciarSesion, cerrarSesion, restaurarSesion,
        usuario, puede, modulosPermitidos, etiquetaRol
    };
})();
