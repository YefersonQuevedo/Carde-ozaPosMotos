# Plan de desarrollo — Revisión con el cliente (2026-06-04)

> **Para Codex:** este documento es la fuente de verdad de lo que hay que construir.
> Lee primero [`README.md`](README.md) y [`MODELO_DATOS.md`](MODELO_DATOS.md) para el contexto
> (arquitectura Node/Express/Prisma sobre **MySQL sin llaves foráneas**, frontend HTML/JS plano).
> Tu trabajo está en la sección **"Lo que desarrolla Codex"**. No toques los módulos marcados como
> de Claude salvo los contratos compartidos definidos en **Fase 0**.

Fuentes de esta especificación:
- Transcripción de la revisión: [`revisiondelsoftare4062026.txt`](revisiondelsoftare4062026.txt)
- Reporte real de pagos de Gora (modelo de datos de cartera): [`pago de gora.pdf`](pago%20de%20gora.pdf)
- Excel del cliente que se debe replicar al exportar: [`FORMATO CIERRE 2.3  2026.xlsx`](FORMATO%20CIERRE%202.3%20%202026.xlsx) y [`2026 consolidado.xlsx`](2026%20consolidado.xlsx)

---

## 1. Contexto del negocio (lo que entendimos en la revisión)

Certimotos es un **CDA** (centro de revisión técnico-mecánica de motos) en Girardot. El POS debe
reflejar la realidad financiera del negocio para "organizarse con la DIAN". Conceptos clave que
salieron en la conversación y que el sistema debe modelar:

- **PIN / FUPA / Sustrato**: Supergiros (plataforma *SuperFlex*) entrega un **PIN prepago** que
  autoriza la RTM ante el Ministerio de Transporte. La compra de un PIN cuesta **$5.600**
  (FUPA $5.600 + sustrato $800 según las tarifas vigentes). El cliente lleva **inventario de PINes**
  y le preocupa que Supergiros "le queme un pin por debajo de cuerda". → control de FUPA al inicio/fin del día.
- **Comisiones (referidos/usuarios)**: NO son un costo operativo que vaya a la DIAN ni a la factura.
  Internamente la **"Diferencia de Jasper"** del cierre **es justamente las comisiones** que tiene que reponer.
- **Provisión**: dinero que se guarda aparte cuando alguien **paga pero no hace la RTM hoy**
  (RTM pendiente = "pendiente de tránsito", no se consigna a Supergiros). Cuando esa persona vuelve y
  hace la RTM, hay que hacer un **egreso de provisión + ingreso al cierre** del día. La plata
  provisionada **no se debe contar dos veces** en ventas brutas.
- **Gora / Addi (cartera)**: convenios de crédito. **Siempre facturan** a la DIAN. Pagan a semanas/meses,
  **por número de factura**, y **descuentan ICA y retención en la fuente** (ver PDF). El cliente nunca ha
  calculado cuánto le cuesta realmente vender por Gora.
- **Convenios**: terceros que radican RTM y a los que se les paga una comisión. Hoy lo maneja
  "folclóricamente". El dinero de convenios va a una **caja/provisión aparte** (NO a caja menor, porque la
  caja menor se usa para reponer Supergiros).
- **Objetivo final**: dejar todo organizado y exportable a Excel para sacar la **resolución de facturación
  electrónica DIAN** (homologación) — eso es fase posterior, ahora el foco es el POS.

---

## 2. Estado actual (ya construido — no rehacer)

Pestañas existentes en el frontend: **Venta, Cierre diario, Consolidado, Cartera, Pagos conv.,
Clientes, Convenios, Ventas, Usuarios**.

Ya funciona: venta progresiva, **pago mixto** (varios métodos por venta), separación venta/factura,
ventas append-only con anulación/reversa, multi-vehículo, tarifas con vigencia, login con roles
(admin/vendedor), cierre diario base, consolidado base, cartera base, pagos de convenios base.

Modelos Prisma existentes: `Client, Vehicle, Ally, Product, Tariff, Package, PackageComponent,
PaymentMethod, Sale, SaleLine, SalePayment, SaleCost, Receivable, User, Invoice, Reversal,
AllyPayment, DailyClosing`.

---

## 3. Lo que pidió el cliente (backlog completo, con trazabilidad)

Cada ítem cita la idea de la transcripción para que no se pierda intención.

### Clientes e historial
- **C1.** Tipo de documento obligatorio: hay terceros **NIT** (Gora, alcaldía, escuelas de conducción),
  no solo CC. *("Tipo de documento… tengo empresas como Gora… son NIT")*
- **C2.** Teléfono obligatorio; permitir **más de un teléfono**. Email opcional. *("obligatorio que tenga teléfono… más de un teléfono")*
- **C3.** **Buscar cliente por placa.** *("sería buenísimo, marica… buscar un cliente por placa")*
- **C4.** **Historial del cliente** como **log de registros** (no como parte del perfil): qué hizo cada año
  y **cómo llegó** (referido vs directo), con el referido **trackeado**. *("tengo el historial de qué ha hecho el cliente conmigo y cómo llegó… como ver los logs")*
- **C5.** Regla/filtro: clientes que **eran directos y pasaron a referidos** (detectar abuso de comisiones).
  *("usuarios que no eran referidos y pasaron a referidos… lo filtra")*
- **C6.** **Vencimiento de RTM** por placa + sección **"Llamadas"**: ver a quién se le vence en X fechas
  para llamarlo. *("Fecha de vencimiento de tecnomecánica… una sección que se llame llamadas")*

### Cierre diario
- **D1.** **Exportar el cierre a Excel con el formato del cliente.** *("¿Eso lo podemos hacer para exportarlo en Excel? Con el formato que usted tiene")*
- **D2.** Renombrar **"Congelar" → "Cierre del día"** (terminar el turno). *("dice congelar… es como terminar el turno")*
- **D3.** **Desglosar** el cierre (que se entienda de dónde sale cada número).
- **D4.** **Egreso de provisión + ingreso al cierre** cuando alguien provisionado hace la RTM hoy.
  *("tiene que hacer un egreso de provisión y un ingreso al cierre diario")*

### Provisiones
- **P1.** Sección **Provisiones** visible (a la izquierda) con las **RTM pendientes** y su dinero apartado.
  *("falta algo que diga como provisiones acá para poderlo mirar bien… literalmente a la izquierda")*
- **P2.** Al vender a alguien **ya pagado/referido provisionado**, NO cobrar comisión 2 veces: en vez de
  elegir "referido", elegir la **placa provisionada** y que el sistema **busque la provisión** en el listado
  de placas pendientes. *("uno coloca la placa que está provisionada… que busquen la provisión de tecnomecánicas")*
- **P3.** En **ventas brutas** restar las **provisiones ya realizadas** para no facturar dos veces.
  *("las ventas brutas se restan las provisiones realizadas")*
- **P4.** Soportar **varias cajas** (caja menor, provisión RTM, provisión convenios = "tercera caja"),
  con posibilidad de **agregar más**. *("hacer como una tercera caja… tener la posibilidad de hacer de una más")*

### Cartera (Gora / Addi)
- **R1.** **Filtro por proveedor** (cuánto debe Gora, cuánto debe Addi). *("un filtro para yo determinar cuánto me debe Gora y cuánto me debe Addy")*
- **R2.** **Columna # de factura** con la que se facturó esa placa, y **buscar por factura**.
  *("una columna que me diga el número de factura con el que le facturé esa placa")*
- **R3.** Vistas **generalizada y agrupada**.
- **R4.** Filtros: **desde/hasta fecha de venta** y por **cédula del cliente** (no la empresa).
- **R5.** Modelar el **pago de Gora**: por **# factura, documento, cliente, fecha, monto**, con
  **ICA** y **retención en la fuente** descontados (ver `pago de gora.pdf`). Calcular cuánto cuesta
  realmente vender por Gora. *("me descuentan ICA… toca calcular la retención en la fuente de Gora")*
- **R6.** Garantía: **Gora siempre factura** (las secretarias a veces olvidan facturar) → validación/filtro
  en venta. *("en venta necesitamos un filtro: siempre Gora factura")*
- **R7.** **Exportar cartera a Excel.**

### Pagos de convenios
- **V1.** Registrar **cuánto se pagó y en qué fecha**, mostrando **cantidad de convenios/placas, las placas,
  el valor y la factura**.
- **V2.** **Botón "aplicar a todos"** para la comisión (no cambiar la tarifa convenio por convenio).
  *("un botón que sea aplicar a todos… imagínese usted cambiar la tarifa de 200 convenios")*
- **V3.** Adjuntar **comprobante de pago** (imagen/escaneo) y **visualizarlo** desde el sistema.
  *("agregar comprobante de pago… uno poder visualizar cualquier cosa")*
- **V4.** **Imprimir** el comprobante de pago para que el convenio lo **firme** y la secretaria suba el firmado.
  *("yo poder imprimir esto así ellos lo firman… sube el comprobante")*
- **V5.** Opción de **facturar a la cédula electrónicamente** el dinero de convenios (hoy subreporta a la DIAN).
  *("alguna opción para facturarle a la cédula electrónicamente")*
- **V6.** El dinero de convenios va a la **provisión / tercera caja** en el cierre (contrato `P4`).
  *("mándelo a provisión en el cierre")*

### Factura electrónica / Proveedores
- **F1.** Sección **Factura electrónica manual** tipo POS para **cualquier ítem** (ej.: venta de equipos de
  pista a otra empresa), separada de la venta diaria de RTM. *("una sección de factura electrónica… como una venta pero para cualquier cosa")*
- **F2.** **Proveedores**: gestionar proveedores y emitir **orden de compra**. *("necesito poder emitirle la orden de compra al proveedor")*
- **F3.** Gestionar **conceptos de pago** para facturar.

### Dashboard / KPIs
- **K1.** **Dashboard** como índice de reportes generales.
- **K2.** **KPIs mensuales**: # RTM del mes y a la fecha, ventas brutas, ticket promedio, % usuarios directos,
  dispersión esperada de Supergiros a la fecha, # y $ de descuentos, $ de comisiones pagadas, total
  deducciones, utilidad bruta, **comparación contra el año pasado**. *("eso lo uso yo… KPI mensual… lo comparo con el año pasado")*
- **K3.** **Provisión de IVA**: cuánto IVA hay que tener guardado para el pago bimestral (otra caja de ahorros).
- **K4.** **Resumen de motos entre fechas** y **exportar reportes a Excel**.

### Transversal
- **T1.** **Todo exportable a Excel** (cierre, consolidado, cartera, convenios, KPIs). Excel básico manipulable.
- **T2.** **Control de FUPA/PIN**: inventario de pines al **inicio y fin del día** (RTM facturadas vs realizadas
  vs FUPA consumidas) para detectar pines quemados sin autorización. *(fase posterior, pero dejarlo previsto)*

---

## 4. Fase 0 — Cimientos compartidos (los hace Claude primero)

> ✅ **ENTREGADA (2026-06-04).** Migración `20260605003729_revision_2026_06_04` aplicada, cliente
> Prisma regenerado, `exceljs` + `multer` instalados, server probado (health/login/uploads/catalog OK).
> **Codex ya puede construir contra estos contratos.** Resumen de lo disponible:
> - **Esquema**: todos los modelos/campos de §4.1 existen en `schema.prisma` y en la BD.
> - **Excel**: `backend/src/services/excel.js` → `toWorkbook({ sheets:[{name,columns,rows,title?,totals?}] })`
>   y `sendXlsx(res, buffer, filename)`. `columns:[{header,key,width,money?,number?}]`.
> - **Uploads**: `POST /api/uploads` (multipart, campo `file`) → `{ ok, path, url, filename }`;
>   archivos servidos en `/uploads/<archivo>`. Front: `api.uploadFile(file)`.
> - **Cajas** sembradas: `CAJA_MENOR`, `PROV_RTM`, `PROV_CONV`, `IVA` (tabla `cash_boxes`).
> - **Frontend**: pestañas y secciones creadas. Monta tu vista en el root de tu módulo:
>   `dashboardRoot`, `facturaelecRoot`, `proveedoresRoot` (Codex) — reemplaza el `renderXxx(container)`
>   stub en `frontend/app.js`. No edites el sidebar ni el router.

Para que Claude y Codex trabajen en paralelo sin pisarse, **Claude** entrega primero estos contratos.
Codex desarrolla **contra estos contratos ya definidos** (no crea migraciones nuevas que choquen).

### 4.1 Cambios de esquema (`backend/prisma/schema.prisma` + 1 migración)
Owner: **Claude**. Codex asume que estos modelos/campos existen:

- `Client`: ya tiene `docType`; añadir `phones Json?` (lista) manteniendo `phone` como principal.
- **`ClientHistory`** (nuevo): `id, clientDoc, saleId?, plate?, year Int, eventType` (`directo|referido|rtm|no_rtm`),
  `allyId?, allyName?, note, createdAt`. Log append-only para C4/C5.
- **`CashBox`** (nuevo): `id, code (unique), name, kind` (`caja_menor|provision_rtm|provision_convenio|iva|otra`), `active`.
  Semilla inicial con esas 4 cajas (P4).
- **`CashMovement`** (nuevo): `id, boxCode, type` (`ingreso|egreso`), `amount, refType, refId?, date, note, createdAt`.
  Egresos/ingresos de provisión (D4, V6) y futuras cajas.
- `Receivable`: añadir `invoiceNumber String?`, `ica Int @default(0)`, `retefuente Int @default(0)`,
  `paymentRef String?` (para R2/R5).
- **`ReceivablePayment`** (nuevo): `id, receivableId, invoiceNumber, amount, ica, retefuente, paidDate, note`
  (abonos de Gora/Addi por factura, R5).
- `AllyPayment`: añadir `voucherPath String?`, `invoiceNumber String?`, `plates Json?`, `convenioCount Int @default(0)` (V1/V3/V4).
- **`Supplier`** (nuevo): `id, docType, docNumber (unique), name, email, phone, address, paymentMethod, active` (F2).
- **`PurchaseOrder`** (nuevo) + **`PurchaseOrderLine`**: orden de compra a proveedor (F2/F3).
- **`ManualInvoice`** (nuevo) + **`ManualInvoiceLine`**: factura electrónica manual tipo POS (F1).
- `Sale`: añadir `provisionConsumed Boolean @default(false)` y `provisionSourcePlate String?`
  para P2/P3 (marca cuándo una venta consume una provisión previa).

> Mantener el estilo del repo: **sin `@relation`/FK**, referencias por id/código escalar, `@@map`, `@@index`.

### 4.2 Utilidad de exportación a Excel
Owner: **Claude**. Nuevo `backend/src/services/excel.js` con un helper genérico
`toWorkbook({ sheets: [{ name, columns, rows }] }) -> Buffer` (usar `exceljs`). Tanto los módulos de
Claude (cierre) como los de Codex (cartera, convenios, KPIs) llaman a este helper. **No reimplementar Excel.**

### 4.3 Subida de archivos (comprobantes)
Owner: **Claude**. Endpoint base de upload (`multer`) que guarda en `backend/uploads/` y devuelve un path
servible. Codex lo usa para los comprobantes de convenios (V3/V4).

### 4.4 Helpers de menú/router del frontend
Owner: **Claude**. Añade las nuevas pestañas vacías al sidebar y al router de `frontend/app.js`
(**Provisiones, Factura elec., Proveedores, Dashboard, Llamadas**) y deja en cada una un punto de
montaje (`renderXxx(container)`) que Codex rellena. Así no hay conflictos en `index.html`/`app.js`.

---

## 5. Reparto del trabajo

### Lo que desarrolla **Claude** (núcleo financiero + clientes)

> ✅ **ENTREGADO (2026-06-04).** Módulos 1–5 implementados y probados por API:
> - **Clientes/historial**: tipo de documento (select CC/NIT/CE/TI/PAS), multi-teléfono (principal + adicionales),
>   búsqueda por placa, `ClientHistory` (bitácora directo/referido/rtm por año), reporte **Directo→Referido**.
>   Endpoints: `GET /api/clients?q=` (incluye placa), `GET /api/clients/reports/directo-referido`,
>   `GET /api/clients/:doc` (trae `history`). Fix: la venta ya **no pisa** tel/email/dirección del cliente.
> - **Llamadas/vencimientos**: `GET /api/calls?from=&to=` (última RTM + 1 año por placa) → pestaña **Llamadas**.
> - **Cierre diario**: `GET /api/closings/export` (Excel con formato vía `excel.js`), botón **"Cierre del día"**,
>   **desglose** de Jasper/Diferencia.
> - **Provisiones**: pestaña con cajas (saldo) + RTM pendientes; **placa provisionada** en la venta
>   (paso "RTM ya está paga" → busca provisión por placa y la **consume sin recalcular comisión ni valor**);
>   `CashMovement` egreso/ingreso (caja menor ↔ provisión RTM); cajas configurables (`POST /api/provisions/boxes`).
>   Endpoints: `GET /api/provisions[?plate=]`, `/boxes`, `POST /:saleId/realize`, `/movements`.
>   **P3 (ventas brutas netas)**: la realización **no crea venta nueva** → no hay doble conteo por diseño.

Núcleo acoplado (provisión ↔ cierre ↔ ventas brutas) y datos maestros de clientes.

1. **Fase 0** completa (sección 4): esquema, migración, `excel.js`, uploads, pestañas y montajes.
2. **Clientes e historial** — C1, C2, C3, C4, C5: multi-teléfono, tipo de documento en UI, búsqueda por
   placa, registro y vista de `ClientHistory`, filtro "directo→referido".
3. **Vencimientos y Llamadas** — C6: cálculo de vencimiento por placa + pestaña **Llamadas**.
4. **Cierre diario** — D1, D2, D3, D4: exportar a Excel (vía `excel.js`), renombrar a "Cierre del día",
   desglose detallado, egreso de provisión + ingreso al cierre.
5. **Provisiones** — P1, P2, P3, P4: pestaña **Provisiones**, lógica de **placa provisionada** en la venta
   (no doble comisión), resta de provisiones realizadas en ventas brutas, modelo de **cajas** (`CashBox`/`CashMovement`).

### Lo que desarrolla **Codex** (reportes + CRUD autocontenidos)
Módulos que dependen del esquema de Fase 0 pero no del cálculo del cierre. Construir contra los contratos ya definidos.

1. **Cartera Gora/Addi** — R1–R7
   - Backend: extender `routes/receivables.js`; nuevos endpoints de **abonos por factura**
     (`POST /api/receivables/:id/payments`) usando `ReceivablePayment`, con **ICA** y **retención en la fuente**.
   - Calcular costo real de vender por Gora (monto facturado − ICA − retefuente − costo transacción).
   - Filtros por **proveedor**, **rango de fechas**, **cédula** y **# factura**; vistas agrupada/general.
   - Validación R6 (Gora siempre factura). Botón **Exportar Excel** (usa `excel.js`).
   - **Referencia obligatoria del formato de pago**: `pago de gora.pdf` (columnas: # factura, documento,
     cliente, fecha, monto, ICA, retención). Pídele al usuario que te describa las columnas exactas si el PDF no es legible.
2. **Pagos de convenios** — V1–V6
   - Botón **"aplicar a todos"** de comisión (actualiza `Ally.commission` masivo).
   - **Comprobante**: subir imagen (usa endpoint de uploads de Fase 0) y visualizar.
   - **Imprimir** comprobante (vista imprimible con placas, valor, factura, espacio de firma).
   - Mostrar **cantidad de convenios, placas, valor, factura**.
   - **Facturar a la cédula** (genera `ManualInvoice` o marca para factura electrónica).
   - Enviar el dinero a la **caja de provisión de convenios** (`CashMovement` ingreso, contrato P4/V6).
3. **Factura electrónica / Proveedores** — F1, F2, F3
   - Pestaña **Factura elec.** (manual, tipo POS) usando `ManualInvoice`/`ManualInvoiceLine`.
   - Pestaña **Proveedores** (CRUD `Supplier`) + **orden de compra** (`PurchaseOrder`).
   - Conceptos de pago configurables.
4. **Dashboard / KPIs** — K1–K4
   - Pestaña **Dashboard** con índice de reportes y tarjetas de **KPIs mensuales** (sección 3 K2),
     comparación contra año anterior, **provisión de IVA** (K3), resumen de motos entre fechas (K4),
     y **exportar a Excel** (usa `excel.js`).

### Fase posterior (no ahora, dejar previsto)
- **T2** Control de FUPA/PIN (inventario de pines inicio/fin de día).
- **Homologación DIAN**: CUFE real, envío al proveedor tecnológico, nómina electrónica. (Ya fuera de alcance en `MODELO_DATOS.md`.)

---

## 6. Convenciones (obligatorias para Codex)

- **Backend**: Node ESM + Express + Prisma. Rutas en `backend/src/routes/`, lógica en `backend/src/services/`.
  Validar entrada, devolver JSON `{ ok, data }`/`{ ok:false, error }` como el resto de rutas.
- **Sin FK**: nunca uses `@relation`; relaciona por id/código en el código. Respeta `@@map`/`@@index`.
- **Dinero**: enteros COP (sin centavos), igual que el resto del proyecto.
- **Frontend**: HTML/JS plano, sin frameworks. Consume la API por `fetch` (ver `frontend/api.js`).
  Monta tu vista en el `renderXxx(container)` que dejó Claude en Fase 0; no edites el sidebar.
- **No crear migraciones de esquema nuevas** salvo que un campo te falte: si falta, **anótalo en este
  archivo bajo "Pendientes para Claude"** y sigue; Claude lo agrega a la migración única de Fase 0.
- **Excel**: siempre vía `services/excel.js`. **Uploads**: siempre vía el endpoint de Fase 0.
- Commits pequeños y descriptivos en español, como el historial actual.

## 7. Secuencia recomendada

1. Claude entrega **Fase 0** (esquema + migración + `excel.js` + uploads + pestañas/montajes) y avisa.
2. En paralelo: Claude → Clientes/Cierre/Provisiones; Codex → Cartera/Convenios/Factura-Proveedores/Dashboard.
3. Integración: validar el flujo **provisión → placa provisionada → egreso/ingreso en cierre → ventas brutas**
   (toca a ambos) y que todas las exportaciones a Excel cuadren con `FORMATO CIERRE 2.3 2026.xlsx`.

---

## Pendientes para Claude (Codex escribe aquí lo que le falte del esquema)
- _(vacío por ahora)_
