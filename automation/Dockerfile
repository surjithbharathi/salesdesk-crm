# Source-built internal n8n editor and engine. Keep upstream license notices.
FROM node:24.22.1-bookworm-slim AS workflow-build
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@12.4.2
WORKDIR /source
RUN git clone --depth 1 --branch n8n@2.44.6 https://github.com/n8n-io/n8n.git . && test "$(git rev-parse HEAD)" = b58d9e89d60e9a3485bb511c5091d8be0d9511e4
COPY automation/source.patch /tmp/salesdesk-source.patch
RUN git apply --check /tmp/salesdesk-source.patch && git apply /tmp/salesdesk-source.patch
ENV CI=true VUE_APP_SALESDESK_INTERNAL=true N8N_DIAGNOSTICS_ENABLED=false N8N_PERSONALIZATION_ENABLED=false
RUN pnpm agent:setup install --mem 4096 --concurrency 2 --tail 30
RUN pnpm agent:setup build --mem 4096 --concurrency 2 --tail 30
RUN N8N_USER_FOLDER=/tmp/salesdesk-build-tests pnpm --filter n8n test src/services/__tests__/salesdesk-access.service.test.ts src/controllers/__tests__/salesdesk.controller.test.ts --maxWorkers=1
RUN NODE_ENV=production DOCKER_BUILD=true pnpm --filter=n8n --prod --config.inject-workspace-packages=true --config.package-import-method=copy deploy --no-optional /opt/n8n
RUN cp LICENSE.md /opt/n8n/UPSTREAM-LICENSE.md

FROM node:24.22.1-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/surjithbharathi/salesdesk-crm
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=stable
COPY --from=node:22.22.2-bookworm-slim /usr/local/bin/node /usr/local/bin/node22
ENV SALESDESK_CRM_NODE=/usr/local/bin/node22
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=workflow-build /opt/n8n /opt/n8n
COPY *.mjs ./
COPY public ./public
COPY scripts/start-with-automation.mjs ./scripts/start-with-automation.mjs
COPY automation/THIRD_PARTY_NOTICES.md ./automation/THIRD_PARTY_NOTICES.md
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV PORT=3100 MOBILE_PORT=3101 BIND_HOST=0.0.0.0 CRM_DB=/app/data/crm.sqlite
EXPOSE 3100 3101
CMD ["node", "scripts/start-with-automation.mjs"]
