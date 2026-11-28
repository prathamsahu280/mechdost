# Monitoring: Sentry (errors) and PostHog (product analytics)

Decision 2026-11-14 (`docs/decisions.md` "Monitoring"). Both run in the **EU** and are **off when their keys are empty** — the website, the API and the worker start normally without them. Specs: 12 (forwarding), 16 (Sentry, JS budget), 08 (Admin → Errors).

## What is wired

| Piece                 | Where                                                                                    | What it sends                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| API errors            | `apps/api/src/monitoring/sentry.ts`, `errors.ts`                                         | Unhandled exceptions (the 500s) + every `log('error', …)` line, max one per message per 10 min                     |
| Worker errors         | same module, started in `apps/api/src/worker.ts`                                         | Failed jobs (offer expiry, stock holds, outbox, PostHog read failures …) as log messages                           |
| Website server errors | `apps/web/src/instrumentation.ts` → `lib/sentry-server.ts`                               | Every failed server render / server function / route handler (`onRequestError`)                                    |
| Browser errors        | `apps/web/src/lib/error-reporting.ts` → `lib/sentry-browser.ts` (loaded after 1st error) | Uncaught errors, unhandled rejections and error-boundary errors; max 10 per page                                   |
| Product analytics     | `apps/api/src/analytics/posthog.ts`, started in the worker                               | Consented web events + server events from the event store, every 10 s                                              |
| Admin → Errors        | `GET /v1/admin/errors` → `apps/api/src/monitoring/sentry-issues.ts`                      | Reads the latest unresolved issues of both Sentry projects (counts and links) for super admin / operations manager |

Nothing personal leaves: Sentry events pass `scrubErrorEvent` (`packages/shared/src/error-scrub.ts`: no user, host, body, headers, cookies, query strings; no emails, phone numbers, tokens or SQL parameters in messages). PostHog gets only events with consent under notice `2026-11-14`+, personless, GeoIP off, props scrubbed again; server events carry no user.

## Reading 429s (API rate limits)

A 429 `RATE_LIMITED` response carries `Retry-After` and `RateLimit-Limit/Remaining/Reset` (the rule that answered). The API log line has the route and status 429, no personal data. The limit that tripped is told by `RateLimit-Limit`: the signed-in number (default 300) means one account was too busy; the guest number (600) means one IP not signed in; the flood number (3000) means one IP overall. Change the numbers in Admin → Settings (API request limits); they apply on every instance within 45 seconds. Spec 13 "Global API limits".

## Settings

| Variable                                                                      | Where                                     | Value                                                                                 |
| ----------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                                                                  | server `.env` (API + worker)              | DSN of project `mechdost-api-actual` (`https://…@o….ingest.de.sentry.io/…`)           |
| `SENTRY_ENVIRONMENT`                                                          | server `.env`                             | `production`                                                                          |
| `SENTRY_RELEASE`                                                              | set by `deploy/compose.yml` (`IMAGE_TAG`) | the deployed commit                                                                   |
| `NEXT_PUBLIC_SENTRY_DSN`                                                      | GitHub variable (build argument)          | DSN of project `mechdost-api` (the website project — the slug is a historic accident) |
| `SENTRY_AUTH_TOKEN`                                                           | GitHub **secret** only                    | org token with CI scope (source-map upload); never on the server                      |
| `SENTRY_ORG`, `SENTRY_PROJECT_WEB`, `SENTRY_URL`                              | GitHub variables                          | `mechdost`, `mechdost-api`, `https://de.sentry.io`                                    |
| `SENTRY_API_TOKEN`                                                            | server `.env`                             | read-only Internal Integration token (64 hex) for Admin → Errors                      |
| `SENTRY_ORG`, `SENTRY_PROJECT_WEB`, `SENTRY_PROJECT_API`, `SENTRY_REGION_URL` | server `.env`                             | `mechdost`, `mechdost-api`, `mechdost-api-actual`, `https://de.sentry.io`             |
| `POSTHOG_KEY`                                                                 | server `.env`                             | project API key `phc_…`                                                               |
| `POSTHOG_HOST`                                                                | server `.env`                             | `https://eu.i.posthog.com`                                                            |

The API refuses malformed values at start-up (`apps/api/src/config.ts`, error names the variable, never the value). **This is fail-fast even for these optional settings:** a mistyped `SENTRY_DSN`, `POSTHOG_KEY` or `SENTRY_API_TOKEN` stops the API and the worker (the site shows 502 for API calls), it is not silently ignored. To recover: `docker compose logs api --tail 20` shows `config_invalid` with the variable's name → fix or empty that line in `/opt/mechdost/.env` → `docker compose up -d --wait api worker` → `curl -fsS https://api.mechdost.com/health`. An empty value always means "off" and is always accepted.

**Sentry project settings to set once, in both projects** (`mechdost-api` and `mechdost-api-actual`): Settings → Projects → _project_ → Security & Privacy → **Prevent Storing of IP Addresses: on**, and **Data Scrubber: on** with **Use Default Scrubbers: on** (a second line of defence behind our `beforeSend`). The SDKs already send no IP (`sendDefaultPii: false`), but Sentry would otherwise record the sender's IP from the request.

### Create the read-only token for Admin → Errors (EU region)

1. Sign in at **https://de.sentry.io** (or `https://mechdost.sentry.io`) → **Settings → Developer Settings → Custom Integrations → Create New Integration → Internal Integration**.
2. Name it `MechDost admin panel (read-only)`. Permissions: **Issue & Event: Read**, **Project: Read**, **Organization: Read**; everything else **No Access**. No webhooks.
3. Save, then copy the token under **Tokens** (64 hex characters) into the server `.env` as `SENTRY_API_TOKEN=…` (with the org/project/region lines above), and restart: `docker compose up -d api`.
4. Check: Admin → Errors shows both projects (or "No unresolved problems"). "Not connected" means one of token/org/project is missing; "Sentry could not be reached" for one project means a wrong slug or a token without access to it.

Never use the CI token (`SENTRY_AUTH_TOKEN`) here: it can upload releases. To revoke: delete the token in the integration; the panel falls back to an error message for each project.

## Reading Sentry

- **Issues** (https://mechdost.sentry.io/issues/, EU): filter by project (`mechdost-api` = website, `mechdost-api-actual` = API + worker), `environment:production`, and `release:<commit>` to see what a deploy broke. Tag `service` is `web`, `api` or `worker`; API exceptions carry `route` and `requestId` (search the API logs for that request id: `docker compose logs api | grep <id>`).
- Log-message issues are named after the log line (`assignment_expiry_failed`, `posthog_read_failed`, …) with the safe fields (`errorName`, `pgCode`, `frames`) under "Additional data".
- **Alerts to create** (Alerts → Create Alert → Issues): "A new issue is created" in each project → email the owner; "Number of events > 50 in 1 h" → email. Turn on **Spike protection** (Settings → Subscription) so a storm cannot use up the monthly quota.
- Browser stack traces are readable when the Deploy run had `SENTRY_AUTH_TOKEN` (source maps uploaded for that release). If they show minified names, check that the Deploy log says the upload ran (no "upload failed" line).
- API and worker frames show TypeScript files and lines because the image runs Node with `--enable-source-maps`. Cost: only when a stack is read (an error is logged or reported) Node maps each frame through `dist/*.mjs.map`; the maps are parsed once per process (a few MB of memory) and normal requests pay nothing. If an error storm ever shows high CPU, remove `NODE_OPTIONS=--enable-source-maps` from `apps/api/Dockerfile` (frames then point into `dist/server.mjs`).
- Uncaught errors in the worker's PostHog loop are logged as `posthog_tick_failed` and never end the worker; a row that cannot be converted is skipped (`posthog_row_skipped`).

## Reading PostHog (EU)

- https://eu.posthog.com → **Web analytics** (from `$pageview` with `$pathname`), **Product analytics** → Insights. Useful insights: page views by `$pathname`; funnel `view_item` → `add_to_cart` → `begin_checkout` → `purchase_submitted` (web, by visitor id); `purchase` count and `totalPaise` sum (server events, distinct id `mechdost-server`).
- Events are **personless**: there are no person profiles, and web and server events are not joined to one person (server events carry no user). "Unique users" means unique random visitor ids.
- Project settings to set once: **Discard client IP data: on**; **Session replay: off**; **Autocapture: off** (nothing is captured in the browser anyway).
- Worker log lines: `posthog_forwarded {forwarded, skipped, dropped}` (every busy 10 s), `posthog_batch_dropped` (PostHog refused or was down after 3 attempts), `posthog_read_failed` (database). Dropped events stay in our own `events` table.

## Turning things off

- **Sentry, API/worker:** empty `SENTRY_DSN` in the server `.env`, `docker compose up -d api worker`.
- **Sentry, website:** empty the GitHub variable `NEXT_PUBLIC_SENTRY_DSN` and redeploy (the DSN is compiled into the build; the CSP then drops the Sentry host).
- **PostHog:** empty `POSTHOG_KEY`, `docker compose up -d worker`. Already-sent data is deleted in PostHog (Project settings → Delete data, or by event).
- **Admin → Errors:** empty `SENTRY_API_TOKEN` → "not connected".
- A visitor's erasure request: their events are personless with a random id that is not linked to their account; delete by that visitor id in PostHog if they provide it (the browser stores it as `mechdost-visitor`).

## Worker health: what to look for (incident 2026-11-16)

- `notify_tick` (info, every 5 min): `{channels, ticks, claimed, sent, failed, retried, skipped, stuck, errors}` since the previous line. **No `notify_tick` line for 10 minutes = the dispatcher is gone; `stuck > 0` or a `notify_tick_stuck` error = a query hung and was replaced after 120 s.** If the outbox has `pending` rows older than a minute and `claimed` stays 0, check `channels`.
- `notify_channel_off` (warn, at start): a channel without its key (`RESEND_API_KEY` for email, `WHATSAPP_*`) is off **by design**; rows for it stay `pending` and nothing is logged per row. This was the cause of the 2026-11-16 "outbox not sent" report: the server `.env` got `RESEND_API_KEY` at 06:56 and the worker was restarted by the deploy after that. After changing `.env`, recreate the worker (`docker compose up -d worker`; a plain restart keeps the old environment) and read `worker_started.channels`.
- **Slow mail (incident 2026-11-16, bug 7):** rows needing attempts 2-3 and 150-250 s were a send-time lookup (template override, company, trust line, bill source) hanging on the shared pool until the 120 s server statement_timeout (57014) while the 120 s lease ran out. Every dispatcher step now has a LOCAL statement_timeout (8 s) and an app deadline (12 s); lookups get 4-10 s then fall back to the default text; the provider call has 30 s. Read: `notify_dispatch_failed` / `notify_tick_stuck` carry `phase` (claim, renew, send, record, event; stuck = no phase change for 45 s); `notify_record_failed_after_send` = the database was slow after the mail went out (retried once, never resent). SQL check: `select count(*) from notification_outbox where last_error = 'lease_expired' or attempts > 1` for recent rows; **any `lease_expired` means a sender hung or the worker died mid-send** and should be rare (none in normal days); `send_timeout` = provider call over 30 s.
- The dispatcher uses its own 1-connection pool (the other jobs share 2), so exports/copurchase cannot starve it.
- Error lines from `safeError` now carry `pgCode` (SQLSTATE) and `reason` (the database's or driver's own message of the wrapped cause, max 200 chars, quoted values hidden for data errors; never the query or parameters). A `data_exports_failed` with no `pgCode` and a `reason` like "argument must be of type string" is a driver-side encoding bug, not a database problem.

### Dead pool connections (DC-B11 root cause, live 2026-11-28)

A worker sweep can wait forever on a database connection that died (Supavisor transaction pooler): nothing runs on the
server, no lock waits, and postgres.js has no client-side query timeout. Live, the delivery offer sweep hung from
2026-11-28 00:04 UTC for ~4 h (`sweep_stuck`, then silence), so no rider offer expired.

- The delivery offer sweep has its own one-connection pool and a 60 s deadline per run; the short 30 s sweeps (shop
  accept timer, service requests, roadside offers, pauses, stock holds, ticket auto-close, unpaid orders, network
  jobs and stories) run through `boundedShared` with a 120 s deadline (`apps/api/src/sweep-pool.ts`).
- On a timeout the worker logs **`sweep_pool_recycled {sweep, afterMs}`**, drops that pool and opens a fresh one. One
  now and then is fine; several an hour means the pooler is dropping connections: check Supabase status.
- `sweep_heartbeat` (every 10 min, delivery) must keep appearing; a `sweep_stuck` without a following
  `sweep_pool_recycled` means the deadline did not fire: restart the worker (`docker compose restart worker`).

## Usage & limits (free-plan warnings, founder 2026-11-26)

Founder: "can u list the storage and stuff via these? and like give me warnings when we are about to exceed the free
limits right". Admin → **Usage & limits** (`/admin/usage`), the daily worker check, and `pnpm usage:check`.

### What is measured

| Metric code                                | Provider | How                                                                                                                | Default limit (free plan, checked 2026-11-26) |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `r2_storage_bytes`                         | R2       | S3 ListObjectsV2 over the four `R2_BUCKET_*` buckets (SigV4, our signer), sum of sizes                             | 10 GB (10^9 bytes)                            |
| `r2_objects_count`                         | R2       | same listing                                                                                                       | none (shown only)                             |
| `r2_class_a_ops_month_count`               | R2       | **estimated**: our own count of uploads, copies, puts and listings (in-memory, flushed every minute)               | 1,000,000 / month                             |
| `r2_class_b_ops_month_count`               | R2       | **estimated**: our own count of signed reads, heads and range reads                                                | 10,000,000 / month                            |
| `supabase_db_bytes`                        | Supabase | `pg_database_size(current_database())`                                                                             | 500 MB                                        |
| `supabase_storage_bytes`, `_objects_count` | Supabase | `sum(metadata->>'size')` and `count(*)` of `storage.objects` (read-only)                                           | 1 GB / none                                   |
| `server_disk_used_bytes`                   | Server   | `statfs(USAGE_DISK_PATH)` inside the container (the Docker root filesystem on the VPS disk)                        | the measured total                            |
| `server_memory_used_bytes`                 | Server   | `MemTotal − MemAvailable` from `/proc/meminfo` (host figure); alerts **off** by default (a moment's reading)       | the measured total                            |
| `resend_emails_month_count`, `_day_count`  | Resend   | **estimated**: emails our dispatcher marked sent this UTC month / in the last 24 h (index `outbox_email_sent_idx`) | 3,000 / month, 100 / day                      |

Sources for the defaults: https://supabase.com/pricing (Free: 500 MB database, 1 GB file storage, 5 GB egress),
https://developers.cloudflare.com/r2/pricing/ (10 GB-month, 1M Class A, 10M Class B; Class A/B operation lists),
https://resend.com/pricing (Free: 3,000 emails a month, 100 a day). Decimal units (1 GB = 10^9 bytes) warn a little
earlier where a provider does not say which it uses. **If a plan changes, edit the limit on the page** (hard rule 8).

**Exact R2 operations (optional):** set `CLOUDFLARE_ANALYTICS_TOKEN` in the server `.env` (Cloudflare → My Profile →
API Tokens → Create → Custom: permission **Account → Account Analytics → Read**, the MechDost account only). The check
then reads `r2OperationsAdaptiveGroups` from the GraphQL Analytics API and labels the values "provider" instead of
"estimated". Without it nothing breaks.

**Not measured (by design):** Upstash Redis usage (needs a separate Upstash management API key; the database token
cannot read usage) and Resend's own counters (need a full-access key; ours is send-only). Supabase egress is not in
Postgres; read it in the Supabase dashboard (Usage).

### When it runs and what it sends

- **Daily**: the worker checks every hour (first time 2 minutes after start) and runs when the last daily check
  finished more than 23 h ago, so a restart never skips a day. Log line `usage_checked {stored, alerts, r2, supabase,
server, resend}`; failures `usage_check_failed` (never stops the worker).
- **Check now** (page header): 6 per hour per person and 12 per hour in total (each one lists the R2 buckets).
- Each provider answers `ok`, `not_configured` (no keys: skipped quietly), `failed` (nothing stored, never a 0) or
  `partial` (R2 listing cut at 200 pages per bucket or 20 s; outside Supabase the storage schema is missing).
- **Alerts:** at the warning (default 70 %) and critical (default 90 %) thresholds, one bell notice
  (`staff.usage_alert`, to staff with an all-cities `settings:read`: super admin, operations manager) and one email
  (`usage_limit_alert`, Admin → Notifications → Emails → "Emails to the MechDost team") per **metric, level and UTC
  month**. Crossing both at once sends only critical; a warning after that month's critical sends nothing. Recipients:
  the addresses typed on the page (in the chosen language), else every active super admin with a confirmed email (in
  their own language). No recovery note.

### Reading and fixing

- `docker compose logs worker | grep usage_` for the daily line. On the page: "Not set up" = the provider's keys are
  missing; "Could not be read" = the last check failed (numbers shown are older); "Partly read" = a floor.
- R2 `failed`: the R2 token needs **Object Read** on every bucket listed (ListObjectsV2 is part of Object Read).
- `pnpm usage:check` on the server (`docker compose exec api node …` is not needed: run it from a checkout with the
  production `.env`) prints the table only; `--record` stores the check and sends alerts like the daily job. It never
  prints keys, tokens or addresses.
- Tables (migration 0103): `usage_runs`, `usage_snapshots` (append-only, ML-ready: metric code with its unit, bigint
  value, limit at the time, source, UTC time), `usage_alerts` (append-only, unique per metric + level + month),
  `usage_limits` and `usage_alert_config` (the admin's, versioned and audited), `usage_counters` (our R2 counts).
