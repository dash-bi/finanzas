# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este repositorio

ERP y sistema de gestión financiera integral, tipo SaaS local: sitio estático sin build que guarda todo en el `localStorage` del navegador. No hay backend.

- **Estructura.** La raíz del repositorio (`01-FINANZAS/`) contiene solo `vercel.json`, `.gitignore` y la carpeta `Aplicación con Claude/`. Todo lo demás vive dentro de la app, incluido este `historial.md`.
- **Especificación funcional.** `Aplicación con Claude/CLAUDE.md` define **qué** hace el sistema.
- **Archivos eliminados.** El 2026-09-11 el usuario borró de la raíz `Agents.md`, `CLAUDE.md` y `README.md` porque le generaban problemas. Sus reglas vigentes están resumidas en «Convenciones del código».
- **Idioma y moneda.** Todo en español: interfaz, mensajes, nombres de funciones y variables, comentarios y commits. Moneda COP.

## Versiones

**Regla del usuario:** cada cambio al sistema se registra aquí como una versión nueva, en el mismo commit que el cambio. Se usa `MAYOR.MENOR.PARCHE`: la menor sube con funcionalidades y el parche con correcciones. El hash de la versión en curso se completa al registrar la siguiente.

| Versión | Fecha | Commit | Cambios |
| --- | --- | --- | --- |
| 1.4.0 | 2026-09-11 | *(esta versión)* | **Permisos por rol configurables:** en Configuración → Permisos por rol el administrador marca qué módulos ve Contador y Vendedor, y el menú, la navegación y la importación de PDF respetan esa selección al instante, también en otras pestañas. Configuración sigue siendo solo del administrador y cada rol debe conservar al menos un módulo. Al entrar se abre el tablero o, si el rol no lo tiene, su primer módulo permitido. **Limpieza de la raíz:** se eliminan `Agents.md`, `CLAUDE.md` y `README.md`; `vercel.json` y `.gitignore` permanecen en la raíz; `historial.md` pasa a la app. |
| — | 2026-09-11 | `5fdd007`, `6cdff0a`, `ebfbcdd` | Commits hechos desde la web de GitHub («Update index.html / base.css / components.css») sin cambios de contenido. |
| 1.3.3 | 2026-09-11 | `65eb224` | La pantalla de acceso deja de mostrar usuarios y contraseñas; contraseñas de la semilla guardadas como hash; credenciales enmascaradas en los bocetos. |
| 1.3.2 | 2026-09-11 | `3545039` | Bocetos de diseño publicados en `.design/`. |
| 1.3.1 | 2026-09-10 | `64ce1f5` | Configuración exclusiva del administrador; la sesión se resincroniza con el rol vigente, incluso desde otra pestaña. |
| 1.3.0 | 2026-09-10 | `7effc30` | Edición de usuarios del sistema: usuario, nombre, rol y contraseña; el sistema nunca queda sin administrador. |
| 1.2.0 | 2026-09-10 | `8640b74` | Edición de ventas, abonos, compras, gastos e inventario; exportación a Excel; carga de facturas PDF con formulario prellenado; vendedor elegido entre los empleados de nómina; tablero con 10 KPI en 2 filas. |
| 1.1.0 | 2026-09-09 | `26394a6` | Piel visual tipo Nubank (morado `#7B2FF7`, verde `#C9F73F`) y restauración de la carpeta de la app. |
| 1.0.1 | 2026-09-09 | `de2b99e` | Intento de mover la app a la raíz para que Vercel la sirviera; revertido en 1.1.0. |
| 1.0.0 | 2026-09-09 | `ce904f7` | Primera versión del ERP. |

## Comandos

No hay `package.json`, build, tests automatizados ni linter. Rutas relativas a la raíz del repositorio.

```bash
# Servir la app (también abre con doble clic en index.html: son scripts clásicos)
cd "Aplicación con Claude" && python -m http.server 8000

# Sintaxis de todos los scripts
for f in "Aplicación con Claude"/assets/JS/*.js; do node --check "$f" || echo "FALLA: $f"; done

# Reglas absolutas del código: no debe imprimir nada.
# El patrón ignora var(--css), ui.confirmar() y comentarios que nombran confirm() o innerHTML.
grep -rnE '\bvar\s+[A-Za-z_$]|\.innerHTML|\b(alert|confirm|prompt)\([^)]' "Aplicación con Claude/assets/JS"
```

`http.server` deja que el navegador cachee los JS: recargar con Ctrl+F5 tras cada cambio.

### Verificación en el navegador (consola, todo cuelga de `window.ERP`)

- **Datos limpios:** `localStorage.removeItem('erp_finanzas_v1'); sessionStorage.clear()` y recargar.
- **Sesión sin escribir contraseña:** `sessionStorage.setItem('erp_finanzas_sesion', JSON.stringify({ id: 'usr_admin' }))` y recargar. Para los otros roles, `usr_conta` y `usr_vende`.
- **Renderizar todos los módulos:** `Object.keys(ERP.app.MODULOS).forEach(ERP.app.irA)`. Un fallo pinta «No fue posible mostrar el módulo» y deja el error en consola.
- **Invariante contable** tras cualquier cambio en transacciones: `ERP.finanzas.balanceGeneral(ERP.util.today()).descuadre` debe ser 0.
- **Criterio de terminado:** consola sin errores y revisión visual a 375 px y 1440 px.

### Despliegue

Push a `main` de `github.com/dash-bi/finanzas` → Vercel despliega solo.

- **`vercel.json` debe quedarse en la raíz del repositorio**, con `outputDirectory: "Aplicación con Claude"`. Si se mueve dentro de la app, el sitio responde 404. **Root Directory** en Vercel debe quedar vacío.
- **Protección de Vercel.** `finanzas-dash-bi.vercel.app` tiene Deployment Protection y redirige al login de Vercel.
- **Versión vieja en producción.** Revisar en Vercel que el despliegue *Current* sea el último commit; un Instant Rollback lo deja fijo.

## Arquitectura

### Carga y módulos

- **Scripts clásicos**, sin módulos ES, para que funcione en `file://`. Cada archivo es un IIFE que asigna una API pública a `ERP.<modulo>`.
- **El orden de `<script>` en `index.html` es la dependencia:** `util → db → ui → charts/pdf/xlsx/pdfreader → lines → auth → negocio → financials → dashboard → tools/payroll → app`. Las referencias a módulos cargados después solo son válidas dentro de funciones que se ejecutan más tarde (p. ej. `ERP.configuracion` usa `ERP.app.MODULOS`).
- **Agregar un módulo** exige tres cambios:
  1. Su `<script>` en `index.html`.
  2. Su entrada en `MODULOS` (y `GRUPOS`) de `app.js`.
  3. Su clave en `PERMISOS` de `auth.js`, siempre en `PERMISOS.administrador` (la lista completa de módulos) y en los roles que deban verlo por defecto.

### Flujo de datos y repintado

- **Capa de datos única.** `db.js` lee `erp_finanzas_v1` una vez a memoria. Cada mutación llama a `persist()`, que escribe el JSON completo, y emite `U.bus.emit('db:changed')`.
- **Repintado completo.** `app.js` escucha `db:changed` y, con debounce de 90 ms, ejecuta `montarAplicacion()`, que reconstruye todo el shell y la vista activa. Por eso las vistas son funciones `vista(contenedor)` sin estado propio en el DOM, y lo que deba sobrevivir al repintado (filtros) vive en un objeto `estado` del módulo. Los modales cuelgan de `document.body` y sobreviven al repintado.
- **Otras pestañas.** Un evento `storage` recarga `db.load()` y repinta.
- **Sesión y vista.** `montarAplicacion()` resincroniza la sesión con el registro vigente del usuario y elige la vista:
  - `estado.vista = null` al entrar o salir abre `primerModuloPermitido()` sin aviso.
  - Una vista que deja de estar permitida con la sesión abierta, por cambio de rol o de permisos, se reemplaza con el aviso «Su acceso cambió».
  - Las acciones de Configuración revalidan el rol con `autorizado()`.

### Permisos por rol

- **Dónde vive la regla.** `ERP.auth.modulosDeRol(rol)` es la única fuente: el administrador recibe `PERMISOS.administrador`; los demás roles, `config.permisosRol[rol]` si el administrador guardó una selección o `PERMISOS[rol]` si no.
- **Filtros de seguridad.** El resultado se filtra contra la lista completa y excluye `SOLO_ADMINISTRADOR` (`configuracion`), así que un dato alterado no abre Configuración a otro rol.
- **Quién la usa.** `puede()`, `modulosPermitidos()`, el menú lateral, `irA`, el conteo de módulos de la tabla de usuarios y el importador de PDF.
- **Guardado.** `ERP.auth.guardarPermisos({ contador: [...], vendedor: [...] })` exige sesión de administrador y al menos un módulo por rol, y guarda con `db.updateConfig({ permisosRol })`. No requiere migración: `load()` fusiona `config` con los valores por defecto.
- **Alcance de los datos.** «Reiniciar datos de demostración» vuelve a los permisos por defecto, y el respaldo JSON los incluye.
- **Lo que no restringe.** Los permisos son por módulo completo: dentro de un módulo permitido, todos los roles ven lo mismo.

### Contabilidad derivada (lo que más fácil se rompe)

- **Solo se guardan transacciones:** compras, ventas, gastos, abonos, pagos de compra y nóminas. Caja, CxC, CxP, inventario contable, P&G, balance, flujo e indicadores se calculan en `ERP.finanzas` (`financials.js`). Un tipo de transacción nuevo debe reflejarse ahí o el balance descuadra.
- **Ventas y compras.** `registrarVenta` valida existencias y cupo de crédito y **congela `costoUnitario`**. `registrarCompra` recalcula el costo promedio ponderado con el costo neto de descuento.
- **Inventario reversible.** `planificarInventario()` valoriza los movimientos por valor total (existencia × costo) para que revertir un documento devuelva el costo promedio exacto.
- **Edición.** `editarVenta` / `editarCompra` / `editarAbono` **revierten el documento original y aplican el nuevo** con las mismas validaciones, conservando número, abonos y costo congelado.
- **Errores sin excepciones.** Las funciones de negocio devuelven `{ ok: false, error }` (helper `fallo`) y la UI lo muestra en un banner.

### Esquema y migraciones

`SCHEMA_VERSION` está en `db.js`. `load()` **regenera la demostración si la versión guardada no coincide**, lo que borra los datos del usuario. Un cambio de esquema se resuelve en `migrar()`, que es no destructiva y completa campos, antes de pensar en subir la versión.

### Autenticación

- **Local.** `hashClave` es djb2: separa responsabilidades, no es seguridad.
- **Contraseñas iniciales.** En la semilla están como hash literal. No volver a escribirlas en texto plano en código, documentación, bocetos ni pantalla de acceso.
- **Último administrador.** `db.actualizarUsuario` impide dejar el sistema sin administrador activo.

### UI sin dependencias

- **Constructor de DOM.** `U.el(tag, { class, text, attrs, props, on, style }, hijos)` sustituye a `innerHTML`. `attrs` omite valores `null`/`false`; `props` asigna propiedades como `checked` o `disabled`.
- **Tablas.** `ui.tabla(filas, columnas, opts)` devuelve `{ nodo, refrescar, estado, filas }`. `filas()` entrega las filas ordenadas y filtradas, y es lo que exportan los botones de Excel: se exporta lo que se ve.
- **Diálogos.** `ui.modal`, `ui.confirmar` y los `toast*` reemplazan los diálogos nativos.
- **Editor de líneas.** `lines.js` lo comparten ventas y compras, e incluye la opción de crear un producto desde una línea leída de un PDF.
- **Implementaciones propias en lugar de librerías:**
  - `charts.js`: gráficos SVG; colores por las variables `--c1`…`--c8` de `base.css`.
  - `pdf.js`: escritor de PDF.
  - `xlsx.js`: ZIP sin compresión con CRC32.
  - `pdfreader.js`: extrae texto con `DecompressionStream`.
- **Importación de facturas.** `importer.js` decide si es compra, gasto o venta comparando NIT con `config.nit` y el contenido. **Nunca registra solo**: abre el formulario prellenado para confirmar y bloquea CUFE duplicados.
- **Piel visual.** Vive solo en `assets/CSS/`: `base.css` (tokens y tema claro/oscuro por `data-theme`), `layout.css` y `components.css`.

## Convenciones del código

Reglas que el usuario fijó al construir el sistema. Venían de `Agents.md` y siguen vigentes en el código.

- **Prohibido** `var`, `innerHTML`, `alert()`, `confirm()` y `prompt()`. Usar `const`/`let`, `document.createElement` (vía `U.el`), `addEventListener` y `preventDefault()` en los `submit`. Todo feedback va dentro del DOM: toasts, banners, modales y estados vacío/cargando/error.
- **Sin frameworks ni paquetes.** Las únicas externas autorizadas eran Chart.js, jsPDF/AutoTable y Google Fonts. Hoy solo se usa Google Fonts (Outfit y Plus Jakarta Sans); gráficos y PDF son nativos. La especificación de la app aún pide Chart.js, jsPDF e Inter/Roboto: no migrar sin aprobación del usuario.
- **Capa de datos única.** Los módulos nunca tocan `localStorage` directamente.
- **Estructura.** `index.html` + `assets/CSS|JS|IMG`, sin carpetas nuevas sin justificación.
- **Consistencia.** KPIs, gráficos y tablas usan el mismo conjunto de datos filtrado. Nunca inventar datos ni métricas.
- **Ante una duda que afecte el resultado**, preguntar al usuario en lugar de decidir.

## Contexto que no se deduce del código

- **El repositorio está dentro de Google Drive** (`G:\Mi unidad`), y archivos y carpetas han aparecido, desaparecido o cambiado de lugar por acciones externas. Antes de cada commit, revisar `git status`, verificar con `git fetch` si GitHub tiene commits nuevos y no subir borrados masivos ni carpetas nuevas sin confirmar con el usuario.
- **Versión anterior del sistema.** Existió en `_version-anterior/` y luego en `Version vieja/`, y nunca se publicó. Si reaparece, no debe subirse: un segundo `index.html` competiría con el despliegue.
- **Preferencias del usuario:**
  - Pide que los cambios se suban directamente al repositorio.
  - Exige no publicar material confidencial (`.env`, llaves, respaldos `respaldo-erp-*.json`).
  - Espera verificación en el navegador antes de dar algo por terminado.
  - Quiere cada versión documentada aquí.
