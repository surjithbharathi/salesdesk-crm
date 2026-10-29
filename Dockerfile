FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/index.html web/vite.config.js ./
COPY web/src ./src
RUN npx vite build

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/surjithbharathi/salesdesk-crm
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY *.mjs ./
COPY public ./public
COPY migrations ./migrations
COPY scripts ./scripts
COPY --from=web /web/dist ./web/dist
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV PORT=3100 MOBILE_PORT=3101 BIND_HOST=0.0.0.0 CRM_DB=/app/data/crm.sqlite
EXPOSE 3100 3101
CMD ["node","server.mjs"]
