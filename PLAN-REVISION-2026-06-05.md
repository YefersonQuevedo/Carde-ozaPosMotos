# Plan de revision - Cliente 2026-06-05

Fuentes:
- `Revision050626principal.txt`
- `Revision050626principalsegundario.txt`
- Reportes recibidos el mismo dia: `Reporte de dispersion efectivo 25 al 31 mayo 1 semana.pdf`, `Reporte de dispersion tarjeta qr 25 al 31 mayo 1 semana.pdf`, `todo Mayo.xlsx`

Este documento complementa `PLAN-REVISION-2026-06-04.md`. La revision del 05/06 cambia el foco: el cliente no solo quiere vender y cerrar, quiere poder auditar descuadres con detalle por transaccion, placa, PIN, factura, metodo de pago y costo.

## 1. Cambios importantes detectados

### A. Venta / RTM / PIN

- El texto "RTM paga / se cobra ahora / no se cobra ahora" confunde. Debe reemplazarse por preguntas de negocio mas claras:
  - `Necesita credito?`
  - `RTM ya esta pagada?`
  - `La RTM se realiza hoy?`
- La placa de moto debe validarse como formato colombiano de moto: `AAA00A` (3 letras, 2 numeros, 1 letra).
- Cuando `La RTM se realiza hoy = si`, el sistema debe pedir el numero de PIN generado en SuperFlex.
- El PIN debe ser obligatorio para registrar/facturar una RTM realizada hoy.
- El PIN es numerico de 19 digitos.
- El PIN debe quedar vinculado a la venta/RTM, no solo como contador.
- El numero interno de venta/factura tipo `BTA...` no es la factura DIAN/POS real. El cliente distingue:
  - `BTA...`: registro interno.
  - `PCDA...` / similar: factura POS/DIAN emitida.

### B. Detalle del dia / planilla auditable

- El cierre actual es demasiado macro para auditar errores.
- El cliente necesita un "detalle del dia" que se parezca a su planilla/base de datos, transaccion por transaccion.
- Debe poder ver y exportar por cada venta:
  - item/orden
  - numero interno
  - numero factura POS/DIAN
  - fecha
  - cliente
  - documento
  - placa
  - modelo
  - rango/tipo de moto
  - directo/referido
  - convenio/referido
  - si fue fidelizado/directo
  - si se debito comision
  - si fue RTM realizada o pendiente
  - PIN de 19 digitos cuando aplique
  - metodo(s) de pago y valor por metodo
  - efectivo real recibido
  - IVA, SICOV, recaudo, ANSV/FNSB, FUPA/sustrato y costos de transaccion
  - gastos/movimientos asociados al dia y de que caja salieron
- La razon: si las comisiones o costos no cuadran, debe poder ubicar exactamente la placa/factura que causo el error sin mirar codigo.

### C. Arqueo Supergiros / dispersion efectivo vs bancos

- Supergiros entrega reportes separados: efectivo y tarjeta/bancos.
- El sistema debe proyectar/conciliar:
  - bruto por metodo de dispersion
  - neto esperado por efectivo
  - neto esperado por bancos/tarjeta/QR/datafono
  - total esperado
  - diferencias contra reporte real de dispersion
- En pago mixto, el valor total de la RTM no cambia, pero la dispersion puede partirse entre efectivo y bancos.
- Los costos operativos (SICOV, ANSV, FUPA, servicio de recaudo, IVA de servicio, costos de transaccion) deben calcularse por venta/RTM y luego poder agruparse por metodo de dispersion.
- Problema real detectado en Excel: cuando hay dos metodos de pago, si el modelo/PIN queda asociado al registro equivocado se descuadra ANSV/costos o se cobran dos veces.
- En la web esto debe resolverse con una sola venta con multiples pagos, pero el reporte debe saber explicar como se distribuye hacia Supergiros.

### D. Provisiones y cajas

- Se confirma la idea de varias cajas:
  - caja menor
  - RTM pendientes / provisiones
  - comisiones/convenios
  - IVA
  - futuras cajas
- Cuando una RTM esta pendiente, el dinero queda provisionado y no es plata libre.
- El reporte de referidos debe mostrar placas pendientes por referido/convenio para llamar y cerrar RTM.
- Se necesita separar la provision por metodo de pago cuando una venta pendiente fue pagada con varios metodos.

### E. Llamadas / base Tecmas / calidad de datos

- El modulo Llamadas debe crecer: no es solo "RTM vence pronto".
- El cliente tiene una base historica de Tecmas con datos desde 2022/2024/2025/2026:
  - cedula
  - placas
  - telefonos historicos
  - direccion
  - modelo
  - motor
  - VIN/BIN
  - ultima visita
- Hay que conservar multiples telefonos por cliente porque la calidad de datos se deteriora y algunos numeros recientes son inventados.
- Llamadas debe registrar seguimiento:
  - pendiente por llamar
  - llamado
  - no contesta
  - numero errado
  - contestado
  - agendado
  - vino / no vino
- A futuro interesa verificar RUNT para saber si el cliente hizo RTM en otro CDA. Esto es fase posterior/bot, no prioridad inmediata.

### F. FUPA / pines

- Se confirma el modulo de pines:
  - registrar compra de pines
  - consumo automatico por RTM realizada
  - stock teorico
  - pines quemados/ajustes
- Correccion de negocio: no hay "conteo fisico" como si fueran papeles; el control es digital contra SuperFlex/RUNT. Se puede mantener "ajuste" como conteo/regularizacion administrativa, pero la UI debe explicarlo mejor.

### G. Proveedores / facturas recibidas / modulo gerencial

- Proveedores no es solo orden de compra. Debe ser base para saber:
  - a quien se le debe
  - que facturas se han recibido
  - que pagos se hicieron
  - que IVA descontable hay
  - que conceptos afectan impuestos/renta
- Proveedores relevantes mencionados: ADI, Gora, ASOSEDEA, contabilidad, Eurometric, Flandes, Olimpica Estereo, CEP/litografia, LS Seguros, RUNT/FUPAS, Sointrek, Supergiros.
- Fase futura: recepcion de facturas electronicas recibidas por correo o DIAN:
  - leer correo dedicado de facturas electronicas
  - extraer ZIP/XML/HTML/PDF
  - clasificar proveedor por NIT
  - registrar concepto, base, IVA, total, descontable/no descontable
  - alimentar modulo gerencial e impuestos estimados
- Esto no debe bloquear el POS, pero conviene dejar el modelo preparado.

### H. Factura electronica / correo / DIAN

- Se confirma que Factura electronica manual sirve para facturar cosas fuera de RTM.
- Se necesita configuracion de correo/envio de facturas al cliente.
- Tambien se menciona recepcion de facturas que le emiten a la empresa, distinto de enviar facturas propias.
- Diferenciar claramente:
  - facturas emitidas por el negocio
  - facturas recibidas de proveedores
  - facturas enviadas a DIAN
  - facturas pendientes por enviar/facturar

## 2. Prioridad recomendada

### Prioridad 1 - No dejar que la venta cree datos malos

Owner sugerido: Claude, con revision de Codex.

- Cambiar textos del flujo para que no confundan "RTM paga" con credito/pago.
- Validar placa de moto `AAA00A`.
- Agregar `pinNumber` a `Sale` o modelo asociado: string numerico de 19 digitos.
- Pedir PIN obligatorio cuando `rtmToday = true`.
- Mostrar PIN en venta, detalle, cierre, llamadas/provisiones y exportaciones.

### Prioridad 2 - Detalle del dia auditable

Owner sugerido: Codex.

- Crear endpoint/export nuevo de detalle diario tipo planilla.
- Incluir todos los campos de venta, pagos, costos, factura, comision, proveedor/convenio, PIN y caja.
- Agregar vista en Cierre diario o Consolidado: "Detalle del dia".
- Exportar a Excel con columnas amplias para auditoria.

### Prioridad 3 - Arqueo de dispersion Supergiros

Owner sugerido: Codex.

- Analizar PDFs de dispersion efectivo/tarjeta y `todo Mayo.xlsx`.
- Crear modelo o reporte de "dispersions" si hace falta.
- Calcular esperado por dia:
  - efectivo
  - bancos/tarjeta/QR/datafono
  - total
  - costos por concepto
  - diferencia contra reporte importado/manual
- Soportar ventas con pago mixto sin duplicar costos de moto/PIN.

### Prioridad 4 - Llamadas y base historica Tecmas

Owner sugerido: Claude.

- Importador de base Tecmas cuando el cliente la entregue.
- Normalizar clientes/telefonos/placas sin destruir historial.
- Seguimiento de llamadas con estados.
- Reporte de clientes por vencer y clientes perdidos/no retornados.

### Prioridad 5 - Proveedores/Fiscal gerencial

Owner sugerido: Codex, fase posterior.

- Ampliar proveedores hacia cuentas por pagar/facturas recibidas.
- Registrar facturas recibidas manualmente primero.
- Luego automatizar correo/DIAN/XML.
- Reportar IVA descontable, gastos por naturaleza y estimado gerencial.

## 3. Cambios de esquema que parecen necesarios

Pendiente para Claude si se mantiene una migracion compartida:

- `Sale.pinNumber String?` con validacion de 19 digitos cuando RTM realizada.
- `Sale.dianInvoiceNumber String?` o aclarar si `invoiceNumber` ya representa PCDA/DIAN y `saleNumber` representa BTA.
- `SalePayment.dispersionGroup String?` o equivalente para clasificar `efectivo`, `bancos`, `tarjeta`, `qr`, `datafono_supergiros`.
- `CallLog` o ampliar modulo llamadas: `clientDoc`, `plate`, `phone`, `status`, `result`, `note`, `nextCallDate`, `createdAt`, `createdBy`.
- `SupplierInvoice` / `ReceivedInvoice` para facturas recibidas de proveedores: proveedor/NIT, numero, fecha, concepto, base, IVA, total, descontable, archivo/correo origen, estado.
- `ExpenseNature` o catalogo de naturalezas de ingreso/gasto.

## 4. Notas para no malinterpretar

- "PIN quemado" significa PIN/RTM generado/consumido, no necesariamente error. Error es cuando el consumo no cuadra con ventas/RTM registradas.
- El cliente quiere seguir pudiendo exportar y auditar en Excel. El sistema no debe encerrar los datos.
- El pago mixto no implica dos ventas. Es una venta con varios pagos, pero los reportes de dispersion deben poder separarla.
- La base de Persei/facturacion anterior no sirve como unica fuente porque solo contiene lo facturado, no toda la operacion ni todos los clientes.
- RUNT/bot/captcha es valioso, pero fase posterior por riesgo tecnico/legal/operativo.

## 5. Tareas inmediatas para Codex

- [ ] Auditar `todo Mayo.xlsx` y los PDFs de dispersion para extraer columnas reales y formulas.
- [ ] Proponer/implementar "Detalle del dia" exportable con transaccion por transaccion.
- [ ] Revisar si el Dashboard actual necesita separar esperado de Supergiros por efectivo/bancos.
- [ ] Ampliar Proveedores con una primera version de facturas recibidas manuales, si Claude confirma esquema.

## 6. Tareas inmediatas para Claude

- [ ] Agregar/validar PIN de 19 digitos en venta RTM realizada.
- [ ] Ajustar textos del wizard de venta para eliminar confusion de "RTM paga".
- [ ] Validar placa de moto `AAA00A`.
- [ ] Ampliar Llamadas con seguimiento real y preparar importador Tecmas.
- [ ] Aclarar campo de factura interna vs factura DIAN/POS.
