/* ============================================================
   ui.js — Componentes reutilizables de interfaz
   Toasts, modales, confirmaciones, tablas con orden/búsqueda/
   paginación, KPIs y estados (carga, vacío, error).
   Reemplaza por completo a alert(), confirm() y prompt().
   ============================================================ */

window.ERP = window.ERP || {};

ERP.ui = (() => {
    const U = ERP.util;
    const { el, clear } = U;

    /* ============================================================
       Toasts
       ============================================================ */

    let toastStack = null;

    const ensureToastStack = () => {
        if (!toastStack) {
            toastStack = el('div', {
                class: 'toast-stack',
                attrs: { role: 'status', 'aria-live': 'polite' }
            });
            document.body.appendChild(toastStack);
        }
        return toastStack;
    };

    const ICONOS = { success: '✓', error: '✕', warning: '!', info: 'i' };

    const toast = (titulo, mensaje, tipo = 'success', ms = 4200) => {
        const stack = ensureToastStack();
        const nodo = el('div', { class: `toast toast-${tipo}` }, [
            el('span', { class: 'strong', text: ICONOS[tipo] || 'i', style: { opacity: '0.75' } }),
            el('div', { class: 'grow' }, [
                el('p', { class: 'toast-title', text: titulo }),
                mensaje ? el('p', { class: 'toast-msg', text: mensaje }) : null
            ]),
            el('button', {
                class: 'btn-ghost btn btn-sm',
                text: '✕',
                attrs: { type: 'button', 'aria-label': 'Cerrar aviso' },
                on: { click: () => nodo.remove() }
            })
        ]);

        stack.appendChild(nodo);
        window.setTimeout(() => nodo.remove(), ms);
        return nodo;
    };

    const toastOk = (titulo, mensaje) => toast(titulo, mensaje, 'success');
    const toastError = (titulo, mensaje) => toast(titulo, mensaje, 'error', 6000);
    const toastWarn = (titulo, mensaje) => toast(titulo, mensaje, 'warning', 5500);
    const toastInfo = (titulo, mensaje) => toast(titulo, mensaje, 'info');

    /* ============================================================
       Modales
       ============================================================ */

    const modalesAbiertos = [];

    /**
     * Abre un modal accesible. Devuelve un controlador con close().
     * opts: { titulo, subtitulo, contenido, acciones, ancho, onClose }
     */
    const modal = (opts) => {
        const previoFoco = document.activeElement;

        const cuerpo = el('div', { class: 'modal-body' }, [opts.contenido]);

        const anchoClase = opts.ancho === 'ancho' ? ' modal-wide'
            : opts.ancho === 'estrecho' ? ' modal-sm' : '';

        const tituloId = U.uid('mtit');

        const btnCerrar = el('button', {
            class: 'icon-btn',
            text: '✕',
            attrs: { type: 'button', 'aria-label': 'Cerrar ventana' }
        });

        const pie = (opts.acciones && opts.acciones.length)
            ? el('div', { class: 'modal-foot' }, opts.acciones)
            : null;

        const caja = el('section', {
            class: `modal${anchoClase}`,
            attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tituloId }
        }, [
            el('header', { class: 'modal-head' }, [
                el('div', { class: 'grow' }, [
                    el('h2', { text: opts.titulo || '', attrs: { id: tituloId } }),
                    opts.subtitulo ? el('p', { text: opts.subtitulo }) : null
                ]),
                btnCerrar
            ]),
            cuerpo,
            pie
        ]);

        const fondo = el('div', { class: 'modal-backdrop' }, [caja]);

        const cerrar = (resultado) => {
            const idx = modalesAbiertos.indexOf(control);
            if (idx >= 0) modalesAbiertos.splice(idx, 1);
            document.removeEventListener('keydown', onKeydown, true);
            fondo.remove();
            if (previoFoco && typeof previoFoco.focus === 'function') previoFoco.focus();
            if (typeof opts.onClose === 'function') opts.onClose(resultado);
        };

        const control = { cerrar, caja, cuerpo, fondo };

        const onKeydown = (event) => {
            if (modalesAbiertos[modalesAbiertos.length - 1] !== control) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                cerrar(null);
                return;
            }

            // Ciclo de foco confinado al modal (accesibilidad con teclado).
            if (event.key === 'Tab') {
                const focusables = caja.querySelectorAll(
                    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                );
                if (focusables.length === 0) return;
                const primero = focusables[0];
                const ultimo = focusables[focusables.length - 1];
                if (event.shiftKey && document.activeElement === primero) {
                    event.preventDefault();
                    ultimo.focus();
                } else if (!event.shiftKey && document.activeElement === ultimo) {
                    event.preventDefault();
                    primero.focus();
                }
            }
        };

        btnCerrar.addEventListener('click', () => cerrar(null));
        fondo.addEventListener('mousedown', (event) => {
            if (event.target === fondo && opts.cerrarAlHacerClicFuera !== false) cerrar(null);
        });
        document.addEventListener('keydown', onKeydown, true);

        document.body.appendChild(fondo);
        modalesAbiertos.push(control);

        const primerCampo = caja.querySelector('input, select, textarea, button');
        if (primerCampo) primerCampo.focus();

        return control;
    };

    /** Sustituto de confirm(): devuelve una promesa con true/false. */
    const confirmar = (opts) => new Promise((resolve) => {
        let resuelto = false;
        const finalizar = (valor) => {
            if (resuelto) return;
            resuelto = true;
            resolve(valor);
        };

        const btnCancelar = el('button', {
            class: 'btn btn-secondary',
            text: opts.textoCancelar || 'Cancelar',
            attrs: { type: 'button' }
        });

        const btnAceptar = el('button', {
            class: `btn ${opts.peligroso ? 'btn-danger' : ''}`.trim(),
            text: opts.textoAceptar || 'Aceptar',
            attrs: { type: 'button' }
        });

        const ctrl = modal({
            titulo: opts.titulo || 'Confirmar acción',
            ancho: 'estrecho',
            contenido: el('div', { class: 'stack-sm' }, [
                el('p', { text: opts.mensaje || '' }),
                opts.detalle ? el('p', { class: 'text-muted', text: opts.detalle }) : null
            ]),
            acciones: [btnCancelar, btnAceptar],
            onClose: () => finalizar(false)
        });

        btnCancelar.addEventListener('click', () => { finalizar(false); ctrl.cerrar(); });
        btnAceptar.addEventListener('click', () => { finalizar(true); ctrl.cerrar(); });
        btnAceptar.focus();
    });

    /* ============================================================
       Campos de formulario
       ============================================================ */

    const campo = (etiqueta, control, opts = {}) => {
        const id = control.id || U.uid('f');
        control.id = id;
        return el('div', { class: `field${opts.clase ? ` ${opts.clase}` : ''}` }, [
            el('label', { text: etiqueta, attrs: { for: id } }),
            control,
            opts.ayuda ? el('span', { class: 'hint', text: opts.ayuda }) : null
        ]);
    };

    const input = (opts = {}) => el('input', {
        class: `input${opts.numerico ? ' num-input' : ''}`,
        attrs: {
            type: opts.tipo || 'text',
            name: opts.name || '',
            placeholder: opts.placeholder || '',
            value: opts.valor !== undefined && opts.valor !== null ? opts.valor : '',
            min: opts.min,
            max: opts.max,
            step: opts.step,
            required: opts.requerido ? true : null,
            readonly: opts.soloLectura ? true : null,
            autocomplete: opts.autocomplete || 'off'
        },
        props: { value: opts.valor !== undefined && opts.valor !== null ? String(opts.valor) : '' },
        on: opts.on || {}
    });

    /** opciones: [{ valor, texto }] o [valor, ...] */
    const select = (opciones, opts = {}) => {
        const nodo = el('select', {
            class: 'select',
            attrs: { name: opts.name || '', required: opts.requerido ? true : null },
            on: opts.on || {}
        });

        if (opts.placeholder) {
            nodo.appendChild(el('option', {
                text: opts.placeholder,
                attrs: { value: '' }
            }));
        }

        (opciones || []).forEach((op) => {
            const valor = typeof op === 'object' ? op.valor : op;
            const texto = typeof op === 'object' ? op.texto : op;
            nodo.appendChild(el('option', { text: texto, attrs: { value: valor } }));
        });

        if (opts.valor !== undefined && opts.valor !== null) nodo.value = String(opts.valor);
        return nodo;
    };

    const segmentado = (opciones, valorActual, onChange) => {
        const cont = el('div', { class: 'segmented', attrs: { role: 'group' } });
        opciones.forEach((op) => {
            const valor = typeof op === 'object' ? op.valor : op;
            const texto = typeof op === 'object' ? op.texto : op;
            const btn = el('button', {
                text: texto,
                attrs: { type: 'button', 'aria-pressed': String(valor === valorActual) },
                on: {
                    click: () => {
                        cont.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
                        btn.setAttribute('aria-pressed', 'true');
                        onChange(valor);
                    }
                }
            });
            cont.appendChild(btn);
        });
        return cont;
    };

    /* ============================================================
       Presentación
       ============================================================ */

    const kpi = (etiqueta, valor, contexto, color) => el('article', {
        class: 'kpi',
        style: color ? { '--kpi-accent': color } : {}
    }, [
        el('p', { class: 'kpi-label', text: etiqueta }),
        el('p', { class: 'kpi-value', text: valor }),
        contexto ? el('p', { class: 'kpi-context', text: contexto }) : null
    ]);

    const badge = (texto, tono = 'neutral') => el('span', {
        class: `badge badge-${tono}`,
        text: texto
    });

    const banner = (titulo, mensaje, tono = 'info') => el('div', {
        class: `banner banner-${tono}`,
        attrs: { role: tono === 'danger' ? 'alert' : 'status' }
    }, [
        el('div', { class: 'grow' }, [
            el('strong', { text: titulo }),
            mensaje ? el('span', { text: mensaje }) : null
        ])
    ]);

    const meter = (porcentaje, color) => el('div', {
        class: 'meter',
        attrs: {
            role: 'progressbar',
            'aria-valuenow': Math.round(porcentaje),
            'aria-valuemin': '0',
            'aria-valuemax': '100'
        },
        style: color ? { '--meter-color': color } : {}
    }, [
        el('span', { style: { width: `${Math.max(0, Math.min(100, porcentaje))}%` } })
    ]);

    const card = (titulo, contenido, opts = {}) => el('section', { class: 'card' }, [
        (titulo || opts.acciones) ? el('header', { class: 'card-head' }, [
            el('div', { class: 'grow' }, [
                titulo ? el('h2', { text: titulo }) : null,
                opts.subtitulo ? el('p', { text: opts.subtitulo }) : null
            ]),
            opts.acciones || null
        ]) : null,
        el('div', { class: `card-body${opts.sinRelleno ? ' flush' : ''}` }, [contenido]),
        opts.pie ? el('footer', { class: 'card-foot' }, [opts.pie]) : null
    ]);

    /* ---------- Estados ---------- */

    const estadoCargando = (mensaje = 'Cargando información…') => el('div', {
        class: 'state', attrs: { role: 'status' }
    }, [
        el('div', { class: 'spinner' }),
        el('p', { class: 'state-msg', text: mensaje })
    ]);

    const estadoVacio = (titulo, mensaje, accion) => el('div', { class: 'state' }, [
        el('p', { class: 'state-icon', text: '◍' }),
        el('p', { class: 'state-title', text: titulo }),
        mensaje ? el('p', { class: 'state-msg', text: mensaje }) : null,
        accion || null
    ]);

    const estadoError = (titulo, mensaje) => el('div', {
        class: 'state', attrs: { role: 'alert' }
    }, [
        el('p', { class: 'state-icon neg', text: '⚠' }),
        el('p', { class: 'state-title', text: titulo }),
        mensaje ? el('p', { class: 'state-msg', text: mensaje }) : null
    ]);

    /* ============================================================
       Tabla de datos
       Columnas: { clave, titulo, tipo:'texto'|'numero'|'moneda'|'fecha'|'nodo',
                   valor(fila), render(fila), ordenable, ancho }
       ============================================================ */

    const tabla = (filas, columnas, opts = {}) => {
        const estado = {
            orden: opts.ordenInicial || null,
            dir: opts.dirInicial || 'asc',
            busqueda: '',
            pagina: 1,
            porPagina: opts.porPagina || 12
        };

        const contenedor = el('div');
        const zonaTabla = el('div', { class: 'table-wrap' });
        const zonaPager = el('div');

        const valorDe = (fila, col) => {
            if (typeof col.valor === 'function') return col.valor(fila);
            return fila[col.clave];
        };

        const textoDe = (fila, col) => {
            const v = valorDe(fila, col);
            if (v === null || v === undefined) return '';
            if (col.tipo === 'moneda') return U.money(v);
            if (col.tipo === 'numero') return U.num(v, col.decimales || 0);
            if (col.tipo === 'fecha') return U.fmtDate(v);
            return String(v);
        };

        const filtrar = () => {
            const q = U.normalize(estado.busqueda).trim();
            if (!q) return filas;
            const terminos = q.split(/\s+/);
            return filas.filter((fila) => {
                const blob = U.normalize(columnas.map((col) => textoDe(fila, col)).join(' '));
                return terminos.every((t) => blob.includes(t));
            });
        };

        const ordenar = (lista) => {
            if (!estado.orden) return lista;
            const col = columnas.find((c) => c.clave === estado.orden);
            if (!col) return lista;
            return U.sortBy(lista, (fila) => {
                const v = valorDe(fila, col);
                if (col.tipo === 'numero' || col.tipo === 'moneda') return U.toNumber(v);
                return v ?? '';
            }, estado.dir);
        };

        const render = () => {
            clear(zonaTabla);
            clear(zonaPager);

            const filtradas = filtrar();
            const ordenadas = ordenar(filtradas);

            if (ordenadas.length === 0) {
                zonaTabla.appendChild(estado.busqueda
                    ? estadoVacio('Sin coincidencias', `Ningún registro coincide con "${estado.busqueda}".`)
                    : (opts.vacio || estadoVacio('Sin registros', 'Todavía no hay información para mostrar.')));
                return;
            }

            const totalPaginas = Math.max(1, Math.ceil(ordenadas.length / estado.porPagina));
            if (estado.pagina > totalPaginas) estado.pagina = totalPaginas;
            const desde = (estado.pagina - 1) * estado.porPagina;
            const visibles = ordenadas.slice(desde, desde + estado.porPagina);

            const thead = el('thead', {}, [
                el('tr', {}, columnas.map((col) => {
                    const esNum = col.tipo === 'numero' || col.tipo === 'moneda';
                    const ordenable = col.ordenable !== false && col.tipo !== 'nodo';
                    const activo = estado.orden === col.clave;

                    const th = el('th', {
                        class: `${esNum ? 'num' : ''}${ordenable ? ' sortable' : ''}`.trim(),
                        attrs: {
                            scope: 'col',
                            'aria-sort': activo ? (estado.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                    }, [
                        el('span', { text: col.titulo }),
                        activo ? el('span', { class: 'sort-mark', text: estado.dir === 'asc' ? '▲' : '▼' }) : null
                    ]);

                    if (ordenable) {
                        th.addEventListener('click', () => {
                            if (estado.orden === col.clave) {
                                estado.dir = estado.dir === 'asc' ? 'desc' : 'asc';
                            } else {
                                estado.orden = col.clave;
                                estado.dir = esNum ? 'desc' : 'asc';
                            }
                            render();
                        });
                    }
                    return th;
                }))
            ]);

            const tbody = el('tbody', {}, visibles.map((fila) => el('tr', {}, columnas.map((col) => {
                const esNum = col.tipo === 'numero' || col.tipo === 'moneda';
                const celda = el('td', { class: `${esNum ? 'num' : ''}${col.ajustar ? ' wrap' : ''}`.trim() });
                if (typeof col.render === 'function') {
                    U.appendAll(celda, col.render(fila));
                } else {
                    celda.textContent = textoDe(fila, col);
                    if (col.tipo === 'moneda' && U.toNumber(valorDe(fila, col)) < 0) celda.classList.add('neg');
                }
                return celda;
            }))));

            const partes = [thead, tbody];

            if (typeof opts.totales === 'function') {
                const totales = opts.totales(ordenadas);
                partes.push(el('tfoot', {}, [
                    el('tr', {}, columnas.map((col) => {
                        const esNum = col.tipo === 'numero' || col.tipo === 'moneda';
                        const valor = totales[col.clave];
                        const celda = el('td', { class: esNum ? 'num' : '' });
                        if (valor !== undefined && valor !== null) {
                            celda.textContent = col.tipo === 'moneda' ? U.money(valor)
                                : col.tipo === 'numero' ? U.num(valor, col.decimales || 0)
                                    : String(valor);
                        }
                        return celda;
                    }))
                ]));
            }

            zonaTabla.appendChild(el('table', { class: 'data' }, partes));

            if (ordenadas.length > estado.porPagina) {
                const btnPrev = el('button', {
                    class: 'btn btn-secondary btn-sm', text: '‹ Anterior',
                    attrs: { type: 'button', disabled: estado.pagina === 1 ? true : null },
                    on: { click: () => { estado.pagina -= 1; render(); } }
                });
                const btnNext = el('button', {
                    class: 'btn btn-secondary btn-sm', text: 'Siguiente ›',
                    attrs: { type: 'button', disabled: estado.pagina === totalPaginas ? true : null },
                    on: { click: () => { estado.pagina += 1; render(); } }
                });

                zonaPager.appendChild(el('div', { class: 'pager' }, [
                    el('span', {
                        text: `${desde + 1}–${Math.min(desde + estado.porPagina, ordenadas.length)} de ${U.num(ordenadas.length)} registros`
                    }),
                    el('div', { class: 'row' }, [btnPrev, btnNext])
                ]));
            } else {
                zonaPager.appendChild(el('div', { class: 'pager' }, [
                    el('span', { text: `${U.num(ordenadas.length)} ${ordenadas.length === 1 ? 'registro' : 'registros'}` })
                ]));
            }
        };

        if (opts.buscador !== false || opts.herramientas) {
            const buscador = input({
                tipo: 'search',
                placeholder: opts.textoBusqueda || 'Buscar…',
                on: {
                    input: U.debounce((event) => {
                        estado.busqueda = event.target.value;
                        estado.pagina = 1;
                        render();
                    }, 180)
                }
            });
            buscador.setAttribute('aria-label', 'Buscar en la tabla');

            contenedor.appendChild(el('div', { class: 'table-toolbar' }, [
                opts.buscador !== false ? el('div', { class: 'field grow' }, [buscador]) : null,
                opts.herramientas || null
            ]));
        }

        contenedor.appendChild(zonaTabla);
        contenedor.appendChild(zonaPager);
        render();

        return { nodo: contenedor, refrescar: render, estado };
    };

    return {
        toast, toastOk, toastError, toastWarn, toastInfo,
        modal, confirmar,
        campo, input, select, segmentado,
        kpi, badge, banner, meter, card,
        estadoCargando, estadoVacio, estadoError,
        tabla
    };
})();
