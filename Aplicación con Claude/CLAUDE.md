# ERP & Sistema de Gestión Financiera Integral (SaaS Local)

## Rol y Objetivo
Actúa como Arquitecto de Software y Desarrollador Full-Stack Senior especializado en sistemas contables y ERPs empresariales. Tu objetivo es diseñar e implementar una aplicación web moderna, autónoma y modular construida estrictamente con **Vanilla HTML5, CSS3 y JavaScript moderno (ES6+)**, sin frameworks externos pesados, con persistencia local robusta (`localStorage` / `IndexedDB`) y generación de documentos en el cliente.

---

## Restricciones y Reglas de Desarrollo
1. **Stack Tecnológico**: HTML semántico, Vanilla CSS (diseño personalizado, variables CSS, glassmorphism sutil, tipografía Inter/Roboto vía Google Fonts), Vanilla JS modular (módulos ES o arquitectura de servicios desacoplados).
2. **Librerías externas mínimas vía CDN**:
   - `Chart.js` (para gráficos interactivos en dashboards y estados financieros).
   - `jspdf` y `jspdf-autotable` (para generación directa de facturas y reportes PDF descargables).
3. **Flujo de Ejecución en Antigravity**:
   - Genera primero un `implementation_plan.md` con el diseño de base de datos relacional/documental en cliente, arquitectura de módulos y desglose paso a paso.
   - Detén la ejecución y solicita confirmación antes de iniciar la escritura de código.
   - Tras construir, verifica responsividad y funcionamiento visual con el subagente de navegador en resoluciones móvil (375px) y escritorio (1440px).

---

## Módulos y Lógica de Negocio Requerida

### 1. Control de Acceso y Estructura Base
- Autenticación local con roles: **Administrador**, **Contador**, **Vendedor**.
- Layout con **Sidebar colapsable** moderno con navegación intuitiva por módulos y barra superior con indicador de usuario activo y selector de tema (Dark/Light Mode).

### 2. Base de Datos Integrada y Transaccionalidad Automática
- **Clientes y Proveedores**: Registro completo (Documento/NIT, Nombre, Teléfono, Email, Dirección, Límite de crédito y Estado de cuenta).
- **Inventario**: Catálogo de productos/servicios con SKU, nombre, categoría, unidad de medida, stock mínimo, precio de costo y precio de venta.
- **Compras y Gastos**:
  - Registro de compras que incrementa automáticamente las existencias de inventario y actualiza el costo ponderado.
  - Registro de gastos operativos/administrativos categorizados para imputación a estados financieros.
- **Ventas, Facturación y Crédito**:
  - Emisión de ventas de contado o a crédito.
  - Cada venta resta existencias en tiempo real de inventario y genera alerta si el stock cae bajo el mínimo.
  - Si es a crédito: apertura automática de cuenta por cobrar (CxC) vinculada al cliente.
  - **Módulo de Abonos**: Registro de abonos parciales o totales que amortizan el saldo adeudado del cliente en tiempo real.
  - **Factura PDF**: Botón de descarga instantánea de factura comercial profesional con desglose de ítems, impuestos, totales y estado de pago.

### 3. Dashboard Ejecutivo e Inteligencia de Negocio
- Filtros dinámicos sincronizados: Rango de fechas (Hoy, Esta semana, Mes actual, Rango personalizado) y por Producto/Categoría.
- Tarjetas de KPIs: Ingresos Totales, Costo de Ventas, Utilidad Bruta, Gastos Operativos, Cuentas por Cobrar (CxC pendientes) y Valor total del Inventario.
- Gráficas interactivas con `Chart.js`: Ventas vs. Gastos en el tiempo, Productos más vendidos y Distribución de gastos.

### 4. Motor de Estados Financieros en Tiempo Real
Generados simultáneamente a partir de las transacciones registradas:
1. **Estado de Resultados (P&G)**: Ingresos Operacionales - Costo de Ventas = Utilidad Bruta - Gastos = Utilidad Operacional / Neta.
2. **Balance General**: Activos (Caja/Bancos, CxC, Inventario) vs. Pasivos (Cuentas por Pagar, deudas) vs. Patrimonio.
3. **Flujo de Caja (Cash Flow)**: Entradas reales de efectivo (ventas contado + abonos) menos salidas reales (compras contado + pagos a proveedores + gastos pagados).
4. **Presupuesto vs. Real**: Matriz editable donde se definen presupuestos mensuales por categoría y se contrasta contra la ejecución real.
5. **Indicadores Financieros**: Margen Bruto (%), Margen Neto (%), Razón Corriente (Liquidez) y Rotación de Cartera.

### 5. Secciones de Análisis Financiero y Herramientas Especiales
- **Punto de Equilibrio**: Calculadora dinámica con inputs para Costos Fijos Mensuales, Precio de Venta Promedio y Costo Variable Unitario, graficando ingresos vs. costos totales con el punto de equilibrio en unidades y dinero.
- **Simulador de Préstamos**: Cálculo de tablas de amortización (Método Francés con cuota fija y Alemán con abono a capital constante), desglose de capital, interés y saldo restante con exportación a tabla/PDF.
- **Liquidación de Nómina**: Módulo de liquidación periódica por empleado (Salario básico, auxilio de transporte condicional, horas extras/recargos, deducciones de salud/pensión 4% y provisiones prestacionales).

---

## Criterios de Calidad y Finalización
- Código modular en archivos limpios: `index.html`, `styles.css`, `app.js` y submódulos en `/modules/` (`db.js`, `inventory.js`, `billing.js`, `financials.js`, `pdfGenerator.js`).
- Persistencia de datos precargada con datos de demostración realistas (mock data) para poder probar y auditar cada módulo de inmediato sin empezar en blanco.
- Sin errores en consola del navegador.
