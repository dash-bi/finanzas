/* ============================================================
   importer.js — Carga de facturas en PDF
   1. Lee el texto del PDF en el navegador (pdfreader.js).
   2. Interpreta la factura: tipo de documento, número, fechas,
      tercero, totales, CUFE e ítems.
   3. Abre el formulario del módulo correspondiente prellenado.
   Nada se registra sin la confirmación del usuario: leer una
   factura es probabilístico y un error contaminaría inventario,
   cartera y estados financieros (Agents.md, sección 16).
   ============================================================ */

window.ERP = window.ERP || {};

ERP.importador = (() => {
    const U = ERP.util;
    const { el } = U;
    const ui = ERP.ui;
    const db = ERP.db;

    const TIPOS = {
        compra: { etiqueta: 'Compra', modulo: 'compras', tercero: 'proveedor' },
        gasto: { etiqueta: 'Gasto', modulo: 'gastos', tercero: 'proveedor' },
        venta: { etiqueta: 'Venta', modulo: 'ventas', tercero: 'cliente' }
    };

    const LIMITE_ARCHIVO = 15 * 1024 * 1024;

    /* ============================================================
       Lectura de números y fechas
       ============================================================ */

    /** Interpreta montos colombianos e internacionales: 1.234.567 · 1.234.567,89 · 1,234,567.89 */
    const parsearNumero = (texto) => {
        let s = String(texto || '').replace(/\s/g, '').replace(/COP/gi, '').replace(/\$/g, '').replace(/%$/, '');
        const negativo = /^-/.test(s) || /^\(.*\)$/.test(s);
        s = s.replace(/[-()]/g, '');
        if (!/\d/.test(s) || /[^\d.,]/.test(s)) return null;

        const punto = s.lastIndexOf('.');
        const coma = s.lastIndexOf(',');
        let entero = s;
        let decimal = '';

        if (punto >= 0 && coma >= 0) {
            const separador = Math.max(punto, coma);
            entero = s.slice(0, separador).replace(/[.,]/g, '');
            decimal = s.slice(separador + 1);
        } else if (punto >= 0 || coma >= 0) {
            const caracter = punto >= 0 ? '.' : ',';
            const partes = s.split(caracter);
            // Varios separadores, o grupo final de tres dígitos: separador de miles.
            if (partes.length > 2 || partes[partes.length - 1].length === 3) {
                entero = partes.join('');
            } else {
                entero = partes[0];
                decimal = partes[1] || '';
            }
        }

        const valor = Number(decimal ? `${entero}.${decimal}` : entero);
        if (!Number.isFinite(valor)) return null;
        return negativo ? -valor : valor;
    };

    const RE_MONTO = /\(?-?\$?\s?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\)?|\(?-?\$?\s?\d+(?:[.,]\d{1,2})?\)?/g;

    /** Montos de una línea, sin porcentajes. */
    const montosDe = (linea) => [...String(linea).matchAll(RE_MONTO)]
        .filter((m) => String(linea).charAt(m.index + m[0].length) !== '%')
        .map((m) => parsearNumero(m[0]))
        .filter((n) => n !== null);

    const MESES = {
        ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5,
        jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9,
        oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12
    };

    const armarFecha = (anio, mes, dia) => {
        let y = Number(anio);
        if (y < 100) y += 2000;
        const iso = `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const d = U.parseISO(iso);
        if (!d || y < 2000 || y > 2100 || d.getMonth() + 1 !== Number(mes) || d.getDate() !== Number(dia)) return '';
        return iso;
    };

    /** Primera fecha legible de un texto, o cadena vacía. */
    const parsearFecha = (texto) => {
        const s = U.normalize(texto);
        let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
        if (m) {
            const f = armarFecha(m[1], m[2], m[3]);
            if (f) return f;
        }
        m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
        if (m) {
            const a = Number(m[1]);
            const b = Number(m[2]);
            // Formato colombiano día/mes; si el primer número no puede ser día… se invierte.
            const f = a > 12 || b <= 12 ? armarFecha(m[3], b, a) : armarFecha(m[3], a, b);
            if (f) return f;
        }
        m = /(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?\s*(?:de|del)?\s*(\d{4})/.exec(s);
        if (m && MESES[m[2]]) {
            const f = armarFecha(m[3], MESES[m[2]], m[1]);
            if (f) return f;
        }
        return '';
    };

    /* ============================================================
       Utilidades de texto
       ============================================================ */

    const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

    const palabras = (s) => U.normalize(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
        .filter((t) => t.length >= 3 || /\d/.test(t));

    /** Similitud de Dice entre dos textos (0 a 1). */
    const similitud = (a, b) => {
        const A = new Set(palabras(a));
        const B = new Set(palabras(b));
        if (!A.size || !B.size) return 0;
        let comunes = 0;
        A.forEach((t) => { if (B.has(t)) comunes += 1; });
        return (2 * comunes) / (A.size + B.size);
    };

    // El lector separa las columnas de la página con dos espacios: el nombre
    // es la primera columna, no la línea completa.
    const limpiarNombre = (texto) => String(texto || '')
        .split(/\s{2,}/)[0]
        .replace(/\b(?:nit|n\.i\.t\.?|c\.?c\.?)\b.*$/i, '')
        .replace(/^(?:razon social|razón social|nombre|señor(?:es)?|senor(?:es)?|cliente|adquiriente|adquirente|proveedor|emisor)\s*[:.-]?\s*/i, '')
        .replace(/[:;|·]+\s*$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const RE_SOCIEDAD = /\b(s\.?\s?a\.?\s?s\.?|ltda\.?|s\.?\s?a\.?|e\.?\s?s\.?\s?p\.?|s\.?\s?c\.?\s?a\.?|sas|limitada)\b/i;

    /* ============================================================
       Interpretación de la factura
       ============================================================ */

    const buscarDocumentos = (lineas) => {
        const hallados = [];
        const vistos = new Set();
        lineas.forEach((linea, indice) => {
            const patrones = [
                /\b(?:nit|n\.i\.t\.?)\s*(?:no\.?|n[°º]|:)?\s*[:.]?\s*(\d[\d.\s]{5,14}\d)\s*(?:-\s*(\d))?/gi,
                /\b(\d{3}\.?\d{3}\.?\d{3})\s*-\s*(\d)\b/g,
                /\b(?:c\.?\s?c\.?|cedula(?:\s+de\s+ciudadania)?|cédula(?:\s+de\s+ciudadanía)?)\s*(?:no\.?|:)?\s*[:.]?\s*(\d[\d.]{5,12}\d)/gi
            ];
            patrones.forEach((re, k) => {
                for (const m of linea.matchAll(re)) {
                    const digitos = soloDigitos(m[1]);
                    if (digitos.length < 6 || digitos.length > 12 || vistos.has(digitos)) continue;
                    vistos.add(digitos);
                    hallados.push({
                        digitos,
                        dv: m[2] || '',
                        tipoDoc: k === 2 ? 'CC' : 'NIT',
                        documento: `${m[1].replace(/\s/g, '')}${m[2] ? `-${m[2]}` : ''}`,
                        indice
                    });
                }
            });
        });
        return hallados;
    };

    const mismoDocumento = (a, b) => {
        const x = soloDigitos(a);
        const y = soloDigitos(b);
        if (!x || !y) return false;
        return x === y || x.slice(0, -1) === y || x === y.slice(0, -1);
    };

    const nombreCerca = (lineas, indice, etiquetaRe) => {
        // 1) Etiqueta explícita en las líneas cercanas.
        for (let i = Math.max(0, indice - 3); i <= Math.min(lineas.length - 1, indice + 3); i += 1) {
            const m = etiquetaRe.exec(U.normalize(lineas[i]));
            if (m) {
                const valor = limpiarNombre(lineas[i].slice(m.index + m[0].length));
                if (valor.length >= 3 && /[a-z]/i.test(valor)) return valor;
            }
        }
        // 2) La misma línea del documento, sin el documento.
        const mismaLinea = limpiarNombre(lineas[indice]);
        if (mismaLinea.length >= 4 && /[a-z]{3}/i.test(mismaLinea) && !/factura|fecha|telefono|direccion/i.test(U.normalize(mismaLinea))) return mismaLinea;
        // 3) La línea anterior (el nombre suele ir encima del NIT).
        if (indice > 0) {
            const anterior = limpiarNombre(lineas[indice - 1]);
            if (anterior.length >= 4 && /[a-z]{3}/i.test(anterior) && !/factura|fecha|telefono|direccion|regimen/i.test(U.normalize(anterior))) return anterior;
        }
        return '';
    };

    const leerNumeroFactura = (lineas) => {
        const patrones = [
            /factura\s+(?:electronica\s+)?(?:de\s+venta\s+)?(?:no\.?|nro\.?|numero|n[°º]|#)\s*[:.]?\s*([a-z]{0,6}\s?-?\s?\d{1,12})/,
            /(?:no\.?|nro\.?|numero|n[°º])\s*(?:de\s+)?factura\s*[:.]?\s*([a-z]{0,6}\s?-?\s?\d{1,12})/,
            /factura\s*[:#]\s*([a-z]{0,6}\s?-?\s?\d{1,12})/,
            /\b((?:fe|fv|fc|fac|sett|seti|fes|fvc|fve)\s?-?\s?\d{2,12})\b/
        ];
        for (const re of patrones) {
            for (const linea of lineas) {
                const m = re.exec(U.normalize(linea));
                if (m) return m[1].replace(/\s+/g, ' ').trim().toUpperCase();
            }
        }
        return '';
    };

    const leerFechaEtiquetada = (lineas, etiquetaRe) => {
        for (let i = 0; i < lineas.length; i += 1) {
            const normal = U.normalize(lineas[i]);
            const m = etiquetaRe.exec(normal);
            if (!m) continue;
            const despues = lineas[i].slice(m.index);
            const fecha = parsearFecha(despues) || (lineas[i + 1] ? parsearFecha(lineas[i + 1]) : '');
            if (fecha) return fecha;
        }
        return '';
    };

    /** Monto asociado a una etiqueta: el último de la línea, o el de la línea siguiente. */
    const leerMonto = (lineas, etiquetas, excluir) => {
        for (const etiqueta of etiquetas) {
            for (let i = lineas.length - 1; i >= 0; i -= 1) {
                const normal = U.normalize(lineas[i]);
                if (!etiqueta.test(normal)) continue;
                if (excluir && excluir.test(normal)) continue;
                let montos = montosDe(lineas[i]).filter((n) => Math.abs(n) >= 1);
                if (!montos.length && lineas[i + 1]) montos = montosDe(lineas[i + 1]).filter((n) => Math.abs(n) >= 1);
                if (montos.length) return Math.abs(montos[montos.length - 1]);
            }
        }
        return 0;
    };

    const ETIQUETAS_NO_ITEM = /\b(sub\s*total|total|iva|impuesto|descuento|retencion|rete|base gravable|pagina|cufe|cude|nit|fecha|resolucion|autorizacion|telefono|direccion|cantidad|descripcion|valor unitario|forma de pago|vencimiento|saldo|abono|cambio|efectivo)\b/;
    const UNIDADES = /^(und|un|u|unid|unidad|unidades|kg|kgs|lt|lts|litro|caja|cj|cjs|pqt|paq|paquete|kit|hr|hrs|hora|horas|serv|servicio|m|mt|mts|metro|resma|rsm|gl|galon|par|doc|docena|rollo|bolsa)$/i;

    const esCeldaNumerica = (celda) => /^\(?-?\$?\s?[\d.,]+\)?%?$/.test(celda) && /\d/.test(celda);

    /** Intenta leer una línea de detalle: descripción, cantidad, valor unitario y total. */
    const leerItem = (linea, ivaPct) => {
        const normal = U.normalize(linea);
        if (ETIQUETAS_NO_ITEM.test(normal)) return null;

        let celdas = linea.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
        if (celdas.length < 3) celdas = linea.split(/\s+/).filter(Boolean);

        // Celdas como "4 UND" o "$ 470.000" se separan en sus partes.
        celdas = celdas.flatMap((celda) => {
            const partes = celda.split(/\s+/);
            return partes.length > 1 && partes.every((p) => esCeldaNumerica(p) || UNIDADES.test(p) || p === '$')
                ? partes
                : [celda];
        });

        // Une "$" suelto con el número siguiente.
        celdas = celdas.reduce((acc, c) => {
            if (acc.length && acc[acc.length - 1] === '$') acc[acc.length - 1] = `$${c}`;
            else acc.push(c);
            return acc;
        }, []);

        const numericas = [];
        let i = celdas.length - 1;
        while (i >= 0) {
            const celda = celdas[i];
            if (esCeldaNumerica(celda)) {
                numericas.unshift({ valor: parsearNumero(celda), pct: /%$/.test(celda) });
                i -= 1;
            } else if (UNIDADES.test(celda) && numericas.length) {
                i -= 1;
            } else {
                break;
            }
        }

        const izquierda = celdas.slice(0, i + 1);
        const montos = numericas.filter((n) => !n.pct && n.valor !== null);
        const porcentajes = numericas.filter((n) => n.pct && n.valor !== null).map((n) => n.valor);
        if (!izquierda.length || montos.length < 2) return null;

        const total = montos[montos.length - 1].valor;
        if (!(total > 0)) return null;

        let codigo = '';
        let partesDescripcion = izquierda;
        if (izquierda.length > 1 && /^[a-z0-9][a-z0-9\-_./]{2,}$/i.test(izquierda[0]) && /\d/.test(izquierda[0])) {
            codigo = izquierda[0];
            partesDescripcion = izquierda.slice(1);
        }
        const descripcion = partesDescripcion.join(' ').trim();
        if (descripcion.length < 3 || !/[a-z]{2}/i.test(descripcion)) return null;

        const cercano = (a, b) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.015);
        const candidatos = montos.slice(0, -1).map((m) => m.valor);
        const descuentosPosibles = [0, ...porcentajes.filter((p) => p > 0 && p < 100 && p !== ivaPct)];

        const probar = (cantidad, unitario) => {
            if (!(cantidad > 0) || !(unitario > 0)) return null;
            for (const descuento of descuentosPosibles) {
                const neto = cantidad * unitario * (1 - descuento / 100);
                if (cercano(neto, total)) return { cantidad, valorUnitario: unitario, descuentoPct: descuento };
                if (cercano(neto * (1 + ivaPct / 100), total)) return { cantidad, valorUnitario: unitario, descuentoPct: descuento };
            }
            return null;
        };

        // Todas las parejas cantidad × valor unitario, prefiriendo cantidades enteras y pequeñas.
        const pares = [];
        for (let a = 0; a < candidatos.length; a += 1) {
            for (let b = 0; b < candidatos.length; b += 1) {
                if (a !== b) pares.push([candidatos[a], candidatos[b]]);
            }
        }
        pares.sort((x, y) => (Number(Number.isInteger(y[0])) - Number(Number.isInteger(x[0]))) || (x[0] - y[0]));
        for (const [cantidad, unitario] of pares) {
            const r = probar(cantidad, unitario);
            if (r) return { codigo, descripcion, ...r, total };
        }

        // Cantidad y total sin valor unitario explícito.
        if (candidatos.length === 1 && Number.isInteger(candidatos[0]) && candidatos[0] > 0 && candidatos[0] <= 1000) {
            return { codigo, descripcion, cantidad: candidatos[0], valorUnitario: Math.round(total / candidatos[0]), descuentoPct: 0, total };
        }
        return null;
    };

    const CATEGORIAS = [
        ['Servicios públicos', /energia|acueducto|alcantarillado|gas natural|internet|telefon|celular|fibra|banda ancha|e\.?s\.?p\b|servicios publicos/],
        ['Arrendamiento', /arrendamiento|arriendo|canon|alquiler/],
        ['Honorarios', /honorario|asesoria|consultoria|servicios profesionales|revisoria/],
        ['Transporte y fletes', /transporte|flete|envio|mensajeria|domicilio|courier|encomienda/],
        ['Publicidad y mercadeo', /publicidad|marketing|mercadeo|pauta|anuncio/],
        ['Papelería y aseo', /papeleria|aseo|cafeteria|utiles de oficina/],
        ['Mantenimiento', /mantenimiento|reparacion|repuesto/],
        ['Seguros', /seguro|poliza|aseguradora/],
        ['Impuestos y tasas', /impuesto predial|industria y comercio|\bica\b|contribucion/],
        ['Gastos bancarios', /comision bancaria|cuota de manejo|gravamen|4 por mil/]
    ];

    const adivinarCategoria = (texto) => {
        const normal = U.normalize(texto);
        const hallada = CATEGORIAS.find(([, re]) => re.test(normal));
        return hallada ? hallada[0] : 'Otros gastos';
    };

    /**
     * Interpreta las líneas de texto de una factura.
     * No consulta la base de datos salvo para conocer el NIT de la empresa.
     */
    const analizar = (lineas, tipoPreferido) => {
        const texto = lineas.join('\n');
        const normal = U.normalize(texto);
        const ivaPct = U.toNumber(db.config().ivaPct);
        const nitEmpresa = db.config().nit;
        const avisos = [];

        const datos = {
            numero: leerNumeroFactura(lineas),
            fecha: leerFechaEtiquetada(lineas, /fecha\s*(?:y\s+hora\s+)?(?:de\s+)?(?:emision|expedicion|factura|generacion|elaboracion)|^fecha\b/),
            vencimiento: leerFechaEtiquetada(lineas, /vencimiento|fecha\s+(?:limite\s+)?(?:de\s+)?pago|pagar\s+antes/),
            cufe: '',
            subtotal: 0,
            iva: 0,
            total: 0,
            condicion: '',
            diasCredito: 0,
            emisor: null,
            adquiriente: null,
            totalesConsistentes: false,
            totalesEstimados: false
        };

        if (!datos.fecha) {
            for (const linea of lineas) {
                const f = parsearFecha(linea);
                if (f) { datos.fecha = f; break; }
            }
        }

        const compacto = texto.replace(/\s+/g, '');
        const cufe = /cu[fd]e:?([0-9a-f]{96})/i.exec(compacto) || /(?:^|[^0-9a-f])([0-9a-f]{96})(?:[^0-9a-f]|$)/i.exec(compacto);
        if (cufe) datos.cufe = cufe[1].toLowerCase();

        /* --- Condición de pago --- */
        const lineaPago = lineas.find((l) => /forma\s+de\s+pago|medio\s+de\s+pago|condicion(?:es)?\s+de\s+pago|plazo/.test(U.normalize(l)));
        if (lineaPago) {
            const n = U.normalize(lineaPago);
            if (/credito|a\s+\d+\s+dias|plazo/.test(n)) datos.condicion = 'credito';
            else if (/contado|efectivo|inmediato/.test(n)) datos.condicion = 'contado';
            const dias = /(\d{1,3})\s*dias/.exec(n);
            if (dias) datos.diasCredito = Number(dias[1]);
        }
        if (datos.fecha && datos.vencimiento && datos.vencimiento > datos.fecha) {
            const dias = U.daysBetween(datos.fecha, datos.vencimiento);
            if (!datos.diasCredito) datos.diasCredito = dias;
            if (!datos.condicion && dias > 3) datos.condicion = 'credito';
        }
        if (!datos.condicion) datos.condicion = 'contado';

        /* --- Totales --- */
        datos.total = leerMonto(lineas,
            [/total\s+a\s+pagar/, /neto\s+a\s+pagar/, /valor\s+total\s+(?:a\s+pagar|factura)/, /total\s+factura/, /gran\s+total/, /valor\s+total/, /\btotal\b/],
            /sub\s*-?\s*total|total\s+(?:iva|impuesto|descuento|items|unidades|bruto|retencion)|base/);
        datos.subtotal = leerMonto(lineas,
            [/sub\s*-?\s*total/, /total\s+bruto/, /base\s+gravable/, /valor\s+antes\s+de\s+iva/, /total\s+sin\s+iva/],
            /total\s+a\s+pagar/);
        datos.iva = leerMonto(lineas,
            [/\biva\b/, /impuesto\s+(?:al\s+valor|sobre\s+las\s+ventas)/, /total\s+impuestos?/],
            /base|retencion|reteiva|excluido|exento|sub\s*-?\s*total|total\s+a\s+pagar/);

        if (datos.total && datos.subtotal && datos.iva) {
            datos.totalesConsistentes = Math.abs(datos.subtotal + datos.iva - datos.total) <= Math.max(2, datos.total * 0.005);
            if (!datos.totalesConsistentes) avisos.push('El subtotal más el IVA no da el total leído: puede haber retenciones u otros cargos.');
        } else if (datos.total && datos.iva && !datos.subtotal) {
            datos.subtotal = datos.total - datos.iva;
            datos.totalesEstimados = true;
        } else if (datos.total && datos.subtotal && !datos.iva) {
            datos.iva = Math.max(0, datos.total - datos.subtotal);
            datos.totalesEstimados = true;
        }
        if (!datos.total) avisos.push('No se encontró el total de la factura.');

        /* --- Terceros y dirección del documento --- */
        const documentos = buscarDocumentos(lineas);
        const lineaAdquiriente = lineas.findIndex((l) => /adquiriente|adquirente|\bcliente\b|senor(?:es)?|facturar\s+a|comprador|receptor|datos\s+del\s+cliente/.test(U.normalize(l)));
        const limite = lineaAdquiriente >= 0 ? lineaAdquiriente : Infinity;

        const deEmisor = documentos.filter((d) => d.indice < limite);
        const deAdquiriente = documentos.filter((d) => d.indice >= limite);

        let emisor = deEmisor[0] || null;
        let adquiriente = deAdquiriente[0] || null;
        if (!emisor && documentos.length) emisor = documentos[0];
        if (adquiriente && emisor && adquiriente.digitos === emisor.digitos) adquiriente = documentos.find((d) => d.digitos !== emisor.digitos) || null;
        if (!adquiriente && documentos.length > 1) adquiriente = documentos.find((d) => !emisor || d.digitos !== emisor.digitos) || null;

        const completar = (doc, rolRe) => {
            if (!doc) return null;
            let nombre = nombreCerca(lineas, doc.indice, rolRe);
            if (!nombre && doc === emisor) {
                const encabezado = lineas.slice(0, Math.min(6, lineas.length)).map(limpiarNombre)
                    .find((l) => RE_SOCIEDAD.test(l) && l.length >= 4);
                if (encabezado) nombre = encabezado;
            }
            return { tipoDoc: doc.tipoDoc, documento: doc.documento, digitos: doc.digitos, nombre };
        };

        datos.emisor = completar(emisor, /(?:razon social|nombre|emisor|proveedor|vendedor)\s*[:.]/);
        datos.adquiriente = completar(adquiriente, /(?:razon social|nombre|cliente|adquir[ie]*ente|senor(?:es)?|comprador)\s*[:.]/);

        const empresaEsEmisor = datos.emisor && mismoDocumento(datos.emisor.documento, nitEmpresa);
        const empresaEsAdquiriente = datos.adquiriente && mismoDocumento(datos.adquiriente.documento, nitEmpresa);
        const empresaAparece = documentos.some((d) => mismoDocumento(d.documento, nitEmpresa));

        let tipo = tipoPreferido;
        if (empresaEsEmisor) {
            tipo = 'venta';
        } else if (empresaEsAdquiriente) {
            if (tipo === 'venta') tipo = 'compra';
        } else if (!empresaAparece) {
            avisos.push(`El NIT de la empresa (${nitEmpresa}) no aparece en la factura. Confirme que el documento corresponde a su negocio.`);
        }

        /* --- Ítems --- */
        const items = lineas.map((l) => leerItem(l, ivaPct)).filter(Boolean);
        if (items.length) {
            const sumaItems = items.reduce((acc, it) => acc + it.cantidad * it.valorUnitario * (1 - it.descuentoPct / 100), 0);
            if (datos.subtotal && Math.abs(sumaItems - datos.subtotal) > Math.max(1000, datos.subtotal * 0.01)) {
                avisos.push(`Los ítems leídos suman ${U.money(sumaItems)} y el subtotal de la factura es ${U.money(datos.subtotal)}: puede faltar algún ítem.`);
            }
        }

        const categoria = adivinarCategoria(texto);

        // El contenido manda sobre la pestaña desde la que se cargó: una factura
        // con productos del inventario es una compra; una de servicios, un gasto.
        if (tipo !== 'venta') {
            const conInventario = items.some((item) => emparejarProducto(item, 'compra'));
            if (conInventario) tipo = 'compra';
            else if (categoria !== 'Otros gastos' || !items.length) tipo = 'gasto';
        }

        /* --- Confianza --- */
        let puntos = 0;
        if (datos.numero) puntos += 1;
        if (datos.fecha) puntos += 1;
        if (datos.total) puntos += 1;
        if (datos.totalesConsistentes) puntos += 1;
        if ((tipo === 'venta' ? datos.adquiriente : datos.emisor)) puntos += 1;
        if (datos.cufe) puntos += 1;
        if (tipo === 'gasto' || items.length) puntos += 1;
        const confianza = puntos >= 6 ? 'alta' : (puntos >= 4 ? 'media' : 'baja');

        if (normal.length < 60) avisos.push('Se leyó muy poco texto del PDF.');

        return { tipo, confianza, puntos, datos, items, categoria, avisos, texto };
    };

    /* ============================================================
       De la lectura al formulario
       ============================================================ */

    const buscarTercero = (tipoTercero, contraparte) => {
        if (!contraparte) return null;
        const terceros = db.all('terceros').filter((t) => t.tipo === tipoTercero);
        if (contraparte.documento) {
            const porDocumento = terceros.find((t) => mismoDocumento(t.documento, contraparte.documento));
            if (porDocumento) return porDocumento;
        }
        if (contraparte.nombre) {
            const mejor = terceros
                .map((t) => ({ t, s: similitud(t.nombre, contraparte.nombre) }))
                .sort((a, b) => b.s - a.s)[0];
            if (mejor && mejor.s >= 0.8) return mejor.t;
        }
        return null;
    };

    const emparejarProducto = (item, tipo) => {
        const candidatos = db.productos().filter((p) => p.activo !== false && (tipo === 'venta' || p.tipo === 'producto'));
        if (item.codigo) {
            const porCodigo = candidatos.find((p) => U.normalize(p.sku) === U.normalize(item.codigo));
            if (porCodigo) return porCodigo;
        }
        const mejor = candidatos
            .map((p) => ({ p, s: similitud(p.nombre, item.descripcion) }))
            .sort((a, b) => b.s - a.s)[0];
        return mejor && mejor.s >= 0.6 ? mejor.p : null;
    };

    const construirPrefill = (resultado, archivo, tipo, onRegistrado) => {
        const { datos } = resultado;
        const contraparte = tipo === 'venta' ? datos.adquiriente : datos.emisor;
        const tipoTercero = TIPOS[tipo].tercero;
        const existente = buscarTercero(tipoTercero, contraparte);
        const nuevo = !existente && contraparte && (contraparte.documento || contraparte.nombre)
            ? { tipoDoc: contraparte.tipoDoc || 'NIT', documento: contraparte.documento || '', nombre: contraparte.nombre || '' }
            : null;

        const duplicado = db.buscarDuplicado({
            tipo, cufe: datos.cufe, terceroId: existente ? existente.id : null, referencia: datos.numero
        });

        const importacion = {
            archivo,
            texto: resultado.texto,
            confianza: resultado.confianza,
            datos: { ...datos, contraparte },
            avisos: resultado.avisos.slice(),
            duplicado
        };

        if (tipo !== 'gasto' && !resultado.items.length) {
            importacion.avisos.push('No se reconocieron las líneas de detalle: agregue los ítems manualmente.');
        }
        if (tipo !== 'gasto' && contraparte && !existente) {
            importacion.avisos.push(`${tipoTercero === 'cliente' ? 'El cliente' : 'El proveedor'} no existe todavía: se creará al registrar.`);
        }

        const base = {
            fecha: datos.fecha && datos.fecha <= U.today() ? datos.fecha : U.today(),
            importacion,
            onRegistrado
        };
        if (datos.fecha && datos.fecha > U.today()) {
            importacion.avisos.push(`La factura tiene fecha futura (${U.fmtDate(datos.fecha)}); se propuso la fecha de hoy.`);
        }

        if (tipo === 'gasto') {
            const nombre = contraparte && contraparte.nombre ? contraparte.nombre : '';
            return {
                ...base,
                categoria: resultado.categoria,
                descripcion: [datos.numero ? `Factura ${datos.numero}` : 'Factura', nombre].filter(Boolean).join(' — '),
                proveedor: nombre,
                referencia: datos.numero,
                valor: datos.total || 0,
                pagado: datos.condicion !== 'credito',
                medio: 'Transferencia'
            };
        }

        const items = resultado.items.map((item) => {
            const producto = emparejarProducto(item, tipo);
            return {
                productoId: producto ? producto.id : '',
                cantidad: item.cantidad,
                valorUnitario: Math.round(item.valorUnitario),
                descuentoPct: item.descuentoPct,
                descripcion: item.descripcion,
                leido: `${item.codigo ? `${item.codigo} · ` : ''}${item.descripcion}`
            };
        });

        const comun = {
            ...base,
            condicion: datos.condicion,
            diasCredito: datos.diasCredito || 30,
            items,
            observaciones: `Importada desde ${archivo}`
        };

        if (tipo === 'venta') {
            return { ...comun, clienteId: existente ? existente.id : '', clienteNuevo: nuevo, referenciaExterna: datos.numero };
        }
        return { ...comun, proveedorId: existente ? existente.id : '', proveedorNuevo: nuevo, documentoProveedor: datos.numero };
    };

    /* ============================================================
       Panel "Datos leídos del PDF" dentro de cada formulario
       ============================================================ */

    const panelLectura = (importacion, obtenerTotales) => {
        const d = importacion.datos || {};
        const tonos = { alta: 'success', media: 'warning', baja: 'danger' };
        const zonaComparacion = el('div');

        const dato = (etiqueta, valor) => el('div', { class: 'dato-leido' }, [
            el('span', { text: etiqueta }),
            el('strong', { text: valor || '—' })
        ]);

        const contraparte = d.contraparte;
        const duplicado = importacion.duplicado;

        const nodo = el('section', { class: 'card', attrs: { 'aria-label': 'Datos leídos del PDF' } }, [
            el('header', { class: 'card-head' }, [
                el('div', { class: 'grow' }, [
                    el('h2', { text: 'Datos leídos del PDF' }),
                    el('p', { text: importacion.archivo })
                ]),
                ui.badge(`Lectura ${importacion.confianza || 'baja'}`, tonos[importacion.confianza] || 'danger')
            ]),
            el('div', { class: 'card-body stack' }, [
                duplicado ? ui.banner(
                    duplicado.certeza === 'cufe' ? 'Esta factura ya fue registrada' : 'Posible factura repetida',
                    duplicado.certeza === 'cufe'
                        ? `El CUFE coincide con ${duplicado.doc.numero || duplicado.doc.descripcion}. No se podrá registrar de nuevo.`
                        : `Ya existe ${duplicado.doc.numero || duplicado.doc.descripcion} con el mismo número de documento.`,
                    duplicado.certeza === 'cufe' ? 'danger' : 'warning') : null,
                importacion.avisos && importacion.avisos.length
                    ? ui.banner('Revise la lectura', importacion.avisos.join(' '), 'warning')
                    : null,
                el('div', { class: 'lectura-pdf' }, [
                    dato('Factura', d.numero),
                    dato('Fecha', d.fecha ? U.fmtDate(d.fecha) : ''),
                    dato('Vence', d.vencimiento ? U.fmtDate(d.vencimiento) : ''),
                    dato('Tercero', contraparte ? [contraparte.nombre, contraparte.documento].filter(Boolean).join(' · ') : ''),
                    dato('Subtotal', d.subtotal ? U.money(d.subtotal) : ''),
                    dato('IVA', d.iva ? U.money(d.iva) : ''),
                    dato('Total', d.total ? U.money(d.total) : ''),
                    dato('Pago', d.condicion === 'credito' ? `Crédito${d.diasCredito ? ` ${d.diasCredito} días` : ''}` : 'Contado'),
                    d.cufe ? dato('CUFE', U.truncate(d.cufe, 22)) : null
                ]),
                zonaComparacion,
                el('details', { class: 'texto-extraido' }, [
                    el('summary', { text: 'Ver el texto extraído del PDF' }),
                    el('pre', { text: importacion.texto || '' })
                ])
            ])
        ]);

        const actualizar = () => {
            U.clear(zonaComparacion);
            const totalLeido = U.toNumber(d.total);
            if (!totalLeido) return;
            const calculado = U.toNumber(obtenerTotales().total);
            const diferencia = calculado - totalLeido;
            const coincide = Math.abs(diferencia) <= Math.max(1000, totalLeido * 0.01);
            zonaComparacion.appendChild(ui.banner(
                coincide ? 'El total coincide con la factura' : 'El total todavía no coincide con la factura',
                coincide
                    ? `Calculado ${U.money(calculado)} · Factura ${U.money(totalLeido)}.`
                    : `Calculado ${U.money(calculado)} · Factura ${U.money(totalLeido)} · Diferencia ${U.money(diferencia)}. Revise cantidades, precios, descuentos o IVA.`,
                coincide ? 'success' : 'warning'));
        };

        return { nodo, actualizar };
    };

    /* ============================================================
       Ventana de carga
       ============================================================ */

    const abrirFormularioDe = (tipo, prefill) => {
        if (tipo === 'venta') ERP.ventas.abrirFormulario({ prefill });
        else if (tipo === 'compra') ERP.compras.abrirFormulario({ prefill });
        else ERP.gastos.abrirFormulario(null, prefill);
    };

    const abrir = (tipoPreferido) => {
        const permitidos = Object.keys(TIPOS).filter((t) => ERP.auth.puede(TIPOS[t].modulo));
        if (!permitidos.length) {
            ui.toastError('Sin permiso', 'Su rol no puede registrar documentos.');
            return;
        }
        const tipoInicial = permitidos.includes(tipoPreferido) ? tipoPreferido : permitidos[0];

        const lista = el('div', { class: 'import-list', attrs: { 'aria-live': 'polite' } });

        const selector = el('input', {
            class: 'visually-hidden',
            attrs: { type: 'file', accept: 'application/pdf,.pdf', multiple: true, tabindex: '-1', 'aria-hidden': 'true' }
        });

        const zona = el('div', {
            class: 'dropzone',
            attrs: { role: 'button', tabindex: '0', 'aria-label': 'Elegir facturas en PDF' }
        }, [
            el('div', { class: 'dropzone-icon', text: 'PDF', attrs: { 'aria-hidden': 'true' } }),
            el('strong', { text: 'Arrastre aquí sus facturas o haga clic para elegirlas' }),
            el('p', { text: 'Puede cargar varias a la vez. Se leen dentro de este navegador: los archivos no salen de su equipo.' }),
            selector
        ]);

        const procesarArchivo = async (archivo) => {
            const nombre = el('p', { class: 'import-name', text: archivo.name });
            const meta = el('p', { class: 'import-meta' }, [el('span', { text: 'Leyendo…' })]);
            const acciones = el('div', { class: 'import-actions' }, [el('div', { class: 'spinner', attrs: { role: 'status', 'aria-label': 'Leyendo' } })]);
            lista.prepend(el('div', { class: 'import-row' }, [
                el('div', {}, [nombre, meta]),
                el('div', {}, []),
                acciones
            ]));
            const fila = lista.firstChild;
            const zonaEstado = fila.children[1];

            const mostrarFallo = (mensaje) => {
                U.clear(meta);
                U.clear(acciones);
                U.clear(zonaEstado);
                meta.appendChild(el('span', { text: mensaje }));
                zonaEstado.appendChild(ui.badge('No se pudo leer', 'danger'));
            };

            if (!/\.pdf$/i.test(archivo.name) && archivo.type !== 'application/pdf') {
                mostrarFallo('Solo se admiten archivos PDF.');
                return;
            }
            if (archivo.size > LIMITE_ARCHIVO) {
                mostrarFallo('El archivo supera los 15 MB.');
                return;
            }

            let lectura;
            try {
                lectura = await ERP.pdfLector.leer(await archivo.arrayBuffer());
            } catch (error) {
                console.error(error);
                mostrarFallo('Ocurrió un error al abrir el archivo.');
                return;
            }
            if (!lectura.ok) {
                mostrarFallo(lectura.error);
                return;
            }

            const resultado = analizar(lectura.lineas, tipoInicial);
            const tipoSugerido = permitidos.includes(resultado.tipo) ? resultado.tipo : tipoInicial;

            U.clear(meta);
            U.clear(acciones);
            U.clear(zonaEstado);

            const describir = (tipo) => {
                const contraparte = tipo === 'venta' ? resultado.datos.adquiriente : resultado.datos.emisor;
                return [
                    resultado.datos.numero || 'Sin número',
                    contraparte && contraparte.nombre ? contraparte.nombre : null,
                    resultado.datos.fecha ? U.fmtDate(resultado.datos.fecha) : null,
                    resultado.datos.total ? U.money(resultado.datos.total) : null
                ].filter(Boolean).join(' · ');
            };

            const textoMeta = el('span', { text: describir(tipoSugerido) });
            meta.appendChild(textoMeta);

            const selTipo = ui.select(permitidos.map((t) => ({ valor: t, texto: `Registrar como ${TIPOS[t].etiqueta.toLowerCase()}` })), { valor: tipoSugerido });
            selTipo.setAttribute('aria-label', `Tipo de documento para ${archivo.name}`);
            selTipo.addEventListener('change', () => { textoMeta.textContent = describir(selTipo.value); });

            const tonos = { alta: 'success', media: 'warning', baja: 'danger' };
            const duplicadoInicial = db.buscarDuplicado({ tipo: tipoSugerido, cufe: resultado.datos.cufe, referencia: '' });
            U.appendAll(zonaEstado, [
                el('div', { class: 'row row-wrap' }, [
                    ui.badge(`Lectura ${resultado.confianza}`, tonos[resultado.confianza]),
                    duplicadoInicial ? ui.badge('Ya registrada', 'danger') : null
                ])
            ]);

            const btnRevisar = el('button', { class: 'btn btn-sm', text: 'Revisar y registrar', attrs: { type: 'button' } });
            btnRevisar.addEventListener('click', () => {
                const tipo = selTipo.value;
                const prefill = construirPrefill(resultado, archivo.name, tipo, (doc) => {
                    U.clear(acciones);
                    U.clear(zonaEstado);
                    zonaEstado.appendChild(ui.badge(`Registrada ${doc.numero || ''}`.trim(), 'success'));
                    acciones.appendChild(el('span', { class: 'import-meta', text: TIPOS[tipo].etiqueta }));
                });
                abrirFormularioDe(tipo, prefill);
            });

            U.appendAll(acciones, [selTipo, btnRevisar]);
        };

        const procesar = async (archivos) => {
            for (const archivo of archivos) {
                // Uno a uno: facturas grandes en paralelo congelarían la interfaz.
                await procesarArchivo(archivo);
            }
        };

        zona.addEventListener('click', (event) => {
            if (event.target !== selector) selector.click();
        });
        zona.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selector.click();
            }
        });
        zona.addEventListener('dragover', (event) => {
            event.preventDefault();
            zona.classList.add('is-over');
        });
        zona.addEventListener('dragleave', () => zona.classList.remove('is-over'));
        zona.addEventListener('drop', (event) => {
            event.preventDefault();
            zona.classList.remove('is-over');
            const archivos = [...(event.dataTransfer ? event.dataTransfer.files : [])];
            if (archivos.length) procesar(archivos);
        });
        selector.addEventListener('change', () => {
            const archivos = [...selector.files];
            selector.value = '';
            if (archivos.length) procesar(archivos);
        });

        const btnCerrar = el('button', { class: 'btn btn-secondary', text: 'Cerrar', attrs: { type: 'button' } });

        const ctrl = ui.modal({
            titulo: 'Cargar facturas en PDF',
            subtitulo: 'Lectura automática con revisión antes de registrar',
            ancho: 'ancho',
            contenido: el('div', { class: 'stack' }, [
                ui.banner('Cómo funciona',
                    'La aplicación lee el PDF, reconoce si es una compra, un gasto o una venta, identifica el tercero, los totales y los ítems, y abre el formulario prellenado. Nada se registra hasta que usted lo confirme.',
                    'info'),
                zona,
                lista
            ]),
            acciones: [btnCerrar]
        });

        btnCerrar.addEventListener('click', () => ctrl.cerrar());
    };

    return { abrir, analizar, construirPrefill, panelLectura, parsearNumero, parsearFecha };
})();
