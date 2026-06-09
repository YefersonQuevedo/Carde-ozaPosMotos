# MotoPOS V3 — POS + Facturacion RTM de motos

Sistema POS para centro de revision tecnico-mecanica (RTM) de motos:
venta progresiva paso a paso, cierre diario que cuadra con el Excel del cliente,
cartera (ADDI/GORA/credito), provision por RTM pendiente y convenios/referidos.

- **Backend**: Node + Express + Prisma sobre **MySQL** (tablas bien definidas, **sin llaves foraneas**).
- **Frontend**: HTML/JS plano (wizard de venta progresivo) que consume la API por `fetch`.
- **Facturacion electronica**: por ahora **marca local** (numero + IVA discriminado). La integracion real con DIAN es fase aparte.

Detalle del modelo y formulas: ver [`MODELO_DATOS.md`](MODELO_DATOS.md).

> **En desarrollo (revisión 2026-06-04):** backlog del cliente y reparto de trabajo
> Claude/Codex en [`PLAN-REVISION-2026-06-04.md`](PLAN-REVISION-2026-06-04.md).
>
> **Arquitectura / próximos pasos:** modularizar el frontend y preparar multi-empresa
> (10–20 CDAs) en [`REFACTOR-Y-MULTIEMPRESA.md`](REFACTOR-Y-MULTIEMPRESA.md).

## Estructura

```
backend/        API Express + Prisma (esquema, migraciones, seed, servicios)
frontend/       App web (index.html, app.js, api.js, styles.css)
```

> Los archivos en la raiz (`app.js`, `index.html`, `styles.css`, `server.js`) son el
> **prototipo V2 legado** (localStorage). La version activa es `backend/` + `frontend/`.

## Puesta en marcha

1. Configurar la base:

   ```powershell
   cd backend
   copy .env.example .env   # ajusta DATABASE_URL a tu MySQL
   npm install
   npx prisma migrate dev --name init
   npm run seed             # carga productos, paquetes, metodos y ~143 convenios del Excel
   ```

2. Levantar la API (sirve tambien el frontend):

   ```powershell
   npm run dev
   ```

   Abrir `http://127.0.0.1:5180`.

## Flujo de venta (progresivo)

1. Cliente (buscar/crear) · 2. Moto (placa + anio → rango/paquete) · 3. ¿RTM ya paga?
· 4. ¿Necesita credito? (ADDI/GORA) o metodo(s) de pago (mixto) · 5. Usuario directo o referido
· 6. ¿RTM hoy? (si → caja, no → provision) · 7. Registrar venta · 8. Emitir factura (separado).

## API

| Metodo | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/catalog` | Productos, paquetes, metodos de pago |
| GET/POST | `/api/clients` | Buscar / crear-actualizar cliente |
| GET/POST | `/api/vehicles` | Motos por cliente/placa |
| GET/POST | `/api/allies` | Convenios / referidos |
| POST | `/api/sales` | Registrar venta (calcula costos, provision, cartera) |
| POST | `/api/sales/:id/invoice` | Emitir factura local |
| GET | `/api/sales` | Listar / filtrar ventas |
| GET/POST | `/api/closings` | Cierre del dia (al vuelo / congelar) |
| GET | `/api/closings/consolidado` | Consolidado de cierres |
| GET | `/api/receivables` | Cartera abierta |
| POST | `/api/receivables/:id/pay` | Marcar cartera pagada |
