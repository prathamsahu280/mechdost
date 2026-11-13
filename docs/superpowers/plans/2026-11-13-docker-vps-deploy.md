# Docker + VPS deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every green push to `main` builds web + API images in GitHub Actions and deploys them with docker compose behind Caddy (HTTPS) on the user's AWS server, with mechdost.com / api.mechdost.com.

**Architecture:**

- **Images:** two multi-stage images (Next.js standalone, bundled Hono API) are pushed to GHCR.
- **Server:** an Ubuntu 24.04 server runs `caddy`, `web` and `api` from `/opt/mechdost/compose.yml`. Secrets live in `/opt/mechdost/.env`.
- **Deploy job:** a `workflow_run` job, triggered after CI, SSHes in with a dedicated deploy key and runs `docker compose pull && up -d --wait`.

**Tech Stack:** Docker, Buildx, GHCR, Caddy 2.11, GitHub Actions, pnpm 11, Node 24.22.1.

**Spec:** `docs/superpowers/specs/2026-11-13-docker-vps-deploy-design.md`.

## Global Constraints

- Node image `node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c`; Caddy `caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0`.
- Actions pinned by SHA: login `8aa5831fb8d48d8f76594c7ddde61ae58019f550` (v4.8.0), setup-buildx `f87e5991a6d7451dcb8d9637bfbc97413f497069` (v4.4.1), build-push `c3c9e263c25d99ce0380d002d59b67737d91b0dc` (v7.4.0), checkout as in `ci.yml`.
- No secret in an image, the repo or a log. `NEXT_PUBLIC_*` values come from repository **variables**. The SSH key and host come from repository **secrets**.
- Containers run as non-root with memory limits (web 512 MB, api 384 MB, caddy 128 MB) and health checks.
- The website stays in demo mode (`NEXT_PUBLIC_DATA_MODE=demo`, `NEXT_PUBLIC_AUTH_MODE=demo`); the API uses the existing Supabase project; migrations stay manual.

## Review Focus

1. A deploy whose new container fails its health check → `up --wait` fails the job, and the job output says so (rollback = re-run with the previous SHA).
2. `/opt/mechdost/.env` missing on the server → the deploy stops with a clear message before pulling.
3. Caddy behind no DNS yet → the site is unreachable but nothing crash-loops; certificates are issued once DNS points at the server.
4. The API behind a proxy → client IPs for rate limits come from `X-Forwarded-For` with `TRUSTED_PROXY_HOPS=1`.
5. Two deploys at once → `concurrency: deploy-production` queues the second.

---

### Task 1: Images

**Files:** Create `.dockerignore`, `apps/web/Dockerfile`, `apps/api/Dockerfile`. Modify `apps/web/next.config.ts` (`output: 'standalone'`, `outputFileTracingRoot` = repo root).

- [ ] Web image: `pnpm install --frozen-lockfile --filter "@mechdost/web..."`, `pnpm --filter @mechdost/web build` with the build args `NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DATA_MODE, NEXT_PUBLIC_AUTH_MODE, NEXT_PUBLIC_MAPTILER_KEY, NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST, NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_RAZORPAY_KEY_ID, NEXT_PUBLIC_TURNSTILE_SITE_KEY`; the runtime copies `.next/standalone`, `.next/static` and `public`, runs `node apps/web/server.js` as `node`, on port 3000.
- [ ] API image: install `--filter "@mechdost/api..."`, `pnpm --filter @mechdost/api build`, `pnpm --filter @mechdost/api deploy --prod --legacy /out`; the runtime copies `/out/node_modules`, `dist`, `package.json`, runs `node dist/server.mjs` as `node`, on port 4000.
- [ ] Verify: `pnpm --filter @mechdost/web build` still passes locally with standalone output (`apps/web/.next/standalone/apps/web/server.js` exists); `pnpm check` green. The images themselves are verified by the Deploy workflow's build job.

### Task 2: Server stack

**Files:** Create `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/bootstrap.sh`, `deploy/env.server.example`.

- [ ] `compose.yml`: services caddy/web/api as in the spec; `${IMAGE_TAG}`; api `env_file: .env` and `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase.json` mounted read-only from `./firebase-admin.json`; web gets only the runtime env it needs; health checks (`wget`-free: `node -e fetch(...)`); volumes `caddy_data`, `caddy_config`.
- [ ] `Caddyfile`: `mechdost.com` → `reverse_proxy web:3000`; `www.mechdost.com` → `redir https://mechdost.com{uri} permanent`; `api.mechdost.com` → `reverse_proxy api:4000`; `encode zstd gzip`.
- [ ] `bootstrap.sh` (idempotent, run once as `ubuntu` with sudo): Docker Engine + compose plugin from Docker's apt repository, a 2 GB swapfile, `/opt/mechdost` owned by `ubuntu`, `ubuntu` in the `docker` group, unattended security upgrades on.
- [ ] Verify: `bash -n deploy/bootstrap.sh`; run bootstrap on the server; `docker compose config` there.

### Task 3: Deploy workflow

**Files:** Create `.github/workflows/deploy.yml`.

- [ ] Triggers: `workflow_run` (workflows: [CI], types: [completed], branches: [main]) when the conclusion is `success`, plus `workflow_dispatch` with an optional `ref`. Permissions: `contents: read, packages: write`. `concurrency: deploy-production`.
- [ ] Job `images`: checkout of the tested SHA, buildx, GHCR login (`GITHUB_TOKEN`), build-push both images with `cache-from/to: type=gha,scope=<name>`, tags `:${sha}` and `:main`.
- [ ] Job `deploy` (needs images, environment `production`): write `secrets.DEPLOY_SSH_KEY` to a file (600), `ssh-keyscan` pinned against `secrets.DEPLOY_KNOWN_HOSTS`, `scp deploy/compose.yml deploy/Caddyfile`, then over `ssh`: check that `.env` exists, `docker login ghcr.io` with the job token, `IMAGE_TAG=<sha> docker compose pull && up -d --wait --remove-orphans`, `docker logout ghcr.io`, `docker image prune -f`.
- [ ] Set the repository secrets `DEPLOY_SSH_KEY` (a new ed25519 key, public half in the server's `authorized_keys`), `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`, and the variables `NEXT_PUBLIC_APP_URL=https://mechdost.com`, `NEXT_PUBLIC_API_URL=https://api.mechdost.com`, `NEXT_PUBLIC_DATA_MODE=demo`, `NEXT_PUBLIC_AUTH_MODE=demo`.
- [ ] Verify: push → CI green → Deploy green; on the server `docker compose ps` is healthy; `curl -H "Host: api.mechdost.com" http://127.0.0.1/health` through Caddy (HTTP until DNS).

### Task 4: Docs

- [ ] A decisions entry ("Hosting: Docker on the user's AWS server"), superseding the Vercel/Cloud Run hosting line.
- [ ] `docs/runbooks/deploy.md`: first-time setup, the user's steps (DNS, security group, `.env`, Firebase file), rollback, logs, manual migrations.
- [ ] `questions-for-user.md` Q81 (DNS + security group + server `.env`); update `progress.md`, `CLAUDE.md` (stack line) and the `README` index.
