# syntax=docker/dockerfile:1.7
# MechDost API image (docs/runbooks/deploy.md). Built in GitHub Actions from the repository root:
#   docker build -f apps/api/Dockerfile .
# Workspace packages are bundled into dist/ by scripts/build.mjs; npm dependencies come from `pnpm deploy --prod`.
# Configuration and secrets arrive at run time from the server's .env (never baked in).

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@mechdost/api..."
RUN pnpm --filter @mechdost/api build \
 && pnpm --filter @mechdost/api deploy --prod --legacy /out

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS run
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.mjs"]
