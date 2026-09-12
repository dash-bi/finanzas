/* ============================================================
   app.js — Arranque, acceso, layout y enrutamiento
   ============================================================ */

window.ERP = window.ERP || {};

/* Versión publicada. Al cambiarla, actualizar también el ?v= de index.html
   para que el navegador no reutilice los archivos anteriores. */
ERP.VERSION = '1.4.1';

/* ============================================================
   Configuración del sistema (solo administrador)
   ============================================================ */

ERP.configuracion = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    /**
     * Solo el administrador usa Configuración. El menú ya la oculta a los demás roles,
     * pero cada acción revalida el rol vigente: la pantalla pudo quedar abierta después
     * de que se le quitara el rol de administrador a esta sesión (aquí o en otra pestaña).
     */
    const autorizado = () => {
        const sesion = ERP.auth.sincronizarSesion();
        if (sesion && ERP.auth.puede('configuracion')) return true;
        if (!sesion) ui.toastWarn('Sesión cerrada', 'Su usuario ya no existe o fue desactivado. Ingrese de nuevo.');
        // El montaje abre el primer módulo permitido y explica el cambio de acceso.
        ERP.app.refrescar();
        return false;
    };

    /* ---------- Edición de un usuario del sistema ---------- */

    const abrirEdicionUsuario = (registro) => {
        if (!autorizado()) return;
        const actual = ERP.auth.usuario();
        const esPropio = Boolean(actual && actual.id === registro.id);

        const campos = {
            usuario: ui.input({ valor: registro.usuario }),
            nombre: ui.input({ valor: registro.nombre }),
            rol: ui.select(Object.entries(ERP.auth.ROLES).map(([valor, r]) => ({ valor, texto: r.etiqueta })), { valor: registro.rol }),
            clave: ui.input({ tipo: 'password', placeholder: 'Déjela vacía para no cambiarla', autocomplete: 'new-password' }),
            confirmacion: ui.input({ tipo: 'password', placeholder: 'Repita la nueva contraseña', autocomplete: 'new-password' })
        };

        const descripcionRol = el('span', { class: 'hint' });
        const actualizarDescripcion = () => {
            const rol = ERP.auth.ROLES[campos.rol.value];
            const modulos = ERP.auth.modulosDeRol(campos.rol.value).length;
            descripcionRol.textContent = rol ? `${rol.descripcion} Ve ${modulos} módulos, según Permisos por rol.` : '';
        };
        campos.rol.addEventListener('change', actualizarDescripcion);
        actualizarDescripcion();

        const campoRol = ui.campo('Rol', campos.rol);
        campoRol.appendChild(descripcionRol);

        const mostrarClaves = el('input', { attrs: { type: 'checkbox' } });
        mostrarClaves.addEventListener('change', () => {
            const tipo = mostrarClaves.checked ? 'text' : 'password';
            campos.clave.type = tipo;
            campos.confirmacion.type = tipo;
        });

        const errores = el('div');

        const formulario = el('form', { class: 'stack' }, [
            errores,
            esPropio ? ui.banner('Está editando su propio usuario',
                'Si se asigna un rol sin acceso a Configuración, saldrá de esta pantalla al guardar.', 'info') : null,
            el('div', { class: 'grid-form' }, [
                ui.campo('Usuario', campos.usuario, { ayuda: 'Con el que se inicia sesión. Letras sin tildes, números, punto o guion.' }),
                ui.campo('Nombre', campos.nombre),
                campoRol
            ]),
            el('fieldset', { class: 'stack-sm' }, [
                el('legend', { text: 'Contraseña' }),
                el('div', { class: 'grid-form' }, [
                    ui.campo('Nueva contraseña', campos.clave, { ayuda: 'Mínimo 6 caracteres. Si la deja vacía se conserva la actual.' }),
                    ui.campo('Confirmar contraseña', campos.confirmacion)
                ]),
                el('label', { class: 'check' }, [mostrarClaves, el('span', { text: 'Mostrar contraseñas' })])
            ])
        ]);

        const btnGuardar = el('button', { class: 'btn', text: 'Guardar cambios', attrs: { type: 'button' } });
        const btnCancelar = el('button', { class: 'btn btn-secondary', text: 'Cancelar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: 'Editar usuario',
            subtitulo: `${registro.nombre} · ${registro.usuario}`,
            contenido: formulario,
            acciones: [btnCancelar, btnGuardar]
        });

        btnCancelar.addEventListener('click', () => ctrl.cerrar());

        const enviar = (event) => {
            if (event) event.preventDefault();
            U.clear(errores);

            if (!autorizado()) {
                ctrl.cerrar();
                return;
            }

            if (campos.clave.value !== campos.confirmacion.value) {
                errores.appendChild(ui.banner('Las contraseñas no coinciden', 'Escriba la misma contraseña en los dos campos.', 'danger'));
                return;
            }

            const res = db.actualizarUsuario(registro.id, {
                usuario: campos.usuario.value,
                nombre: campos.nombre.value,
                rol: campos.rol.value,
                clave: campos.clave.value
            });

            if (!res.ok) {
                errores.appendChild(ui.banner('No se pudo guardar', res.error, 'danger'));
                return;
            }

            ctrl.cerrar();
            ui.toastOk('Usuario actualizado',
                `${res.usuario.nombre} (${res.usuario.usuario})${res.claveCambiada ? ' · contraseña cambiada' : ''}.`);

            if (esPropio) {
                // Si el nuevo rol ya no incluye Configuración, el montaje lo lleva a un módulo permitido.
                ERP.auth.sincronizarSesion();
                ERP.app.refrescar();
            }
        };

        formulario.addEventListener('submit', enviar);
        btnGuardar.addEventListener('click', enviar);
    };

    /* ---------- Permisos por rol ---------- */

    const tarjetaPermisos = () => {
        const { MODULOS, GRUPOS } = ERP.app;
        const roles = Object.keys(ERP.auth.ROLES);
        const delegables = roles.filter((rol) => rol !== 'administrador');
        const claves = GRUPOS.flatMap((grupo) => Object.keys(MODULOS).filter((clave) => MODULOS[clave].grupo === grupo));

        // casillas[rol][modulo]: solo las editables; administrador y Configuración van fijas.
        const casillas = {};
        const errores = el('div');
        const resumen = el('p', { class: 'text-muted' });

        const seleccion = () => Object.fromEntries(delegables.map((rol) => [rol,
            Object.keys(casillas[rol] || {}).filter((clave) => casillas[rol][clave].checked)]));

        const actualizarResumen = () => {
            const actual = seleccion();
            resumen.textContent = delegables
                .map((rol) => `${ERP.auth.etiquetaRol(rol)}: ${actual[rol].length} módulos`)
                .join(' · ');
        };

        const filas = claves.map((clave) => {
            const soloAdmin = ERP.auth.SOLO_ADMINISTRADOR.includes(clave);
            return el('tr', {}, [
                el('td', {}, [
                    el('span', { class: 'strong', text: MODULOS[clave].etiqueta }),
                    soloAdmin ? el('span', { class: 'hint', text: ' · Solo administrador' }) : null
                ]),
                ...roles.map((rol) => {
                    const fija = rol === 'administrador' || soloAdmin;
                    const casilla = el('input', {
                        attrs: { type: 'checkbox', 'aria-label': `${MODULOS[clave].etiqueta} para ${ERP.auth.etiquetaRol(rol)}` },
                        props: { checked: ERP.auth.modulosDeRol(rol).includes(clave), disabled: fija }
                    });
                    if (!fija) {
                        casillas[rol] = casillas[rol] || {};
                        casillas[rol][clave] = casilla;
                        casilla.addEventListener('change', actualizarResumen);
                    }
                    return el('td', { class: rol === 'administrador' ? 'col-rol col-admin' : 'col-rol' }, [casilla]);
                })
            ]);
        });

        const btnGuardar = el('button', {
            class: 'btn', text: 'Guardar permisos', attrs: { type: 'button' },
            on: {
                click: () => {
                    if (!autorizado()) return;
                    U.clear(errores);
                    const res = ERP.auth.guardarPermisos(seleccion());
                    if (!res.ok) {
                        errores.appendChild(ui.banner('No se guardaron los permisos', res.error, 'danger'));
                        return;
                    }
                    ui.toastOk('Permisos guardados', `${delegables
                        .map((rol) => `${ERP.auth.etiquetaRol(rol)}: ${res.permisos[rol].length} módulos`)
                        .join(' · ')}. Las sesiones abiertas se actualizan al instante.`);
                }
            }
        });

        actualizarResumen();

        return ui.card('Permisos por rol', el('div', { class: 'stack' }, [
            errores,
            el('div', { class: 'table-wrap' }, [
                el('table', { class: 'data permisos-rol' }, [
                    el('thead', {}, [el('tr', {}, [
                        el('th', { text: 'Módulo', attrs: { scope: 'col' } }),
                        ...roles.map((rol) => el('th', { class: rol === 'administrador' ? 'col-rol col-admin' : 'col-rol', text: ERP.auth.etiquetaRol(rol), attrs: { scope: 'col' } }))
                    ])]),
                    el('tbody', {}, filas)
                ])
            ]),
            resumen,
            el('div', { class: 'row row-wrap' }, [btnGuardar])
        ]), {
            subtitulo: 'Marque qué módulos ve cada rol. El administrador los ve todos y Configuración es solo suya.'
        });
    };

    const vista = (contenedor) => {
        const cfg = db.config();

        const campos = {
            empresa: ui.input({ valor: cfg.empresa }),
            nit: ui.input({ valor: cfg.nit }),
            direccion: ui.input({ valor: cfg.direccion }),
            ciudad: ui.input({ valor: cfg.ciudad }),
            telefono: ui.input({ valor: cfg.telefono }),
            email: ui.input({ tipo: 'email', valor: cfg.email }),
            ivaPct: ui.input({ tipo: 'number', valor: cfg.ivaPct, numerico: true, min: 0, max: 100, step: 1 }),
            capitalInicial: ui.input({ tipo: 'number', valor: cfg.capitalInicial, numerico: true, min: 0, step: 1000000 }),
            salarioMinimo: ui.input({ tipo: 'number', valor: cfg.salarioMinimo, numerico: true, min: 0, step: 10000 }),
            auxilioTransporte: ui.input({ tipo: 'number', valor: cfg.auxilioTransporte, numerico: true, min: 0, step: 10000 }),
            topeAuxilioSmmlv: ui.input({ tipo: 'number', valor: cfg.topeAuxilioSmmlv, numerico: true, min: 0, step: 1 }),
            aporteSaludPct: ui.input({ tipo: 'number', valor: cfg.aporteSaludPct, numerico: true, min: 0, max: 100, step: 0.5 }),
            aportePensionPct: ui.input({ tipo: 'number', valor: cfg.aportePensionPct, numerico: true, min: 0, max: 100, step: 0.5 })
        };

        const guardar = () => {
            if (!autorizado()) return;
            const ivaPct = U.toNumber(campos.ivaPct.value);
            if (ivaPct < 0 || ivaPct > 100) {
                ui.toastError('IVA inválido', 'El porcentaje debe estar entre 0 y 100.');
                return;
            }
            if (!campos.empresa.value.trim()) {
                ui.toastError('Falta el nombre de la empresa', 'Es obligatorio para emitir facturas.');
                return;
            }

            db.updateConfig({
                empresa: campos.empresa.value.trim(),
                nit: campos.nit.value.trim(),
                direccion: campos.direccion.value.trim(),
                ciudad: campos.ciudad.value.trim(),
                telefono: campos.telefono.value.trim(),
                email: campos.email.value.trim(),
                ivaPct,
                capitalInicial: U.roundCop(campos.capitalInicial.value),
                salarioMinimo: U.roundCop(campos.salarioMinimo.value),
                auxilioTransporte: U.roundCop(campos.auxilioTransporte.value),
                topeAuxilioSmmlv: U.toNumber(campos.topeAuxilioSmmlv.value),
                aporteSaludPct: U.toNumber(campos.aporteSaludPct.value),
                aportePensionPct: U.toNumber(campos.aportePensionPct.value)
            });

            ui.toastOk('Configuración guardada', 'Los estados financieros se recalcularon con los nuevos parámetros.');
        };

        const btnGuardar = el('button', {
            class: 'btn', text: 'Guardar configuración', attrs: { type: 'button' },
            on: { click: guardar }
        });

        const btnExportar = el('button', {
            class: 'btn btn-secondary', text: '⤓ Exportar datos (JSON)', attrs: { type: 'button' },
            on: {
                click: () => {
                    if (!autorizado()) return;
                    U.downloadBlob(
                        new Blob([db.exportJSON()], { type: 'application/json' }),
                        `respaldo-erp-${U.today()}.json`
                    );
                    ui.toastOk('Respaldo generado', 'Guarde el archivo en un lugar seguro.');
                }
            }
        });

        const btnReiniciar = el('button', {
            class: 'btn btn-danger', text: 'Reiniciar datos de demostración', attrs: { type: 'button' },
            on: {
                click: async () => {
                    if (!autorizado()) return;
                    const ok = await ui.confirmar({
                        titulo: 'Reiniciar todos los datos',
                        mensaje: '¿Borrar toda la información y regenerar los datos de demostración?',
                        detalle: 'Se perderán clientes, facturas, compras, gastos y nóminas registrados. Exporte un respaldo antes si desea conservarlos.',
                        textoAceptar: 'Borrar y regenerar',
                        peligroso: true
                    });
                    if (!ok || !autorizado()) return;
                    db.reset();
                    ui.toastOk('Datos regenerados', 'La demostración volvió a su estado inicial.');
                }
            }
        });

        const usuarios = db.all('usuarios');

        U.appendAll(contenedor, [
            el('div', { class: 'view-head' }, [
                el('div', { class: 'grow' }, [
                    el('h1', { text: 'Configuración' }),
                    el('p', { text: 'Datos de la empresa y parámetros de cálculo que alimentan facturas, impuestos y nómina.' })
                ])
            ]),

            ui.card('Datos de la empresa', el('div', { class: 'grid-form' }, [
                ui.campo('Razón social', campos.empresa, { clase: 'span-full' }),
                ui.campo('NIT', campos.nit),
                ui.campo('Teléfono', campos.telefono),
                ui.campo('Dirección', campos.direccion, { clase: 'span-full' }),
                ui.campo('Ciudad', campos.ciudad),
                ui.campo('Correo electrónico', campos.email)
            ]), { subtitulo: 'Aparecen en el encabezado de las facturas y reportes PDF' }),

            ui.card('Parámetros contables', el('div', { class: 'grid-form' }, [
                ui.campo('IVA (%)', campos.ivaPct, { ayuda: 'Se aplica solo a los ítems marcados como gravados.' }),
                ui.campo('Capital inicial', campos.capitalInicial, { ayuda: 'Saldo de caja con el que arranca el balance general.' })
            ])),

            ui.card('Parámetros de nómina', el('div', { class: 'stack' }, [
                el('div', { class: 'grid-form' }, [
                    ui.campo('Salario mínimo vigente', campos.salarioMinimo),
                    ui.campo('Auxilio de transporte', campos.auxilioTransporte),
                    ui.campo('Tope de auxilio (en SMMLV)', campos.topeAuxilioSmmlv),
                    ui.campo('Aporte a salud (%)', campos.aporteSaludPct),
                    ui.campo('Aporte a pensión (%)', campos.aportePensionPct)
                ]),
                ui.banner('Estos valores cambian cada año',
                    'El salario mínimo y el auxilio de transporte se fijan por decreto. Actualícelos en enero de cada año para que la liquidación de nómina siga siendo correcta.',
                    'warning')
            ])),

            ui.card('Usuarios del sistema', el('div', { class: 'table-wrap' }, [
                el('table', { class: 'data' }, [
                    el('thead', {}, [el('tr', {}, [
                        el('th', { text: 'Usuario', attrs: { scope: 'col' } }),
                        el('th', { text: 'Nombre', attrs: { scope: 'col' } }),
                        el('th', { text: 'Rol', attrs: { scope: 'col' } }),
                        el('th', { class: 'num', text: 'Módulos con acceso', attrs: { scope: 'col' } }),
                        el('th', { attrs: { scope: 'col' } }, [el('span', { class: 'visually-hidden', text: 'Acciones' })])
                    ])]),
                    el('tbody', {}, usuarios.map((u) => {
                        const actual = ERP.auth.usuario();
                        return el('tr', {}, [
                            el('td', {}, [el('div', { class: 'row' }, [
                                el('span', { class: 'strong', text: u.usuario }),
                                actual && actual.id === u.id ? ui.badge('Usted', 'neutral') : null
                            ])]),
                            el('td', { text: u.nombre }),
                            el('td', {}, [ui.badge(ERP.auth.etiquetaRol(u.rol), 'info')]),
                            el('td', { class: 'num', text: U.num(ERP.auth.modulosDeRol(u.rol).length) }),
                            el('td', { class: 'text-right' }, [el('button', {
                                class: 'btn btn-ghost btn-sm', text: 'Editar',
                                attrs: { type: 'button', 'aria-label': `Editar el usuario ${u.usuario}` },
                                on: { click: () => abrirEdicionUsuario(u) }
                            })])
                        ]);
                    }))
                ])
            ]), {
                subtitulo: 'Usuario, nombre, rol y contraseña de quienes acceden al sistema',
                sinRelleno: true,
                pie: el('p', {
                    class: 'text-muted',
                    text: 'La autenticación local separa responsabilidades dentro de la aplicación, pero no es un control de seguridad. Al conectar Supabase debe delegarse en Supabase Auth con Row Level Security.'
                })
            }),

            tarjetaPermisos(),

            ui.card('Datos y respaldo', el('div', { class: 'stack' }, [
                el('p', {
                    class: 'text-muted',
                    text: `La información se guarda en el navegador (localStorage). ${db.persistente ? 'La persistencia está activa.' : 'ATENCIÓN: el navegador bloqueó el almacenamiento; los cambios se perderán al recargar.'}`
                }),
                el('div', { class: 'row row-wrap' }, [btnExportar, btnReiniciar])
            ])),

            el('div', { class: 'row row-wrap' }, [btnGuardar])
        ]);
    };

    return { vista };
})();

/* ============================================================
   Aplicación
   ============================================================ */

ERP.app = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;

    const TEMA_KEY = 'erp_finanzas_tema';

    const MODULOS = {
        dashboard: { etiqueta: 'Tablero ejecutivo', icono: '◈', grupo: 'Operación', render: (c) => ERP.dashboard.vista(c) },
        ventas: { etiqueta: 'Ventas', icono: '▤', grupo: 'Operación', render: (c) => ERP.ventas.vista(c) },
        cartera: { etiqueta: 'Cartera y abonos', icono: '◷', grupo: 'Operación', render: (c) => ERP.cartera.vista(c) },
        compras: { etiqueta: 'Compras', icono: '↓', grupo: 'Operación', render: (c) => ERP.compras.vista(c) },
        gastos: { etiqueta: 'Gastos', icono: '◇', grupo: 'Operación', render: (c) => ERP.gastos.vista(c) },
        inventario: { etiqueta: 'Inventario', icono: '▦', grupo: 'Operación', render: (c) => ERP.inventario.vista(c) },
        clientes: { etiqueta: 'Clientes', icono: '◉', grupo: 'Terceros', render: (c) => ERP.contactos.vistaClientes(c) },
        proveedores: { etiqueta: 'Proveedores', icono: '◎', grupo: 'Terceros', render: (c) => ERP.contactos.vistaProveedores(c) },
        financieros: { etiqueta: 'Estados financieros', icono: '▧', grupo: 'Análisis', render: (c) => ERP.estadosFinancieros.vista(c) },
        equilibrio: { etiqueta: 'Punto de equilibrio', icono: '⟁', grupo: 'Análisis', render: (c) => ERP.equilibrio.vista(c) },
        prestamos: { etiqueta: 'Simulador de préstamos', icono: '≡', grupo: 'Análisis', render: (c) => ERP.prestamos.vista(c) },
        nomina: { etiqueta: 'Nómina', icono: '◫', grupo: 'Administración', render: (c) => ERP.nomina.vista(c) },
        configuracion: { etiqueta: 'Configuración', icono: '⚙', grupo: 'Administración', render: (c) => ERP.configuracion.vista(c) }
    };

    /** Orden en que se muestran los grupos del menú lateral. */
    const GRUPOS = ['Operación', 'Terceros', 'Análisis', 'Administración'];

    const estado = {
        // null = elegir al montar el primer módulo permitido para el rol.
        vista: null,
        colapsado: false,
        cajonAbierto: false
    };

    let raiz = null;

    /* ---------- Tema ---------- */

    const temaGuardado = () => {
        try {
            return window.localStorage.getItem(TEMA_KEY);
        } catch (error) {
            return null;
        }
    };

    const aplicarTema = (tema) => {
        document.documentElement.setAttribute('data-theme', tema);
        try {
            window.localStorage.setItem(TEMA_KEY, tema);
        } catch (error) {
            // Sin almacenamiento el tema simplemente no se recuerda.
        }
    };

    const temaActual = () => document.documentElement.getAttribute('data-theme') || 'light';

    /* ---------- Pantalla de acceso ---------- */

    const pantallaAcceso = () => {
        U.clear(raiz);

        const usuario = ui.input({ autocomplete: 'username' });
        const clave = ui.input({ tipo: 'password', placeholder: '••••••••', autocomplete: 'current-password' });
        const errores = el('div');

        const btnEntrar = el('button', { class: 'btn', text: 'Ingresar', attrs: { type: 'submit' }, style: { width: '100%' } });

        const formulario = el('form', { class: 'stack' }, [
            errores,
            ui.campo('Usuario', usuario),
            ui.campo('Contraseña', clave),
            btnEntrar
        ]);

        formulario.addEventListener('submit', (event) => {
            event.preventDefault();
            U.clear(errores);

            const res = ERP.auth.iniciarSesion(usuario.value, clave.value);
            if (!res.ok) {
                errores.appendChild(ui.banner('No fue posible ingresar', res.error, 'danger'));
                clave.value = '';
                clave.focus();
                return;
            }
            estado.vista = null;
            montarAplicacion();
            ui.toastOk(`Bienvenida, ${res.usuario.nombre}`, ERP.auth.etiquetaRol(res.usuario.rol));
        });

        // La pantalla de acceso no muestra usuarios ni contraseñas: la app es pública
        // y quien administra el sistema entrega las credenciales.
        raiz.appendChild(el('div', { class: 'login-screen' }, [
            el('main', { class: 'login-card' }, [
                el('div', { class: 'login-brand' }, [
                    el('img', { attrs: { src: 'assets/IMG/logo.svg', alt: '' } }),
                    el('div', {}, [
                        el('h1', { text: 'Gestión Financiera' }),
                        el('p', { text: ERP.db.config().empresa }),
                        el('p', { class: 'hint', text: `Versión ${ERP.VERSION}` })
                    ])
                ]),
                formulario
            ])
        ]));

        usuario.focus();
    };

    /* ---------- Layout ---------- */

    const construirSidebar = () => {
        const nav = el('nav', { class: 'sidebar-nav', attrs: { 'aria-label': 'Módulos del sistema' } });

        const bajoMinimo = ERP.db.productosBajoMinimo().length;
        const vencidas = ERP.db.all('ventas').filter(
            (v) => ERP.db.estadoVenta(v).clave === 'vencida').length;

        const permitidos = ERP.auth.modulosPermitidos();

        // El menú se arma por grupos, no por el orden de la lista de
        // permisos: así cada encabezado aparece una sola vez.
        GRUPOS.forEach((grupo) => {
            const claves = Object.keys(MODULOS).filter(
                (clave) => MODULOS[clave].grupo === grupo && permitidos.includes(clave));
            if (claves.length === 0) return;

            nav.appendChild(el('p', { class: 'nav-group-label', text: grupo }));

            claves.forEach((clave) => {
                const modulo = MODULOS[clave];
                const insignia = clave === 'inventario' && bajoMinimo ? bajoMinimo
                    : clave === 'cartera' && vencidas ? vencidas : null;

                nav.appendChild(el('button', {
                    class: 'nav-item',
                    attrs: {
                        type: 'button',
                        title: modulo.etiqueta,
                        'aria-current': estado.vista === clave ? 'page' : null
                    },
                    on: { click: () => irA(clave) }
                }, [
                    el('span', { class: 'nav-icon', text: modulo.icono, attrs: { 'aria-hidden': 'true' } }),
                    el('span', { class: 'nav-label', text: modulo.etiqueta }),
                    insignia ? el('span', { class: 'nav-badge', text: String(insignia) }) : null
                ]));
            });
        });

        return el('aside', { class: 'sidebar' }, [
            el('div', { class: 'sidebar-head' }, [
                el('img', { attrs: { src: 'assets/IMG/logo.svg', alt: '' } }),
                el('div', { class: 'sidebar-title' }, [
                    el('span', { text: 'ERP Financiero', style: { fontWeight: '700', fontSize: '0.9rem' } }),
                    el('span', { text: U.truncate(ERP.db.config().empresa, 26) }),
                    el('span', { class: 'sidebar-version', text: `Versión ${ERP.VERSION}` })
                ])
            ]),
            nav
        ]);
    };

    const construirTopbar = () => {
        const usuario = ERP.auth.usuario();
        const modulo = MODULOS[estado.vista];

        const btnMenu = el('button', {
            class: 'icon-btn', text: '☰',
            attrs: { type: 'button', 'aria-label': 'Mostrar u ocultar el menú lateral' },
            on: {
                click: () => {
                    const esMovil = window.matchMedia('(max-width: 860px)').matches;
                    if (esMovil) {
                        estado.cajonAbierto = !estado.cajonAbierto;
                    } else {
                        estado.colapsado = !estado.colapsado;
                    }
                    actualizarShell();
                }
            }
        });

        const btnTema = el('button', {
            class: 'icon-btn',
            text: temaActual() === 'dark' ? '☀' : '☾',
            attrs: {
                type: 'button',
                'aria-label': temaActual() === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'
            },
            on: {
                click: () => {
                    const nuevo = temaActual() === 'dark' ? 'light' : 'dark';
                    aplicarTema(nuevo);
                    montarAplicacion();
                }
            }
        });

        const btnSalir = el('button', {
            class: 'icon-btn', text: '⏻',
            attrs: { type: 'button', 'aria-label': 'Cerrar sesión' },
            on: {
                click: async () => {
                    const ok = await ui.confirmar({
                        titulo: 'Cerrar sesión',
                        mensaje: '¿Desea salir del sistema?',
                        detalle: 'Los datos registrados quedan guardados en este navegador.',
                        textoAceptar: 'Cerrar sesión'
                    });
                    if (ok) {
                        ERP.auth.cerrarSesion();
                        estado.vista = null;
                        pantallaAcceso();
                    }
                }
            }
        });

        return el('header', { class: 'topbar' }, [
            btnMenu,
            el('div', {}, [
                el('h1', { text: modulo ? modulo.etiqueta : 'Sistema' }),
                el('p', { class: 'topbar-sub', text: U.fmtDateLong(U.today()) })
            ]),
            el('div', { class: 'topbar-spacer' }),
            btnTema,
            el('div', { class: 'user-chip' }, [
                el('span', { class: 'avatar', text: U.initials(usuario.nombre) }),
                el('div', {}, [
                    el('p', { class: 'user-name', text: usuario.nombre }),
                    el('p', { class: 'user-role', text: ERP.auth.etiquetaRol(usuario.rol) })
                ])
            ]),
            btnSalir
        ]);
    };

    const actualizarShell = () => {
        const shell = document.querySelector('.app-shell');
        if (!shell) return;
        shell.classList.toggle('is-collapsed', estado.colapsado);
        shell.classList.toggle('is-drawer-open', estado.cajonAbierto);

        const scrim = document.querySelector('.scrim');
        if (estado.cajonAbierto && !scrim) {
            shell.appendChild(el('div', {
                class: 'scrim',
                on: { click: () => { estado.cajonAbierto = false; actualizarShell(); } }
            }));
        } else if (!estado.cajonAbierto && scrim) {
            scrim.remove();
        }
    };

    /** Tablero si el rol lo tiene; si no, el primer módulo permitido en el orden del menú. */
    const primerModuloPermitido = () => {
        const permitidos = ERP.auth.modulosPermitidos();
        if (permitidos.includes('dashboard')) return 'dashboard';
        const enMenu = GRUPOS.flatMap((grupo) => Object.keys(MODULOS).filter((clave) => MODULOS[clave].grupo === grupo));
        return enMenu.find((clave) => permitidos.includes(clave)) || null;
    };

    const irA = (clave) => {
        if (!ERP.auth.puede(clave)) {
            ui.toastError('Sin permiso', 'Su rol no tiene acceso a este módulo.');
            return;
        }
        estado.vista = clave;
        estado.cajonAbierto = false;
        montarAplicacion();
    };

    const pintarVista = (contenedor) => {
        U.clear(contenedor);
        const modulo = MODULOS[estado.vista];

        if (!modulo || !ERP.auth.puede(estado.vista)) {
            contenedor.appendChild(ui.estadoError('Módulo no disponible',
                'El módulo solicitado no existe o su rol no tiene acceso a él.'));
            return;
        }

        try {
            modulo.render(contenedor);
        } catch (error) {
            console.error(`Error al renderizar el módulo "${estado.vista}"`, error);
            U.clear(contenedor);
            contenedor.appendChild(ui.estadoError('No fue posible mostrar el módulo',
                'Ocurrió un error inesperado. Revise la consola del navegador para más detalle.'));
        }
    };

    const montarAplicacion = () => {
        // Los permisos se leen del registro vigente en cada montaje: si el rol cambió
        // (aquí o en otra pestaña), el menú deja de ofrecer lo que ya no corresponde.
        const rolAnterior = ERP.auth.usuario() ? ERP.auth.usuario().rol : null;
        const sesion = ERP.auth.sincronizarSesion();
        if (!sesion) {
            estado.vista = null;
            pantallaAcceso();
            if (rolAnterior) ui.toastWarn('Sesión cerrada', 'Su usuario ya no existe o fue desactivado. Ingrese de nuevo.');
            return;
        }
        if (!estado.vista || !ERP.auth.puede(estado.vista)) {
            // Perder la vista con la sesión abierta es un cambio de rol o de permisos: se avisa.
            // Al entrar (vista vacía) se abre el primer módulo permitido sin aviso.
            const anterior = MODULOS[estado.vista];
            estado.vista = primerModuloPermitido();
            if (anterior) {
                ui.toastInfo('Su acceso cambió',
                    `${anterior.etiqueta} ya no está disponible para el rol ${ERP.auth.etiquetaRol(sesion.rol)}.`);
            }
        }

        U.clear(raiz);

        const contenedorVista = el('div', { class: 'view' });

        const shell = el('div', { class: 'app-shell' }, [
            construirSidebar(),
            el('div', { class: 'main-area' }, [
                construirTopbar(),
                el('main', { class: 'view-scroll', attrs: { id: 'contenido', tabindex: '-1' } }, [contenedorVista])
            ])
        ]);

        raiz.appendChild(shell);
        actualizarShell();
        pintarVista(contenedorVista);
    };

    /* ---------- Arranque ---------- */

    const iniciar = () => {
        raiz = document.getElementById('app');
        if (!raiz) return;

        aplicarTema(temaGuardado()
            || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

        const carga = ERP.db.load();

        if (!carga.persistente) {
            ui.toastWarn('Almacenamiento no disponible',
                'El navegador bloqueó localStorage: los cambios no se conservarán al recargar la página.');
        }

        // Al cambiar los datos se repinta la vista activa para que
        // KPIs, gráficos y tablas nunca queden desincronizados.
        const repintar = U.debounce(() => {
            if (ERP.auth.usuario()) montarAplicacion();
        }, 90);
        U.bus.on('db:changed', repintar);

        // Otra pestaña guardó cambios (por ejemplo, el administrador cambió un rol):
        // se releen los datos para que permisos y cifras no queden desactualizados.
        window.addEventListener('storage', (event) => {
            if (event.key !== ERP.db.STORAGE_KEY || event.newValue === null) return;
            ERP.db.load();
            repintar();
        });

        U.bus.on('db:persist-error', () => {
            ui.toastError('No se pudo guardar', ERP.auth.puede('configuracion')
                ? 'El almacenamiento del navegador está lleno o bloqueado. Exporte un respaldo desde Configuración.'
                : 'El almacenamiento del navegador está lleno o bloqueado. Avise al administrador para que exporte un respaldo.');
        });

        // El menú lateral pasa de colapsable a cajón según el ancho.
        window.addEventListener('resize', U.debounce(() => {
            if (!window.matchMedia('(max-width: 860px)').matches && estado.cajonAbierto) {
                estado.cajonAbierto = false;
                actualizarShell();
            }
        }, 200));

        if (ERP.auth.restaurarSesion()) {
            montarAplicacion();
        } else {
            pantallaAcceso();
        }

        if (carga.seeded) {
            window.setTimeout(() => ui.toastInfo('Datos de demostración cargados',
                'Puede auditar cada módulo de inmediato. El administrador puede reiniciarlos o exportarlos desde Configuración.'), 900);
        }
    };

    return { iniciar, irA, refrescar: montarAplicacion, MODULOS, GRUPOS, estado };
})();

document.addEventListener('DOMContentLoaded', ERP.app.iniciar);
