# Setup runbook — accounts, keys and where they go

**Rule:** real secrets live only in the git-ignored root `.env` (local), Vercel environment variables (web) and Google Secret Manager (API). Never in git, never in chat, never in `CLAUDE.md`. Template with every variable: `/.env.example`.

## Local `.env` (repo root)
`C:\Users\Admin\Desktop\automart\.env` was created from the template with the public Supabase values pre-filled. Fill in the blanks as each service is set up.

| Variable | Where to get it | Secret? |
|---|---|---|
| `DATABASE_URL` | Supabase → Connect → **Session pooler** URI (port 5432). Replace `<db-password>` with the database password. Copy the host exactly from the dashboard (it may be `aws-0-…` or `aws-1-…`). | **Yes** (contains password) |
| `DATABASE_POOL_URL` | Supabase → Connect → **Transaction pooler** URI (port 6543), same password | **Yes** |
| `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` | pre-filled (`https://ewrszfqhgbrriqqggjts.supabase.co`) | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | pre-filled (`sb_publishable_…`) | No (public by design) |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → Secret keys (`sb_secret_…`) | **Yes** |
| Firebase `NEXT_PUBLIC_FIREBASE_*` | Firebase console → Project settings → Web app SDK config | No |
| `GOOGLE_APPLICATION_CREDENTIALS` | path to a Firebase Admin key file stored **outside** the repo (local only; prod uses Workload Identity) | **Yes** (the file) |
| `UPSTASH_REDIS_REST_URL/TOKEN` | Upstash console → Redis database (region Mumbai) | token **Yes** |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → add site | secret **Yes** |
| `NEXT_PUBLIC_MAPTILER_KEY` | MapTiler Cloud → API keys (restrict to your domains) | No |
| `RESEND_API_KEY` | Resend → API Keys | **Yes** |
| Razorpay keys | Razorpay dashboard → Test mode → API keys + Webhooks (later) | secret/webhook **Yes** |
| MSG91 keys | later | **Yes** |
| PostHog / Sentry | later | DSN/keys public-ish |

## Supabase dev project
- Project ref `ewrszfqhgbrriqqggjts`, region Mumbai, Postgres 17.11.
- Claude Code MCP: `supabase-mechdost` in `.mcp.json` (OAuth; no keys in the repo).
- Recommended hardening (dashboard): disable the **legacy anon/service_role JWT keys** once the app uses the new `sb_publishable_` / `sb_secret_` keys; enable PITR before launch.

## Production (later)
- Web (Vercel): Project → Settings → Environment Variables; mark secrets **Sensitive**.
- API (Cloud Run): Google Secret Manager, mounted as env vars; Firebase Admin via the service account (Workload Identity), no JSON key.
