# MotoPOS V2 Facturacion

Prototipo web independiente para facturacion POS/electronica de servicios de motos, cierre diario, cartera y convenios.

## Incluye

- Factura POS con cliente, placa, rango de moto y renovacion.
- Ventas recurrentes por rango de modelo.
- Flujo operativo: RTM ya pagada, usuario directo/referido, credito, RTM hoy/pendiente y envio DIAN.
- Productos con impuestos, pagos reales y cambio.
- Metodos de pago del cierre: efectivo, Datafono SG, QR SG, QR CM, Datafono CM, transferencia, ADDI, GORA y credito propio.
- Costos operativos tomados del formato de cierre: SICOV, recaudo, ANSV, FUPA, sustratos, IVA de facturacion y coste de transaccion.
- Cierre diario con ingresos por metodo, provision, cartera, Jasper estimado y deducciones.
- Cuentas por cobrar para ADDI, GORA, credito propio o saldos pendientes.
- Catalogo de convenios/referidos.
- Registro de terceros/clientes con placa principal.
- Facturas guardadas en `localStorage`.
- Analisis por placa, cliente y rango de moto.
- Exportacion CSV de facturas.

## Abrir

Abrir `index.html` en el navegador. No requiere instalar dependencias.

Tambien se puede servir por HTTP local:

```powershell
cd "E:\guardando datos\pos-motos-facturacion"
node server.js
```

Luego abrir `http://127.0.0.1:5180`.

## Siguiente paso real

Validar el flujo con el usuario final y luego conectar el boton `Facturar` a un backend que emita ante DIAN/POS electronico, guarde en base de datos y persista cierres/cartera.
