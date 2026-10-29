FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/index.html web/vite.config.js ./
COPY web/src ./src
RUN npx vite build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY *.mjs ./
COPY public ./public
COPY --from=web /web/dist ./web/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV PORT=3100 MOBILE_PORT=3101 BIND_HOST=0.0.0.0 CRM_DB=/app/data/crm.sqlite
EXPOSE 3100 3101
CMD ["node","workspace-gateway.mjs"]
