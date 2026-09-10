/* ============================================================
   pdfreader.js — Lector nativo de texto en archivos PDF
   Extrae el texto de facturas electrónicas sin librerías externas
   (Agents.md, sección 3). Soporta flujos comprimidos (Flate),
   flujos de objetos, fuentes Type0 con tabla ToUnicode, fuentes
   simples con codificación WinAnsi/Differences y formularios
   XObject. Reconstruye las líneas por posición en la página.

   Limitaciones conocidas y declaradas al usuario:
   - PDF escaneados (solo imagen): no hay texto que leer.
   - PDF cifrados: se rechazan con un mensaje claro.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.pdfLector = (() => {
    const LIMITE_BYTES = 15 * 1024 * 1024;
    const LIMITE_PAGINAS = 20;

    class Ref { constructor(num) { this.num = num; } }
    class Cadena { constructor(bytes) { this.bytes = bytes; } }
    class Operador { constructor(nombre) { this.nombre = nombre; } }

    const esDic = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
        && !(v instanceof Ref) && !(v instanceof Cadena) && !(v instanceof Operador);

    /* ============================================================
       Bytes y texto: cada byte es un carácter (latin-1 exacto), de
       modo que las posiciones del texto coinciden con las del archivo.
       ============================================================ */

    const bytesATexto = (u8) => {
        let salida = '';
        const PASO = 8192;
        for (let i = 0; i < u8.length; i += PASO) {
            salida += String.fromCharCode.apply(null, u8.subarray(i, i + PASO));
        }
        return salida;
    };

    /* ============================================================
       Analizador léxico de la sintaxis PDF
       ============================================================ */

    const ESPACIOS = new Set([0, 9, 10, 12, 13, 32]);
    const DELIMITADORES = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
    const ESCAPES = { n: 10, r: 13, t: 9, b: 8, f: 12 };

    class Lexer {
        constructor(texto, inicio) {
            this.s = texto;
            this.p = inicio || 0;
        }

        saltarEspacios() {
            const s = this.s;
            while (this.p < s.length) {
                const c = s.charCodeAt(this.p);
                if (ESPACIOS.has(c)) { this.p += 1; continue; }
                if (c === 37) {
                    while (this.p < s.length && s.charCodeAt(this.p) !== 10 && s.charCodeAt(this.p) !== 13) this.p += 1;
                    continue;
                }
                break;
            }
        }

        leerLiteral() {
            const s = this.s;
            this.p += 1;
            let nivel = 1;
            let salida = '';
            while (this.p < s.length) {
                const ch = s[this.p];
                if (ch === '\\') {
                    const siguiente = s[this.p + 1];
                    if (siguiente !== undefined && ESCAPES[siguiente] !== undefined) {
                        salida += String.fromCharCode(ESCAPES[siguiente]);
                        this.p += 2;
                        continue;
                    }
                    if (siguiente === '(' || siguiente === ')' || siguiente === '\\') {
                        salida += siguiente;
                        this.p += 2;
                        continue;
                    }
                    if (siguiente >= '0' && siguiente <= '7') {
                        let octal = '';
                        let k = 1;
                        while (k <= 3 && s[this.p + k] >= '0' && s[this.p + k] <= '7') {
                            octal += s[this.p + k];
                            k += 1;
                        }
                        salida += String.fromCharCode(parseInt(octal, 8) & 255);
                        this.p += 1 + octal.length;
                        continue;
                    }
                    const codigo = s.charCodeAt(this.p + 1);
                    if (codigo === 13) { this.p += s.charCodeAt(this.p + 2) === 10 ? 3 : 2; continue; }
                    if (codigo === 10) { this.p += 2; continue; }
                    this.p += 1;
                    continue;
                }
                if (ch === '(') nivel += 1;
                if (ch === ')') {
                    nivel -= 1;
                    if (nivel === 0) { this.p += 1; break; }
                }
                salida += ch;
                this.p += 1;
            }
            return salida;
        }

        siguiente() {
            this.saltarEspacios();
            const s = this.s;
            if (this.p >= s.length) return null;
            const ch = s[this.p];

            if (ch === '[' || ch === ']' || ch === '{' || ch === '}') {
                this.p += 1;
                return { t: ch };
            }
            if (ch === '<') {
                if (s[this.p + 1] === '<') { this.p += 2; return { t: '<<' }; }
                const fin = s.indexOf('>', this.p + 1);
                const hex = s.slice(this.p + 1, fin < 0 ? s.length : fin).replace(/[^0-9a-fA-F]/g, '');
                this.p = fin < 0 ? s.length : fin + 1;
                let bytes = '';
                for (let i = 0; i < hex.length; i += 2) {
                    bytes += String.fromCharCode(parseInt((hex.substr(i, 2) + '0').slice(0, 2), 16));
                }
                return { t: 'str', v: bytes };
            }
            if (ch === '>') {
                if (s[this.p + 1] === '>') { this.p += 2; return { t: '>>' }; }
                this.p += 1;
                return { t: 'op', v: '>' };
            }
            if (ch === '(') return { t: 'str', v: this.leerLiteral() };
            if (ch === ')') { this.p += 1; return { t: 'op', v: ')' }; }
            if (ch === '/') {
                this.p += 1;
                let nombre = '';
                while (this.p < s.length) {
                    const c = s[this.p];
                    if (ESPACIOS.has(s.charCodeAt(this.p)) || DELIMITADORES.has(c)) break;
                    if (c === '#' && /^[0-9a-fA-F]{2}$/.test(s.substr(this.p + 1, 2))) {
                        nombre += String.fromCharCode(parseInt(s.substr(this.p + 1, 2), 16));
                        this.p += 3;
                        continue;
                    }
                    nombre += c;
                    this.p += 1;
                }
                return { t: 'name', v: nombre };
            }

            const inicio = this.p;
            while (this.p < s.length) {
                if (ESPACIOS.has(s.charCodeAt(this.p)) || DELIMITADORES.has(s[this.p])) break;
                this.p += 1;
            }
            if (this.p === inicio) {
                this.p += 1;
                return { t: 'op', v: s[inicio] };
            }
            const palabra = s.slice(inicio, this.p);
            if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(palabra)) return { t: 'num', v: parseFloat(palabra) };
            return { t: 'op', v: palabra };
        }
    }

    const parsearValor = (lx, tok) => {
        if (!tok) return undefined;
        switch (tok.t) {
            case 'num': {
                const guardado = lx.p;
                if (Number.isInteger(tok.v)) {
                    const t2 = lx.siguiente();
                    if (t2 && t2.t === 'num' && Number.isInteger(t2.v)) {
                        const t3 = lx.siguiente();
                        if (t3 && t3.t === 'op' && t3.v === 'R') return new Ref(tok.v);
                    }
                }
                lx.p = guardado;
                return tok.v;
            }
            case 'name': return `/${tok.v}`;
            case 'str': return new Cadena(tok.v);
            case '[': {
                const lista = [];
                for (;;) {
                    const t = lx.siguiente();
                    if (!t || t.t === ']') break;
                    lista.push(parsearValor(lx, t));
                }
                return lista;
            }
            case '<<': {
                const dic = Object.create(null);
                for (;;) {
                    const t = lx.siguiente();
                    if (!t || t.t === '>>') break;
                    if (t.t !== 'name') continue;
                    const v = lx.siguiente();
                    if (!v || v.t === '>>') break;
                    dic[t.v] = parsearValor(lx, v);
                }
                return dic;
            }
            case 'op':
                if (tok.v === 'true') return true;
                if (tok.v === 'false') return false;
                if (tok.v === 'null') return null;
                return new Operador(tok.v);
            default:
                return undefined;
        }
    };

    /* ============================================================
       Índice de objetos
       ============================================================ */

    const indexar = (s, bytes) => {
        const objetos = new Map();
        const re = /(\d+)\s+(\d+)\s+obj\b/g;
        let m;

        while ((m = re.exec(s))) {
            if (m.index > 0 && !ESPACIOS.has(s.charCodeAt(m.index - 1)) && s[m.index - 1] !== '>') continue;

            const num = parseInt(m[1], 10);
            const lx = new Lexer(s, m.index + m[0].length);
            let valor;
            try {
                valor = parsearValor(lx, lx.siguiente());
            } catch (error) {
                continue;
            }

            const entrada = { num, pos: m.index, valor, ini: -1, fin: -1, largoRef: null };
            lx.saltarEspacios();

            if (s.startsWith('stream', lx.p)) {
                let ini = lx.p + 6;
                if (s.charCodeAt(ini) === 13 && s.charCodeAt(ini + 1) === 10) ini += 2;
                else if (s.charCodeAt(ini) === 10 || s.charCodeAt(ini) === 13) ini += 1;

                let fin = -1;
                const largo = esDic(valor) ? valor.Length : undefined;
                if (typeof largo === 'number' && ini + largo <= s.length && /^\s*endstream/.test(s.substr(ini + largo, 24))) {
                    fin = ini + largo;
                }
                if (fin < 0) {
                    const e = s.indexOf('endstream', ini);
                    fin = e < 0 ? s.length : e;
                    if (s.charCodeAt(fin - 1) === 10) fin -= 1;
                    if (s.charCodeAt(fin - 1) === 13) fin -= 1;
                    if (largo instanceof Ref) entrada.largoRef = largo.num;
                }
                entrada.ini = ini;
                entrada.fin = fin;
                re.lastIndex = fin;
            } else if (lx.p > re.lastIndex) {
                re.lastIndex = lx.p;
            }

            // Una definición posterior sustituye a la anterior (actualizaciones incrementales).
            objetos.set(num, entrada);
        }

        objetos.forEach((o) => {
            if (o.largoRef === null) return;
            const ref = objetos.get(o.largoRef);
            if (ref && typeof ref.valor === 'number' && o.ini + ref.valor <= s.length
                && /^\s*endstream/.test(s.substr(o.ini + ref.valor, 24))) {
                o.fin = o.ini + ref.valor;
            }
        });

        return { s, bytes, objetos };
    };

    const resolver = (doc, valor) => {
        let v = valor;
        let guardia = 0;
        while (v instanceof Ref && guardia < 32) {
            const obj = doc.objetos.get(v.num);
            v = obj ? obj.valor : null;
            guardia += 1;
        }
        return v;
    };

    /* ============================================================
       Filtros de flujo
       ============================================================ */

    const pasarPorStream = async (datos, formato) => {
        const flujo = new DecompressionStream(formato);
        const escritor = flujo.writable.getWriter();
        escritor.write(datos).catch(() => {});
        escritor.close().catch(() => {});
        const lector = flujo.readable.getReader();
        const trozos = [];
        let total = 0;
        try {
            for (;;) {
                const { done, value } = await lector.read();
                if (done) break;
                trozos.push(value);
                total += value.length;
            }
        } catch (error) {
            // Algunos generadores dejan bytes sobrantes al final del flujo:
            // lo ya descomprimido es válido y se conserva.
            if (total === 0) throw error;
        }
        const salida = new Uint8Array(total);
        let posicion = 0;
        trozos.forEach((t) => { salida.set(t, posicion); posicion += t.length; });
        return salida;
    };

    const inflar = async (datos) => {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('Este navegador no permite descomprimir el contenido del PDF.');
        }
        try {
            return await pasarPorStream(datos, 'deflate');
        } catch (error) {
            if (datos.length > 2) return pasarPorStream(datos.subarray(2), 'deflate-raw');
            throw error;
        }
    };

    const aplicarPredictor = (datos, parametros) => {
        if (!esDic(parametros) || !(parametros.Predictor >= 10)) return datos;
        const colores = parametros.Colors || 1;
        const bits = parametros.BitsPerComponent || 8;
        const columnas = parametros.Columns || 1;
        const bpp = Math.max(1, Math.ceil((colores * bits) / 8));
        const ancho = Math.ceil((columnas * colores * bits) / 8);
        const filas = Math.floor(datos.length / (ancho + 1));
        const salida = new Uint8Array(filas * ancho);
        let previa = new Uint8Array(ancho);

        for (let f = 0; f < filas; f += 1) {
            const tipo = datos[f * (ancho + 1)];
            const fila = datos.subarray(f * (ancho + 1) + 1, (f + 1) * (ancho + 1));
            const actual = new Uint8Array(ancho);
            for (let i = 0; i < ancho; i += 1) {
                const a = i >= bpp ? actual[i - bpp] : 0;
                const b = previa[i];
                const c = i >= bpp ? previa[i - bpp] : 0;
                let v = fila[i];
                if (tipo === 1) v += a;
                else if (tipo === 2) v += b;
                else if (tipo === 3) v += (a + b) >> 1;
                else if (tipo === 4) {
                    const p = a + b - c;
                    const pa = Math.abs(p - a);
                    const pb = Math.abs(p - b);
                    const pc = Math.abs(p - c);
                    v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
                }
                actual[i] = v & 255;
            }
            salida.set(actual, f * ancho);
            previa = actual;
        }
        return salida;
    };

    const asciiHex = (datos) => {
        const s = bytesATexto(datos);
        const fin = s.indexOf('>');
        const hex = (fin >= 0 ? s.slice(0, fin) : s).replace(/[^0-9a-fA-F]/g, '');
        const salida = new Uint8Array(Math.ceil(hex.length / 2));
        for (let i = 0; i < salida.length; i += 1) {
            salida[i] = parseInt((hex.substr(i * 2, 2) + '0').slice(0, 2), 16);
        }
        return salida;
    };

    const ascii85 = (datos) => {
        const s = bytesATexto(datos).replace(/\s/g, '');
        const fin = s.indexOf('~>');
        const cuerpo = (fin >= 0 ? s.slice(0, fin) : s).replace(/^<~/, '');
        const salida = [];
        let grupo = [];
        const volcar = (valores, cantidad) => {
            let v = 0;
            valores.forEach((d) => { v = v * 85 + d; });
            const b = [Math.floor(v / 16777216) & 255, Math.floor(v / 65536) & 255, Math.floor(v / 256) & 255, v & 255];
            salida.push(...b.slice(0, cantidad));
        };
        for (let i = 0; i < cuerpo.length; i += 1) {
            if (cuerpo[i] === 'z' && grupo.length === 0) { salida.push(0, 0, 0, 0); continue; }
            grupo.push(cuerpo.charCodeAt(i) - 33);
            if (grupo.length === 5) { volcar(grupo, 4); grupo = []; }
        }
        if (grupo.length) {
            const n = grupo.length;
            while (grupo.length < 5) grupo.push(84);
            volcar(grupo, n - 1);
        }
        return new Uint8Array(salida);
    };

    const decodificarStream = async (doc, obj) => {
        let datos = doc.bytes.subarray(obj.ini, obj.fin);
        const dic = esDic(obj.valor) ? obj.valor : Object.create(null);
        let filtros = resolver(doc, dic.Filter);
        let parametros = resolver(doc, dic.DecodeParms);
        if (!filtros) return datos;
        if (!Array.isArray(filtros)) {
            filtros = [filtros];
            parametros = [parametros];
        }
        if (!Array.isArray(parametros)) parametros = [];

        for (let i = 0; i < filtros.length; i += 1) {
            const filtro = resolver(doc, filtros[i]);
            const param = resolver(doc, parametros[i]);
            if (filtro === '/FlateDecode' || filtro === '/Fl') {
                datos = aplicarPredictor(await inflar(datos), param);
            } else if (filtro === '/ASCIIHexDecode' || filtro === '/AHx') {
                datos = asciiHex(datos);
            } else if (filtro === '/ASCII85Decode' || filtro === '/A85') {
                datos = ascii85(datos);
            } else {
                throw new Error(`Filtro de PDF no soportado: ${filtro}`);
            }
        }
        return datos;
    };

    /* ============================================================
       Flujos de objetos (PDF 1.5+)
       ============================================================ */

    const expandirFlujosDeObjetos = async (doc) => {
        const contenedores = [...doc.objetos.values()]
            .filter((o) => o.ini >= 0 && esDic(o.valor) && o.valor.Type === '/ObjStm');

        for (const contenedor of contenedores) {
            let texto;
            try {
                texto = bytesATexto(await decodificarStream(doc, contenedor));
            } catch (error) {
                continue;
            }
            const cantidad = Number(resolver(doc, contenedor.valor.N)) || 0;
            const primero = Number(resolver(doc, contenedor.valor.First)) || 0;
            const cabecera = new Lexer(texto, 0);
            const pares = [];
            for (let i = 0; i < cantidad; i += 1) {
                const a = cabecera.siguiente();
                const b = cabecera.siguiente();
                if (!a || !b) break;
                pares.push([a.v, b.v]);
            }
            pares.forEach(([num, desplazamiento]) => {
                const existente = doc.objetos.get(num);
                if (existente && existente.pos > contenedor.pos) return;
                const lx = new Lexer(texto, primero + desplazamiento);
                let valor;
                try {
                    valor = parsearValor(lx, lx.siguiente());
                } catch (error) {
                    return;
                }
                doc.objetos.set(num, { num, pos: contenedor.pos, valor, ini: -1, fin: -1, largoRef: null });
            });
        }
    };

    /* ============================================================
       Páginas
       ============================================================ */

    const localizarPaginas = (doc) => {
        const paginas = [];
        const visitados = new Set();

        const recorrer = (nodoRef, recursosHeredados) => {
            if (paginas.length >= LIMITE_PAGINAS) return;
            if (nodoRef instanceof Ref) {
                if (visitados.has(nodoRef.num)) return;
                visitados.add(nodoRef.num);
            }
            const nodo = resolver(doc, nodoRef);
            if (!esDic(nodo)) return;
            const recursos = nodo.Resources !== undefined ? nodo.Resources : recursosHeredados;
            const hijos = resolver(doc, nodo.Kids);
            if (Array.isArray(hijos)) {
                hijos.forEach((hijo) => recorrer(hijo, recursos));
                return;
            }
            if (nodo.Type === '/Page' || nodo.Contents !== undefined) paginas.push({ nodo, recursos });
        };

        const catalogos = [...doc.objetos.values()]
            .filter((o) => esDic(o.valor) && o.valor.Type === '/Catalog')
            .sort((a, b) => a.pos - b.pos);

        if (catalogos.length) recorrer(catalogos[catalogos.length - 1].valor.Pages, undefined);

        if (!paginas.length) {
            [...doc.objetos.values()]
                .filter((o) => esDic(o.valor) && o.valor.Type === '/Page')
                .sort((a, b) => a.pos - b.pos)
                .slice(0, LIMITE_PAGINAS)
                .forEach((o) => paginas.push({ nodo: o.valor, recursos: o.valor.Resources }));
        }
        return paginas;
    };

    /* ============================================================
       Fuentes y codificaciones
       ============================================================ */

    // Caracteres 0x80–0x9F de WinAnsi que difieren de Latin-1.
    const WIN_ANSI_ALTOS = [
        0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017D, 0,
        0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178
    ];

    const tablaWinAnsi = () => {
        const tabla = new Array(256);
        for (let i = 0; i < 256; i += 1) tabla[i] = String.fromCharCode(i);
        for (let i = 0; i < 32; i += 1) if (WIN_ANSI_ALTOS[i]) tabla[0x80 + i] = String.fromCharCode(WIN_ANSI_ALTOS[i]);
        tabla[0xA0] = ' ';
        tabla[0xAD] = '-';
        return tabla;
    };

    // Caracteres del español en MacRoman (código → punto Unicode).
    const MAC_ROMAN = [
        [0x87, 0xE1], [0x8E, 0xE9], [0x92, 0xED], [0x97, 0xF3], [0x9C, 0xFA], [0x96, 0xF1], [0x84, 0xD1],
        [0xE7, 0xC1], [0x83, 0xC9], [0xEA, 0xCD], [0xEE, 0xD3], [0xF2, 0xDA], [0x9F, 0xFC], [0x86, 0xDC],
        [0xC0, 0xBF], [0xC1, 0xA1], [0xA1, 0xB0], [0xBC, 0xBA], [0xBB, 0xAA], [0xA5, 0x2022], [0xD0, 0x2013],
        [0xD1, 0x2014], [0xD2, 0x201C], [0xD3, 0x201D], [0xD4, 0x2018], [0xD5, 0x2019], [0xCA, 0x20]
    ];

    const aplicarMacRoman = (tabla) => {
        MAC_ROMAN.forEach(([codigo, unicode]) => { tabla[codigo] = String.fromCharCode(unicode); });
    };

    const GLIFOS = new Map(Object.entries({
        space: 32, exclam: 33, quotedbl: 34, numbersign: 35, dollar: 36, percent: 37, ampersand: 38,
        quotesingle: 39, quoteright: 0x2019, parenleft: 40, parenright: 41, asterisk: 42, plus: 43,
        comma: 44, hyphen: 45, minus: 45, period: 46, slash: 47, zero: 48, one: 49, two: 50, three: 51,
        four: 52, five: 53, six: 54, seven: 55, eight: 56, nine: 57, colon: 58, semicolon: 59, less: 60,
        equal: 61, greater: 62, question: 63, at: 64, bracketleft: 91, backslash: 92, bracketright: 93,
        underscore: 95, braceleft: 123, bar: 124, braceright: 125, degree: 0xB0, ordmasculine: 0xBA,
        ordfeminine: 0xAA, aacute: 0xE1, eacute: 0xE9, iacute: 0xED, oacute: 0xF3, uacute: 0xFA,
        Aacute: 0xC1, Eacute: 0xC9, Iacute: 0xCD, Oacute: 0xD3, Uacute: 0xDA, ntilde: 0xF1, Ntilde: 0xD1,
        udieresis: 0xFC, Udieresis: 0xDC, questiondown: 0xBF, exclamdown: 0xA1, bullet: 0x2022,
        endash: 0x2013, emdash: 0x2014, quotedblleft: 0x201C, quotedblright: 0x201D, quoteleft: 0x2018,
        Euro: 0x20AC, periodcentered: 0xB7, section: 0xA7, copyright: 0xA9, registered: 0xAE,
        multiply: 0xD7, divide: 0xF7, nbspace: 32, nonbreakingspace: 32
    }));

    const glifoAUnicode = (nombre) => {
        if (!nombre) return '';
        if (GLIFOS.has(nombre)) return String.fromCharCode(GLIFOS.get(nombre));
        if (nombre.length === 1) return nombre;
        let m = /^uni([0-9A-Fa-f]{4})$/.exec(nombre);
        if (m) return String.fromCharCode(parseInt(m[1], 16));
        m = /^u([0-9A-Fa-f]{4,6})$/.exec(nombre);
        if (m) return String.fromCodePoint(parseInt(m[1], 16));
        const base = nombre.split('.')[0];
        return base !== nombre ? glifoAUnicode(base) : '';
    };

    /** Convierte hexadecimal UTF-16BE a texto. */
    const utf16 = (hex) => {
        const limpio = hex.length % 4 === 0 ? hex : hex.padStart(Math.ceil(hex.length / 4) * 4, '0');
        let salida = '';
        for (let i = 0; i + 3 < limpio.length; i += 4) salida += String.fromCharCode(parseInt(limpio.substr(i, 4), 16));
        return salida;
    };

    const parsearCMap = (texto) => {
        const mapa = new Map();
        let bytes = 0;
        const fichas = (bloque) => [...bloque.matchAll(/<([0-9A-Fa-f\s]*)>|\[|\]/g)]
            .map((m) => ((m[0] === '[' || m[0] === ']') ? m[0] : m[1].replace(/\s/g, '')));

        for (const m of texto.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
            fichas(m[1]).forEach((h) => {
                if (h !== '[' && h !== ']') bytes = Math.max(bytes, Math.ceil(h.length / 2));
            });
        }

        for (const m of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
            const t = fichas(m[1]);
            for (let i = 0; i + 1 < t.length; i += 2) mapa.set(parseInt(t[i], 16), utf16(t[i + 1]));
        }

        for (const m of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
            const t = fichas(m[1]);
            let i = 0;
            while (i + 2 < t.length) {
                const bajo = parseInt(t[i], 16);
                const alto = parseInt(t[i + 1], 16);
                if (t[i + 2] === '[') {
                    let k = i + 3;
                    let codigo = bajo;
                    while (k < t.length && t[k] !== ']') {
                        mapa.set(codigo, utf16(t[k]));
                        codigo += 1;
                        k += 1;
                    }
                    i = k + 1;
                } else {
                    const destino = t[i + 2].padStart(4, '0');
                    const cabeza = destino.slice(0, -4);
                    const cola = parseInt(destino.slice(-4), 16);
                    for (let c = bajo; c <= alto && c - bajo < 65536; c += 1) {
                        mapa.set(c, utf16(cabeza + (cola + c - bajo).toString(16).padStart(4, '0')));
                    }
                    i += 3;
                }
            }
        }
        return { mapa, bytes: bytes || 1 };
    };

    const cargarFuente = async (doc, refFuente, cache) => {
        const clave = refFuente instanceof Ref ? refFuente.num : null;
        if (clave !== null && cache.has(clave)) return cache.get(clave);

        const fuente = { tipo0: false, bytes: 1, aUnicode: null, codificacion: tablaWinAnsi(), ancho: () => 520 };
        const dic = resolver(doc, refFuente);

        if (esDic(dic)) {
            const baseFont = String(resolver(doc, dic.BaseFont) || '');

            if (dic.Subtype === '/Type0') {
                fuente.tipo0 = true;
                fuente.bytes = 2;
                const descendientes = resolver(doc, dic.DescendantFonts);
                const desc = resolver(doc, Array.isArray(descendientes) ? descendientes[0] : null);
                const anchoDefecto = esDic(desc) && typeof resolver(doc, desc.DW) === 'number' ? resolver(doc, desc.DW) : 1000;
                const anchos = new Map();
                const w = esDic(desc) ? resolver(doc, desc.W) : null;
                if (Array.isArray(w)) {
                    let i = 0;
                    while (i < w.length) {
                        const primero = resolver(doc, w[i]);
                        const segundo = resolver(doc, w[i + 1]);
                        if (Array.isArray(segundo)) {
                            segundo.forEach((valor, k) => anchos.set(primero + k, Number(resolver(doc, valor)) || anchoDefecto));
                            i += 2;
                        } else {
                            const valor = Number(resolver(doc, w[i + 2])) || anchoDefecto;
                            for (let c = primero; c <= segundo && c - primero < 65536; c += 1) anchos.set(c, valor);
                            i += 3;
                        }
                    }
                }
                fuente.ancho = (codigo) => (anchos.has(codigo) ? anchos.get(codigo) : anchoDefecto);
            } else {
                const primerCaracter = resolver(doc, dic.FirstChar);
                const lista = resolver(doc, dic.Widths);
                if (Array.isArray(lista) && typeof primerCaracter === 'number') {
                    fuente.ancho = (codigo) => {
                        const v = Number(resolver(doc, lista[codigo - primerCaracter]));
                        return v > 0 ? v : 520;
                    };
                } else if (/courier/i.test(baseFont)) {
                    fuente.ancho = () => 600;
                }

                const codificacion = resolver(doc, dic.Encoding);
                if (codificacion === '/MacRomanEncoding') aplicarMacRoman(fuente.codificacion);
                if (esDic(codificacion)) {
                    if (codificacion.BaseEncoding === '/MacRomanEncoding') aplicarMacRoman(fuente.codificacion);
                    const diferencias = resolver(doc, codificacion.Differences);
                    if (Array.isArray(diferencias)) {
                        let codigo = 0;
                        diferencias.forEach((d) => {
                            const v = resolver(doc, d);
                            if (typeof v === 'number') {
                                codigo = v;
                            } else if (typeof v === 'string') {
                                const unicode = glifoAUnicode(v.slice(1));
                                if (unicode && codigo < 256) fuente.codificacion[codigo] = unicode;
                                codigo += 1;
                            }
                        });
                    }
                }
            }

            if (dic.ToUnicode instanceof Ref) {
                const objeto = doc.objetos.get(dic.ToUnicode.num);
                if (objeto && objeto.ini >= 0) {
                    try {
                        const cmap = parsearCMap(bytesATexto(await decodificarStream(doc, objeto)));
                        if (cmap.mapa.size) {
                            fuente.aUnicode = cmap.mapa;
                            if (fuente.tipo0) fuente.bytes = cmap.bytes >= 1 ? cmap.bytes : 2;
                        }
                    } catch (error) {
                        // Sin tabla legible: se usa la codificación base.
                    }
                }
            }
        }

        if (clave !== null) cache.set(clave, fuente);
        return fuente;
    };

    /* ============================================================
       Intérprete del contenido de página
       ============================================================ */

    const IDENTIDAD = [1, 0, 0, 1, 0, 0];

    const multiplicar = (a, b) => [
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5]
    ];

    const saltarImagenEnLinea = (lx) => {
        let tok;
        while ((tok = lx.siguiente())) {
            if (tok.t === 'op' && tok.v === 'ID') break;
        }
        const s = lx.s;
        let desde = lx.p + 1;
        for (;;) {
            const i = s.indexOf('EI', desde);
            if (i < 0) { lx.p = s.length; return; }
            const antes = s.charCodeAt(i - 1);
            const despues = s.charCodeAt(i + 2);
            if (ESPACIOS.has(antes) && (i + 2 >= s.length || ESPACIOS.has(despues))) {
                lx.p = i + 2;
                return;
            }
            desde = i + 2;
        }
    };

    const prepararRecursos = async (doc, recursosRef, cache) => {
        const recursos = resolver(doc, recursosRef);
        const fuentes = new Map();
        const formularios = new Map();
        if (esDic(recursos)) {
            const dicFuentes = resolver(doc, recursos.Font);
            if (esDic(dicFuentes)) {
                for (const nombre of Object.keys(dicFuentes)) {
                    fuentes.set(nombre, await cargarFuente(doc, dicFuentes[nombre], cache));
                }
            }
            const dicX = resolver(doc, recursos.XObject);
            if (esDic(dicX)) Object.keys(dicX).forEach((nombre) => formularios.set(nombre, dicX[nombre]));
        }
        return { fuentes, formularios };
    };

    const interpretar = async (doc, contenido, recursosRef, ctmBase, fragmentos, cache, profundidad, visitados) => {
        const { fuentes, formularios } = await prepararRecursos(doc, recursosRef, cache);
        const lx = new Lexer(contenido, 0);
        const pila = [];
        const pilaCtm = [];
        let ctm = ctmBase.slice();
        let tm = IDENTIDAD.slice();
        let tlm = IDENTIDAD.slice();
        let fuente = null;
        let tam = 0;
        let tc = 0;
        let tw = 0;
        let th = 1;
        let tl = 0;

        const numero = (desdeElFinal) => {
            const v = pila[pila.length - desdeElFinal];
            return typeof v === 'number' ? v : 0;
        };

        const moverLinea = (tx, ty) => {
            tlm = multiplicar([1, 0, 0, 1, tx, ty], tlm);
            tm = tlm.slice();
        };

        const mostrar = (cadena) => {
            if (!fuente || !(cadena instanceof Cadena)) return;
            const bytes = cadena.bytes;
            const n = fuente.bytes;
            let texto = '';
            let avance = 0;
            for (let i = 0; i + n <= bytes.length; i += n) {
                let codigo = 0;
                for (let k = 0; k < n; k += 1) codigo = codigo * 256 + (bytes.charCodeAt(i + k) & 255);
                let caracter = fuente.aUnicode ? fuente.aUnicode.get(codigo) : undefined;
                if (caracter === undefined) caracter = fuente.tipo0 ? '' : (fuente.codificacion[codigo] || '');
                texto += caracter;
                const esEspacio = n === 1 && codigo === 32;
                avance += ((fuente.ancho(codigo) / 1000) * tam + tc + (esEspacio ? tw : 0)) * th;
            }
            const m = multiplicar(tm, ctm);
            const escala = Math.hypot(m[2], m[3]) || 1;
            tm = multiplicar([1, 0, 0, 1, avance, 0], tm);
            const m2 = multiplicar(tm, ctm);
            fragmentos.push({ x: m[4], y: m[5], x2: m2[4], texto, tam: Math.abs(tam * escala) || 10 });
        };

        let tok;
        let guardia = 0;
        while ((tok = lx.siguiente())) {
            guardia += 1;
            if (guardia > 3000000) break;
            if (tok.t !== 'op') {
                pila.push(parsearValor(lx, tok));
                continue;
            }

            switch (tok.v) {
                case 'q': pilaCtm.push(ctm.slice()); break;
                case 'Q': if (pilaCtm.length) ctm = pilaCtm.pop(); break;
                case 'cm': if (pila.length >= 6) ctm = multiplicar(pila.slice(-6).map(Number), ctm); break;
                case 'BT': tm = IDENTIDAD.slice(); tlm = IDENTIDAD.slice(); break;
                case 'Tf': {
                    const nombre = pila[pila.length - 2];
                    tam = numero(1);
                    fuente = typeof nombre === 'string' ? (fuentes.get(nombre.slice(1)) || null) : null;
                    break;
                }
                case 'Tc': tc = numero(1); break;
                case 'Tw': tw = numero(1); break;
                case 'Tz': th = numero(1) / 100; break;
                case 'TL': tl = numero(1); break;
                case 'Td': moverLinea(numero(2), numero(1)); break;
                case 'TD': tl = -numero(1); moverLinea(numero(2), numero(1)); break;
                case 'Tm':
                    if (pila.length >= 6) {
                        tlm = pila.slice(-6).map(Number);
                        tm = tlm.slice();
                    }
                    break;
                case 'T*': moverLinea(0, -tl); break;
                case 'Tj': mostrar(pila[pila.length - 1]); break;
                case "'": moverLinea(0, -tl); mostrar(pila[pila.length - 1]); break;
                case '"':
                    tw = numero(3);
                    tc = numero(2);
                    moverLinea(0, -tl);
                    mostrar(pila[pila.length - 1]);
                    break;
                case 'TJ': {
                    const lista = pila[pila.length - 1];
                    if (Array.isArray(lista)) {
                        lista.forEach((elemento) => {
                            if (typeof elemento === 'number') tm = multiplicar([1, 0, 0, 1, (-elemento / 1000) * tam * th, 0], tm);
                            else mostrar(elemento);
                        });
                    }
                    break;
                }
                case 'Do': {
                    const nombre = pila[pila.length - 1];
                    if (typeof nombre !== 'string' || profundidad > 6) break;
                    const ref = formularios.get(nombre.slice(1));
                    const objeto = ref instanceof Ref ? doc.objetos.get(ref.num) : null;
                    if (!objeto || objeto.ini < 0 || !esDic(objeto.valor) || objeto.valor.Subtype !== '/Form') break;
                    if (visitados.has(ref.num)) break;
                    visitados.add(ref.num);
                    try {
                        const datos = bytesATexto(await decodificarStream(doc, objeto));
                        const matrizCruda = resolver(doc, objeto.valor.Matrix);
                        const matriz = Array.isArray(matrizCruda) && matrizCruda.length === 6
                            ? matrizCruda.map((v) => Number(resolver(doc, v)) || 0)
                            : IDENTIDAD;
                        const recursos = objeto.valor.Resources !== undefined ? objeto.valor.Resources : recursosRef;
                        await interpretar(doc, datos, recursos, multiplicar(matriz, ctm), fragmentos, cache, profundidad + 1, visitados);
                    } catch (error) {
                        // Formulario ilegible: se continúa con el resto de la página.
                    }
                    visitados.delete(ref.num);
                    break;
                }
                case 'BI': saltarImagenEnLinea(lx); break;
                default: break;
            }
            pila.length = 0;
        }
    };

    /* ============================================================
       Reconstrucción de líneas
       ============================================================ */

    const armarLineas = (fragmentos) => {
        const utiles = fragmentos.filter((f) => f.texto && f.texto.trim() !== ''
            && Number.isFinite(f.x) && Number.isFinite(f.y));
        utiles.sort((a, b) => (b.y - a.y) || (a.x - b.x));

        const lineas = [];
        utiles.forEach((f) => {
            const ultima = lineas[lineas.length - 1];
            const tolerancia = Math.max(1.5, f.tam * 0.45);
            if (ultima && Math.abs(ultima.y - f.y) <= tolerancia) ultima.fragmentos.push(f);
            else lineas.push({ y: f.y, fragmentos: [f] });
        });

        return lineas.map((linea) => {
            linea.fragmentos.sort((a, b) => a.x - b.x);
            let salida = '';
            let previo = null;
            linea.fragmentos.forEach((f) => {
                if (previo) {
                    const referencia = Math.max(previo.tam, f.tam) || 10;
                    // Texto dibujado dos veces para simular negrita: se descarta la copia.
                    if (f.texto === previo.texto && Math.abs(f.x - previo.x) < referencia * 0.5) return;
                    const hueco = f.x - previo.x2;
                    if (hueco > referencia * 1.1) salida += '  ';
                    else if (hueco > referencia * 0.12 && !salida.endsWith(' ') && !f.texto.startsWith(' ')) salida += ' ';
                }
                salida += f.texto;
                previo = f;
            });
            return salida.replace(/ {3,}/g, '  ').trim();
        }).filter(Boolean);
    };

    /* ============================================================
       API
       ============================================================ */

    const fallo = (codigo, error, extra) => ({ ok: false, codigo, error, lineas: [], texto: '', paginas: 0, ...(extra || {}) });

    /** Lee un PDF (ArrayBuffer o Uint8Array) y devuelve su texto por líneas. */
    const leer = async (entrada) => {
        try {
            const bytes = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
            if (bytes.length > LIMITE_BYTES) return fallo('grande', 'El PDF supera los 15 MB permitidos.');

            const s = bytesATexto(bytes);
            if (s.slice(0, 1024).indexOf('%PDF-') < 0) return fallo('no_pdf', 'El archivo no es un PDF válido.');
            if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(s)) {
                return fallo('cifrado', 'El PDF está protegido. Ábralo y guárdelo de nuevo como PDF sin protección, o registre la factura manualmente.');
            }

            const doc = indexar(s, bytes);
            await expandirFlujosDeObjetos(doc);

            const paginas = localizarPaginas(doc);
            if (!paginas.length) return fallo('error', 'No se encontraron páginas en el PDF.');

            const cache = new Map();
            const avisos = [];
            const lineasPorPagina = [];

            for (const pagina of paginas) {
                const contenidos = resolver(doc, pagina.nodo.Contents);
                const referencias = Array.isArray(contenidos) ? contenidos : [pagina.nodo.Contents];
                let contenido = '';
                for (const ref of referencias) {
                    const objeto = ref instanceof Ref ? doc.objetos.get(ref.num) : null;
                    if (!objeto || objeto.ini < 0) continue;
                    try {
                        contenido += `${bytesATexto(await decodificarStream(doc, objeto))}\n`;
                    } catch (error) {
                        avisos.push(error.message);
                    }
                }
                const fragmentos = [];
                await interpretar(doc, contenido, pagina.recursos, IDENTIDAD, fragmentos, cache, 0, new Set());
                lineasPorPagina.push(armarLineas(fragmentos));
            }

            const lineas = lineasPorPagina.flat();
            const caracteres = lineas.join('').replace(/\s/g, '').length;
            if (caracteres < 20) {
                const sinMapa = [...cache.values()].some((f) => f.tipo0 && !f.aUnicode);
                return fallo('sin_texto', sinMapa
                    ? 'El PDF usa fuentes sin tabla de caracteres, así que su texto no se puede leer. Regístrela manualmente.'
                    : 'El PDF no tiene texto seleccionable (probablemente es una imagen escaneada). Regístrela manualmente.',
                { paginas: paginas.length });
            }

            return {
                ok: true,
                paginas: paginas.length,
                lineas,
                texto: lineasPorPagina.map((ls) => ls.join('\n')).join('\n\n'),
                avisos
            };
        } catch (error) {
            console.error('Lectura de PDF', error);
            return fallo('error', `No fue posible leer el PDF: ${error.message}`);
        }
    };

    return { leer };
})();
