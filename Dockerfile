# Portal de Aplicativos: API NestJS servindo também o front (web/dist) num único container.

FROM node:20-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:20-alpine AS api
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY api/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=api /app/api/node_modules api/node_modules
COPY --from=api /app/api/dist api/dist
COPY --from=web /app/web/dist web/dist
COPY manifest/manifest.schema.json manifest/manifest.schema.json
COPY config/systems.json config/systems.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "api/dist/main.js"]
