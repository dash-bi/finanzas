/* ============================================================
   charts.js — Gráficos SVG nativos e interactivos
   Sin librerías externas. Cada gráfico devuelve un nodo del DOM
   que se adapta al ancho disponible mediante viewBox.
   Los colores salen de las variables CSS, de modo que el gráfico
   responde automáticamente al tema claro / oscuro.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.charts = (() => {
    const U = ERP.util;
    const { el, svgEl } = U;

    const PALETA = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)',
        'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

    const color = (i) => PALETA[i % PALETA.length];

    /* ---------- Utilidades internas ---------- */

    /** Escala "bonita": redondea el máximo a un valor legible para el eje. */
    const escalaBonita = (max) => {
        if (!Number.isFinite(max) || max <= 0) return { max: 10, paso: 2 };
        const exp = Math.floor(Math.log10(max));
        const base = Math.pow(10, exp);
        const norm = max / base;
        const factor = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
        const techo = factor * base;
        return { max: techo, paso: techo / 4 };
    };

    /**
     * El ancho del viewBox determina cuánto se escala el dibujo dentro de
     * su tarjeta: cuanto más ancho, más pequeño queda el texto. Los gráficos
     * de barras usan un lienzo estrecho para seguir siendo legibles cuando
     * comparten fila con otra tarjeta.
     */
    const crearLienzo = (alto = 320, ancho = 800) => {
        const cont = el('div', { class: 'chart' });
        const tooltip = el('div', { class: 'chart-tooltip is-hidden' });
        const svg = svgEl('svg', {
            viewBox: `0 0 ${ancho} ${alto}`,
            role: 'img',
            preserveAspectRatio: 'xMidYMid meet'
        });
        cont.appendChild(svg);
        cont.appendChild(tooltip);
        return { cont, svg, tooltip, ancho, alto };
    };

    const mostrarTooltip = (tooltip, x, y, ancho, alto, titulo, filas) => {
        U.clear(tooltip);
        tooltip.appendChild(el('p', { class: 'tt-title', text: titulo }));
        filas.forEach((fila) => {
            tooltip.appendChild(el('div', { class: 'tt-row' }, [
                el('span', { class: 'tt-key' }, [
                    fila.color ? el('span', { class: 'swatch', style: { background: fila.color } }) : null,
                    el('span', { text: fila.etiqueta })
                ]),
                el('span', { class: 'strong num', text: fila.valor })
            ]));
        });
        tooltip.classList.remove('is-hidden');
        tooltip.style.left = `${(x / ancho) * 100}%`;
        tooltip.style.top = `${(y / alto) * 100}%`;
    };

    const ocultarTooltip = (tooltip) => tooltip.classList.add('is-hidden');

    const leyenda = (items) => el('div', { class: 'legend' }, items.map((item) => el('span', {
        class: 'legend-item'
    }, [
        el('span', { class: 'swatch', style: { background: item.color } }),
        el('span', { text: item.etiqueta })
    ])));

    /* ============================================================
       Gráfico de líneas (una o varias series en el tiempo)
       opts: { etiquetas:[], series:[{nombre, datos:[], color}],
               formato: fn, alto }
       ============================================================ */

    const lineas = (opts) => {
        const etiquetas = opts.etiquetas || [];
        const series = (opts.series || []).map((s, i) => ({ ...s, color: s.color || color(i) }));
        const fmt = opts.formato || U.money;
        const alto = opts.alto || 320;

        if (etiquetas.length === 0 || series.length === 0) {
            return ERP.ui.estadoVacio('Sin datos para graficar',
                'Ajuste los filtros o registre movimientos en el periodo.');
        }

        const { cont, svg, tooltip, ancho } = crearLienzo(alto);
        const m = { top: 18, right: 18, bottom: 34, left: 66 };
        const w = ancho - m.left - m.right;
        const h = alto - m.top - m.bottom;

        const maxDato = Math.max(0, ...series.flatMap((s) => s.datos.map((d) => U.toNumber(d))));
        const escala = escalaBonita(maxDato);

        const px = (i) => etiquetas.length === 1
            ? m.left + w / 2
            : m.left + (i / (etiquetas.length - 1)) * w;
        const py = (v) => m.top + h - (U.toNumber(v) / escala.max) * h;

        // Rejilla y eje vertical
        for (let v = 0; v <= escala.max + 0.001; v += escala.paso) {
            const y = py(v);
            svg.appendChild(svgEl('line', {
                class: 'grid-line', x1: m.left, y1: y, x2: m.left + w, y2: y
            }));
            svg.appendChild(svgEl('text', {
                class: 'axis-text', x: m.left - 8, y: y + 3,
                'text-anchor': 'end', text: U.moneyShort(v)
            }));
        }

        svg.appendChild(svgEl('line', {
            class: 'axis-line', x1: m.left, y1: m.top + h, x2: m.left + w, y2: m.top + h
        }));

        // Eje horizontal: se rotulan como máximo 12 marcas para no saturar
        const salto = Math.max(1, Math.ceil(etiquetas.length / 12));
        etiquetas.forEach((etq, i) => {
            if (i % salto !== 0 && i !== etiquetas.length - 1) return;
            svg.appendChild(svgEl('text', {
                class: 'axis-text', x: px(i), y: alto - 12,
                'text-anchor': 'middle', text: etq
            }));
        });

        // Series
        series.forEach((serie) => {
            const puntos = serie.datos.map((valor, i) => `${px(i)},${py(valor)}`).join(' ');

            if (opts.area !== false && series.length === 1) {
                svg.appendChild(svgEl('polygon', {
                    points: `${m.left},${m.top + h} ${puntos} ${m.left + w},${m.top + h}`,
                    style: `fill:${serie.color};opacity:0.12`
                }));
            }

            svg.appendChild(svgEl('polyline', {
                class: 'series-line', points: puntos, style: `stroke:${serie.color}`
            }));
        });

        // Capa de interacción: una guía vertical y un tooltip por índice
        const guia = svgEl('line', { class: 'hover-guide', y1: m.top, y2: m.top + h, opacity: 0 });
        svg.appendChild(guia);

        const marcadores = series.map((serie) => {
            const c = svgEl('circle', { class: 'series-dot', r: 4.5, opacity: 0, style: `fill:${serie.color}` });
            svg.appendChild(c);
            return c;
        });

        const capa = svgEl('rect', {
            x: m.left, y: m.top, width: w, height: h, fill: 'transparent',
            style: 'cursor:crosshair'
        });

        const indiceDesdeEvento = (event) => {
            const caja = svg.getBoundingClientRect();
            const xRel = ((event.clientX - caja.left) / caja.width) * ancho;
            const prop = etiquetas.length === 1 ? 0 : (xRel - m.left) / w;
            return Math.max(0, Math.min(etiquetas.length - 1, Math.round(prop * (etiquetas.length - 1))));
        };

        const resaltar = (i) => {
            guia.setAttribute('x1', px(i));
            guia.setAttribute('x2', px(i));
            guia.setAttribute('opacity', '1');
            marcadores.forEach((marcador, k) => {
                marcador.setAttribute('cx', px(i));
                marcador.setAttribute('cy', py(series[k].datos[i]));
                marcador.setAttribute('opacity', '1');
            });
            const alturaMin = Math.min(...series.map((s) => py(s.datos[i])));
            mostrarTooltip(tooltip, px(i), alturaMin - 8, ancho, alto, etiquetas[i],
                series.map((s) => ({ etiqueta: s.nombre, valor: fmt(s.datos[i]), color: s.color })));
        };

        const limpiar = () => {
            guia.setAttribute('opacity', '0');
            marcadores.forEach((marcador) => marcador.setAttribute('opacity', '0'));
            ocultarTooltip(tooltip);
        };

        capa.addEventListener('mousemove', (event) => resaltar(indiceDesdeEvento(event)));
        capa.addEventListener('mouseleave', limpiar);
        capa.addEventListener('touchstart', (event) => {
            if (event.touches.length) resaltar(indiceDesdeEvento(event.touches[0]));
        }, { passive: true });
        capa.addEventListener('touchend', limpiar);
        svg.appendChild(capa);

        svg.appendChild(svgEl('title', {
            text: `${series.map((s) => s.nombre).join(' y ')} por periodo`
        }));

        return el('div', {}, [cont, leyenda(series.map((s) => ({ etiqueta: s.nombre, color: s.color })))]);
    };

    /* ============================================================
       Gráfico de barras horizontales (rankings)
       opts: { items:[{etiqueta, valor, detalle}], formato, alto }
       ============================================================ */

    const barras = (opts) => {
        const items = (opts.items || []).filter((it) => U.toNumber(it.valor) > 0);
        const fmt = opts.formato || U.money;

        if (items.length === 0) {
            return ERP.ui.estadoVacio('Sin datos para graficar',
                'No hay movimientos que cumplan los filtros aplicados.');
        }

        const filaAlto = 26;
        const m = { top: 8, right: 74, bottom: 8, left: 158 };
        const alto = m.top + m.bottom + items.length * filaAlto;
        const { cont, svg, tooltip, ancho } = crearLienzo(alto, 440);
        const w = ancho - m.left - m.right;

        const max = Math.max(...items.map((it) => U.toNumber(it.valor)));

        items.forEach((item, i) => {
            const y = m.top + i * filaAlto;
            const largo = max > 0 ? (U.toNumber(item.valor) / max) * w : 0;
            const c = item.color || color(i);

            svg.appendChild(svgEl('text', {
                class: 'axis-text', x: m.left - 8, y: y + filaAlto / 2 + 3,
                'text-anchor': 'end', text: U.truncate(item.etiqueta, 24)
            }));

            const barra = svgEl('rect', {
                class: 'bar', x: m.left, y: y + 5, width: Math.max(2, largo),
                height: filaAlto - 11, rx: 4, style: `fill:${c}`
            });

            barra.addEventListener('mousemove', () => {
                mostrarTooltip(tooltip, m.left + largo / 2, y + 2, ancho, alto, item.etiqueta, [
                    { etiqueta: opts.nombreSerie || 'Valor', valor: fmt(item.valor), color: c },
                    ...(item.detalle ? [{ etiqueta: item.detalle.etiqueta, valor: item.detalle.valor }] : [])
                ]);
            });
            barra.addEventListener('mouseleave', () => ocultarTooltip(tooltip));
            svg.appendChild(barra);

            svg.appendChild(svgEl('text', {
                class: 'bar-label',
                x: ancho - 6,
                y: y + filaAlto / 2 + 3,
                'text-anchor': 'end',
                text: U.moneyShort(item.valor)
            }));
        });

        return cont;
    };

    /* ============================================================
       Gráfico de dona (composición)
       opts: { items:[{etiqueta, valor}], formato, alto }
       ============================================================ */

    const dona = (opts) => {
        const items = (opts.items || []).filter((it) => U.toNumber(it.valor) > 0);
        const fmt = opts.formato || U.money;

        if (items.length === 0) {
            return ERP.ui.estadoVacio('Sin datos para graficar',
                'No hay valores positivos para representar.');
        }

        const alto = opts.alto || 270;
        const { cont, svg, tooltip, ancho } = crearLienzo(alto);
        const cx = ancho / 2;
        const cy = alto / 2;
        const radio = Math.min(cx, cy) - 18;
        const grosor = radio * 0.42;

        const total = U.sum(items, (it) => it.valor);
        let angulo = -Math.PI / 2;

        const punto = (r, a) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;

        items.forEach((item, i) => {
            const proporcion = U.toNumber(item.valor) / total;
            const barrido = proporcion * Math.PI * 2;
            const fin = angulo + barrido;
            const c = item.color || color(i);
            const arcoLargo = barrido > Math.PI ? 1 : 0;

            const d = [
                `M ${punto(radio, angulo)}`,
                `A ${radio} ${radio} 0 ${arcoLargo} 1 ${punto(radio, fin)}`,
                `L ${punto(radio - grosor, fin)}`,
                `A ${radio - grosor} ${radio - grosor} 0 ${arcoLargo} 0 ${punto(radio - grosor, angulo)}`,
                'Z'
            ].join(' ');

            const medio = angulo + barrido / 2;
            const sector = svgEl('path', { class: 'slice', d, style: `fill:${c}` });

            sector.addEventListener('mousemove', () => {
                mostrarTooltip(tooltip, cx + (radio - grosor / 2) * Math.cos(medio),
                    cy + (radio - grosor / 2) * Math.sin(medio), ancho, alto, item.etiqueta, [
                    { etiqueta: 'Valor', valor: fmt(item.valor), color: c },
                    { etiqueta: 'Participación', valor: U.pct(proporcion * 100) }
                ]);
            });
            sector.addEventListener('mouseleave', () => ocultarTooltip(tooltip));
            svg.appendChild(sector);

            angulo = fin;
        });

        svg.appendChild(svgEl('text', {
            x: cx, y: cy - 4, 'text-anchor': 'middle',
            style: 'fill:var(--text-muted);font-size:11px', text: opts.titulo || 'Total'
        }));
        svg.appendChild(svgEl('text', {
            x: cx, y: cy + 16, 'text-anchor': 'middle',
            style: 'fill:var(--text);font-size:16px;font-weight:700', text: fmt(total)
        }));

        return el('div', {}, [
            cont,
            leyenda(items.map((item, i) => ({
                etiqueta: `${U.truncate(item.etiqueta, 26)} — ${U.pct((U.toNumber(item.valor) / total) * 100)}`,
                color: item.color || color(i)
            })))
        ]);
    };

    /* ============================================================
       Gráfico de punto de equilibrio
       Cruza la recta de ingresos con la de costos totales.
       ============================================================ */

    const puntoEquilibrio = (opts) => {
        const costosFijos = U.toNumber(opts.costosFijos);
        const precio = U.toNumber(opts.precio);
        const costoVariable = U.toNumber(opts.costoVariable);
        const unidadesEq = U.toNumber(opts.unidadesEquilibrio);

        const maxUnidades = Math.max(10, Math.ceil((unidadesEq > 0 ? unidadesEq : 100) * 1.8));
        const alto = 320;
        const { cont, svg, tooltip, ancho } = crearLienzo(alto);
        const m = { top: 18, right: 18, bottom: 36, left: 70 };
        const w = ancho - m.left - m.right;
        const h = alto - m.top - m.bottom;

        const maxValor = Math.max(precio * maxUnidades, costosFijos + costoVariable * maxUnidades);
        const escala = escalaBonita(maxValor);

        const px = (u) => m.left + (u / maxUnidades) * w;
        const py = (v) => m.top + h - (v / escala.max) * h;

        for (let v = 0; v <= escala.max + 0.001; v += escala.paso) {
            svg.appendChild(svgEl('line', {
                class: 'grid-line', x1: m.left, y1: py(v), x2: m.left + w, y2: py(v)
            }));
            svg.appendChild(svgEl('text', {
                class: 'axis-text', x: m.left - 8, y: py(v) + 3,
                'text-anchor': 'end', text: U.moneyShort(v)
            }));
        }

        svg.appendChild(svgEl('line', {
            class: 'axis-line', x1: m.left, y1: m.top + h, x2: m.left + w, y2: m.top + h
        }));

        for (let k = 0; k <= 5; k += 1) {
            const u = Math.round((maxUnidades / 5) * k);
            svg.appendChild(svgEl('text', {
                class: 'axis-text', x: px(u), y: alto - 14,
                'text-anchor': 'middle', text: U.num(u)
            }));
        }

        svg.appendChild(svgEl('text', {
            class: 'axis-text', x: m.left + w / 2, y: alto - 1,
            'text-anchor': 'middle', text: 'Unidades vendidas'
        }));

        // Zona de pérdida / utilidad
        if (unidadesEq > 0 && unidadesEq < maxUnidades) {
            svg.appendChild(svgEl('rect', {
                x: m.left, y: m.top, width: px(unidadesEq) - m.left, height: h,
                style: 'fill:var(--danger);opacity:0.06'
            }));
            svg.appendChild(svgEl('rect', {
                x: px(unidadesEq), y: m.top, width: m.left + w - px(unidadesEq), height: h,
                style: 'fill:var(--success);opacity:0.07'
            }));
        }

        const lineaCostos = `${px(0)},${py(costosFijos)} ${px(maxUnidades)},${py(costosFijos + costoVariable * maxUnidades)}`;
        const lineaIngresos = `${px(0)},${py(0)} ${px(maxUnidades)},${py(precio * maxUnidades)}`;
        const lineaFijos = `${px(0)},${py(costosFijos)} ${px(maxUnidades)},${py(costosFijos)}`;

        svg.appendChild(svgEl('polyline', { class: 'series-line', points: lineaFijos, style: 'stroke:var(--c7);stroke-dasharray:5 4;stroke-width:1.6' }));
        svg.appendChild(svgEl('polyline', { class: 'series-line', points: lineaCostos, style: 'stroke:var(--c6)' }));
        svg.appendChild(svgEl('polyline', { class: 'series-line', points: lineaIngresos, style: 'stroke:var(--c2)' }));

        if (unidadesEq > 0 && unidadesEq <= maxUnidades) {
            const x = px(unidadesEq);
            const y = py(precio * unidadesEq);
            svg.appendChild(svgEl('line', {
                class: 'hover-guide', x1: x, y1: y, x2: x, y2: m.top + h
            }));
            svg.appendChild(svgEl('circle', {
                class: 'series-dot', cx: x, cy: y, r: 6, style: 'fill:var(--c1)'
            }));
            svg.appendChild(svgEl('text', {
                x: Math.min(x + 10, m.left + w - 120), y: Math.max(y - 12, m.top + 12),
                style: 'fill:var(--text);font-size:11px;font-weight:700',
                text: `Equilibrio: ${U.num(Math.ceil(unidadesEq))} unidades`
            }));
        }

        // Interacción: muestra ingresos, costos y utilidad en cada punto
        const capa = svgEl('rect', {
            x: m.left, y: m.top, width: w, height: h, fill: 'transparent', style: 'cursor:crosshair'
        });
        capa.addEventListener('mousemove', (event) => {
            const caja = svg.getBoundingClientRect();
            const xRel = ((event.clientX - caja.left) / caja.width) * ancho;
            const unidades = Math.max(0, Math.min(maxUnidades, ((xRel - m.left) / w) * maxUnidades));
            const ingresos = precio * unidades;
            const costos = costosFijos + costoVariable * unidades;
            mostrarTooltip(tooltip, px(unidades), py(Math.max(ingresos, costos)) - 8, ancho, alto,
                `${U.num(Math.round(unidades))} unidades`, [
                { etiqueta: 'Ingresos', valor: U.money(ingresos), color: 'var(--c2)' },
                { etiqueta: 'Costo total', valor: U.money(costos), color: 'var(--c6)' },
                { etiqueta: 'Resultado', valor: U.money(ingresos - costos) }
            ]);
        });
        capa.addEventListener('mouseleave', () => ocultarTooltip(tooltip));
        svg.appendChild(capa);

        return el('div', {}, [
            cont,
            leyenda([
                { etiqueta: 'Ingresos por ventas', color: 'var(--c2)' },
                { etiqueta: 'Costo total', color: 'var(--c6)' },
                { etiqueta: 'Costos fijos', color: 'var(--c7)' }
            ])
        ]);
    };

    /* ============================================================
       Barras agrupadas (presupuesto contra ejecución real)
       ============================================================ */

    const barrasComparadas = (opts) => {
        const items = opts.items || [];
        if (items.length === 0) {
            return ERP.ui.estadoVacio('Sin datos para comparar', 'Defina un presupuesto para el periodo.');
        }

        const fmt = opts.formato || U.money;
        const filaAlto = 40;
        const m = { top: 10, right: 16, bottom: 10, left: 160 };
        const alto = m.top + m.bottom + items.length * filaAlto;
        const { cont, svg, tooltip, ancho } = crearLienzo(alto, 560);
        const w = ancho - m.left - m.right;

        const max = Math.max(1, ...items.flatMap((it) => [U.toNumber(it.presupuesto), U.toNumber(it.real)]));

        items.forEach((item, i) => {
            const y = m.top + i * filaAlto;
            const anchoPre = (U.toNumber(item.presupuesto) / max) * w;
            const anchoReal = (U.toNumber(item.real) / max) * w;
            const excedido = U.toNumber(item.real) > U.toNumber(item.presupuesto);

            svg.appendChild(svgEl('text', {
                class: 'axis-text', x: m.left - 10, y: y + filaAlto / 2 + 3,
                'text-anchor': 'end', text: U.truncate(item.etiqueta, 26)
            }));

            const barraPre = svgEl('rect', {
                class: 'bar', x: m.left, y: y + 6, width: Math.max(2, anchoPre),
                height: 14, rx: 3, style: 'fill:var(--c7);opacity:0.45'
            });
            const barraReal = svgEl('rect', {
                class: 'bar', x: m.left, y: y + 24, width: Math.max(2, anchoReal),
                height: 14, rx: 3, style: `fill:${excedido ? 'var(--c6)' : 'var(--c2)'}`
            });

            const mostrar = () => mostrarTooltip(tooltip, m.left + Math.max(anchoPre, anchoReal) / 2,
                y, ancho, alto, item.etiqueta, [
                { etiqueta: 'Presupuesto', valor: fmt(item.presupuesto), color: 'var(--c7)' },
                { etiqueta: 'Ejecutado', valor: fmt(item.real), color: excedido ? 'var(--c6)' : 'var(--c2)' },
                { etiqueta: 'Desviación', valor: fmt(U.toNumber(item.real) - U.toNumber(item.presupuesto)) }
            ]);

            [barraPre, barraReal].forEach((barra) => {
                barra.addEventListener('mousemove', mostrar);
                barra.addEventListener('mouseleave', () => ocultarTooltip(tooltip));
                svg.appendChild(barra);
            });
        });

        return el('div', {}, [
            cont,
            leyenda([
                { etiqueta: 'Presupuesto', color: 'var(--c7)' },
                { etiqueta: 'Ejecutado dentro del presupuesto', color: 'var(--c2)' },
                { etiqueta: 'Ejecutado por encima del presupuesto', color: 'var(--c6)' }
            ])
        ]);
    };

    return { lineas, barras, dona, puntoEquilibrio, barrasComparadas, color, PALETA };
})();
