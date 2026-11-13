# Deploy with Docker to the AWS server: short design

User (2026-11-13):

- "we have to setup the cd part too, basically i think we should dockerize it and use that and also i have the vps ready too … its an aws … ubuntu@13.201.82.82";
- "the database would still be supabase tho".

## Answers (AskUserQuestion, 2026-11-13)

- **Build:** images are built in **GitHub Actions** and pushed to GHCR. The server only pulls.
- **Address:** **mechdost.com now**, with `www.mechdost.com` redirecting to the apex. The API runs at `api.mechdost.com`.
- **Data mode:** a **demo website plus a live API** (the Q69/Q70 defaults). The API uses the existing Supabase project, which is also today's development project.

## Intent

Every green push to `main` goes live without hand work, on the user's own server, at low cost. The database stays on Supabase (managed, Mumbai).

## Server

- **Address:** Elastic IP 13.207.157.3 (attached 2026-11-13, replaces the launch address 13.201.82.82).

- **Machine:** AWS, Ubuntu 24.04, 2 vCPU, 1.9 GB RAM, 17 GB free disk. It is reached with the user's SSH key.
- **Too small to build Next.js:** so images are built in Actions, and the server adds a 2 GB swap file for safety.

## What runs (docker compose, `/opt/mechdost`)

| Service | Image                                       | Notes                                                                                                                                          |
| ------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `caddy` | `caddy:2` (pinned digest)                   | Ports 80/443, automatic HTTPS (Let's Encrypt). `mechdost.com` → web, `www` → 301 to the apex, `api.mechdost.com` → api.                        |
| `web`   | `ghcr.io/prathamsahu280/mechdost-web:<sha>` | Next.js `output: 'standalone'`, `node server.js` on :3000. `NEXT_PUBLIC_*` values are baked in at build time from GitHub repository variables. |
| `api`   | `ghcr.io/prathamsahu280/mechdost-api:<sha>` | `node dist/server.mjs` on :4000, `TRUSTED_PROXY_HOPS=1` (behind Caddy).                                                                        |

- **Secrets:** only in `/opt/mechdost/.env` on the server (mode 600), plus the Firebase service-account file mounted read-only. Never in images, the repo or Actions logs (hard rule 4).
- **Containers:** run as a non-root user, with a memory limit each, `restart: unless-stopped`, and health checks (`/health` on the API, `/` on the web).

## Pipeline

1. `CI` (existing) passes on `main`.
2. `Deploy` (`workflow_run`, main only) builds both images with Buildx (GHA cache) and pushes them as `:<sha>` and `:main`.
3. It then SSHes to the server with a **dedicated deploy key** (not the user's key). There it:
   - logs in to GHCR with the job's short-lived token;
   - writes the image tag;
   - runs `docker compose pull && docker compose up -d --wait`;
   - prunes old images.
4. **Rollback:** re-run Deploy for an older commit (manual `workflow_dispatch` with a SHA).

Actions are pinned by SHA, and no third-party SSH action is used (plain `ssh`).

## Approaches considered

1. **Build in Actions, push to GHCR, SSH compose (chosen).** The server stays small and clean, and rollback is by tag.
2. **Build on the server.** Simpler, but Next.js build memory can exceed 1.9 GB, and the site slows during deploys.
3. **`docker save | ssh docker load`.** No registry, but slow transfers and no image history.

## Not in this change (queued)

- **Database migrations:** they stay manual (`pnpm db:migrate`, runbook). Running them in the pipeline needs a production Supabase project and a migrate step before the API swap.
- **Background worker** (`dist/worker.mjs`, live relay): off until live updates are enabled.
- **Monitoring and alerts:** Sentry/uptime come later.
- **A separate production Supabase project:** before real customers.

## Needs the user (`questions-for-user.md`)

- **DNS at the registrar:**
  - `A mechdost.com → 13.207.157.3`;
  - `A www.mechdost.com → 13.207.157.3`;
  - `A api.mechdost.com → 13.207.157.3`;
  - optional `CAA 0 issue "letsencrypt.org"`.
- **AWS security group:** inbound TCP 80 and 443 from anywhere (22 stays as is).
- **Firebase:** add `mechdost.com` to the authorised domains when real sign-in is turned on (later).
