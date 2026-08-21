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
COPY --from=build /opt/app/apps/api/dist ./apps/api/dist
COPY --from=build /opt/app/libs ./libs

RUN yarn workspaces focus @hmcts/api --production
ENV NODE_ENV=production

WORKDIR /opt/app/apps/api
EXPOSE 3001
CMD ["node", "dist/server.js"]
