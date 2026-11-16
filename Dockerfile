# =====================================================================
#  Préstalo — Imagen de contenedor (Node.js 20 / Express)
#  Build multi-etapa: dependencias en una etapa, runtime mínimo en la final.
# =====================================================================

# ---- Etapa de dependencias y build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# ---- Etapa de runtime (imagen final, mínima) ----
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Usuario sin privilegios (no root) por seguridad
RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app /app
USER app

EXPOSE 3000

# Verificación de salud (usa el endpoint /health y el fetch global de Node 20)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
