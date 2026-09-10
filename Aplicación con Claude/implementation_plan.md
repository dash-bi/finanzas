# Plan de implementación — ERP y Gestión Financiera Integral

Documento exigido por `CLAUDE.md` (sección "Flujo de Ejecución") y por `Agents.md` §2.6.

---

## 1. Decisiones de arquitectura

| Decisión | Elección | Razón |
| --- | --- | --- |
| Stack | HTML5 + CSS3 + JS nativo, sin build | `Agents.md` §3 |
| Dependencias | Ninguna | Gráficos en SVG nativo y escritor de PDF propio |
| Módulos JS | Scripts clásicos con namespace `ERP` | Permite abrir `index.html` con doble clic; los módulos ES exigen servidor HTTP |
| Persistencia | `localStorage` tras la capa `db.js` | Sin credenciales de Supabase; interfaz preparada para sustituirlo |
| Render | `document.createElement` en toda la app | `Agents.md` §9 prohíbe `innerHTML` |
| Feedback | Toasts, modales y estados propios | `Agents.md` §10 prohíbe `alert/confirm/prompt` |

---

## 2. Modelo de datos

Diseñado como modelo relacional para poder migrarse a PostgreSQL sin rediseño.

```text
usuarios(id PK, usuario UNIQUE, clave, nombre, rol)

terceros(id PK, tipo['cliente'|'proveedor'], tipoDoc, documento UNIQUE,
         nombre, telefono, email, direccion, limiteCredito, activo)

productos(id PK, sku UNIQUE, nombre, categoria, unidad,
          stock, stockMinimo, costo, precio, activo)

compras(id PK, numero UNIQUE, fecha, proveedorId FK->terceros,
        condicion['contado'|'credito'], subtotal, iva, total, saldo)
compraItems(compraId FK, productoId FK, cantidad, costoUnitario)

ventas(id PK, numero UNIQUE, fecha, clienteId FK->terceros,
       condicion['contado'|'credito'], subtotal, iva, total, saldo, anulada)
ventaItems(ventaId FK, productoId FK, cantidad, precioUnitario, costoUnitario)

gastos(id PK, fecha, categoria, descripcion, valor, pagado, origen)

abonos(id PK, fecha, ventaId FK->ventas, valor, medio)          -- amortiza CxC
pagosCompra(id PK, fecha, compraId FK->compras, valor, medio)   -- amortiza CxP

presupuestos(id PK, periodo 'YYYY-MM', categoria, monto)

empleados(id PK, documento UNIQUE, nombre, cargo, salario, auxilioTransporte, activo)
nominas(id PK, empleadoId FK, periodo, dias, hExtraDiurna, hExtraNocturna,
        bonificaciones, otrasDeducciones, ...calculado)

config(empresa, nit, direccion, telefono, email, ivaPct, capitalInicial,
       salarioMinimo, auxilioTransporte, topeAuxilio, consecutivos)
```

### Reglas de integridad aplicadas por la capa de datos

1. `costoUnitario` de una venta se **congela** al momento de emitirla → el costo de ventas no cambia retroactivamente.
2. Una compra recalcula el **costo promedio ponderado**:
   `costo = (stock·costo + cantidad·costoCompra) / (stock + cantidad)`
3. `saldo` de venta/compra nunca queda negativo; un abono no puede exceder el saldo.
4. Una venta a crédito valida el **cupo disponible** del cliente antes de guardarse.
5. Una venta valida **stock suficiente** de productos inventariables antes de guardarse.
6. La caja es **derivada**, nunca almacenada:
   `caja = capitalInicial + ventasContado + abonos − comprasContado − pagosCompra − gastosPagados`

---

## 3. Arquitectura de archivos

```text
Aplicación con Claude/
├── index.html                  Estructura semántica + contenedores de vistas
├── CLAUDE.md                   Especificación funcional
├── implementation_plan.md      Este documento
└── assets/
    ├── CSS/
    │   ├── base.css            Reset, variables de tema, tipografía, utilidades
    │   ├── layout.css          Sidebar, topbar, grid, login, responsive
    │   └── components.css      Botones, tablas, modales, toasts, KPIs, gráficos
    ├── IMG/
    │   └── logo.svg            Identidad de la aplicación
    └── JS/
        ├── util.js             DOM helper, formateo, fechas, cálculo, descarga
        ├── db.js               CAPA DE DATOS única + semilla de demostración
        ├── ui.js               Toast, modal, tabla, KPI, estados (loading/empty/error)
        ├── charts.js           Gráficos SVG nativos e interactivos
        ├── pdf.js              Escritor de PDF nativo (facturas y reportes)
        ├── auth.js             Sesión, roles y permisos por módulo
        ├── contacts.js         Clientes y proveedores + estado de cuenta
        ├── inventory.js        Catálogo, stock, alertas de mínimo, kardex
        ├── purchases.js        Compras (entrada de inventario) y gastos
        ├── billing.js          Ventas, facturación, cartera y abonos
        ├── dashboard.js        KPIs, filtros sincronizados y gráficos
        ├── financials.js       P&G, balance, flujo de caja, presupuesto, indicadores
        ├── tools.js            Punto de equilibrio y simulador de préstamos
        ├── payroll.js          Liquidación de nómina
        └── app.js              Arranque, router, layout, tema
```

---

## 4. Flujo de información

```text
db.js (localStorage)
   ↓  lectura única en memoria
ERP.state.data
   ↓  normalización (join de ítems, tercero y producto)
ERP.state.filters  ──►  selectores de dominio
   ↓
datos filtrados
   ↓
┌──────────┬──────────┬──────────┐
│   KPIs   │ GRÁFICOS │  TABLAS  │
└──────────┴──────────┴──────────┘
```

Un solo evento (`ERP.bus`) notifica cambios de datos o de filtros; cada vista suscrita se vuelve a renderizar. Nunca se recalcula un KPI con un conjunto de datos distinto al de su gráfico.

---

## 5. Pasos de construcción

1. `base.css`, `layout.css`, `components.css`, `logo.svg` — sistema visual y temas.
2. `util.js` — helpers de DOM, formato de moneda COP, fechas, redondeo contable.
3. `db.js` — esquema, CRUD, reglas transaccionales, semilla de demostración.
4. `ui.js` — toasts, modales, tablas con orden/búsqueda/paginación, estados.
5. `charts.js` — línea, barra, dona y gráfico de punto de equilibrio en SVG.
6. `pdf.js` — escritor PDF, factura comercial y reporte tabular.
7. `auth.js` + `app.js` — login, roles, sidebar colapsable, router, tema.
8. Módulos de negocio: `contacts`, `inventory`, `purchases`, `billing`.
9. `dashboard.js` y `financials.js` — inteligencia de negocio.
10. `tools.js` y `payroll.js` — herramientas especiales.
11. Verificación: consola limpia, 375 px y 1440 px, cuadre del balance.

---

## 6. Verificación de cierre

Ejecutada el 9 de septiembre de 2026 sobre la demostración precargada (240 ventas, 58 compras, 77 gastos).

- [x] Sin errores en consola.
- [x] Balance general cuadra (Activo = Pasivo + Patrimonio).
- [x] Una venta a crédito descuenta stock, abre CxC y aparece en cartera.
- [x] Un abono reduce el saldo y cambia el estado de la factura.
- [x] Una compra sube stock y recalcula costo ponderado.
- [x] La factura PDF se descarga y abre correctamente.
- [x] Los filtros del dashboard afectan KPIs, gráficos y tablas a la vez.
- [x] Layout usable en 375 px y en 1440 px.
