# Plan: Caja menor + Cuentas por pagar (dispersión Supergiros)

Origen: revisión en audio `revision0906206.txt` (2026-06-09).
Decisiones tomadas con el dueño:
- **Cierre = puro ventas.** Los gastos dejan de restarse en el cierre; solo afectan el saldo de caja menor.
- Diseñar el plan completo antes de tocar código.

## Diagnóstico del estado actual

### Lo que YA existe (reutilizable)
- `CashBox` + `CashMovement` con saldo por caja (`boxesWithBalance` en [provisions.js:21](backend/src/routes/provisions.js#L21)). Cajas sembradas: `CAJA_MENOR`, `PROV_RTM`, `PROV_CONV`, `IVA`.
- `Expense` → genera egreso de caja ([expenses.js:189](backend/src/routes/expenses.js#L189)). Anular revierte. **Funciona.**
- `Payable` + `PayablePayment` + ruta + módulo `payables` — pero hoy es un módulo **gerencial genérico** (arriendo, nómina, cesantías, cuotas). **No** está atado a caja menor ni al cierre.
- Cierre diario calculado al vuelo ([closing.js](backend/src/services/closing.js), [dayAudit.js:100](backend/src/services/dayAudit.js#L100)) + snapshot `DailyClosing`.

### Los vacíos vs. lo que pidió el dueño
| # | Pedido | Estado hoy |
|---|--------|-----------|
| A | Al cerrar el día, el efectivo a entregar entra **automático** a caja menor | `POST /api/closings` solo guarda snapshot, **no mueve dinero** |
| B | Cartera de **cuentas por pagar a Supergiros por día** (Jasper), auto-generada al cerrar | No existe el vínculo día/proveedor |
| C | Pagar Supergiros **descuenta de caja menor** + validación "faltan $X" | `payable.pay` no genera `CashMovement` |
| D | **Filtrar por proveedor + rango de fechas** y descargar lo filtrado | GET solo filtra status/category; export solo status |
| E | **Desacoplar gastos del cierre** | El cierre resta gastos ([closing.js:48](backend/src/services/closing.js#L48)) |
| F | **Tablero unificado**: saldo caja menor + por pagar en una vista | Están separados |

## Decisión de arquitectura
Reutilizar el modelo `Payable` existente para las deudas de dispersión (Supergiros/Gora/Addi), en vez de crear una tabla paralela. Se distinguen por `creditor` (= `SUPERGIROS`) y `category` (= `dispersion`), y se vinculan al cierre por idempotencia. Así arriendo/nómina y Supergiros conviven en una sola cartera, filtrable por proveedor.

---

## Fase 1 — Desacoplar gastos del cierre (rápido, aislado)
1. `computeClosing` ([closing.js:48](backend/src/services/closing.js#L48)): `efectivoEntregar = efectivo − fidelizacion − referidos` (quitar `− gastos`). `diferenciaJasper` se recalcula solo.
2. `gatherDay` ([dayAudit.js:107](backend/src/services/dayAudit.js#L107)): dejar de inyectar `gastosRegistrados + gastosManual` al `computeClosing`. Seguir devolviendo `gastosRegistrados`/`gastosManual` como **informativo** (no resta).
3. Frontend [closing-report.js:36-38](frontend/modules/closing-report.js#L36): actualizar el desglose y la nota para que el efectivo a entregar ya no muestre la resta de gastos; mostrar gastos como dato aparte ("los gastos salen de caja menor").
4. Export resumen [closings.js:268-270](backend/src/routes/closings.js#L268): ajustar líneas de "Gastos"/"Efectivo a entregar".
> Verificación: un día con gasto registrado debe dar `efectivoEntregar` = efectivo − deducciones, y el saldo de `CAJA_MENOR` sí baja por el gasto.

## Fase 2 — Cierre dispara dispersión automática
Modificar `POST /api/closings` ([closings.js:307](backend/src/routes/closings.js#L307)) para que, dentro de una transacción, además del snapshot:
1. **Idempotencia**: borrar los `CashMovement` y `Payable` previos con `refType="closing"` y referencia a esa fecha, antes de recrear (permite re-cerrar el día sin duplicar).
2. **Ingreso a caja menor**: `CashMovement{ boxCode:"CAJA_MENOR", type:"ingreso", amount: closing.efectivoEntregar, refType:"closing", refId:<clave fecha>, date, note:"Cierre día X" }`.
3. **Cuenta por pagar Supergiros**: `Payable{ creditor:"SUPERGIROS", category:"dispersion", concept:"Jasper día X", totalAmount: closing.jasper, dueDate: date, refType:"closing", refId:<clave fecha> }`. (Requiere agregar `refType`/`refId` a `Payable` — ver Fase 4.)
4. (Opcional, follow-up) provisión del día → `PROV_RTM` ingreso. Se deja fuera de v1 porque el consumo ya lo maneja `realize` ([provisions.js:165](backend/src/routes/provisions.js#L165)); se documenta como punto abierto para no doble-contar.
> Verificación: cerrar un día crea exactamente 1 ingreso a caja menor + 1 payable Supergiros; re-cerrar no duplica.

## Fase 3 — Pagar cuentas por pagar desde caja menor (con validación de fondos)
Extender `POST /api/payables/:id/pay` ([payables.js:116](backend/src/routes/payables.js#L116)):
1. Aceptar `boxCode` opcional. Si viene:
   - Calcular saldo de esa caja (reusar `boxesWithBalance`).
   - Si `saldo < amount` → `409 { error: "Fondos insuficientes en <caja>", faltan: amount − saldo }`. (Permitir override explícito con `force:true` si el dueño quiere registrar igual; decidir en UI.)
   - Crear `CashMovement{ boxCode, type:"egreso", amount, refType:"payable", refId:id, note }` en la misma transacción que el `PayablePayment`.
   - Si NO viene `boxCode` → comportamiento actual (solo abono, para obligaciones pagadas por banco).
2. `DELETE` payable / anular abono → revertir el egreso (ingreso compensatorio), análogo a anular gasto.
> Verificación: pagar Supergiros baja el saldo de caja menor; pagar más de lo disponible devuelve 409 con el faltante.

## Fase 4 — Filtro por proveedor + rango de fechas + export filtrado
1. Migración Prisma: agregar a `Payable` los campos `refType String?`, `refId Int?` (para Fase 2). `creditor`/`category`/`dueDate` ya existen.
2. `GET /api/payables` ([payables.js:19](backend/src/routes/payables.js#L19)): aceptar `creditor`, `from`, `to` (sobre `dueDate`). Devolver totales filtrados.
3. `GET /api/payables/export` ([payables.js:36](backend/src/routes/payables.js#L36)): aplicar los mismos filtros (hoy solo `status`) para que **descargue exactamente lo filtrado**.
> Verificación: "lo que le debo a Supergiros entre el 1 y el 9 de junio" filtra y el Excel trae solo esas filas.

## Fase 5 — Tablero unificado de caja
Vista que combine, reutilizando módulos existentes:
1. **Saldos** de cada caja (`GET /api/provisions/boxes`).
2. **Cuentas por pagar pendientes** agrupadas por proveedor (Supergiros por día, Gora, Addi, obligaciones) con botón "Pagar" → llama Fase 3 con `boxCode=CAJA_MENOR`.
3. KPIs: "Saldo caja menor", "Debo a Supergiros", "Faltante para cubrir".
4. Filtros proveedor + rango + botón Exportar (Fase 4).
> Integración: nueva vista `view-caja` registrada en [app.js:50](frontend/app.js#L50) (patrón `switchView`), módulo nuevo `frontend/modules/cashbox.js` o ampliar `payables.js`.

---

## Fuera de alcance de este módulo (del mismo audio, para después)
- Dashboard: métodos de pago como **% del valor**; motos por rango como **%**; quitar tabla "venta por hora".
- Cobro directo: opción "aplica descuento" (descuento Fénix/cupón) como comisión interna que **no** aparece en la factura DIAN; foto + verificación de placa.
- Cierre detalle: descontar NSB (servicio homologado) según modelo en el efectivo a recibir.

## Riesgos / notas
- **Cambia números vs. el Excel original** (Fase 1): el efectivo a entregar ya no resta gastos. Es lo que pidió el dueño, pero hay que avisarle al comparar con planillas viejas.
- Las migraciones siguen el patrón del proyecto: MySQL sin FKs, relaciones por id en código.
- Idempotencia del cierre es crítica: el día se cierra/re-cierra varias veces; nunca debe duplicar movimientos ni payables.
