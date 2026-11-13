# Runbook: deployment (Docker on the AWS server)

How MechDost goes from a push on `main` to the live site. Read this before changing anything in `deploy/`, `apps/*/Dockerfile` or `.github/workflows/deploy.yml`.

- **Decision:** decisions 2026-11-13 "Hosting: Docker on the user's AWS server". This supersedes Vercel and Cloud Run.
- **Design:** `docs/superpowers/specs/2026-11-13-docker-vps-deploy-design.md`.
- **Plan:** `docs/superpowers/plans/2026-11-13-docker-vps-deploy.md`.

## 1. The picture

```
push to main ─▶ CI (format, types, lint, tests)
                   │ green
                   ▼
              Deploy workflow
              ├─ images: build web + API images (Buildx, cached) ─▶ ghcr.io/prathamsahu280/mechdost-{web,api}:<sha>
              └─ deploy: ssh ubuntu@13.201.82.82 ─▶ /opt/mechdost
                                                     docker compose pull && up -d --wait
                                                     ┌──────────────────────────────────────────┐
  shoppers ─▶ https://mechdost.com ────────────────▶ │ caddy :80/:443 (HTTPS, Let's Encrypt)    │
  apps     ─▶ https://api.mechdost.com ────────────▶ │   ├─ web  :3000 (Next.js standalone)     │
                                                     │   └─ api  :4000 (Hono)  [profile: api]   │
                                                     └──────────────────────────────────────────┘
                                                                   │
                                                                   ▼
                                                     Supabase Postgres (Mumbai), Firebase Auth
```

| Piece    | Where                          | Notes                                                                                                                   |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Server   | AWS, `ubuntu@13.201.82.82`     | Ubuntu 24.04, 2 vCPU, 1.9 GB RAM + 2 GB swap, 19 GB disk.                                                               |
| Stack    | `/opt/mechdost/` on the server | `compose.yml`, `Caddyfile` (copied by every deploy), `.env` (yours, never in git), `.image-tag` (last deployed commit). |
| Images   | GHCR (private, like the repo)  | `mechdost-web:<sha>` / `:main`, `mechdost-api:<sha>` / `:main`.                                                         |
| Database | Supabase                       | Not on the server. Migrations are run by hand (§ 6).                                                                    |
| HTTPS    | Caddy                          | Certificates are issued and renewed automatically once DNS points at the server.                                        |

**Repository files:**

- `apps/web/Dockerfile` and `apps/api/Dockerfile`: multi-stage, pinned `node:24.22.1-bookworm-slim` digest, run as the `node` user, with health checks.
- `.dockerignore`: keeps `.env`, keys and local builds out of the build context.
- `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/bootstrap.sh`, `deploy/env.server.example`.
- `.github/workflows/deploy.yml`.
- `apps/web/next.config.ts`: `output: 'standalone'` for the web image.

## 2. What the website and API run on

- **Website:** demo data and demo sign-in (`NEXT_PUBLIC_DATA_MODE=demo`, `NEXT_PUBLIC_AUTH_MODE=demo`; Q69/Q70 defaults). It needs no secrets at run time.
- **API:** off until its production settings exist (§ 3.5). It then runs against the Supabase project. Today that is the same project as development, so a separate production project is needed before real customers.
- **Website settings are fixed at build time.** `NEXT_PUBLIC_*` values are compiled into the browser code, so they are **GitHub repository variables** read by the image build, not server settings. Changing one means a new deploy.

## 3. First-time setup

Done by Claude on 2026-11-13: the server bootstrap (§ 3.1), the deploy key and the `production` environment secrets (§ 3.3, with your approval), the GitHub variables (§ 3.4) and the files in the repo. Everything else is yours: it needs your accounts, your SSH access or your secrets.

### 3.1 Server bootstrap (done 2026-11-13; safe to re-run)

The script installs:

- Docker Engine and the compose plugin (Docker's signed apt repository);
- log rotation (10 MB × 3 per container);
- a 2 GB swap file;
- unattended security upgrades;
- `/opt/mechdost` (owned by `ubuntu`).

```bash
scp deploy/bootstrap.sh ubuntu@13.201.82.82:/tmp/ && ssh ubuntu@13.201.82.82 'bash /tmp/bootstrap.sh'
```

### 3.2 AWS security group (you, AWS console)

- **Rules:** EC2 → Instances → the instance → Security → security group → Edit inbound rules. Add:
  - HTTP, TCP 80, from `0.0.0.0/0` and `::/0`;
  - HTTPS, TCP 443, from `0.0.0.0/0` and `::/0` (UDP 443 is optional, for HTTP/3).
- **SSH (22):** keep it as it is. Restrict it to your own IP if you can, but GitHub Actions also needs SSH (§ 3.3). If you restrict it, allow GitHub's runner ranges or use a self-hosted runner.

### 3.3 Deploy key and GitHub secrets (done 2026-11-13)

GitHub Actions logs in with **its own key** (`github-actions-deploy@mechdost` in `~/.ssh/authorized_keys` on the server), not yours, so it can be removed without touching your access. The secrets live in the GitHub **environment `production`**, which only accepts the `main` branch (Settings → Environments):

| Secret               | Value                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `DEPLOY_SSH_KEY`     | The private half of the deploy key. GitHub holds the only copy; the local copy was deleted after upload. |
| `DEPLOY_KNOWN_HOSTS` | The server's ed25519 host key (`ssh-keyscan`), so a man-in-the-middle cannot impersonate the server.     |
| `DEPLOY_HOST`        | `13.201.82.82`                                                                                           |
| `DEPLOY_USER`        | `ubuntu`                                                                                                 |

**To rotate the key:**

```bash
ssh-keygen -q -t ed25519 -N "" -C "github-actions-deploy@mechdost" -f ~/.ssh/mechdost_deploy
ssh ubuntu@13.201.82.82 'umask 077; cat >> ~/.ssh/authorized_keys' < ~/.ssh/mechdost_deploy.pub
"/c/Program Files/GitHub CLI/gh.exe" secret set DEPLOY_SSH_KEY --env production < ~/.ssh/mechdost_deploy
rm ~/.ssh/mechdost_deploy
# then delete the old github-actions-deploy line from ~/.ssh/authorized_keys on the server
```

If the server is rebuilt, refresh the host key:

```bash
ssh-keyscan -t ed25519 <ip> | "/c/Program Files/GitHub CLI/gh.exe" secret set DEPLOY_KNOWN_HOSTS --env production
```

Also update `DEPLOY_HOST` if the address changes.

**Workflow trust:** the deploy only runs for a green CI run started by a **push to `main` of this repository**, never for a fork or a pull-request run, or when started by hand (`workflow_dispatch`) by someone with write access (security review 2026-11-13).

### 3.4 GitHub repository variables (public build settings)

These were set 2026-11-13:

- `NEXT_PUBLIC_APP_URL=https://mechdost.com`;
- `NEXT_PUBLIC_API_URL=https://api.mechdost.com`;
- `NEXT_PUBLIC_DATA_MODE=demo`;
- `NEXT_PUBLIC_AUTH_MODE=demo`.

Add the map key from your `.env` (public by design, but it lives in `.env`, so you set it):

```bash
"/c/Program Files/GitHub CLI/gh.exe" variable set NEXT_PUBLIC_MAPTILER_KEY --body "<value from .env>"
```

These are optional, set them when the service exists:

- `NEXT_PUBLIC_SATELLITE_TILES`, `NEXT_PUBLIC_SATELLITE_ATTRIBUTION`;
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`;
- `NEXT_PUBLIC_SENTRY_DSN`;
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`;
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Never put a secret in a variable: variables are printed in logs.

### 3.5 Server settings: `/opt/mechdost/.env` (you)

Start from the template, then fill in the values from your password manager or your local `.env`. Do **not** copy the local `.env` as is: it has development values (localhost URLs, the Auth emulator, test keys).

```bash
scp deploy/env.server.example ubuntu@13.201.82.82:/opt/mechdost/.env
ssh -t ubuntu@13.201.82.82 'chmod 600 /opt/mechdost/.env && nano /opt/mechdost/.env'
```

**Website only (now):** the file only has to exist. The website reads nothing from it.

**API too (later):** the API refuses to start in production unless all of these are set:

- the Supabase connection settings: `DATABASE_POOL_URL` (and `DATABASE_URL` for the relay);
- `FIREBASE_PROJECT_ID` (the real project);
- `FIREBASE_API_KEY`;
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (rate limits, Q4);
- `TURNSTILE_SECRET_KEY` (bot check, Q5);
- `WEB_BASE_URL` and `CORS_ORIGINS` as `https://` addresses;
- live Razorpay keys if any Razorpay key is set (test keys are refused in production).

The checks are in `apps/api/src/config.ts`. No service-account key file goes on the server: the API verifies sign-in tokens with the project id. When all of these are filled in, uncomment `COMPOSE_PROFILES=api` and deploy (§ 5).

### 3.6 DNS (you, at the registrar of mechdost.com)

Today `mechdost.com` points at `2.57.91.91` (the registrar's parking page). Replace or add these records:

| Type | Name               | Value                       | TTL                          |
| ---- | ------------------ | --------------------------- | ---------------------------- |
| A    | `@` (mechdost.com) | `13.201.82.82`              | 300                          |
| A    | `www`              | `13.201.82.82`              | 300                          |
| A    | `api`              | `13.201.82.82`              | 300                          |
| CAA  | `@`                | `0 issue "letsencrypt.org"` | 3600 (optional, recommended) |

- **Delete** any other A or AAAA record on `@`, `www` and `api`; a leftover AAAA record breaks certificate issuance.
- **Check:** `nslookup mechdost.com` should show `13.201.82.82`. Caddy then gets the certificates within a minute of the next request, and no restart is needed.
- **Elastic IP:** the server needs an Elastic IP in AWS, or this address changes when the instance is stopped and started.

### 3.7 Switch deploys on

Once § 3.5 is done (§ 3.3 already is):

```bash
"/c/Program Files/GitHub CLI/gh.exe" variable set DEPLOY_ENABLED --body true
"/c/Program Files/GitHub CLI/gh.exe" workflow run deploy.yml   # first deploy without waiting for a push
```

Until `DEPLOY_ENABLED=true`, the workflow only builds and pushes images (which also proves the Dockerfiles still build), and the deploy job is skipped.

## 4. How a deploy works

1. **Trigger:** `CI` finishes green on `main`, and `Deploy` starts (`workflow_run`). A manual run (`workflow_dispatch`) takes an optional `ref`.
2. **Job `images`:**
   - checks out the exact tested commit;
   - builds `apps/api/Dockerfile` and `apps/web/Dockerfile` with the GitHub Actions cache;
   - pushes `:<sha>` and `:main` to GHCR with the job's own token (no stored registry password).
3. **Job `deploy`** (only with `DEPLOY_ENABLED=true`) runs over SSH with the deploy key and the pinned host key:
   1. stops with a clear error if `/opt/mechdost/.env` is missing;
   2. copies `deploy/compose.yml` and `deploy/Caddyfile` to `/opt/mechdost/`;
   3. logs in to GHCR on the server with the job's short-lived token, and logs out afterwards;
   4. runs `IMAGE_TAG=<sha> docker compose pull`, then `docker compose up -d --wait --wait-timeout 120 --remove-orphans`;
   5. prunes old images and prints `docker compose ps`.
4. **Health:** `up --wait` fails the job if a container does not become healthy within 120 s:
   - web: `GET /` on :3000;
   - API: `GET /health` on :4000.
   - The old container keeps serving until the new one is up.
5. **Public check:** a last, non-blocking step requests `https://mechdost.com/` from GitHub, to show whether the site is reachable from the internet.

**Concurrency:** one deploy at a time (`deploy-production` group); a second one waits.

## 5. Everyday operations

All commands run on the server (`ssh ubuntu@13.201.82.82`, then `cd /opt/mechdost`), unless they say `gh`.

| Task                         | Command                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is running              | `docker compose ps` · `cat .image-tag`                                                                                                                                                                                                                              |
| Logs (follow)                | `docker compose logs -f web` · `… api` · `… caddy` (last hour: `--since 1h`)                                                                                                                                                                                        |
| Restart one service          | `docker compose restart web`                                                                                                                                                                                                                                        |
| Settings changed in `.env`   | `docker compose up -d` (recreates the services whose settings changed)                                                                                                                                                                                              |
| Turn the API on or off       | set or unset `COMPOSE_PROFILES=api` in `.env`, then `docker compose up -d --remove-orphans`                                                                                                                                                                         |
| Deploy the latest `main` now | `gh workflow run deploy.yml`                                                                                                                                                                                                                                        |
| **Roll back**                | `gh workflow run deploy.yml -f ref=<older commit sha>`. The image is rebuilt from that commit, or reused from cache. On the server only, as an emergency: `IMAGE_TAG=<sha> docker compose up -d` (needs `docker login ghcr.io` with a token that can read packages) |
| Memory and disk              | `docker stats --no-stream` · `free -h` · `df -h /` · `docker system df`                                                                                                                                                                                             |
| Free disk                    | `docker image prune -af` (keeps the running images)                                                                                                                                                                                                                 |
| Certificates                 | `docker compose logs caddy \| grep -i -E "certificate\|acme"`                                                                                                                                                                                                       |

## 6. Database migrations (manual, before deploying code that needs them)

The database is Supabase, and nothing on the server touches the schema. When a commit adds a migration (`packages/db/drizzle/NNNN_*.sql`):

1. Read the migration. It must be backward compatible (expand first, contract later; spec 14), because the running API keeps using the old code until the deploy finishes.
2. From your machine: `pnpm db:migrate` (uses `DATABASE_URL` from your local `.env`).
3. Then deploy (push or `gh workflow run deploy.yml`).

When a separate production Supabase project exists, migrations move into the pipeline, as a step before `up` that runs the API image's migrate command.

## 7. Security notes

- **Secrets:** they live only in `/opt/mechdost/.env` (mode 600) and in the GitHub environment `production` (secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`; main branch only). They are never in images (`.dockerignore`), the repo, variables or logs.
- **Pinned sources:** actions are pinned by commit SHA, and the Node and Caddy images by digest (hard rule 4). To update one, replace the SHA or digest in the same change as the version comment.
- **Containers:**
  - all run as non-root, with `no-new-privileges` and memory limits (web 512 MB, API 384 MB, Caddy 128 MB);
  - the API runs on a read-only filesystem;
  - only Caddy publishes ports (80/443).
- **Headers:** security headers (CSP, HSTS preload, frame and referrer policy) come from `apps/web/next.config.ts` and the API. Caddy adds HTTPS and compression only.
- **Rate limits:** the API trusts one proxy hop (`TRUSTED_PROXY_HOPS=1`, Caddy), so each client's real IP is used.
- **Removing the deploy key:** delete its line (`github-actions-deploy@mechdost`) from `~/.ssh/authorized_keys` on the server, then delete the `DEPLOY_SSH_KEY` secret of the `production` environment.
- **Server patching:** security updates install automatically (unattended-upgrades). Reboot for kernel updates when convenient: `sudo reboot`. The containers come back by themselves (`restart: unless-stopped`).

## 8. Troubleshooting

| Symptom                                                          | Likely cause                                                          | Fix                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails "`.env` is missing"                                 | § 3.5 not done                                                        | Create `/opt/mechdost/.env`.                                                                                               |
| Deploy fails at `ssh` / host key                                 | Deploy key not on the server, or the server was rebuilt               | § 3.3 (re-run the `ssh-keyscan` line).                                                                                     |
| Deploy fails in `up --wait`                                      | New container unhealthy                                               | `docker compose logs --since 10m api` (or `web`). The API prints which production setting is missing. Roll back if needed. |
| `https://mechdost.com` does not load, `http://13.201.82.82` does | DNS not pointing here yet, or ports closed                            | § 3.6 / § 3.2; then `docker compose logs caddy`.                                                                           |
| Certificate errors in Caddy logs                                 | DNS still on the old address, an extra AAAA record, or port 80 closed | Fix DNS or ports; Caddy retries by itself.                                                                                 |
| 502 on `api.mechdost.com`                                        | API not enabled (`COMPOSE_PROFILES=api` missing) or crashed           | § 3.5; `docker compose ps`.                                                                                                |
| Site slow, server swapping                                       | Out of memory                                                         | `docker stats`; the instance may need 4 GB (t3.medium) when the API and worker both run.                                   |

## 9. Not covered yet (queued)

- A production Supabase project and migrations in the pipeline (§ 6).
- The background worker (`dist/worker.mjs`, live relay) as a compose service, when live updates are on.
- Uptime monitoring and error tracking (Sentry), and alerts.
- Backups: Supabase handles the database (PITR add-on to turn on). The server holds no data except Caddy's certificates, which are re-issued automatically.
