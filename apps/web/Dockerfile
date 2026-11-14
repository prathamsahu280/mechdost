# syntax=docker/dockerfile:1.7
# MechDost website image (docs/runbooks/deploy.md). Built in GitHub Actions from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_APP_URL=… .
# NEXT_PUBLIC_* values are compiled into the browser code, so they are build arguments (public values only;
# secrets never go here). The runtime image holds only Next.js' standalone server.

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
# pnpm at the version pinned in package.json (`packageManager`).
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@mechdost/web..."
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DATA_MODE=demo
ARG NEXT_PUBLIC_AUTH_MODE=demo
ARG NEXT_PUBLIC_MAPTILER_KEY
ARG NEXT_PUBLIC_SATELLITE_TILES
ARG NEXT_PUBLIC_SATELLITE_ATTRIBUTION
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG NEXT_PUBLIC_SENTRY_RELEASE
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENVNEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_DATA_MODE=$NEXT_PUBLIC_DATA_MODE \
    NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE \
    NEXT_PUBLIC_MAPTILER_KEY=$NEXT_PUBLIC_MAPTILER_KEY \
    NEXT_PUBLIC_SATELLITE_TILES=$NEXT_PUBLIC_SATELLITE_TILES \
    NEXT_PUBLIC_SATELLITE_ATTRIBUTION=$NEXT_PUBLIC_SATELLITE_ATTRIBUTION \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT \
    NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE \
    NEXT_PUBLIC_RAZORPAY_KEY_ID=$NEXT_PUBLIC_RAZORPAY_KEY_ID \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_FIREBASE_VAPID_KEY=$NEXT_PUBLIC_FIREBASE_VAPID_KEY \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
# Source maps for Sentry (decision 2026-11-14): only when the Deploy workflow passes the `sentry_auth_token` build
# secret (never a build argument, never in a layer). Then the browser maps are built, uploaded to the EU region for
# this release, and deleted in the same step; without the secret the step is skipped. Either way no `.map` file is
# left under .next/static, so source maps are never served.
ARG SENTRY_ORG
ARG SENTRY_PROJECT_WEB
ARG SENTRY_URL=https://de.sentry.io
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    set -e; \
    if [ -s /run/secrets/sentry_auth_token ] && [ -n "$SENTRY_ORG" ] && [ -n "$SENTRY_PROJECT_WEB" ] \
       && [ -n "$NEXT_PUBLIC_SENTRY_RELEASE" ]; then UPLOAD=1; else UPLOAD=0; fi; \
    if [ "$UPLOAD" = 1 ]; then export SENTRY_SOURCEMAPS=1; fi; \
    pnpm --filter @mechdost/web build; \
    if [ "$UPLOAD" = 1 ]; then \
      SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token)" SENTRY_URL="$SENTRY_URL" \
        pnpm --filter @mechdost/web exec sentry-cli sourcemaps upload --org "$SENTRY_ORG" \
        --project "$SENTRY_PROJECT_WEB" --release "$NEXT_PUBLIC_SENTRY_RELEASE" --url-prefix '~/_next/static' \
        .next/static \
        || echo 'Sentry source-map upload failed; deploying without it'; \
    fi; \
    find apps/web/.next/static -name '*.map' -delete

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
