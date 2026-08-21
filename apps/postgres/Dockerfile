# ---- Base image ----
FROM hmctsprod.azurecr.io/base/node:22-alpine AS base
USER root
RUN npm install -g corepack
RUN corepack enable
COPY --chown=hmcts:hmcts . .
USER hmcts

# ---- Build image ----
FROM base AS build
RUN yarn install
ENV NODE_ENV=production
RUN yarn build

# ---- Runtime image ----
FROM base AS runtime
COPY --chmod=755 apps/postgres/start.sh ./apps/postgres/start.sh
COPY apps/postgres/health-server.mjs ./apps/postgres/health-server.mjs

RUN yarn workspaces focus @hmcts/postgres
ENV NODE_ENV=production

WORKDIR /opt/app/apps/postgres
CMD ["sh", "./start.sh"]
