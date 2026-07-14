# Instalación de MotoPOS

Guía para instalar el sistema en el PC del CDA. No hace falta saber programar
ni instalar Node ni MySQL: **todo corre dentro de Docker**.

Tiempo estimado: 20 minutos (casi todo es la descarga de Docker).

---

## 1. Requisitos

- **Windows 10/11 de 64 bits** (o cualquier PC con Docker).
- **8 GB de RAM** recomendado (4 GB es el mínimo real).
- **10 GB libres** en disco.
- Conexión a internet **para instalar**. Después el sistema funciona sin internet,
  salvo la facturación DIAN y la validación de licencia.

---

## 2. Instalar Docker Desktop

1. Descargar de <https://www.docker.com/products/docker-desktop/>
2. Instalar con las opciones por defecto.
3. **Reiniciar el PC** cuando lo pida.
4. Abrir Docker Desktop y esperar a que abajo a la izquierda diga **"Engine running"**.

> Docker tiene que quedar **abierto** para que el POS funcione. En Docker Desktop:
> *Settings → General → Start Docker Desktop when you log in*. Así arranca solo
> cuando prenden el PC y nadie tiene que acordarse.

---

## 3. Copiar el sistema

Copiar la carpeta del sistema al PC, por ejemplo a `C:\motopos`.

---

## 4. Configurar las claves (solo una vez)

Dentro de la carpeta hay un archivo `.env.example`. Hay que **copiarlo** a `.env`
y completarlo.

Abrir PowerShell en la carpeta (clic derecho → *Abrir en Terminal*) y correr:

```powershell
copy .env.example .env
```

Ahora hay que generar dos claves al azar. Correr este comando **dos veces** y
guardar cada resultado:

```powershell
docker run --rm node:24-slim node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Abrir `.env` con el Bloc de notas y pegar una en cada línea:

```
MYSQL_ROOT_PASSWORD=<la primera clave>
JWT_SECRET=<la segunda clave>
```

> **No inventes claves cortas ni reutilices las de otra instalación.** El
> `JWT_SECRET` es lo que impide que alguien se fabrique una sesión de
> administrador. Si es adivinable o si es el mismo de otro CDA, cualquiera que
> lo conozca entra como admin.

---

## 5. Arrancar

```powershell
docker compose up -d
```

La **primera vez** tarda varios minutos: descarga MySQL y construye la
aplicación. Las siguientes son cuestión de segundos.

Para ver que todo levantó:

```powershell
docker compose ps
```

Los dos servicios (`motopos-db` y `motopos-app`) tienen que decir **running**.

---

## 6. Cargar los datos iniciales (solo una vez)

Esto crea el catálogo (productos, paquetes, métodos de pago, tarifas) y el
usuario administrador:

```powershell
docker compose exec app npm run seed
```

Al final imprime la clave del admin, algo así:

```
====================================================
  Usuario admin creado.
  usuario: admin
  clave:   xK3mP9qL2vN8
  Anotala: no se vuelve a mostrar. Cambiala al entrar.
====================================================
```

> **Anotar esa clave.** No se vuelve a mostrar. Si se pierde, hay que crear otro
> usuario a mano contra la base.

La instalación arranca **sin convenios**: cada CDA carga los suyos desde el
sistema. Es a propósito — los convenios son datos personales (cédulas, cuentas
bancarias) y no se comparten entre empresas.

---

## 7. Entrar

Abrir el navegador en:

**<http://127.0.0.1:5180>**

Usuario `admin` y la clave del paso anterior. **Cambiarla apenas entres.**

---

## Uso diario

No hay que hacer nada. Si Docker Desktop arranca con el PC, el POS ya está
levantado y solo hay que abrir <http://127.0.0.1:5180>.

| Para... | Comando |
| --- | --- |
| Apagar el sistema | `docker compose down` |
| Volver a prenderlo | `docker compose up -d` |
| Ver qué está pasando | `docker compose logs -f` |
| Ver si está corriendo | `docker compose ps` |

`docker compose down` **no borra datos**: quedan en el volumen `motopos-db`.

> ### Lo único que nunca hay que correr
>
> ```
> docker compose down -v
> ```
>
> Ese `-v` **borra la base de datos completa**: ventas, clientes, cierres, todo.
> No tiene deshacer.

---

## Respaldos

Los datos viven en un volumen de Docker, **no** en la carpeta del sistema.
Copiar `C:\motopos` NO respalda la base.

Para sacar un respaldo:

```powershell
docker compose exec db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" motopos' > respaldo.sql
```

Guardarlo **fuera del PC** (nube o disco externo). Un respaldo en el mismo disco
no sirve el día que el disco falla.

Para restaurar:

```powershell
Get-Content respaldo.sql | docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" motopos'
```

---

## Actualizar a una versión nueva

```powershell
docker compose down
# (reemplazar los archivos del sistema por los nuevos)
docker compose up -d --build
```

Las migraciones de base se aplican solas al arrancar. Los datos y los archivos
subidos se conservan.

> Sacar un respaldo **antes** de actualizar. Siempre.

---

## Si algo falla

**"docker: command not found" / "cannot connect to the Docker daemon"**
Docker Desktop no está abierto. Abrirlo y esperar a "Engine running".

**El navegador dice que no se puede conectar**
Ver `docker compose ps`. Si `motopos-app` no está *running*, mirar el error con
`docker compose logs app`.

**"falta MYSQL_ROOT_PASSWORD en el archivo .env"**
No se creó el `.env` o quedó vacío. Volver al paso 4.

**"port is already allocated"**
Otro programa usa el puerto 5180. En `docker compose.yml`, cambiar
`"127.0.0.1:5180:5180"` por `"127.0.0.1:5181:5180"` y entrar por
<http://127.0.0.1:5181>.

**La app arranca y se cae sola**
Casi siempre es que la base todavía no estaba lista. `docker compose restart app`.
Si sigue, `docker compose logs app`.

---

## Notas de seguridad

- **La base no está expuesta.** Solo la alcanza la aplicación, por la red interna
  de Docker. No tiene puerto abierto en el PC.
- **El POS solo responde en este PC** (`127.0.0.1`). Para usarlo desde otras
  máquinas del local hay que cambiar los puertos en `docker-compose.yml` — pero
  eso lo expone a toda la red, así que consultá antes.
- **El `.env` no se comparte ni se sube a ningún lado.** Tiene las claves de esta
  instalación.
