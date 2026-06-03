# MotoPOS Facturacion

Prototipo web independiente para facturacion POS/electronica de servicios de motos.

## Incluye

- Factura POS con cliente, placa, rango de moto y renovacion.
- Ventas recurrentes por rango de modelo.
- Productos con impuestos, pagos y cambio.
- Registro de terceros/clientes con placa principal.
- Facturas guardadas en `localStorage`.
- Analisis por placa, cliente y rango de moto.
- Exportacion CSV de facturas.

## Abrir

Abrir `index.html` en el navegador. No requiere instalar dependencias.

Tambien se puede servir por HTTP local:

```powershell
cd "E:\guardando datos\claude test\pos-motos-facturacion"
node server.js
```

Luego abrir `http://127.0.0.1:5180`.

## Siguiente paso real

Conectar el boton `Facturar` a un backend que emita ante DIAN/POS electronico y guarde en una base de datos. Ahora esta armado como prototipo funcional local.
