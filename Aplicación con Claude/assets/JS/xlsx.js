/* ============================================================
   xlsx.js — Escritor nativo de libros de Excel (.xlsx)
   Un .xlsx es un ZIP con piezas XML. Se arma aquí byte a byte,
   sin librerías (Agents.md, sección 3), para que el archivo abra
   en Excel sin advertencias y con datos realmente tipados:
   números que suman, fechas que ordenan y filtros activos.
   ============================================================ */

window.ERP = window.ERP || {};

ERP.excel = (() => {
    const U = ERP.util;
    const codificador = new TextEncoder();
    const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    /* ============================================================
       ZIP sin compresión
       Los libros que genera la aplicación son pequeños: guardar sin
       comprimir mantiene la escritura síncrona y simple.
       ============================================================ */

    const TABLA_CRC = (() => {
        const tabla = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            tabla[n] = c >>> 0;
        }
        return tabla;
    })();

    const crc32 = (bytes) => {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i += 1) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    };

    const empaquetarZip = (archivos) => {
        const ahora = new Date();
        const horaDos = ((ahora.getHours() << 11) | (ahora.getMinutes() << 5) | Math.floor(ahora.getSeconds() / 2)) & 0xFFFF;
        const fechaDos = (((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate()) & 0xFFFF;

        const locales = [];
        const centrales = [];
        let desplazamiento = 0;

        archivos.forEach(({ nombre, datos }) => {
            const nombreBytes = codificador.encode(nombre);
            const crc = crc32(datos);

            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);
            local.setUint16(6, 0x0800, true);        // nombres en UTF-8
            local.setUint16(8, 0, true);             // sin compresión
            local.setUint16(10, horaDos, true);
            local.setUint16(12, fechaDos, true);
            local.setUint32(14, crc, true);
            local.setUint32(18, datos.length, true);
            local.setUint32(22, datos.length, true);
            local.setUint16(26, nombreBytes.length, true);
            local.setUint16(28, 0, true);
            locales.push(new Uint8Array(local.buffer), nombreBytes, datos);

            const central = new DataView(new ArrayBuffer(46));
            central.setUint32(0, 0x02014b50, true);
            central.setUint16(4, 20, true);
            central.setUint16(6, 20, true);
            central.setUint16(8, 0x0800, true);
            central.setUint16(10, 0, true);
            central.setUint16(12, horaDos, true);
            central.setUint16(14, fechaDos, true);
            central.setUint32(16, crc, true);
            central.setUint32(20, datos.length, true);
            central.setUint32(24, datos.length, true);
            central.setUint16(28, nombreBytes.length, true);
            central.setUint16(30, 0, true);
            central.setUint16(32, 0, true);
            central.setUint16(34, 0, true);
            central.setUint16(36, 0, true);
            central.setUint32(38, 0, true);
            central.setUint32(42, desplazamiento, true);
            centrales.push(new Uint8Array(central.buffer), nombreBytes);

            desplazamiento += 30 + nombreBytes.length + datos.length;
        });

        const tamanoCentral = centrales.reduce((acc, parte) => acc + parte.length, 0);
        const cierre = new DataView(new ArrayBuffer(22));
        cierre.setUint32(0, 0x06054b50, true);
        cierre.setUint16(4, 0, true);
        cierre.setUint16(6, 0, true);
        cierre.setUint16(8, archivos.length, true);
        cierre.setUint16(10, archivos.length, true);
        cierre.setUint32(12, tamanoCentral, true);
        cierre.setUint32(16, desplazamiento, true);
        cierre.setUint16(20, 0, true);

        const partes = [...locales, ...centrales, new Uint8Array(cierre.buffer)];
        const total = partes.reduce((acc, parte) => acc + parte.length, 0);
        const salida = new Uint8Array(total);
        let posicion = 0;
        partes.forEach((parte) => {
            salida.set(parte, posicion);
            posicion += parte.length;
        });
        return salida;
    };

    /* ============================================================
       Utilidades XML y de celdas
       ============================================================ */

    const escaparXml = (valor) => String(valor ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const letraColumna = (indice) => {
        let n = indice + 1;
        let letras = '';
        while (n > 0) {
            const resto = (n - 1) % 26;
            letras = String.fromCharCode(65 + resto) + letras;
            n = Math.floor((n - 1) / 26);
        }
        return letras;
    };

    /** Número de serie de Excel (días desde 1899-12-30) a partir de 'YYYY-MM-DD'. */
    const serialFecha = (iso) => {
        const fecha = U.parseISO(iso);
        if (!fecha) return null;
        return (Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
    };

    const ESTILO = {
        cabecera: 1, moneda: 2, fecha: 3, entero: 4, porcentaje: 5, numero: 6, texto: 7,
        totalTexto: 8, totalMoneda: 9, totalEntero: 10, totalNumero: 11
    };

    const ESTILO_TOTAL = { moneda: ESTILO.totalMoneda, entero: ESTILO.totalEntero, numero: ESTILO.totalNumero };

    const NUMERICOS = new Set(['moneda', 'entero', 'numero', 'porcentaje']);

    const nombreHojaSeguro = (nombre, usados) => {
        const base = String(nombre || 'Hoja').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
        let final = base;
        let contador = 2;
        while (usados.has(final.toLowerCase())) {
            const sufijo = ` (${contador})`;
            final = base.slice(0, 31 - sufijo.length) + sufijo;
            contador += 1;
        }
        usados.add(final.toLowerCase());
        return final;
    };

    /* ============================================================
       Piezas del libro
       ============================================================ */

    const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

    const estilosXml = () => `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5">
<numFmt numFmtId="164" formatCode="&quot;$&quot; #,##0;[Red]-&quot;$&quot; #,##0"/>
<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>
<numFmt numFmtId="166" formatCode="#,##0"/>
<numFmt numFmtId="167" formatCode="0.0%"/>
<numFmt numFmtId="168" formatCode="#,##0.00"/>
</numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF7B2FF7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF0E7FF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF7B2FF7"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="168" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const celdaXml = (referencia, valor, tipo) => {
        if (valor === null || valor === undefined || valor === '') return '';

        if (tipo === 'fecha') {
            const serial = serialFecha(valor);
            if (serial !== null) return `<c r="${referencia}" s="${ESTILO.fecha}"><v>${serial}</v></c>`;
        }

        if (NUMERICOS.has(tipo)) {
            const numero = Number(valor);
            if (!Number.isFinite(numero)) return '';
            return `<c r="${referencia}" s="${ESTILO[tipo]}"><v>${numero}</v></c>`;
        }

        return `<c r="${referencia}" t="inlineStr" s="${ESTILO.texto}"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
    };

    const hojaXml = (hoja, esPrimera) => {
        const columnas = hoja.columnas || [];
        const filas = hoja.filas || [];
        const ultimaColumna = letraColumna(Math.max(0, columnas.length - 1));
        const filaFinDatos = filas.length + 1;
        const conTotales = Boolean(hoja.totales) && filas.length > 0
            && columnas.some((col) => ESTILO_TOTAL[col.tipo] !== undefined);
        const filaTotal = filaFinDatos + 1;
        const ultimaFila = conTotales ? filaTotal : filaFinDatos;

        const anchos = columnas.map((col, indice) => {
            if (col.ancho) return col.ancho;
            if (col.tipo === 'moneda') return 17;
            if (col.tipo === 'fecha') return 12;
            let maximo = String(col.titulo || '').length;
            filas.slice(0, 400).forEach((fila) => {
                const largo = String(fila[indice] ?? '').length;
                if (largo > maximo) maximo = largo;
            });
            return Math.min(60, Math.max(9, maximo + 2));
        });

        const partes = [];
        partes.push(`${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`);
        partes.push(`<dimension ref="A1:${ultimaColumna}${ultimaFila}"/>`);
        partes.push(`<sheetViews><sheetView workbookViewId="0"${esPrimera ? ' tabSelected="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`);
        partes.push('<sheetFormatPr defaultRowHeight="15"/>');
        partes.push(`<cols>${anchos.map((ancho, i) => `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`).join('')}</cols>`);
        partes.push('<sheetData>');

        partes.push(`<row r="1" ht="24" customHeight="1">${columnas.map((col, i) => `<c r="${letraColumna(i)}1" t="inlineStr" s="${ESTILO.cabecera}"><is><t xml:space="preserve">${escaparXml(col.titulo)}</t></is></c>`).join('')}</row>`);

        filas.forEach((fila, indiceFila) => {
            const r = indiceFila + 2;
            const celdas = columnas.map((col, i) => celdaXml(`${letraColumna(i)}${r}`, fila[i], col.tipo || 'texto')).join('');
            partes.push(`<row r="${r}">${celdas}</row>`);
        });

        if (conTotales) {
            const celdas = columnas.map((col, i) => {
                const referencia = `${letraColumna(i)}${filaTotal}`;
                const estiloTotal = ESTILO_TOTAL[col.tipo];
                if (estiloTotal !== undefined) {
                    const suma = filas.reduce((acc, fila) => acc + (Number.isFinite(Number(fila[i])) ? Number(fila[i]) : 0), 0);
                    // SUBTOTAL(9, …) respeta los filtros que el usuario aplique en Excel.
                    return `<c r="${referencia}" s="${estiloTotal}"><f>SUBTOTAL(9,${letraColumna(i)}2:${letraColumna(i)}${filaFinDatos})</f><v>${suma}</v></c>`;
                }
                if (i === 0) return `<c r="${referencia}" t="inlineStr" s="${ESTILO.totalTexto}"><is><t>TOTAL</t></is></c>`;
                return `<c r="${referencia}" s="${ESTILO.totalTexto}"/>`;
            }).join('');
            partes.push(`<row r="${filaTotal}">${celdas}</row>`);
        }

        partes.push('</sheetData>');
        if (columnas.length) partes.push(`<autoFilter ref="A1:${ultimaColumna}${filaFinDatos}"/>`);
        partes.push('</worksheet>');
        return partes.join('');
    };

    /* ============================================================
       API
       ============================================================ */

    /**
     * opciones: { archivo, titulo, hojas: [{ nombre, columnas: [{ titulo, tipo, ancho }],
     *             filas: [[valor, …]], totales }] }
     * tipos: 'texto' | 'moneda' | 'numero' | 'entero' | 'fecha' (ISO) | 'porcentaje' (fracción)
     */
    const construir = (opciones) => {
        const usados = new Set();
        const hojas = (opciones.hojas || []).map((hoja) => ({ ...hoja, nombre: nombreHojaSeguro(hoja.nombre, usados) }));
        if (hojas.length === 0) hojas.push({ nombre: 'Hoja', columnas: [], filas: [] });

        const creado = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        const autor = escaparXml((ERP.db && ERP.db.config && ERP.db.config().empresa) || 'ERP');

        const archivos = [];
        const agregar = (nombre, texto) => archivos.push({ nombre, datos: codificador.encode(texto) });

        agregar('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);

        agregar('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);

        agregar('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escaparXml(opciones.titulo || opciones.archivo || 'Exportación')}</dc:title>
<dc:creator>${autor}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${creado}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${creado}</dcterms:modified>
</cp:coreProperties>`);

        agregar('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ERP Andina</Application></Properties>`);

        const filtros = hojas
            .map((hoja, i) => {
                const columnas = (hoja.columnas || []).length;
                if (!columnas) return '';
                const nombre = hoja.nombre.replace(/'/g, "''");
                return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escaparXml(nombre)}'!$A$1:$${letraColumna(columnas - 1)}$${(hoja.filas || []).length + 1}</definedName>`;
            })
            .filter(Boolean)
            .join('');

        agregar('xl/workbook.xml', `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${hojas.map((hoja, i) => `<sheet name="${escaparXml(hoja.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${filtros ? `<definedNames>${filtros}</definedNames>` : ''}
</workbook>`);

        agregar('xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

        agregar('xl/styles.xml', estilosXml());
        hojas.forEach((hoja, i) => agregar(`xl/worksheets/sheet${i + 1}.xml`, hojaXml(hoja, i === 0)));

        return empaquetarZip(archivos);
    };

    const descargar = (opciones) => {
        const bytes = construir(opciones);
        U.downloadBlob(new Blob([bytes], { type: MIME }), opciones.archivo || nombreArchivo('exportacion'));
        return bytes.length;
    };

    const nombreArchivo = (base) => `${base}-${U.today()}.xlsx`;

    return { construir, descargar, nombreArchivo, MIME };
})();
