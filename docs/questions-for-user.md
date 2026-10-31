# Questions & authorizations inbox

**Protocol (user instruction 2026-10-31):** Claude keeps building without stopping. Anything that needs the
user — a decision, an input (keys, accounts), or an authorization (destructive/outward-facing action) — is
written here instead of asked mid-work. When the user says **"I'm here"**, walk through every `open` item in
order, one at a time, then move answered items to the log at the bottom (and into `decisions.md` /
`progress.md` as appropriate). Pending product decisions also stay mirrored in `decisions.md` → PENDING.

Status values: `open` · `answered` · `withdrawn`. Priority: P0 blocks a feature soon · P1 needed this phase · P2 later.

## Open
| # | Type | Priority | Question / request | Why it's needed | Default Claude will use until answered |
|---|---|---|---|---|---|
| Q1 | Decision | P1 | Post-purchase P1 items at launch: exchanges, service reminders, disputes, order chat? (you said you'd answer 2026-11-01; leaning yes to all) | Scope of spec 05 for Phase 2 | Build P0 flows; keep P1 designed and switchable behind feature flags |
| Q2 | Decision | P1 | Payment methods at launch: COD + Razorpay, COD only, or Razorpay only? (leaning COD + Razorpay) | Checkout build (spec 03) | Build both behind flags; Razorpay in test mode |
| Q3 | Input | P0 (for login) | Create a Firebase project (Phone + Email/Password providers, SMS region policy = India only) and share the web SDK config; set up Admin credentials | Real phone-OTP login | Local Firebase Auth Emulator with test OTP 123456 |
| Q4 | Input | P1 | Upstash Redis (Mumbai) REST URL + token in `.env` | Distributed rate limits / cache | In-memory rate limiter (single instance only) |
| Q5 | Input | P1 | Cloudflare Turnstile site + secret key | Bot protection on OTP and guest forms | Turnstile test keys (always pass) in dev |
| Q6 | Input | P1 | MapTiler free API key (restricted to your domains) | Map tiles | OSM raster tiles in dev |
| Q7 | Input | P2 | Resend API key + sending domain (DNS SPF/DKIM) | Transactional email | Emails written to the outbox and logged, not sent |
| Q8 | Input | P2 | Razorpay **test** account keys + webhook secret | Online payments | Payment flows mocked in tests |
| Q9 | Decision | P2 | WhatsApp handoff from support tickets: yes/no, and which number | Spec 09 | Call + in-app only |
| Q10 | Decision | P2 | Vehicle master source: curated CSV (I prepare ~150 Raipur models) vs licensed database | Fitment | Curated CSV seed, admin-editable |
| Q11 | Decision | P2 | Commission % and payout cycle for shops/workshops | Payouts ledger | Ledger built with configurable rates, no default rate applied |
| Q12 | Decision | P2 | Geocoding/autocomplete provider after the 50-address Raipur bake-off (Google Places vs Ola Maps) | Address entry | Nominatim in dev |
| Q13 | Authorization | P1 | Switch the Supabase MCP to read-only (one re-authentication via `/mcp`) | Least privilege (security review) | Stays read-write on the dev project only |
| Q14 | Input | P1 | GitHub: the `github` plugin failed to connect (bad Authorization header) — create a fine-grained PAT and set `GITHUB_PERSONAL_ACCESS_TOKEN`, or ignore | PR/issue automation from Claude | Plain `git` push (works today) |
| Q15 | Confirm | P2 | Verify legal details before they appear on public pages: GSTIN 22ABVCS4888H1ZL, CIN, registered address, grievance officer name | Consumer Protection rules | Shown as placeholders in dev |
| Q16 | Confirm | P2 | "ux superpower" skill — was `obra/superpowers` the one you meant? | Tooling | Keep superpowers |
| Q17 | Input | P2 | Google Cloud project for Cloud Run (billing enabled) + `gcloud` installed, Vercel account/team | Deployment | Local only until then |

## Answered log
| # | Date | Answer |
|---|---|---|
