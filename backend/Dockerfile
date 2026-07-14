# Imagen de la app MotoPOS (API Express + Prisma; tambien sirve el frontend).
#
# El build corre desde la RAIZ del proyecto, no desde backend/, porque la imagen
# necesita copiar tambien frontend/:
#   docker build -f backend/Dockerfile .
# El docker-compose.yml de la raiz ya lo hace asi.

FROM node:24-slim AS base
# openssl: lo necesita el motor de consultas de Prisma en las imagenes slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- deps: se cachean mientras no cambien package.json ni el schema ---
FROM base AS deps
COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci
# Genera el client de Prisma contra el schema (necesita prisma/ ya copiado).
RUN npx prisma generate

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/prisma ./prisma
COPY backend/src ./src
# server.js:119 sirve el frontend desde join(__dirname,"..","..","frontend"),
# y __dirname es /app/src -> la ruta tiene que ser /frontend exactamente.
COPY frontend /frontend

# Archivos subidos en runtime. uploads.js:11 los resuelve en /app/uploads.
# El compose le monta un volumen encima para que sobrevivan a las
# actualizaciones de la imagen.
RUN mkdir -p /app/uploads && chown -R node:node /app /frontend

# No correr como root.
USER node

EXPOSE 5180

# El entrypoint aplica migraciones antes de arrancar (ver docker-compose.yml).
CMD ["node", "src/server.js"]
