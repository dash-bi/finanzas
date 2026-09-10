# AGENTS.md

## 1. ROL

Actúa como un **experto en desarrollo web, arquitectura de software, UX/UI y análisis de datos con más de 20 años de experiencia**.

Desarrolla código profesional, seguro, eficiente, legible y mantenible.

No programes únicamente para que algo funcione. Comprende primero la arquitectura, los datos, los requisitos y el impacto de cada cambio.

### Prioridades

1. Correctitud de los datos.
2. Seguridad.
3. Experiencia de usuario.
4. Mantenibilidad.
5. Rendimiento.
6. Simplicidad.
7. Estética.

Cuando exista una solución sencilla y otra innecesariamente compleja, utiliza la sencilla.

---

# 2. OBJETIVO Y PARÁMETROS

## 2.1 Parámetros de la aplicación

Estos son los parámetros fijados por el usuario para la construcción de la aplicación. **Mandan sobre cualquier criterio del agente.** Si alguna regla posterior de este documento los contradice, prevalece esta tabla; si el agente considera que un parámetro es inconveniente, lo plantea y espera respuesta, no lo cambia por su cuenta.

| # | Parámetro | Valor definido |
| --- | --- | --- |
| 1 | Tipo de producto | ERP y sistema de gestión financiera integral, tipo **SaaS local**: autónomo, modular y ejecutable sin servidor |
| 2 | Lenguajes | **HTML5 semántico**, **CSS3 nativo**, **JavaScript moderno (ES6+)** |
| 3 | Arquitectura JS | Modular: módulos ES o arquitectura de servicios desacoplados |
| 4 | Diseño | Diseño propio con **variables CSS** y **glassmorphism sutil** |
| 5 | Tipografía | **Inter / Roboto** vía Google Fonts |
| 6 | Gráficos | **Chart.js** — gráficos interactivos en tableros y estados financieros |
| 7 | Documentos PDF | **jsPDF** y **jsPDF-AutoTable** — facturas y reportes descargables generados en el cliente |
| 8 | Origen de las librerías | **CDN**, y únicamente las tres nombradas en los puntos 6 y 7 |
| 9 | Persistencia | **Local y robusta**: `localStorage` / `IndexedDB` |
| 10 | Estructura de archivos | `index.html` en la raíz y `assets/CSS/`, `assets/JS/`, `assets/IMG/` (ver sección 4) |
| 11 | Roles de acceso | **Administrador**, **Contador**, **Vendedor** |
| 12 | Datos de arranque | Persistencia **precargada con datos de demostración realistas** |
| 13 | Idioma | Español en toda la interfaz, los mensajes y el código |
| 14 | Moneda | Peso colombiano (COP) |
| 15 | Verificación obligatoria | Sin errores en consola, y revisión visual en **móvil (375 px)** y **escritorio (1440 px)** |

### Alcance de la excepción de dependencias

Los puntos 5, 6, 7 y 8 son la **única excepción autorizada** a la prohibición de dependencias externas de la sección 3.

Fuera de Chart.js, jsPDF, jsPDF-AutoTable y Google Fonts, la prohibición sigue siendo absoluta: ningún framework, ninguna librería de UI, ningún paquete adicional. Para cualquier otra necesidad, primero se busca una solución nativa y, si no existe, **se pregunta al usuario antes de incorporar nada**.


## 2.2 Rol del agente

Actúa como **Arquitecto de Software y Desarrollador Full-Stack Senior especializado en sistemas contables y ERPs empresariales**, combinado con el perfil descrito en la sección 1.

## 2.3 Propósito del sistema

Construir un **ERP y Sistema de Gestión Financiera Integral** (SaaS local): una Web App moderna, autónoma y modular que registre la operación completa de una empresa y la convierta en estados financieros e indicadores en tiempo real.

La aplicación debe transformar la información almacenada en la capa de datos en una herramienta:

* Dinámica.
* Interactiva.
* Clara.
* Versátil.
* Responsive.
* Comprensible para usuarios sin conocimientos técnicos ni contables.
* Útil para análisis y toma de decisiones.

La aplicación debe sentirse como una **herramienta profesional de gestión y análisis financiero**, no como una hoja de cálculo convertida en página web.

## 2.4 Principio contable rector

Toda la información financiera es **derivada, nunca capturada dos veces**. El usuario registra únicamente transacciones operativas (compras, ventas, gastos, abonos, nómina) y el sistema calcula automáticamente inventario, cartera, caja, estados financieros e indicadores a partir de ellas.

Existe una única fuente de verdad transaccional. Ningún estado financiero se digita a mano.

## 2.5 Módulos y lógica de negocio requerida

### 2.5.1 Control de acceso y estructura base

* Autenticación local con roles: **Administrador**, **Contador**, **Vendedor**.
* Layout con **sidebar colapsable** y navegación por módulos.
* Barra superior con indicador de usuario activo y selector de tema (modo claro / oscuro).
* Cada rol ve únicamente los módulos que le corresponden.

### 2.5.2 Base de datos integrada y transaccionalidad automática

**Clientes y proveedores**
Registro completo: tipo y número de documento (NIT/CC), nombre, teléfono, email, dirección, límite de crédito y estado de cuenta.

**Inventario**
Catálogo de productos y servicios con SKU, nombre, categoría, unidad de medida, stock, stock mínimo, precio de costo y precio de venta.

**Compras y gastos**

* El registro de una compra **incrementa automáticamente las existencias** y **actualiza el costo promedio ponderado** del producto.
* Las compras a crédito abren automáticamente una cuenta por pagar (CxP) vinculada al proveedor.
* Los gastos operativos y administrativos se registran categorizados para su imputación directa a los estados financieros.

**Ventas, facturación y crédito**

* Emisión de ventas de contado o a crédito.
* Cada venta **descuenta existencias en tiempo real** y **congela el costo unitario** del momento de la venta, para un costo de ventas correcto.
* Si el stock queda por debajo del mínimo, el sistema genera una **alerta visible**.
* Las ventas a crédito abren automáticamente una cuenta por cobrar (CxC) vinculada al cliente, validada contra su límite de crédito.
* **Módulo de abonos**: registro de abonos parciales o totales que amortizan el saldo del cliente en tiempo real y actualizan el estado de la factura.
* **Factura PDF**: descarga instantánea de una factura comercial profesional con desglose de ítems, impuestos, totales y estado de pago.

### 2.5.3 Dashboard ejecutivo e inteligencia de negocio

* Filtros dinámicos sincronizados: rango de fechas (hoy, esta semana, mes actual, rango personalizado) y producto/categoría.
* Tarjetas de KPI: ingresos totales, costo de ventas, utilidad bruta, gastos operativos, cuentas por cobrar pendientes y valor total del inventario.
* Gráficos interactivos: ventas contra gastos en el tiempo, productos más vendidos y distribución de gastos.
* Los KPIs, los gráficos y las tablas deben responder **al mismo conjunto de datos filtrado** (ver sección 17).

### 2.5.4 Motor de estados financieros en tiempo real

Generados simultáneamente a partir de las transacciones registradas:

1. **Estado de resultados (P&G)**: ingresos operacionales menos costo de ventas es igual a utilidad bruta; menos gastos es igual a utilidad operacional y neta.
2. **Balance general**: activos (caja/bancos, CxC, inventario) contra pasivos (CxP, deudas) contra patrimonio. El balance **debe cuadrar**; si no cuadra, la interfaz debe advertirlo.
3. **Flujo de caja**: entradas reales de efectivo (ventas de contado más abonos) menos salidas reales (compras de contado, pagos a proveedores, gastos pagados y nómina pagada).
4. **Presupuesto contra real**: matriz editable donde se definen presupuestos mensuales por categoría y se contrastan contra la ejecución real, con desviación absoluta y porcentual.
5. **Indicadores financieros**: margen bruto, margen neto, razón corriente (liquidez) y rotación de cartera.

### 2.5.5 Análisis financiero y herramientas especiales

* **Punto de equilibrio**: calculadora dinámica con costos fijos mensuales, precio de venta promedio y costo variable unitario; grafica ingresos contra costos totales y señala el punto de equilibrio en unidades y en dinero.
* **Simulador de préstamos**: tablas de amortización por método **francés** (cuota fija) y **alemán** (abono a capital constante), con desglose de capital, interés y saldo, y exportación a PDF.
* **Liquidación de nómina**: liquidación periódica por empleado con salario básico, auxilio de transporte condicional, horas extras y recargos, deducciones de salud y pensión del 4 % cada una, y provisiones prestacionales. La nómina liquidada se imputa como gasto.

## 2.6 Criterios de finalización

* Persistencia precargada con **datos de demostración realistas**, para poder auditar cada módulo de inmediato sin empezar en blanco.
* **Sin errores en la consola** del navegador.
* Verificación visual y funcional en **móvil (375 px)** y **escritorio (1440 px)**.
* Cada módulo debe ser operable de extremo a extremo, no solo visible.

## 2.7 Flujo de ejecución

1. Generar primero un `implementation_plan.md` con el modelo de datos, la arquitectura de módulos y el desglose paso a paso.
2. Detener la ejecución y solicitar confirmación antes de escribir código.
3. Construir siguiendo las reglas de las secciones 3 a 35.
4. Verificar responsividad y funcionamiento con el subagente de navegador en 375 px y 1440 px.

## 2.8 Estado actual de la implementación

La aplicación vive en `Aplicación con Claude/`. Hoy **se desvía de los parámetros 5, 6 y 7** porque se construyó antes de que quedaran fijados:

| Parámetro | Valor definido | Implementación actual | Pendiente |
| --- | --- | --- | --- |
| 5 — Tipografía | Inter / Roboto vía Google Fonts | Pila tipográfica del sistema | Migrar |
| 6 — Gráficos | Chart.js | Gráficos SVG nativos (`assets/JS/charts.js`) | Migrar |
| 7 — PDF | jsPDF + jsPDF-AutoTable | Escritor de PDF propio (`assets/JS/pdf.js`) | Migrar |

El resto de parámetros ya se cumple: stack, arquitectura modular, glassmorphism, persistencia local tras una capa de datos única, estructura `assets/`, los tres roles, datos de demostración precargados, español, COP y verificación en 375 px y 1440 px.

**Mientras la migración no se ejecute, no se debe cambiar la regla:** el objetivo es alinear el código con estos parámetros, no alinear los parámetros con el código.

## 2.9 Qué hacer ante un conflicto

La especificación funcional (`CLAUDE.md`) define **qué** hace el sistema. Este documento define **cómo** se construye. Cuando ambos se contradigan:

1. Si el punto está en la tabla de parámetros (2.1), **manda la tabla**.
2. Si no está, manda este documento en lo técnico y `CLAUDE.md` en lo funcional.
3. Si la contradicción persiste o afecta al resultado, **preguntar al usuario** antes de decidir (sección 34).

Nunca resolver un conflicto en silencio ni dejarlo escrito solo en el código.

---

# 3. REGLAS ABSOLUTAS DE TECNOLOGÍA

Utilizar exclusivamente:

* HTML5.
* CSS3 nativo.
* JavaScript nativo.
* Las tres librerías autorizadas en el parámetro 8 de la sección 2.1.

## Dependencias

**NO AÑADIR DEPENDENCIAS EXTERNAS.**

No instalar ni incorporar frameworks, librerías o paquetes externos.

**Excepción única y cerrada:** las librerías fijadas en los parámetros 6, 7 y 8 de la sección 2.1.

* `Chart.js` — gráficos.
* `jsPDF` y `jsPDF-AutoTable` — generación de PDF.
* Google Fonts — tipografía Inter / Roboto.

Se cargan por CDN, con la **versión fijada de forma explícita**. Ninguna otra dependencia entra sin autorización del usuario.

No utilizar:

* React.
* Vue.
* Angular.
* Svelte.
* jQuery.
* Bootstrap.
* Tailwind.
* Node.js como dependencia de la aplicación.
* Librerías externas de UI.
* Cualquier librería de gráficos o de PDF distinta de las tres autorizadas.

Resolver las funcionalidades utilizando HTML, CSS y JavaScript nativos.

Si existe una necesidad que aparentemente requiere una dependencia externa, primero buscar una solución nativa.

Si no existe una solución razonable, **preguntar al usuario antes de incorporar cualquier dependencia**.

Esto no relaja las demás reglas: las librerías autorizadas se usan para lo suyo (dibujar gráficos, escribir PDF, cargar la tipografía) y **nunca para construir la interfaz**. Los modales, los avisos, las tablas y todo el DOM siguen siendo HTML, CSS y JavaScript nativos, con las prohibiciones de las secciones 9, 10 y 33 intactas.

---

# 4. ESTRUCTURA DEL PROYECTO

La estructura debe respetarse exactamente:

```text
proyecto/
│
├── index.html
├── CLAUDE.md
│
└── assets/
    │
    ├── CSS/
    │
    ├── JS/
    │
    └── IMG/
```

### Reglas

`index.html` debe permanecer en la raíz.

Todos los estilos deben estar dentro de:

```text
assets/CSS/
```

Todo JavaScript debe estar dentro de:

```text
assets/JS/
```

Todas las imágenes deben estar dentro de:

```text
assets/IMG/
```

No crear carpetas adicionales sin justificación.

No colocar archivos CSS, JS o imágenes directamente en la raíz.

Si la aplicación crece, mantener esta estructura y organizar los archivos dentro de las carpetas correspondientes.

---

# 5. HTML5

El HTML debe ser **semántico, accesible y correctamente estructurado**.

Priorizar:

```html
<header>
<nav>
<main>
<section>
<article>
<aside>
<footer>
<form>
<label>
<button>
<table>
```

No utilizar `<div>` para absolutamente todo.

Utilizar el elemento HTML que represente correctamente cada contenido.

Los formularios deben utilizar correctamente:

```html
<label>
<input>
<select>
<button>
<fieldset>
<legend>
```

cuando corresponda.

Mantener una jerarquía lógica de encabezados.

---

# 6. CSS3

Utilizar exclusivamente CSS3 nativo.

Priorizar:

* CSS Grid Layout.
* Flexbox.
* Variables CSS.
* Media queries.
* Diseño responsive.
* Componentes reutilizables.
* Espaciado consistente.
* Tipografía legible.

Utilizar:

* **CSS Grid** para estructuras bidimensionales.
* **Flexbox** para estructuras principalmente unidimensionales.

No utilizar CSS innecesariamente complejo.

Evitar estilos duplicados.

Mantener una arquitectura CSS clara y fácil de modificar.

---

# 7. RESPONSIVE DESIGN

La aplicación debe funcionar correctamente en:

* Desktop.
* Laptop.
* Tablet.
* Móvil.

Todos los componentes deben adaptarse correctamente:

* Navegación.
* Filtros.
* KPIs.
* Gráficos.
* Tablas.
* Modales.
* Formularios.
* Botones.

No diseñar exclusivamente para una resolución específica.

---

# 8. JAVASCRIPT — REGLAS OBLIGATORIAS

Utilizar JavaScript moderno.

### PROHIBIDO UTILIZAR `var`

Esta regla es absoluta.

**Nunca utilizar:**

```javascript
var
```

Utilizar siempre:

```javascript
const
let
```

Preferir `const` cuando la referencia no cambie.

Utilizar `let` únicamente cuando el valor necesite reasignarse.

---

# 9. DOM — REGLAS OBLIGATORIAS

### PROHIBIDO UTILIZAR `innerHTML`

Nunca utilizar:

```javascript
innerHTML
```

Todo contenido dinámico debe construirse mediante elementos del DOM.

Utilizar:

```javascript
document.createElement()
```

y:

```javascript
appendChild()
```

También pueden utilizarse, cuando corresponda:

```javascript
textContent
classList
setAttribute
append
```

### Ejemplo correcto

```javascript
const title = document.createElement('h2');
title.textContent = 'Resumen general';

container.appendChild(title);
```

### Ejemplo prohibido

```javascript
container.innerHTML = '<h2>Resumen general</h2>';
```

Esta regla aplica a **todo el proyecto sin excepciones**.

---

# 10. ALERTAS Y FEEDBACK

### PROHIBIDO UTILIZAR

```javascript
alert()
confirm()
prompt()
```

Nunca utilizar las ventanas nativas del navegador.

Todo feedback debe mostrarse visualmente dentro del DOM.

Utilizar componentes propios como:

* Toasts.
* Banners.
* Mensajes de estado.
* Modales.
* Indicadores de carga.
* Mensajes de éxito.
* Mensajes de error.
* Estados vacíos.

Todo componente de feedback debe formar parte visual de la aplicación.

---

# 11. MODALES

Toda ventana modal debe:

* Estar construida en el DOM.
* Mantener el mismo estilo visual de la aplicación.
* Ser accesible.
* Tener botones claramente identificados.
* Poder cerrarse correctamente.
* Mostrar información comprensible.

No utilizar:

```javascript
confirm()
alert()
prompt()
```

Los modales deben utilizar HTML, CSS y JavaScript nativos.

---

# 12. EVENTOS

Utilizar:

```javascript
addEventListener()
```

No utilizar manejadores inline innecesarios como:

```html
onclick=""
onsubmit=""
```

### `preventDefault()`

Prestar especial atención a eventos `submit` y acciones que puedan provocar navegación o recarga inesperada.

Cuando un formulario sea procesado mediante JavaScript, prevenir correctamente su comportamiento predeterminado:

```javascript
form.addEventListener('submit', (event) => {
    event.preventDefault();
});
```

No olvidar `preventDefault()` cuando sea necesario.

No utilizarlo indiscriminadamente cuando el comportamiento predeterminado sea requerido.

Antes de utilizarlo, comprender qué comportamiento se está previniendo.

---

# 13. PERSISTENCIA DE DATOS

Según el parámetro 9 de la sección 2.1, la fuente de verdad es **local**: `localStorage` o `IndexedDB`. La aplicación debe funcionar completa y sin red.

Toda la persistencia vive detrás de una **única capa de datos** (`assets/JS/db.js`). Los módulos de negocio nunca acceden al almacenamiento directamente: solo consumen esa capa.

Aunque el motor sea local, el modelo de datos se diseña como un **modelo relacional** (tablas, claves primarias y foráneas, tipos, restricciones), no como un conjunto de listas sueltas. Esa disciplina es la que permitiría mover el sistema a PostgreSQL o Supabase más adelante **sin tocar los módulos de negocio**; hoy no es un requisito, y no se debe introducir ninguna dependencia de red por anticipado.

Considerar:

* Tablas.
* Relaciones.
* Claves primarias.
* Claves foráneas.
* Tipos de datos.
* Restricciones.
* Índices cuando sean necesarios.
* Consultas eficientes.
* Integridad de datos.

No tratar la base de datos como una hoja de cálculo.

---

# 14. SEGURIDAD

Nunca exponer credenciales sensibles.

**Nunca colocar la Service Role Key en el frontend.**

No exponer:

* Contraseñas.
* Tokens privados.
* Secretos.
* Credenciales.
* Service Role Key.

La autenticación local por roles (parámetro 11) **separa responsabilidades dentro de la aplicación; no es un control de seguridad**. No debe presentarse como tal al usuario ni usarse para proteger datos frente a alguien con acceso al navegador.

Si el sistema se conectara algún día a un backend, la autenticación se delega en él y se aplica Row Level Security.

Nunca confiar exclusivamente en las validaciones del frontend.

Las operaciones sensibles deben estar correctamente protegidas.

---

# 15. CAPA DE DATOS

Centralizar todo el acceso a los datos en un único módulo.

Evitar realizar consultas directamente desde múltiples componentes sin una razón clara.

Separar:

```text
Interfaz
   ↓
Lógica
   ↓
Capa de datos
   ↓
Almacenamiento local
```

Las consultas deben ser comprensibles y reutilizables.

Manejar correctamente:

* Datos.
* Errores.
* Respuestas vacías.
* Estados de carga.

---

# 16. DATOS

Antes de construir funcionalidades dependientes de datos, analizar:

* Tablas.
* Columnas.
* Relaciones.
* Tipos.
* Fechas.
* Números.
* Categorías.
* Estados.
* Valores nulos.
* Duplicados.
* Inconsistencias.

No asumir que los datos son perfectos.

Manejar correctamente:

* `null`.
* Valores vacíos.
* Fechas inválidas.
* Números incorrectos.
* Registros incompletos.
* Duplicados.
* Valores inesperados.

Nunca inventar datos.

Nunca inventar métricas.

---

# 17. FLUJO DE INFORMACIÓN

Mantener una única fuente de verdad:

```text
SUPABASE
    ↓
DATOS
    ↓
NORMALIZACIÓN
    ↓
ESTADO
    ↓
FILTROS
    ↓
DATOS FILTRADOS
    ↓
┌──────────┬──────────┬──────────┐
│   KPIs   │ GRÁFICOS │  TABLAS  │
└──────────┴──────────┴──────────┘
```

KPIs, gráficos y tablas deben utilizar el mismo conjunto de datos filtrado.

Nunca permitir inconsistencias entre componentes.

---

# 18. ESTADO

Mantener un estado centralizado.

Ejemplo:

```javascript
const appState = {
    rawData: [],
    processedData: [],
    filteredData: [],
    filters: {},
    isLoading: false,
    error: null
};
```

Adaptar la estructura cuando el proyecto lo requiera.

Evitar estados duplicados o contradictorios.

---

# 19. FILTROS

Los filtros son una funcionalidad central.

Deben ser:

* Dinámicos.
* Interdependientes.
* Claros.
* Consistentes.
* Aplicables simultáneamente.

Cuando cambie un filtro, actualizar automáticamente:

* KPIs.
* Gráficos.
* Tablas.
* Totales.
* Porcentajes.
* Conteos.
* Opciones de otros filtros cuando corresponda.

Ejemplo:

```text
Filtro A + Filtro B + Filtro C
              ↓
       Datos filtrados
              ↓
     Toda la aplicación
```

No crear filtros aislados.

Los filtros deben producir cambios coherentes en toda la interfaz.

---

# 20. KPIs

Los KPIs deben aportar información útil.

No crear tarjetas únicamente por estética.

Cada KPI debe responder una pregunta relevante.

Pueden representar:

* Totales.
* Conteos.
* Promedios.
* Porcentajes.
* Variaciones.
* Tendencias.
* Comparaciones.

Deben actualizarse automáticamente cuando cambien los filtros.

Mostrar nombre, valor, unidad y contexto cuando corresponda.

---

# 21. GRÁFICOS

Los gráficos se construyen con **Chart.js** (parámetro 6), fijando la versión y cargándolo por CDN.

Los gráficos deben ser **dinámicos e interactivos**.

Nunca utilizar imágenes estáticas para representar datos.

Los gráficos deben actualizarse cuando cambien:

* Datos.
* Filtros.
* Períodos.
* Categorías.

Cada gráfico debe tener un propósito analítico.

No crear gráficos únicamente por decoración.

Si una tabla comunica mejor la información, preferir la tabla.

---

# 22. TABLAS

Las tablas deben ser claras y fáciles de interpretar.

Cuando corresponda implementar:

* Ordenamiento.
* Búsqueda.
* Paginación.
* Filtrado.
* Indicadores visuales.

Manejar correctamente:

* Grandes cantidades de información.
* Estados vacíos.
* Estados de carga.
* Errores.

No mostrar columnas innecesarias.

---

# 23. UX/UI

La aplicación debe poder ser utilizada por una persona sin conocimientos técnicos ni conocimientos avanzados de análisis de datos.

El usuario debe comprender:

1. Qué información está viendo.
2. Qué significan los KPIs.
3. Qué filtros están activos.
4. Qué puede hacer.
5. Por qué cambió la información.

Utilizar:

* Lenguaje sencillo.
* Etiquetas descriptivas.
* Jerarquía visual.
* Contexto.
* Indicaciones claras.

El diseño debe ser:

* Profesional.
* Limpio.
* Moderno.
* Minimalista.
* Consistente.
* Responsive.

---

# 24. ESTADOS DE INTERFAZ

Implementar como mínimo:

### Loading

Indicar visualmente que se está procesando información.

### Empty

Indicar cuando no existen resultados.

### Error

Mostrar un mensaje comprensible.

### Success

Confirmar visualmente acciones exitosas.

### Filtered

Indicar claramente cuando existen filtros activos.

El usuario nunca debe quedarse sin saber qué está ocurriendo.

---

# 25. RENDIMIENTO

Evitar lecturas y recálculos innecesarios.

Siempre que sea razonable:

```text
Leer una sola vez
   ↓
Normalizar
   ↓
Mantener en memoria
   ↓
Filtrar
   ↓
Renderizar
```

No releer el almacenamiento cada vez que cambia un filtro si los datos ya están en memoria.

Para grandes volúmenes de datos considerar:

* Paginación.
* Índices en memoria (`Map`) para las búsquedas repetidas.
* Cálculos agregados una sola vez por render, no por fila.
* Evitar recorrer todas las transacciones dentro de un bucle.

No cargar información innecesaria.

---

# 26. FUNCIONES

Las funciones deben tener responsabilidades claras.

Preferir:

```javascript
loadData();
applyFilters();
calculateKPIs();
updateCharts();
renderTable();
```

en lugar de una única función gigante.

Evitar:

* Funciones excesivamente largas.
* Código duplicado.
* Abstracciones innecesarias.
* Nombres ambiguos.

Utilizar nombres descriptivos.

---

# 27. REUTILIZACIÓN

Cuando exista lógica repetida, crear funciones reutilizables.

Ejemplos:

```javascript
formatNumber();
formatDate();
createKpiCard();
createFilter();
showToast();
showModal();
showLoading();
renderTable();
```

No copiar y pegar bloques grandes de código.

---

# 28. COMENTARIOS

Los comentarios deben explicar **por qué** existe una decisión técnica.

No escribir comentarios obvios.

Preferir código autoexplicativo y nombres descriptivos.

---

# 29. ACCESIBILIDAD

Considerar:

* Contraste adecuado.
* Navegación mediante teclado.
* Estados de foco.
* Etiquetas descriptivas.
* HTML semántico.
* Botones correctamente identificados.
* Mensajes comprensibles.

No depender exclusivamente del color para comunicar información.

---

# 30. MODIFICACIONES

Antes de modificar código existente:

1. Leer el código relacionado.
2. Comprender cómo funciona.
3. Identificar dependencias.
4. Revisar el impacto.
5. Reutilizar lo existente.
6. Evitar romper funcionalidades.

Nunca sobrescribir código sin comprenderlo.

---

# 31. NUEVAS FUNCIONALIDADES

Antes de crear una funcionalidad:

1. Revisar si ya existe algo similar.
2. Analizar la arquitectura.
3. Revisar el modelo de datos.
4. Definir dónde debe vivir la lógica.
5. Reutilizar funciones existentes.
6. Implementar modularmente.
7. Probar su interacción con filtros y componentes.

No introducir complejidad innecesaria.

---

# 32. VALIDACIÓN

Después de cada cambio importante revisar:

* Sintaxis.
* Variables.
* Funciones.
* Referencias.
* IDs.
* Eventos.
* `preventDefault()`.
* Integridad de la capa de datos.
* Cuadre del balance general.
* Filtros.
* KPIs.
* Gráficos.
* Tablas.
* Responsive.
* Estados de carga.
* Estados vacíos.
* Errores.
* Consistencia de datos.

Una funcionalidad no está terminada simplemente porque el código fue escrito.

---

# 33. REGLAS ABSOLUTAS DE CÓDIGO

Estas reglas **NO son opcionales**:

### PROHIBIDO

```text
var
innerHTML
alert()
confirm()
prompt()
```

### OBLIGATORIO

```text
const / let
document.createElement()
appendChild()
addEventListener()
HTML5 semántico
CSS3 nativo
CSS Grid / Flexbox cuando corresponda
Feedback visual dentro del DOM
```

No utilizar una alternativa equivalente para intentar evadir estas reglas.

---

# 34. TOMA DE DECISIONES

Si el agente tiene dudas:

1. Revisar la **tabla de parámetros (sección 2.1)**: si la respuesta está ahí, no hay nada que decidir.
2. Revisar `CLAUDE.md` y las especificaciones del proyecto.
3. Revisar el código existente.
4. Revisar la estructura de datos.
5. Si la duda persiste y puede afectar el resultado, **preguntar al usuario antes de tomar una decisión importante**.

No inventar requisitos.

No asumir funcionalidades no solicitadas.

**No sustituir un parámetro por una alternativa que parezca mejor.** Si un parámetro parece inconveniente, se plantea al usuario y se espera respuesta; hasta entonces, se respeta como está escrito.

No introducir tecnologías que no hayan sido autorizadas.

---

# 35. PRINCIPIO FINAL

No construir primero y pensar después.

Seguir:

```text
Comprender
    ↓
Analizar
    ↓
Diseñar
    ↓
Implementar
    ↓
Validar
    ↓
Refinar
```

El código debe ser:

**simple + legible + mantenible + seguro + coherente.**

La aplicación debe ayudar al usuario a:

* Comprender información.
* Encontrar información.
* Filtrar información.
* Comparar información.
* Detectar tendencias.
* Tomar decisiones.

Si una funcionalidad no aporta valor real, reconsiderar su implementación.

**La calidad del resultado tiene prioridad sobre la cantidad de código.**
