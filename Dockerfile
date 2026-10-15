# ---- Base image ----
FROM hmctsprod.azurecr.io/base/node:24-alpine AS base
USER root
RUN npm install -g corepack
RUN corepack enable
COPY --chown=hmcts:hmcts . .
USER hmcts

# ---- Build image ----
FROM base AS build
RUN yarn install
RUN yarn build

# ---- Runtime image ----
FROM base AS runtime
COPY --from=build /opt/app/dist ./dist
COPY --from=build /opt/app/libs ./libs

# No workspace name: the application is the root workspace since plan 03 task 3 flattened `apps/web` into
# it, and `yarn workspaces focus` with no argument focuses the current one — pulling in `libs/*` through the
# `workspace:*` dependencies and nothing else.
RUN yarn workspaces focus --production
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "dist/server.js"]
