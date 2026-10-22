FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY *.mjs ./
COPY public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV PORT=3100 MOBILE_PORT=3101 BIND_HOST=0.0.0.0 CRM_DB=/app/data/crm.sqlite
EXPOSE 3100 3101
CMD ["node","server.mjs"]
