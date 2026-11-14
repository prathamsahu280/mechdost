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

The API refuses malformed values at start-up (`apps/api/src/config.ts`, error names the variable, never the value).

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
