/* ============================================================
   util.js — Utilidades transversales
   Helpers de DOM (sin innerHTML), formato de moneda y fecha,
   redondeo contable y descarga de archivos.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.util = (() => {

    /* ---------- DOM ---------- */

    /**
     * Crea un elemento del DOM sin recurrir a innerHTML.
     * opts: { class, text, html:NO, attrs, dataset, on, style, props }
     */
    const el = (tag, opts = {}, children = []) => {
        const node = document.createElement(tag);

        if (opts.class) node.className = opts.class;
        if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);

        if (opts.attrs) {
            Object.entries(opts.attrs).forEach(([key, value]) => {
                if (value === false || value === null || value === undefined) return;
                node.setAttribute(key, value === true ? '' : String(value));
            });
        }

        if (opts.dataset) {
            Object.entries(opts.dataset).forEach(([key, value]) => {
                node.dataset[key] = String(value);
            });
        }

        if (opts.style) Object.assign(node.style, opts.style);
        if (opts.props) Object.assign(node, opts.props);

        if (opts.on) {
            Object.entries(opts.on).forEach(([evt, handler]) => {
                node.addEventListener(evt, handler);
            });
        }

        appendAll(node, children);
        return node;
    };

    const SVG_NS = 'http://www.w3.org/2000/svg';

    /** Equivalente a el() para el espacio de nombres SVG. */
    const svgEl = (tag, attrs = {}, children = []) => {
        const node = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (value === null || value === undefined || value === false) return;
            if (key === 'text') { node.textContent = String(value); return; }
            if (key === 'on') {
                Object.entries(value).forEach(([evt, handler]) => node.addEventListener(evt, handler));
                return;
            }
            node.setAttribute(key, String(value));
        });
        appendAll(node, children);
        return node;
    };

    const appendAll = (parent, children) => {
        const list = Array.isArray(children) ? children : [children];
        list.forEach((child) => {
            if (child === null || child === undefined || child === false) return;
            if (Array.isArray(child)) { appendAll(parent, child); return; }
            parent.appendChild(typeof child === 'string' || typeof child === 'number'
                ? document.createTextNode(String(child))
                : child);
        });
        return parent;
    };

    /** Vacía un nodo sin usar innerHTML. */
    const clear = (node) => {
        while (node && node.firstChild) node.removeChild(node.firstChild);
        return node;
    };

    const qs = (selector, root = document) => root.querySelector(selector);

    /* ---------- Números y moneda ---------- */

    const copFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });

    const numFormatter = new Intl.NumberFormat('es-CO', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    /** Convierte cualquier entrada a número seguro; nunca devuelve NaN. */
    const toNumber = (value) => {
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        if (value === null || value === undefined) return 0;
        const clean = String(value).trim().replace(/\s/g, '').replace(/\$/g, '');
        if (clean === '') return 0;
        // Acepta tanto "1.234.567,89" como "1234567.89"
        const normalized = clean.includes(',')
            ? clean.replace(/\./g, '').replace(',', '.')
            : clean;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    /** Redondeo contable a 2 decimales, evitando errores de coma flotante. */
    const round2 = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;

    /** Redondeo a pesos enteros (la moneda local no usa centavos en la práctica). */
    const roundCop = (value) => Math.round(toNumber(value));

    const money = (value) => copFormatter.format(roundCop(value));

    /** Moneda compacta para ejes de gráficos. */
    const moneyShort = (value) => {
        const n = toNumber(value);
        const abs = Math.abs(n);
        if (abs >= 1e9) return `${numFormatter.format(round2(n / 1e9))} MM`;
        if (abs >= 1e6) return `${numFormatter.format(round2(n / 1e6))} M`;
        if (abs >= 1e3) return `${numFormatter.format(Math.round(n / 1e3))} k`;
        return numFormatter.format(Math.round(n));
    };

    const num = (value, decimals = 0) => new Intl.NumberFormat('es-CO', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(toNumber(value));

    const pct = (value, decimals = 1) => `${num(toNumber(value), decimals)} %`;

    /** División protegida: devuelve null cuando el resultado no tiene sentido. */
    const safeDiv = (a, b) => {
        const divisor = toNumber(b);
        if (divisor === 0) return null;
        return toNumber(a) / divisor;
    };

    /* ---------- Fechas ---------- */

    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
        'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    /** Todas las fechas del sistema son cadenas ISO 'YYYY-MM-DD' sin zona horaria. */
    const today = () => toISO(new Date());

    const toISO = (date) => {
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return '';
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    };

    /** Interpreta 'YYYY-MM-DD' como fecha local, no UTC (evita el desfase de un día). */
    const parseISO = (iso) => {
        if (!iso || typeof iso !== 'string') return null;
        const parts = iso.slice(0, 10).split('-').map(Number);
        if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    const isValidISO = (iso) => parseISO(iso) !== null;

    const fmtDate = (iso) => {
        const d = parseISO(iso);
        if (!d) return '—';
        return `${String(d.getDate()).padStart(2, '0')} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`;
    };

    const fmtDateLong = (iso) => {
        const d = parseISO(iso);
        if (!d) return '—';
        return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    };

    /** Periodo contable 'YYYY-MM'. */
    const periodOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 7) : '');

    const fmtPeriod = (period) => {
        if (!period || period.length < 7) return '—';
        const [y, m] = period.split('-').map(Number);
        if (!MESES_CORTOS[m - 1]) return period;
        return `${MESES_CORTOS[m - 1]} ${y}`;
    };

    const addDays = (iso, days) => {
        const d = parseISO(iso);
        if (!d) return '';
        d.setDate(d.getDate() + days);
        return toISO(d);
    };

    const addMonths = (iso, months) => {
        const d = parseISO(iso);
        if (!d) return '';
        d.setMonth(d.getMonth() + months);
        return toISO(d);
    };

    const daysBetween = (isoA, isoB) => {
        const a = parseISO(isoA);
        const b = parseISO(isoB);
        if (!a || !b) return 0;
        return Math.round((b - a) / 86400000);
    };

    const startOfMonth = (iso) => `${periodOf(iso)}-01`;

    const endOfMonth = (iso) => {
        const d = parseISO(iso);
        if (!d) return '';
        return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    };

    /** Lunes como primer día de la semana. */
    const startOfWeek = (iso) => {
        const d = parseISO(iso);
        if (!d) return '';
        const shift = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - shift);
        return toISO(d);
    };

    /** Lista de periodos 'YYYY-MM' entre dos fechas, ambos inclusive. */
    const periodRange = (isoFrom, isoTo) => {
        const out = [];
        let cursor = startOfMonth(isoFrom);
        const limit = periodOf(isoTo);
        let guard = 0;
        while (periodOf(cursor) <= limit && guard < 600) {
            out.push(periodOf(cursor));
            cursor = addMonths(cursor, 1);
            guard += 1;
        }
        return out;
    };

    /* ---------- Texto ---------- */

    /** Normaliza para búsquedas: minúsculas y sin tildes. */
    const normalize = (value) => String(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');

    const initials = (name) => String(name ?? '')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || '?';

    const truncate = (value, max = 40) => {
        const text = String(value ?? '');
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    /* ---------- Colecciones ---------- */

    const sum = (list, selector) => (list || []).reduce(
        (acc, item) => acc + toNumber(typeof selector === 'function' ? selector(item) : item), 0);

    const groupBy = (list, selector) => {
        const map = new Map();
        (list || []).forEach((item) => {
            const key = typeof selector === 'function' ? selector(item) : item[selector];
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
        });
        return map;
    };

    const sortBy = (list, selector, dir = 'asc') => {
        const factor = dir === 'desc' ? -1 : 1;
        return [...(list || [])].sort((a, b) => {
            const va = typeof selector === 'function' ? selector(a) : a[selector];
            const vb = typeof selector === 'function' ? selector(b) : b[selector];
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
            return String(va ?? '').localeCompare(String(vb ?? ''), 'es', { numeric: true }) * factor;
        });
    };

    const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

    const debounce = (fn, wait = 220) => {
        let timer = null;
        return (...args) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => fn(...args), wait);
        };
    };

    /* ---------- Bus de eventos ---------- */

    const bus = (() => {
        const listeners = new Map();
        return {
            on(topic, handler) {
                if (!listeners.has(topic)) listeners.set(topic, new Set());
                listeners.get(topic).add(handler);
                return () => listeners.get(topic).delete(handler);
            },
            emit(topic, payload) {
                (listeners.get(topic) || []).forEach((handler) => {
                    try {
                        handler(payload);
                    } catch (error) {
                        console.error(`Error en suscriptor de "${topic}"`, error);
                    }
                });
            }
        };
    })();

    /* ---------- Descarga de archivos ---------- */

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const link = el('a', { attrs: { href: url, download: filename } });
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Se libera después del clic para no invalidar la descarga en curso.
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    };

    return {
        el, svgEl, appendAll, clear, qs, SVG_NS,
        toNumber, round2, roundCop, money, moneyShort, num, pct, safeDiv,
        today, toISO, parseISO, isValidISO, fmtDate, fmtDateLong,
        periodOf, fmtPeriod, addDays, addMonths, daysBetween,
        startOfMonth, endOfMonth, startOfWeek, periodRange, MESES, MESES_CORTOS,
        normalize, initials, truncate,
        sum, groupBy, sortBy, uid, debounce,
        bus, downloadBlob
    };
})();
