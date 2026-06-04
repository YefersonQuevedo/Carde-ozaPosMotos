# Modelo de datos MotoPOS V3

Base **MySQL con migraciones (Prisma)**, pero **sin llaves foraneas**: las tablas
estan bien definidas y las relaciones se resuelven **por valor de id en el codigo**
(`relationMode = "prisma"`, sin `@relation`). Asi el proyecto crece sin que cada
cambio rompa una marana de relaciones en la base.

> Esquema fuente: `backend/prisma/schema.prisma`. Carga inicial: `backend/prisma/seed.js`.

## Catalogos (estables)

| Tabla | Campos clave | Notas |
| --- | --- | --- |
| `clients` | `docNumber` (unico), `docType`, `name`, `phone`, `email`, `address` | La **placa NO va aqui**. |
| `vehicles` | `clientDoc`, `plate`, `modelYear`, `rangeName` | Un cliente, varias motos. Referencia por `clientDoc`. |
| `allies` | `name`, `commission`, `isDirectUser`, `enrolled`, contacto/cuenta | Convenios/referidos. `USUARIO` = directo ($20.000); referido ($40.000). |
| `products` | `code`, `name`, `unitPrice` (IVA-incluido), `taxRate` | Componentes fiscales: servicio, RUNT, SICOV, recaudo, ANSV. |
| `packages` | `code`, `name`, `rangeName` | Los 4 combos RTM por rango de modelo. |
| `package_components` | `packageCode`, `productCode`, `quantity` | Paquete -> componentes (por valor). |
| `payment_methods` | `code`, `groupCode`, `isCredit`, `generatesReceivable`, `facturaDian`, `costType`, `costRate`, `costAmount`, `costTaxRate` | Cada metodo trae su regla de costo y si factura DIAN. |

## Nucleo transaccional (referencias por `saleId`, sin FK)

| Tabla | Campos clave | Notas |
| --- | --- | --- |
| `sales` | cabecera + columnas planas indexadas (`saleDate`, `clientDoc`, `plate`, `total`, `rtmStatus`, `dianStatus`, `provisionAmount`, `deduction`, `allyType`...) | Un registro por servicio. Se registra **siempre**, se facture o no. |
| `sale_lines` | `saleId`, `productCode`, `base`, `tax`, `total` | Lineas fiscales internas (IVA discriminado). |
| `sale_payments` | `saleId`, `methodCode`, `amount`, `costAmount`, `costTax` | **Pago mixto**: varias filas por venta. Costo de transaccion **congelado**. |
| `sale_costs` | `saleId` (unico), `sicov`, `ivaSicov`, `recaudo`, `ivaRecaudo`, `ansv`, `fupa`, `sustratos`, `ivaFact`, `costeTransaccion`, `costosTotal` | Costos operativos congelados (formato de cierre). |
| `receivables` | `saleId`, `provider`, `amount`, `pending`, `status` | Cartera ADDI / GORA / credito propio. |
| `daily_closings` | `closingDate` (unico), `byMethod` (JSON), `jasperEstimado`, `provision`, `deducciones`, `cajaEfectivo` | Snapshot congelado del cierre que alimenta el consolidado. |

## Reglas de negocio (fuente: conversacion con el cliente + Excel de cierre)

- Los datos del cliente se **registran siempre** (se facture o no).
- **RTM realizada hoy → caja**; **RTM pendiente → provision** (no se consigna a Supergiros = "pendientes de transito").
- **ADDI y GORA siempre facturan** (DIAN) y generan **cartera**. **Supergiros NO factura** (solo recauda).
- Comision/deduccion: usuario directo (fidelizado) $20.000; referido $40.000 (se guarda si se aplico descuento).
- `pinAdquirido > 0` ⇒ RTM realizada (consume sustrato) ⇒ aplican costos por-RTM.
- Valores monetarios como enteros COP (centavos no aplican en este negocio).

## Costos por venta (replica EXACTA del Excel, en `services/costs.js`)

| Concepto | Regla |
| --- | --- |
| SICOV | `pin>0 ? 29825 : 0` ; IVA = SICOV * 0.19 |
| Recaudo | `pin>0 ? 8693 : 0` ; IVA = recaudo * 0.19 |
| ANSV | por anio: ≥2024→8500, 2019-2023→8800, 2010-2018→9100, ≤2009→8800 |
| FUPA (RUNT) | `pin>0 ? 5600 : 0` |
| Sustratos | `pin>0 ? 800 : 0` |
| IVA de facturacion | `facturada ? 37185 : 0` |
| Coste transaccion | por metodo: DATAFONO SG 0.79% · QR SG $1.000 · CREDITO PROPIO $1.000 · ADDI 9%+IVA · DATAFONO CM 4% · resto $0 |

## Cierre diario (replica del Excel, en `services/closing.js`)

- Subtotal SG = DATAFONO SG + QR SG ; Subtotal CM = total ingresos − Subtotal SG.
- `provision` = Σ total de RTM pendientes.
- `JASPER` (gira Supergiros) = Subtotal CM − provision.
- `EFECTIVO a entregar` = efectivo − fidelizados − gastos − referidos.
- `DIFERENCIA JASPER` = JASPER − efectivo entregado.
- Descuentos fidelizacion = Σ deduccion (allyType=usuario) ; referidos = total − fidelizacion.

## Fuera de alcance (fases siguientes)

- Integracion real con proveedor DIAN (CUFE, envio, notas de correccion con codigo del administrativo).
- Nomina electronica. Roles/permisos (recepcionista vs administrativo). Caja menor / gastos detallados.
