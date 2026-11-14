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
              └─ deploy: ssh ubuntu@13.207.157.3 ─▶ /opt/mechdost
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

| Piece    | Where                          | Notes                                                                                                                                                |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server   | AWS, `ubuntu@13.207.157.3`     | Ubuntu 24.04, 2 vCPU, 1.9 GB RAM + 2 GB swap, 19 GB disk.                                                                                            |
| Stack    | `/opt/mechdost/` on the server | `compose.yml`, `Caddyfile` (copied by every deploy), `.env` (yours, never in git; every deploy keeps one line in it, `IMAGE_TAG=<deployed commit>`). |
| Images   | GHCR (private, like the repo)  | `mechdost-web:<sha>` / `:main`, `mechdost-api:<sha>` / `:main`.                                                                                      |
| Database | Supabase                       | Not on the server. Migrations are run by hand (§ 6).                                                                                                 |
| HTTPS    | Caddy                          | Certificates are issued and renewed automatically once DNS points at the server.                                                                     |

**Repository files:**

- `apps/web/Dockerfile` and `apps/api/Dockerfile`: multi-stage, pinned `node:24.22.1-bookworm-slim` digest, run as the `node` user, with health checks.
- `.dockerignore`: keeps `.env`, keys and local builds out of the build context.
- `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/bootstrap.sh`, `deploy/env.server.example`, `deploy/set-env.sh` (sets `.env` lines from stdin, prints names only), `deploy/supabase-ca-2021.crt` (public Supabase CA).
- `.github/workflows/deploy.yml`.
- `apps/web/next.config.ts`: `output: 'standalone'` for the web image.

## 2. What the website and API run on

- **Website:** demo data and demo sign-in (`NEXT_PUBLIC_DATA_MODE=demo`, `NEXT_PUBLIC_AUTH_MODE=demo`; Q69/Q70 defaults). It needs no secrets at run time.
- **API:** live since 2026-11-13 at https://api.mechdost.com (`COMPOSE_PROFILES=api` in the server `.env`). It runs against the Supabase project. Today that is the same project as development, so a separate production project is needed before real customers.
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
scp deploy/bootstrap.sh ubuntu@13.207.157.3:/tmp/ && ssh ubuntu@13.207.157.3 'bash /tmp/bootstrap.sh'
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
| `DEPLOY_HOST`        | `13.207.157.3`                                                                                           |
| `DEPLOY_USER`        | `ubuntu`                                                                                                 |

**To rotate the key:**

```bash
ssh-keygen -q -t ed25519 -N "" -C "github-actions-deploy@mechdost" -f ~/.ssh/mechdost_deploy
ssh ubuntu@13.207.157.3 'umask 077; cat >> ~/.ssh/authorized_keys' < ~/.ssh/mechdost_deploy.pub
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
- `NEXT_PUBLIC_SENTRY_DSN`, and for source maps `SENTRY_ORG`, `SENTRY_PROJECT_WEB`, `SENTRY_URL` (variables) plus the **secret** `SENTRY_AUTH_TOKEN` (set 2026-11-14; `runbooks/monitoring.md`). There is no PostHog browser key: PostHog is fed by the worker (`POSTHOG_KEY` in the server `.env`).
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`;
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Never put a secret in a variable: variables are printed in logs.

### 3.5 Server settings: `/opt/mechdost/.env` (you)

Start from the template, then fill in the values from your password manager or your local `.env`. Do **not** copy the local `.env` as is: it has development values (localhost URLs, the Auth emulator, test keys).

```bash
scp deploy/env.server.example ubuntu@13.207.157.3:/opt/mechdost/.env
ssh -t ubuntu@13.207.157.3 'chmod 600 /opt/mechdost/.env && nano /opt/mechdost/.env'
```

**Website only (now):** the file only has to exist. The website reads nothing from it.

**API too (later):** the API refuses to start in production unless all of these are set:

- the Supabase connection settings: `DATABASE_POOL_URL` (and `DATABASE_URL` for the relay);
- `FIREBASE_PROJECT_ID` (the real project);
- the Firebase service-account key as a file on the server, `/opt/mechdost/firebase-admin.json` (mode 600, owner uid 1000), mounted read-only at `/run/secrets/firebase-admin.json` by `compose.yml` — never in git or `.env`; production accepts a key only from `/run/secrets/` (Q93; copied 2026-11-14 and checked from the API image with a read-only `listUsers(1)`). Rotate it in the Firebase console (Project settings → Service accounts) and copy the new file the same way;
- `FIREBASE_API_KEY`;
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (rate limits, Q4);
- `TURNSTILE_SECRET_KEY` (bot check, Q5);
- `WEB_BASE_URL` and `CORS_ORIGINS` as `https://` addresses;
- live Razorpay keys if any Razorpay key is set (test keys are refused in production).

The checks are in `apps/api/src/config.ts`. No service-account key file goes on the server: the API verifies sign-in tokens with the project id. When all of these are filled in, uncomment `COMPOSE_PROFILES=api` and deploy (§ 5).

### 3.5a Turn the API on (api.mechdost.com)

The API starts only when every production check in `apps/api/src/config.ts` passes. Two of those settings are already handled by `compose.yml`:

- `TRUSTED_PROXY_HOPS=1`;
- `DATABASE_CA_CERT`: the public Supabase Root 2021 CA, `deploy/supabase-ca-2021.crt`, verified against the Mumbai poolers on 2026-11-13.

You add the rest:

1. **Upstash Redis** (rate limits): go to https://console.upstash.com, then Create database, Redis, region **ap-south-1 (Mumbai)**. Copy the **REST URL** and **REST token** into your local `.env` as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. **Cloudflare Turnstile** (bot check on public forms): go to https://dash.cloudflare.com, then Turnstile, then Add widget. Use the hostnames `mechdost.com` and `localhost`, mode Managed. Copy:
   - the **secret key** into the local `.env` as `TURNSTILE_SECRET_KEY`;
   - the **site key** as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. That one is also a GitHub variable (§ 3.4), needed when real sign-in is switched on.
3. **Copy the settings to the server** without showing them anywhere. Run this from the repo root (prefix with `!` in this Claude session). `set-env.sh` prints only the names it set:

```bash
grep -E '^(DATABASE_POOL_URL|DATABASE_URL|SUPABASE_URL|SUPABASE_SECRET_KEY|DATA_ENCRYPTION_KEYS|DATA_ENCRYPTION_KEY_ID|DATA_INDEX_KEY|FIREBASE_PROJECT_ID|FIREBASE_API_KEY|UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN|TURNSTILE_SECRET_KEY)=' .env   | ssh ubuntu@13.207.157.3 'bash /opt/mechdost/set-env.sh'
```

**Do not copy** `DATABASE_CA_CERT` (a Windows path), `FIREBASE_AUTH_EMULATOR_HOST`, `GOOGLE_APPLICATION_CREDENTIALS`, or the Razorpay **test** keys. Production refuses all of them. 4. **Switch on:**

- `printf 'COMPOSE_PROFILES=api
' | ssh ubuntu@13.207.157.3 'bash /opt/mechdost/set-env.sh'`;
- then on the server: `cd /opt/mechdost && docker compose up -d --wait`.
- Check: `curl https://api.mechdost.com/health`. If the API does not start, `docker compose logs api` names each missing or invalid setting (names only, never values).

**Note:** the API then uses the same Supabase project as development, which is the user's choice for now (decisions 2026-11-13 "Hosting"). Create a production project before real customers.

### 3.6 DNS (you, at the registrar of mechdost.com)

Today `mechdost.com` points at `2.57.91.91` (the registrar's parking page). Replace or add these records:

| Type       | Name               | Value                                               | TTL                          |
| ---------- | ------------------ | --------------------------------------------------- | ---------------------------- |
| A          | `@` (mechdost.com) | `13.207.157.3`                                      | 300                          |
| A or CNAME | `www`              | `13.207.157.3`, or CNAME `mechdost.com` (as set up) | 300                          |
| A          | `api`              | `13.207.157.3`                                      | 300                          |
| CAA        | `@`                | `0 issue "letsencrypt.org"`                         | 3600 (optional, recommended) |

- **Delete** any other A or AAAA record on `@`, `www` and `api`; a leftover AAAA record breaks certificate issuance.
- **Check:** `nslookup mechdost.com` should show `13.207.157.3`. Caddy then gets the certificates within a minute of the next request, and no restart is needed.
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
   - Since 2026-11-14, CI also builds both Docker images without pushing them (job "Docker images (build only)"). A broken Dockerfile now fails CI on every push and pull request, and never reaches the deploy.
2. **Job `images`:**
   - checks out the exact tested commit;
   - builds `apps/api/Dockerfile` and `apps/web/Dockerfile` with the GitHub Actions cache;
   - pushes `:<sha>` and `:main` to GHCR with the job's own token (no stored registry password).
3. **Job `deploy`** (only with `DEPLOY_ENABLED=true`) runs over SSH with the deploy key and the pinned host key:
   1. stops with a clear error if `/opt/mechdost/.env` is missing;
   2. copies `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/supabase-ca-2021.crt` and `deploy/set-env.sh` to `/opt/mechdost/`;
   3. logs in to GHCR on the server with the job's short-lived token, and logs out afterwards;
   4. writes `IMAGE_TAG=<sha>` into `.env` (replacing the previous line), runs `docker compose pull`, then `docker compose up -d --wait --wait-timeout 120 --remove-orphans`;
   5. prunes old images and prints `docker compose ps`.
4. **Health:** `up --wait` fails the job if a container does not become healthy within 120 s:
   - web: `GET /` on :3000;
   - API: `GET /health` on :4000.
   - The old container keeps serving until the new one is up.
5. **Public check:** a last, non-blocking step requests `https://mechdost.com/` from GitHub, to show whether the site is reachable from the internet.

**Concurrency:** one deploy at a time (`deploy-production` group); a second one waits.

## 5. Everyday operations

All commands run on the server (`ssh ubuntu@13.207.157.3`, then `cd /opt/mechdost`), unless they say `gh`.

| Task                         | Command                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is running              | `docker compose ps` · `grep IMAGE_TAG .env`                                                                                                                                                                                                                         |
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

| Symptom                                                                    | Likely cause                                                                                                                                           | Fix                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails "`.env` is missing"                                           | § 3.5 not done                                                                                                                                         | Create `/opt/mechdost/.env`.                                                                                                                                                                                          |
| Deploy fails at `ssh` / host key                                           | Deploy key not on the server, or the server was rebuilt                                                                                                | § 3.3 (re-run the `ssh-keyscan` line).                                                                                                                                                                                |
| Deploy fails in `up --wait`                                                | New container unhealthy                                                                                                                                | `docker compose logs --since 10m api` (or `web`). The API prints which production setting is missing. Roll back if needed.                                                                                            |
| `https://mechdost.com` does not load, `http://13.207.157.3` does           | DNS not pointing here yet, or ports closed                                                                                                             | § 3.6 / § 3.2; then `docker compose logs caddy`.                                                                                                                                                                      |
| Certificate errors in Caddy logs (`2.57.91.91: … no application protocol`) | Let's Encrypt still saw the old DNS answer from its cache just after the records changed (seen 2026-11-13), or an extra AAAA record, or port 80 closed | Check the authoritative answer (`nslookup mechdost.com hermes.dns-parking.com`). Once it is right, `docker compose restart caddy` retries at once (otherwise Caddy backs off and may try ZeroSSL, which can be slow). |
| 502 on `api.mechdost.com`                                                  | API not enabled (`COMPOSE_PROFILES=api` missing) or crashed                                                                                            | § 3.5; `docker compose ps`.                                                                                                                                                                                           |
| Site slow, server swapping                                                 | Out of memory                                                                                                                                          | `docker stats`; the instance may need 4 GB (t3.medium) when the API and worker both run.                                                                                                                              |

## 9. Not covered yet (queued)

- A production Supabase project and migrations in the pipeline (§ 6).
- ~~The background worker as a compose service~~ — **added 2026-11-14**: service `worker` in `deploy/compose.yml` (same API image, `node dist/worker.mjs`, profile `api`, 256 MB, no port, health check off). It sends the outbox (WhatsApp, email), expires shop offers, releases stock holds, expires unpaid online orders, resumes ended pauses, bridges WhatsApp replies into support tickets and runs the live relay. Logs: `docker compose logs -f worker` (`worker_started` lists the channels). Trial-run on the server before the first deploy: started cleanly with the WhatsApp channel.
- Uptime monitoring and error tracking (Sentry), and alerts.
- Backups: Supabase handles the database (PITR add-on to turn on). The server holds no data except Caddy's certificates, which are re-issued automatically.

## Before the public launch (checklist)

Items decided to happen before going public; tick them off here.

- [x] Hide the demo-only controls: "advance" (orders, service requests, applications), "demo reply" and "demo offer" (Q86, user 2026-11-14). Done 2026-11-14: `SHOW_DEMO_CONTROLS`.
- [ ] Switch the website from the browser demo to real sign-in and the API (data switch), so seller onboarding links the shop owner on sign-in (Q89).
- [ ] Demo data off (Q21: "Demo off before public launch, date TBD").

### The real-mode switch, step by step (launch 2026-11-16)

1. **Firebase web config as repository variables.** These values are public: they ship in the browser. Copy them from the Firebase console (Project settings → Your apps → Web app):
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`

   Set each one with `gh variable set NAME --body "…"`. The deploy passes them to the website build (added 2026-11-14).

2. **Firebase console → Authentication:**
   - Settings → Authorized domains includes `mechdost.com`.
   - Phone sign-in is enabled.
   - SMS region policy is set to India only (security baseline).
3. **Before real customers: Razorpay live.**
   - Remove `RAZORPAY_ALLOW_TEST_KEYS` from `/opt/mechdost/.env`.
   - Set the live `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
   - Add a live-mode webhook with its secret in `RAZORPAY_WEBHOOK_SECRET`.
   - Set `NEXT_PUBLIC_RAZORPAY_KEY_ID` to the live key id.
   - Redeploy.
   - Test keys are allowed only during pre-launch testing (payments runbook).
     **Online payments:** set `NEXT_PUBLIC_RAZORPAY_KEY_ID` (public key id). Without it, checkout offers cash on delivery only. Test keys take test payments only.
4. **Database migrations applied** (§ 6). 0044 was applied 2026-11-14.
5. **Flip the switches:**
   - `gh variable set NEXT_PUBLIC_AUTH_MODE --body firebase`
   - `gh variable set NEXT_PUBLIC_DATA_MODE --body api`
   - Re-run the Deploy workflow (`gh workflow run Deploy`) or push a commit.
6. **First admin:**
   - Sign up on mechdost.com with the owner's phone.
   - Then, from a machine with the root `.env`: `pnpm db:grant-role --phone +91XXXXXXXXXX --role super_admin --reason "Launch: owner"`.
   - Sign out and in again (staff two-step).
7. **Content:**
   - Admin → Catalogue → Add product / Import CSV (`docs/runbooks/catalogue-import.md`).
   - Add shops (seller invite or application → approve with PIN codes). Set shop prices.
   - Add workshops (Admin → Workshops). Publish and verify the location.
8. **WhatsApp:**
   - Once Meta approves the templates, turn each event on in Admin → Notifications (English and Hindi text).
   - The worker sends them.
9. **Live smoke test (Q95):**
   - Order: sign up, place a cash-on-delivery order, route it to the shop, accept it, pack it, send it out for delivery, then deliver it with the code.
   - Service request: book, propose, accept, receive the vehicle, estimate, bill, mark paid.
   - Run each in English and in Hindi.

Hidden in real mode until their APIs exist: bulk quotes, coins, reviews (decision 2026-11-14).
