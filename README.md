# ERP y Gestión Financiera Integral

Aplicación web de gestión contable y financiera que funciona **por completo en el navegador**, sin servidor y sin base de datos remota.

El usuario registra únicamente transacciones operativas —compras, ventas, gastos, abonos y nómina— y el sistema deriva de ellas el inventario, la cartera, la caja, los estados financieros y los indicadores. **Ningún estado financiero se digita a mano.**

---

## Cómo abrirla

Abrir `Aplicación con Claude/index.html` en el navegador (doble clic), o visitar el despliegue en Vercel.

Si el navegador bloquea el almacenamiento local en `file://`, la aplicación lo advierte. En ese caso, servirla desde la carpeta de la app:

```bash
python -m http.server 8000
```

### Usuarios de demostración

| Usuario | Contraseña | Rol | Acceso |
| --- | --- | --- | --- |
| `admin` | `admin123` | Administrador | Todos los módulos |
| `contador` | `conta123` | Contador | Todo excepto configuración |
| `vendedor` | `venta123` | Vendedor | Ventas, clientes, cartera e inventario |

> Son credenciales de demostración, visibles a propósito en la pantalla de acceso. La autenticación local **separa responsabilidades dentro de la aplicación; no es un control de seguridad**. Cámbialas antes de usar el sistema con información real.

---

## Módulos

**Operación** — Tablero ejecutivo · Ventas y facturación · Cartera y abonos · Compras · Gastos · Inventario
**Terceros** — Clientes · Proveedores
**Análisis** — Estados financieros · Punto de equilibrio · Simulador de préstamos
**Administración** — Nómina · Configuración

### Reglas de negocio que aplica el sistema

- Una compra **sube existencias** y recalcula el **costo promedio ponderado**.
- Una venta **descuenta existencias** y **congela el costo unitario** del momento, para que el costo de ventas no cambie de forma retroactiva.
- Una venta a crédito valida el **cupo del cliente** y abre la cuenta por cobrar.
- Los abonos amortizan el saldo en tiempo real y cambian el estado de la factura.
- La caja es **derivada**, nunca almacenada.
- El **balance general cuadra**; si no cuadrara, la interfaz lo advierte.

---

## Estructura

```text
.
├── Agents.md                Parámetros y reglas de construcción
├── vercel.json              Apunta el despliegue a la carpeta de la app
└── Aplicación con Claude/
    ├── index.html           Punto de entrada
    ├── CLAUDE.md            Especificación funcional
    ├── implementation_plan.md
    └── assets/
    ├── CSS/                 base · layout · components
    ├── IMG/                 logo
    └── JS/
        ├── util.js          Helpers de DOM, moneda y fechas
        ├── db.js            Capa de datos única + datos de demostración
        ├── ui.js            Toasts, modales, tablas, estados
        ├── charts.js        Gráficos SVG interactivos
        ├── pdf.js           Escritor de PDF
        ├── auth.js          Sesión y permisos por rol
        ├── lines.js         Editor de líneas de documento
        ├── contacts.js · inventory.js · purchases.js · billing.js
        ├── financials.js    Motor de estados financieros
        ├── dashboard.js · tools.js · payroll.js
        └── app.js           Arranque, enrutador y tema
```

---

## Despliegue

Es un sitio estático sin build. Como `index.html` vive dentro de `Aplicación con Claude/` y no en la raíz del repositorio, `vercel.json` le indica a Vercel dónde está:

```json
{ "outputDirectory": "Aplicación con Claude" }
```

Si el despliegue respondiera 404, revisar que **Root Directory** esté vacío en los ajustes del proyecto en Vercel: `vercel.json` se resuelve desde la raíz del repositorio.

---

## Datos

Los datos de demostración —empresa, clientes, proveedores, NIT, teléfonos, correos y direcciones— son **ficticios**, generados para poder auditar cada módulo desde el primer arranque. Cualquier parecido con una entidad real es casual.

La información se guarda en el `localStorage` del navegador. Nunca sale del equipo: no hay backend, ni analítica, ni llamadas de red. Desde **Configuración** se puede exportar un respaldo en JSON o reiniciar la demostración.

> Los respaldos exportados sí contienen datos reales de operación. Están excluidos del repositorio en `.gitignore`.

---

## Apariencia

La piel visual —morado de marca, verde ácido de acento, fondo lavanda y esquinas redondeadas— vive **solo en `assets/CSS/`**. Los tres archivos son `base.css` (tokens de color, tipografía y radios), `layout.css` (barra lateral, barra superior y rejillas) y `components.css` (tarjetas, botones, tablas y modales).

Cambiar el aspecto no exige tocar JavaScript: los gráficos leen sus colores de las variables `--c1` … `--c8`.

La tipografía (Outfit y Plus Jakarta Sans) se pide a Google Fonts desde `index.html`. Sin conexión, la pila del sistema la sustituye y la aplicación sigue funcionando igual.

---

## Parámetros legales

El salario mínimo, el auxilio de transporte, el tope del auxilio, el IVA y los porcentajes de salud y pensión **son editables desde Configuración**, porque cambian por decreto cada año. Revísalos antes de liquidar nómina.
