# Plan: modularizar el frontend + preparar multi-empresa

> **Estado:** plan / cosas por hacer. No implementado aún.
> **Por qué:** `frontend/app.js` ya pasa de **2.700 líneas** (un solo archivo = difícil de
> mantener, conflictos entre agentes y mucho consumo de tokens al editarlo). Además el
> software va a ser **multi-empresa (10–20 CDAs)**, así que la arquitectura debe escalar.

Objetivos:
1. **Archivos chicos y por dominio** (cada vista ~100–250 líneas) → mantenible y barato de editar.
2. **Funciones separadas y reutilizables** (helpers compartidos, no copy-paste).
3. **Aislamiento por empresa** (cada CDA ve solo sus datos, con su config DIAN/cajas/tarifas).
4. Que dos agentes (Claude/Codex) puedan trabajar en paralelo **sin pisarse**.

---

## FASE A — Modularizar el frontend (prioridad 1)

Hoy todo vive en `frontend/app.js`. Pasar a **módulos ES nativos** (el navegador ya carga
`<script type="module">`, no hace falta build).

### A.1 Estructura objetivo

```
frontend/
  index.html
  app.js                 ← SOLO: boot, login, router (switchView) y arranque. ~150 líneas.
  api.js                 ← (ya existe) cliente HTTP. Se puede partir luego por dominio.
  lib/
    ui.js                ← $, esc, money, todayIso, readCop, downloadBlob, toast, attachSuggest
    state.js             ← estado compartido: catalog, productByCode, methodByCode,
                           expenseNatures, currentUser. Exporta un objeto `state`.
    router.js            ← go(view), registro de vistas, título por vista
  views/
    venta.js             ← wizard completo (estado `sale` local al módulo)
    cierre.js            ← cierre + detalle del día
    consolidado.js       ← consolidado + mapa de calor
    provisiones.js
    gastos.js
    ingresos.js
    payables.js          ← cuentas por pagar
    cartera.js
    pagoconv.js
    convenios.js
    clientes.js          ← clientes + historial + directo→referido
    llamadas.js          ← vencimientos + gestión + referidos
    fupa.js
    ventas.js
    dian.js              ← trazabilidad DIAN
    config.js            ← configuración (DIAN + correos + Telegram + WhatsApp)
    proveedores.js       ← (Codex)
    facturaelec.js       ← (Codex)
    dashboard.js         ← (Codex) + heatmap si se mueve aquí
    usuarios.js
```

Regla: **cada vista exporta `export function render(container) { ... }`** y se encarga de su
propio HTML + wiring + llamadas a `api`. Nada de variables globales sueltas.

### A.2 Mecánica

- `lib/ui.js`: mover ahí TODOS los helpers de DOM/format (hoy duplicados arriba de app.js).
  Cada vista hace `import { $, esc, money, toast, downloadBlob } from "../lib/ui.js"`.
- `lib/state.js`: el `catalog`, `methodByCode`, `expenseNatures`, etc. pasan a
  `export const state = { catalog: {...}, ... }`. Las vistas leen `state.catalog`.
- `lib/router.js`: `switchView` se vuelve un router que conoce un mapa
  `{ venta: () => import("../views/venta.js"), ... }` (o imports estáticos) y al cambiar de
  pestaña llama `mod.render($("xxxRoot"))`. Navegación cruzada (ej. llamadas → cliente) se hace
  con `router.go("clientes", { doc })` en vez de llamar funciones de otra vista directamente.
- `app.js`: queda con `boot()`, login, `applyRole()`, y el registro del router. ~150 líneas.

### A.3 Cómo migrar sin romper (orden seguro)

1. Crear `lib/ui.js`, `lib/state.js`, `lib/router.js` y mover los helpers (sin cambiar lógica).
2. Mover **una vista a la vez** a `views/xxx.js` (empezar por las chicas: ingresos, gastos,
   payables, fupa, dian, config). Probar que carga antes de seguir con la siguiente.
3. Dejar el **wizard de venta para el final** (es el más grande y con más estado).
4. Cuando todas las vistas estén movidas, `app.js` queda mínimo.

> **IMPORTANTE:** este split lo hace **UN solo agente en una pasada** (es un refactor
> coordinado de `app.js`). Si dos agentes parten `app.js` a la vez = conflictos. Una vez
> partido, cada quien edita su `views/xxx.js` sin chocar.

### A.4 Definición de "hecho"

- `app.js` < 200 líneas. Ninguna vista > ~300 líneas.
- Sin duplicar `money/esc/$/toast` en cada archivo.
- La app funciona igual que antes (mismas pestañas, mismas acciones).

---

## FASE B — Multi-empresa (backend) (prioridad 2)

Para 10–20 CDAs lo recomendado es **una sola base de datos con `companyId`** en cada tabla de
negocio (multi-tenant por fila). Es lo más simple de operar y escala a cientos. (DB-por-empresa
da más aislamiento pero multiplica el costo operativo; no hace falta para 10–20.)

### B.1 Modelo

- Nueva tabla **`Company`**: `id, nit, dv, name, commercialName, address, city, active, createdAt`.
- Añadir **`companyId Int`** (indexado) a TODAS las tablas de negocio:
  `Client, Vehicle, Ally, Sale, SaleLine, SalePayment, SaleCost, Receivable, Invoice,
  DailyClosing, CashBox, CashMovement, Expense, Income, Payable, CallLog, FupaMovement,
  ExpenseNature, SupplierInvoice, Supplier, ManualInvoice, Tariff, Package, Product...`.
- **Config por empresa**: `DianConfig`, `NotificationConfig` pasan a tener `companyId` (1 fila
  por empresa, no singleton global). Igual catálogos que hoy son globales pero deberían ser por
  empresa: tarifas, métodos de pago, naturalezas, cajas.
- **`User`** gana `companyId` y un rol `superadmin` (gestiona empresas) además de admin/vendedor.

### B.2 Aislamiento (lo crítico)

- El **JWT** incluye `companyId`. El middleware `auth()` inyecta `req.companyId`.
- **Toda** consulta Prisma filtra por `companyId` (helper central, p.ej. un wrapper o un
  `where: { companyId: req.companyId, ... }` obligatorio). Esto es lo que evita que una empresa
  vea datos de otra. Hay que auditar ruta por ruta.
- Numeraciones (saleNumber/invoiceNumber) y secuencias pasan a ser **por empresa**.
- Uploads (comprobantes) en subcarpeta por empresa: `uploads/<companyId>/...`.

### B.3 Onboarding de empresa

- Pantalla de **superadmin**: crear empresa + su usuario admin + su config DIAN/tarifas/cajas
  iniciales (seed por empresa).
- Selección de empresa en login (o subdominio por empresa a futuro: `certimotos.app...`).

### B.4 Migración de lo actual

- Crear una empresa "Certimotos" y backfill: `UPDATE ... SET companyId = 1` en todo lo existente.
- Hacerlo en una migración + script de datos. Probar con copia antes.

---

## FASE C — Endurecimiento / escalado (prioridad 3)

- DIAN por empresa (resolución, software id/pin, certificado) — ya casi, solo falta `companyId`.
- Reporte ejecutivo por naturaleza juntando **ingresos + gastos** (neto por naturaleza).
- Índices y paginación en listados grandes (ventas, clientes) cuando crezcan los datos.
- Tests básicos de aislamiento (que empresa A nunca lea datos de empresa B).
- Logs/auditoría por empresa.

---

## División de tareas sugerida

- **Fase A (frontend split):** **un solo agente** (sugerido Claude, dueño de la mayoría de vistas)
  hace el split base (lib/ + router + mover vistas). Codex revisa y luego cada quien mantiene sus
  vistas (`dashboard.js`, `proveedores.js`, `facturaelec.js` = Codex).
- **Fase B (multi-empresa backend):** repartible por grupos de tablas/rutas una vez definido el
  patrón de `companyId` + helper de filtrado (que lo defina quien arranque, para que sea idéntico).
- **Fase C:** según prioridad del cliente.

---

## Convenciones para que NO se vuelva a inflar

- Una vista = un archivo en `views/`. Si pasa de ~300 líneas, partir en sub-módulos.
- Helpers compartidos SIEMPRE en `lib/` (nunca copiar `money/esc/$`).
- Llamadas a la API SIEMPRE por `api.js` (nunca `fetch` suelto en una vista).
- Nada de estado global mutable fuera de `lib/state.js`.
- Texto al usuario en español; dinero entero COP; sin FK (estilo del repo).

## Orden recomendado

1. **Fase A** (modularizar frontend) — desbloquea todo lo demás y baja el costo de editar.
2. **Fase B** (multi-empresa) — cuando A esté estable.
3. **Fase C** — continuo.

> Riesgo principal: hacer Fase A y Fase B a la vez. **No.** Primero A (refactor sin cambiar
> comportamiento), luego B (cambio de arquitectura de datos). Cada una probada antes de la otra.
