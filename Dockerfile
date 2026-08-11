FROM node:22.19.0-slim AS build

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build:node

FROM node:22.19.0-slim AS runtime

ENV NODE_ENV=production \
    ASK_JDP_BIND_HOST=0.0.0.0 \
    ASK_JDP_TRANSCRIPT_RETENTION_HOURS=18
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/start-container.mjs scripts/runtime-permissions.mjs ./scripts/

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=25s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "scripts/start-container.mjs"]
