/* ============================================================
   pdf.js — Escritor de PDF nativo (sin librerías externas)
   Genera el archivo PDF byte a byte y lo entrega como descarga.
   Usa las fuentes base Helvetica con codificación WinAnsi, que
   cubre el español completo sin necesidad de incrustar fuentes.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.pdf = (() => {
    const U = ERP.util;

    /* ---------- Métricas de Helvetica (unidades por millar) ---------- */

    const anchoNormal = {
        ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
        '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
        ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
        A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
        K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
        U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
        '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
        a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
        k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
        u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
        '{': 334, '|': 260, '}': 334, '~': 584
    };

    const anchoNegrita = {
        ' ': 278, '!': 333, '"': 474, '#': 556, $: 556, '%': 889, '&': 722, "'": 238,
        '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
        ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611, '@': 975,
        A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
        K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
        U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
        '[': 333, '\\': 278, ']': 333, '^': 584, _: 556, '`': 333,
        a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
        k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
        u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
        '{': 389, '|': 280, '}': 389, '~': 584
    };

    const DIGITO = { normal: 556, negrita: 556 };

    const anchoTexto = (texto, tamano, negrita) => {
        const tabla = negrita ? anchoNegrita : anchoNormal;
        const porDefecto = negrita ? 611 : 556;
        let total = 0;
        const s = String(texto ?? '');
        for (let i = 0; i < s.length; i += 1) {
            const ch = s.charAt(i);
            if (ch >= '0' && ch <= '9') { total += DIGITO.normal; continue; }
            total += tabla[ch] !== undefined ? tabla[ch] : porDefecto;
        }
        return (total / 1000) * tamano;
    };

    /* ---------- Codificación ---------- */

    /** Convierte a bytes WinAnsi; lo que no existe en la tabla pasa a "?". */
    const aLatin1 = (texto) => {
        let salida = '';
        const s = String(texto ?? '');
        for (let i = 0; i < s.length; i += 1) {
            const code = s.charCodeAt(i);
            if (code < 256) {
                salida += s.charAt(i);
            } else if (code === 0x2019) {
                salida += "'";
            } else if (code === 0x2018) {
                salida += "'";
            } else if (code === 0x201C || code === 0x201D) {
                salida += '"';
            } else if (code === 0x2013 || code === 0x2014) {
                salida += '-';
            } else if (code === 0x2026) {
                salida += '...';
            } else {
                salida += '?';
            }
        }
        return salida;
    };

    const escapar = (texto) => aLatin1(texto)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

    const hexColor = (hex) => {
        const limpio = String(hex || '#000000').replace('#', '');
        const n = parseInt(limpio.length === 3
            ? limpio.split('').map((c) => c + c).join('')
            : limpio, 16);
        return [
            ((n >> 16) & 255) / 255,
            ((n >> 8) & 255) / 255,
            (n & 255) / 255
        ].map((v) => v.toFixed(3));
    };

    /* ============================================================
       Documento
       ============================================================ */

    const crearDocumento = (opts = {}) => {
        const ANCHO = 595.28;   // A4 vertical, en puntos
        const ALTO = 841.89;
        const margen = opts.margen || 40;

        const paginas = [];
        let ops = null;

        const nuevaPagina = () => {
            ops = [];
            paginas.push(ops);
            return ops;
        };

        nuevaPagina();

        /** El API expone Y desde el borde superior; el PDF cuenta desde abajo. */
        const invY = (y) => ALTO - y;

        const doc = {
            ANCHO, ALTO, margen,
            get anchoUtil() { return ANCHO - margen * 2; },
            get paginaActual() { return paginas.length; },

            nuevaPagina() {
                nuevaPagina();
                return doc;
            },

            texto(x, y, texto, cfg = {}) {
                const tamano = cfg.tamano || 10;
                const negrita = cfg.negrita === true;
                const contenido = String(texto ?? '');
                if (contenido === '') return doc;

                let xFinal = x;
                if (cfg.align === 'right') xFinal = x - anchoTexto(contenido, tamano, negrita);
                if (cfg.align === 'center') xFinal = x - anchoTexto(contenido, tamano, negrita) / 2;

                const [r, g, b] = hexColor(cfg.color || '#101828');
                ops.push(`BT ${r} ${g} ${b} rg /${negrita ? 'F2' : 'F1'} ${tamano} Tf`);
                ops.push(`1 0 0 1 ${xFinal.toFixed(2)} ${invY(y).toFixed(2)} Tm (${escapar(contenido)}) Tj ET`);
                return doc;
            },

            linea(x1, y1, x2, y2, cfg = {}) {
                const [r, g, b] = hexColor(cfg.color || '#c3ccdb');
                ops.push(`${r} ${g} ${b} RG ${(cfg.grosor || 0.7).toFixed(2)} w`);
                ops.push(`${x1.toFixed(2)} ${invY(y1).toFixed(2)} m ${x2.toFixed(2)} ${invY(y2).toFixed(2)} l S`);
                return doc;
            },

            rect(x, y, ancho, alto, cfg = {}) {
                const geo = `${x.toFixed(2)} ${invY(y + alto).toFixed(2)} ${ancho.toFixed(2)} ${alto.toFixed(2)} re`;
                if (cfg.relleno) {
                    const [r, g, b] = hexColor(cfg.relleno);
                    ops.push(`${r} ${g} ${b} rg ${geo} f`);
                }
                if (cfg.borde) {
                    const [r, g, b] = hexColor(cfg.borde);
                    ops.push(`${r} ${g} ${b} RG ${(cfg.grosor || 0.7).toFixed(2)} w ${geo} S`);
                }
                return doc;
            },

            /** Divide un texto para que quepa en un ancho dado. */
            dividir(texto, ancho, tamano = 10, negrita = false) {
                const palabras = String(texto ?? '').split(/\s+/).filter(Boolean);
                const lineas = [];
                let linea = '';
                palabras.forEach((palabra) => {
                    const prueba = linea ? `${linea} ${palabra}` : palabra;
                    if (anchoTexto(prueba, tamano, negrita) > ancho && linea) {
                        lineas.push(linea);
                        linea = palabra;
                    } else {
                        linea = prueba;
                    }
                });
                if (linea) lineas.push(linea);
                return lineas.length ? lineas : [''];
            },

            anchoTexto,

            /**
             * Tabla con salto de página automático.
             * columnas: [{ titulo, ancho, align, negrita }]
             * filas: [[celda, ...]]
             */
            tabla(cfg) {
                const columnas = cfg.columnas;
                const altoFila = cfg.altoFila || 17;
                const tamano = cfg.tamano || 9;
                const limite = cfg.limiteInferior || ALTO - 70;
                let y = cfg.y;

                const dibujarCabecera = () => {
                    doc.rect(margen, y - 12, doc.anchoUtil, altoFila, { relleno: cfg.colorCabecera || '#eef1f7' });
                    let x = margen;
                    columnas.forEach((col) => {
                        const posX = col.align === 'right' ? x + col.ancho - 6 : x + 6;
                        doc.texto(posX, y, col.titulo, {
                            tamano: tamano - 0.5, negrita: true, align: col.align, color: '#5b6779'
                        });
                        x += col.ancho;
                    });
                    y += altoFila;
                };

                dibujarCabecera();

                cfg.filas.forEach((fila) => {
                    if (y > limite) {
                        doc.nuevaPagina();
                        y = margen + 30;
                        if (typeof cfg.alSaltarPagina === 'function') cfg.alSaltarPagina(doc);
                        dibujarCabecera();
                    }

                    let x = margen;
                    columnas.forEach((col, i) => {
                        const celda = fila[i];
                        const valor = celda && typeof celda === 'object' ? celda.texto : celda;
                        const posX = col.align === 'right' ? x + col.ancho - 6 : x + 6;
                        doc.texto(posX, y, valor === undefined || valor === null ? '' : valor, {
                            tamano,
                            align: col.align,
                            negrita: (celda && celda.negrita) || col.negrita || false,
                            color: (celda && celda.color) || '#101828'
                        });
                        x += col.ancho;
                    });

                    doc.linea(margen, y + 4.5, ANCHO - margen, y + 4.5, { color: '#e4e8f0', grosor: 0.5 });
                    y += altoFila;
                });

                return y;
            },

            /** Numera las páginas al final: "Página i de n". */
            paginar(texto) {
                const total = paginas.length;
                paginas.forEach((pagOps, i) => {
                    const guardar = ops;
                    ops = pagOps;
                    doc.texto(ANCHO - margen, ALTO - 24,
                        `${texto ? `${texto} — ` : ''}Página ${i + 1} de ${total}`,
                        { tamano: 7.5, color: '#8a94a6', align: 'right' });
                    ops = guardar;
                });
                return doc;
            },

            /* ---------- Serialización ---------- */

            construir() {
                const nPaginas = paginas.length;
                const idFuenteNormal = 3 + nPaginas * 2;
                const idFuenteNegrita = idFuenteNormal + 1;

                const objetos = [];

                const kids = [];
                for (let i = 0; i < nPaginas; i += 1) kids.push(`${3 + i * 2} 0 R`);

                objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
                objetos[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPaginas} >>`;

                paginas.forEach((pagOps, i) => {
                    const idPagina = 3 + i * 2;
                    const idContenido = idPagina + 1;
                    const contenido = pagOps.join('\n');
                    objetos[idPagina] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] `
                        + `/Resources << /Font << /F1 ${idFuenteNormal} 0 R /F2 ${idFuenteNegrita} 0 R >> >> `
                        + `/Contents ${idContenido} 0 R >>`;
                    objetos[idContenido] = `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`;
                });

                objetos[idFuenteNormal] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
                objetos[idFuenteNegrita] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

                let salida = '%PDF-1.4\n%âãÏÓ\n';
                const offsets = [];

                for (let id = 1; id < objetos.length; id += 1) {
                    offsets[id] = salida.length;
                    salida += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
                }

                const inicioXref = salida.length;
                const total = objetos.length;
                salida += `xref\n0 ${total}\n0000000000 65535 f \n`;
                for (let id = 1; id < total; id += 1) {
                    salida += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
                }
                salida += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;

                // Cada carácter es un byte: el documento se escribe en Latin-1.
                const bytes = new Uint8Array(salida.length);
                for (let i = 0; i < salida.length; i += 1) bytes[i] = salida.charCodeAt(i) & 0xff;
                return bytes;
            },

            guardar(nombreArchivo) {
                const bytes = doc.construir();
                U.downloadBlob(new Blob([bytes], { type: 'application/pdf' }), nombreArchivo);
                return doc;
            }
        };

        return doc;
    };

    /* ============================================================
       Encabezado corporativo reutilizable
       ============================================================ */

    const encabezadoEmpresa = (doc, cfg, y = 46) => {
        doc.rect(doc.margen, y - 26, 4, 44, { relleno: '#2f5bdc' });
        doc.texto(doc.margen + 14, y - 8, cfg.empresa, { tamano: 15, negrita: true });
        doc.texto(doc.margen + 14, y + 6, `NIT ${cfg.nit}`, { tamano: 8.5, color: '#5b6779' });
        doc.texto(doc.margen + 14, y + 17, `${cfg.direccion} — ${cfg.ciudad}`, { tamano: 8.5, color: '#5b6779' });
        doc.texto(doc.margen + 14, y + 28, `Tel. ${cfg.telefono} — ${cfg.email}`, { tamano: 8.5, color: '#5b6779' });
        return y + 48;
    };

    /* ============================================================
       Factura de venta
       ============================================================ */

    const facturaVenta = (venta) => {
        const cfg = ERP.db.config();
        const cliente = ERP.db.terceroPorId(venta.clienteId);
        const abonos = ERP.db.abonosDeVenta(venta.id);
        const estado = ERP.db.estadoVenta(venta);
        const doc = crearDocumento();

        let y = encabezadoEmpresa(doc, cfg);

        // Recuadro del documento
        const anchoCaja = 190;
        const xCaja = doc.ANCHO - doc.margen - anchoCaja;
        doc.rect(xCaja, 24, anchoCaja, 74, { relleno: '#f7f9fc', borde: '#dde3ed' });
        doc.texto(xCaja + anchoCaja / 2, 42, 'FACTURA DE VENTA', { tamano: 11, negrita: true, align: 'center' });
        doc.texto(xCaja + 12, 58, 'Número', { tamano: 8, color: '#5b6779' });
        doc.texto(xCaja + anchoCaja - 12, 58, venta.numero, { tamano: 9.5, negrita: true, align: 'right' });
        doc.texto(xCaja + 12, 72, 'Fecha de emisión', { tamano: 8, color: '#5b6779' });
        doc.texto(xCaja + anchoCaja - 12, 72, U.fmtDate(venta.fecha), { tamano: 9, align: 'right' });
        doc.texto(xCaja + 12, 86, venta.condicion === 'credito' ? 'Vence' : 'Condición', { tamano: 8, color: '#5b6779' });
        doc.texto(xCaja + anchoCaja - 12, 86,
            venta.condicion === 'credito' ? U.fmtDate(venta.fechaVencimiento) : 'Contado',
            { tamano: 9, align: 'right' });

        y = Math.max(y, 118);

        // Datos del cliente
        doc.rect(doc.margen, y - 12, doc.anchoUtil, 62, { relleno: '#f7f9fc', borde: '#dde3ed' });
        doc.texto(doc.margen + 12, y + 2, 'CLIENTE', { tamano: 8, negrita: true, color: '#5b6779' });
        doc.texto(doc.margen + 12, y + 17, cliente ? cliente.nombre : 'Cliente eliminado', { tamano: 11, negrita: true });
        doc.texto(doc.margen + 12, y + 30, cliente ? `${cliente.tipoDoc} ${cliente.documento}` : '', { tamano: 8.5, color: '#5b6779' });
        doc.texto(doc.margen + 12, y + 41, cliente ? cliente.direccion : '', { tamano: 8.5, color: '#5b6779' });
        doc.texto(doc.ANCHO - doc.margen - 12, y + 30, cliente ? `Tel. ${cliente.telefono}` : '', { tamano: 8.5, color: '#5b6779', align: 'right' });
        doc.texto(doc.ANCHO - doc.margen - 12, y + 41, cliente ? cliente.email : '', { tamano: 8.5, color: '#5b6779', align: 'right' });

        y += 74;

        // Detalle de ítems
        const util = doc.anchoUtil;
        const columnas = [
            { titulo: 'CÓDIGO', ancho: util * 0.13 },
            { titulo: 'DESCRIPCIÓN', ancho: util * 0.37 },
            { titulo: 'CANT.', ancho: util * 0.09, align: 'right' },
            { titulo: 'V. UNITARIO', ancho: util * 0.15, align: 'right' },
            { titulo: 'DTO.', ancho: util * 0.08, align: 'right' },
            { titulo: 'TOTAL', ancho: util * 0.18, align: 'right' }
        ];

        const filas = venta.items.map((item) => {
            const producto = ERP.db.productoPorId(item.productoId);
            const bruto = item.cantidad * item.valorUnitario;
            const neto = bruto - bruto * (U.toNumber(item.descuentoPct) / 100);
            return [
                producto ? producto.sku : '—',
                U.truncate(producto ? producto.nombre : 'Producto eliminado', 44),
                U.num(item.cantidad, 0),
                U.money(item.valorUnitario),
                item.descuentoPct ? `${U.num(item.descuentoPct)} %` : '—',
                { texto: U.money(neto), negrita: true }
            ];
        });

        y = doc.tabla({ y, columnas, filas, limiteInferior: doc.ALTO - 190 });

        // Totales
        y += 12;
        const xTot = doc.ANCHO - doc.margen;
        const xEtq = xTot - 190;

        const lineaTotal = (etiqueta, valor, opts = {}) => {
            doc.texto(xEtq, y, etiqueta, { tamano: opts.grande ? 10.5 : 9, color: opts.grande ? '#101828' : '#5b6779', negrita: opts.grande });
            doc.texto(xTot, y, valor, { tamano: opts.grande ? 12 : 9.5, align: 'right', negrita: true });
            y += opts.grande ? 20 : 15;
        };

        lineaTotal('Subtotal', U.money(venta.subtotal));
        lineaTotal(`IVA (${U.num(ERP.db.config().ivaPct)} %)`, U.money(venta.iva));
        doc.linea(xEtq, y - 6, xTot, y - 6, { color: '#c3ccdb', grosor: 1 });
        lineaTotal('TOTAL A PAGAR', U.money(venta.total), { grande: true });

        // Estado de pago
        const totalAbonado = U.sum(abonos, (a) => a.valor);
        doc.rect(doc.margen, y - 14, util * 0.5, 54, { relleno: '#f7f9fc', borde: '#dde3ed' });
        doc.texto(doc.margen + 12, y, 'ESTADO DE PAGO', { tamano: 8, negrita: true, color: '#5b6779' });
        doc.texto(doc.margen + 12, y + 15, estado.texto.toUpperCase(), {
            tamano: 11, negrita: true,
            color: estado.tono === 'success' ? '#0f8a52' : estado.tono === 'danger' ? '#c92c3d' : '#b7791f'
        });
        doc.texto(doc.margen + 12, y + 30,
            `Abonado: ${U.money(totalAbonado)}   ·   Saldo: ${U.money(venta.saldo)}`,
            { tamano: 8.5, color: '#5b6779' });

        y += 58;

        if (abonos.length > 0) {
            doc.texto(doc.margen, y, 'Abonos registrados', { tamano: 9, negrita: true });
            y += 14;
            y = doc.tabla({
                y,
                tamano: 8.5,
                altoFila: 15,
                columnas: [
                    { titulo: 'FECHA', ancho: util * 0.25 },
                    { titulo: 'MEDIO DE PAGO', ancho: util * 0.45 },
                    { titulo: 'VALOR', ancho: util * 0.30, align: 'right' }
                ],
                filas: U.sortBy(abonos, 'fecha').map((a) => [U.fmtDate(a.fecha), a.medio, U.money(a.valor)])
            });
        }

        if (venta.observaciones) {
            y += 10;
            doc.texto(doc.margen, y, 'Observaciones', { tamano: 8, negrita: true, color: '#5b6779' });
            y += 12;
            doc.dividir(venta.observaciones, util, 8.5).forEach((linea) => {
                doc.texto(doc.margen, y, linea, { tamano: 8.5, color: '#5b6779' });
                y += 11;
            });
        }

        // Pie legal
        doc.linea(doc.margen, doc.ALTO - 52, doc.ANCHO - doc.margen, doc.ALTO - 52, { color: '#dde3ed' });
        doc.texto(doc.margen, doc.ALTO - 38,
            'Documento generado electrónicamente por el sistema de gestión financiera. Vale como soporte contable interno.',
            { tamano: 7.5, color: '#8a94a6' });
        doc.texto(doc.margen, doc.ALTO - 28,
            venta.anulada ? 'FACTURA ANULADA' : `Vendedor: ${venta.vendedor || 'No registrado'}`,
            { tamano: 7.5, color: venta.anulada ? '#c92c3d' : '#8a94a6', negrita: venta.anulada });

        doc.paginar(venta.numero);
        doc.guardar(`${venta.numero}-${(cliente ? cliente.nombre : 'cliente').replace(/[^\w]+/g, '_').slice(0, 24)}.pdf`);
        return doc;
    };

    /* ============================================================
       Reporte tabular genérico (estados financieros, amortización…)
       ============================================================ */

    const reporteTabla = (cfg) => {
        const config = ERP.db.config();
        const doc = crearDocumento();
        let y = encabezadoEmpresa(doc, config);

        doc.texto(doc.ANCHO - doc.margen, 40, cfg.titulo, { tamano: 13, negrita: true, align: 'right' });
        if (cfg.subtitulo) {
            doc.texto(doc.ANCHO - doc.margen, 55, cfg.subtitulo, { tamano: 8.5, color: '#5b6779', align: 'right' });
        }
        doc.texto(doc.ANCHO - doc.margen, 68, `Generado el ${U.fmtDateLong(U.today())}`,
            { tamano: 8, color: '#8a94a6', align: 'right' });

        y = Math.max(y, 112);

        if (cfg.resumen && cfg.resumen.length) {
            const anchoTarjeta = doc.anchoUtil / cfg.resumen.length;
            doc.rect(doc.margen, y - 14, doc.anchoUtil, 44, { relleno: '#f7f9fc', borde: '#dde3ed' });
            cfg.resumen.forEach((item, i) => {
                const x = doc.margen + anchoTarjeta * i + 12;
                doc.texto(x, y, item.etiqueta, { tamano: 7.5, color: '#5b6779' });
                doc.texto(x, y + 16, item.valor, { tamano: 11, negrita: true });
            });
            y += 54;
        }

        y = doc.tabla({
            y,
            columnas: cfg.columnas,
            filas: cfg.filas,
            tamano: cfg.tamano || 8.5,
            altoFila: cfg.altoFila || 16,
            alSaltarPagina: (d) => {
                d.texto(d.margen, 34, cfg.titulo, { tamano: 9, negrita: true, color: '#5b6779' });
            }
        });

        if (cfg.nota) {
            y += 14;
            doc.dividir(cfg.nota, doc.anchoUtil, 8).forEach((linea) => {
                doc.texto(doc.margen, y, linea, { tamano: 8, color: '#8a94a6' });
                y += 11;
            });
        }

        doc.paginar(config.empresa);
        doc.guardar(cfg.archivo || 'reporte.pdf');
        return doc;
    };

    return { crearDocumento, facturaVenta, reporteTabla, encabezadoEmpresa, anchoTexto };
})();
