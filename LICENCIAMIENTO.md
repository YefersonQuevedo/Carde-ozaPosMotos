# Plan: licenciamiento con verificación remota (lease firmado)

> **Estado:** plan / decisiones tomadas. No implementado aún.
> **Por qué:** el despliegue es **on-premise** (cada CDA corre Node + MySQL en su propia
> máquina). No controlamos el servidor, así que necesitamos una forma de saber que la
> licencia sigue activa y de poder cortarla si dejan de pagar.
> **Pendiente de decidir:** servidor de licencias en Cloudflare Worker (recomendado) o
> archivos estáticos en GitHub. Ver [FASE C](#fase-c--servidor-de-licencias).

---

## 0. El límite real (leer antes de sobre-invertir)

**Cualquier check que corra en la máquina del cliente se puede quitar.** El código es
nuestro pero la máquina es de ellos. No existe forma de impedirlo, solo de encarecerlo.

La meta no es "imposible de romper", es **"romperlo cuesta más que pagar la mensualidad"**.
Para un CDA de motos eso se logra con relativamente poco. Todo lo que sigue está calibrado
a ese objetivo — no hay que irse a extremos que solo generan trabajo y bugs.

Dos consecuencias que mandan sobre el resto del diseño:

1. **El chequeo va en el backend, nunca en el frontend.** `frontend/` corre entero en el
   navegador del cliente: por más ofuscado que esté, abrir DevTools y borrar la línea del
   check es cuestión de minutos. Ofuscar el frontend para licenciamiento no aporta nada.
2. **La firma criptográfica importa más que la ofuscación.** Ver [FASE B](#fase-b--módulo-de-licencia-backend).

---

## 1. Modelo elegido: lease firmado de 15 días

El servidor devuelve una licencia **firmada** que dice "este install vale hasta el
29 de julio". El backend chequea a diario en background y renueva el lease.

| Situación | Comportamiento |
| --- | --- |
| Chequeo diario OK | Renueva lease a **+15 días**. Silencio total, el cliente no ve nada. |
| Falla el chequeo | Reintenta cada ~2h. Mientras el lease siga vigente, **sin ruido**. |
| Lease con < 3 días | Banner de aviso: "no se ha podido validar la licencia, quedan X días". |
| Lease vencido | Gracia de **7 días** con banner rojo. |
| Gracia agotada | **Degradar**: bloquear escrituras (ventas, facturas), dejar GET y exportar. |

**Por qué así:** se le cayó el WiFi y no pasa nada. El cliente tendría que estar **20+ días
sin internet** para que le bloqueemos algo, y el POS ya necesita internet para la DIAN de
todos modos. Bloquear apenas falle el chequeo significa dejar sin facturar a un cliente que
sí pagó porque se le cayó la conexión — eso genera una llamada furiosa y no vale la pena.

**Degradar ≠ apagar.** Al degradar se bloquean las escrituras pero se deja consultar y
exportar. Nunca les secuestramos sus propios datos: eso convierte una disputa de cobro en
un problema legal.

---

## FASE A — Estado de licencia (persistencia)

En el schema **no hay modelo `Setting`**, así que el estado de licencia necesita tabla propia.

### A.1 Modelo Prisma

```
model License {
  id         Int      @id @default(autoincrement())  // siempre 1 fila
  installId  String                                   // UUID generado en la activación
  blob       String   @db.Text                        // payload JSON firmado (base64)
  signature  String   @db.Text                        // firma Ed25519
  expiresAt  DateTime                                 // copia desnormalizada para queries
  lastSeenAt DateTime                                 // anti-rollback de reloj
  lastCheck  DateTime?                                // último intento (OK o no)
  @@map("license")
}
```

### A.2 Doble persistencia

Guardar el blob firmado en **la tabla `license` + una copia en archivo** (fuera de `src/`).
Si falta uno, se restaura del otro. Motivo: borrar la fila de MySQL no debe ser un reset
gratis a "sin licencia = instalación nueva".

### A.3 Anti-rollback del reloj

**El detalle que se le olvida a todo el mundo.** Con un lease firmado, atrasar la fecha del
sistema lo extiende para siempre.

- Actualizar `lastSeenAt` de forma periódica (throttled, no en cada request).
- Si `now < lastSeenAt - 1h` → el reloj retrocedió → **no renovar el lease** y marcar sospecha.

---

## FASE B — Módulo de licencia (backend)

### B.1 Firma Ed25519 — la pieza central

Node 24 trae todo, **sin dependencias extra**:

```js
// Generación de llaves (una sola vez, en NUESTRA máquina)
crypto.generateKeyPairSync("ed25519")

// Verificación en el backend del cliente (Ed25519 usa null como algoritmo)
crypto.verify(null, Buffer.from(payloadJson), publicKey, signature)
```

- La **llave privada nunca sale de nuestra máquina**.
- La **pública va incrustada** en el backend.

**Sin firma, el bypass es de 5 minutos:** apuntan nuestro dominio a `127.0.0.1` en el archivo
`hosts`, montan un server que responde `{"activa": true}` y listo. Con Ed25519 ese ataque no
sirve para nada porque no pueden firmar la respuesta falsa.

Y como el `expiresAt` va **dentro** de lo firmado, tampoco sirve editar MySQL a mano — ojo
que el cliente es admin de esa base, así que esto importa. Pueden borrar la fila (→ se
restaura del archivo, o se trata como sin licencia), pero **no pueden extender la fecha**.

### B.2 Payload firmado

```json
{
  "installId": "uuid-v4",
  "companyNit": "900123456",
  "issuedAt":  "2026-07-14T10:00:00Z",
  "expiresAt": "2026-07-29T10:00:00Z"
}
```

### B.3 Activación inicial

Necesitamos un **código de activación** que se le entrega al cliente en la instalación
(ej. `CDA-XXXX-XXXX`):

1. Primer arranque: `POST /activate {code, fingerprint}`.
2. El servidor genera el `installId`, devuelve el primer lease firmado y **ata el código a
   esa máquina**.
3. Segundo intento con el mismo código desde otra máquina → rechazado (o nos avisa).

Sin esto, una instalación nueva sin fila en `license` sería indistinguible de una legítima.

### B.4 Scheduler

- Chequeo diario en background (no bloqueante, no en el path de un request).
- Reintento cada ~2h si falla.
- `POST /check {installId}` → nuevo lease firmado +15d.

---

## FASE C — Servidor de licencias

### C.1 Opción recomendada: Cloudflare Worker

- **Gratis** en el tier que vamos a usar (100k req/día; nosotros haremos ~20).
- ~30 líneas de código.
- **Revocación instantánea.**
- **Telemetría**: sabemos quién hace check-in y cuándo.
- **Detecta bases clonadas**: mismo `installId` haciendo check-in desde dos IPs. Este es el
  escenario realista con un CDA que abre sede nueva y "aprovecha" la instalación.

### C.2 Opción GitHub (funciona, pero es ciega)

Publicar `licencias/<installId>.json` firmado. El `installId` es un UUID aleatorio, así que
aunque el repo sea público nadie adivina la URL — y el contenido va firmado, o sea que da
igual quién lo lea. Revocar = borrar el archivo. Cero infraestructura, cero costo, uptime de
GitHub. El caché del CDN (~5 min) es irrelevante para un check diario.

**Pero no nos enteramos de nada.** Un archivo estático no sabe quién lo pidió:

- No sabemos si el cliente está activo o si hace 3 meses que no prende el sistema.
- **No detectamos bases clonadas** a una segunda máquina.
- No hay log de nada para cobrar ni para discutir.

> **Conclusión:** el trabajo de firmar/verificar es **idéntico** en ambos casos. GitHub no es
> más simple, solo es más ciego. Ir directo al Worker.

Bloquear/spoofear el endpoint (vía `hosts` o firewall) no les sirve: la firma impide falsear
la respuesta, y bloquearlo solo hace que el lease venza en 15 días y degrade. Funciona a
nuestro favor.

---

## FASE D — Ofuscación

### D.1 Qué ofuscar

**Solo el módulo de licencia** (`src/license/*.js`), **nunca el backend completo**:
`javascript-obfuscator` sobre todo `src/` va a romper Prisma y los imports dinámicos, y
vamos a terminar debuggeando eso en vez de vendiendo.

### D.2 Qué NO esperar de la ofuscación

No detiene a alguien que sepa. **Lo que de verdad sube el costo es que el check no sea un
`if (licenciaOk)` suelto** que se borra de un plumazo, sino que esté **tejido en los caminos
que ellos necesitan**:

- Crear venta (`POST /api/sales`)
- Cerrar caja (`POST /api/closings`)
- Emitir factura (`POST /api/sales/:id/invoice`)

En varios lugares, inline. Quitarlo obliga a **entender el código**, no a buscar la palabra
"licencia".

### D.3 Descartado por ahora

- **Node SEA** (empaquetar todo en un `.exe` para que nunca vean el `.js`): Node 24 lo trae,
  pero Prisma tiene un motor nativo que hace ese empaquetado bastante doloroso. **No para el v1.**
- **bytenode** (`.jsc`, bytecode V8): soporte flojo de ESM y queda atado a la versión de Node.

---

## Resumen de decisiones

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Dónde va el check | Backend | El frontend corre en el navegador del cliente |
| Modelo | Lease firmado, 15 días | Tolera cortes de internet sin molestar |
| Chequeo | Diario, reintento ~2h | Fallar callado mientras el lease viva |
| Firma | Ed25519 (`node:crypto`) | Impide spoof del server y edición de MySQL |
| Al vencer | Banner → 7d gracia → bloquear escrituras | Nunca secuestrar sus datos |
| Servidor | Cloudflare Worker *(a confirmar)* | Gratis + telemetría + revocación + detecta clones |
| Ofuscación | Solo `src/license/*` | Ofuscar todo rompe Prisma |
| Anti-rollback | `lastSeenAt` | Sin esto, atrasar el reloj vuelve eterno el lease |

---

## Por hacer (cuando se implemente)

- [ ] Decidir Worker vs GitHub
- [ ] Generar par de llaves Ed25519 (privada **fuera del repo**, en sitio seguro)
- [ ] Modelo `License` + migración
- [ ] Módulo `src/license/` (verify, lease, scheduler, anti-rollback)
- [ ] Endpoint de activación + script para emitir códigos
- [ ] Servidor de licencias (Worker + KV/D1)
- [ ] Tejer los checks en sales / closings / invoice
- [ ] Banner de aviso en el frontend (solo UI; la decisión la toma el backend)
- [ ] Ofuscar `src/license/` en el build de release
- [ ] Probar: sin internet, reloj atrasado, fila borrada, base clonada
