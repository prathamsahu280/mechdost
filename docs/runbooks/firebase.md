# Firebase (sign-in) runbook

Spec: `docs/specs/01-auth-accounts.md` § Password sign-in. Decisions: 2026-11-01 "Sign-in: phone OTP once, then password", 2026-11-09 "Password sign-in API".

## Projects

| Project         | Use                                      | Status                          |
| --------------- | ---------------------------------------- | ------------------------------- |
| `mechdost-dev`  | Local development and manual smoke tests | Linked 2026-11-09 (Q3)          |
| `mechdost-prod` | Launch                                   | Not created yet (before launch) |

Checked on `mechdost-dev` through the Admin API (read only, 2026-11-09): Email/Password with password required, Phone on, SMS region allow-list **India only**, authorized domains `localhost` + the two Firebase domains, no test phone numbers.

## Local setup

`.env` (git-ignored) holds:

- Web config (public): `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`; for web push also `NEXT_PUBLIC_FIREBASE_VAPID_KEY` and `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` (`docs/runbooks/push.md`).
- API: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` (same value as the web key: the API checks passwords with it), `GOOGLE_APPLICATION_CREDENTIALS` = path of the Admin key file. It sits in the repo root under Firebase's own name `<project>-firebase-adminsdk-<id>.json`, which `.gitignore` excludes (`*firebase-adminsdk*.json`; after any rename check with `git check-ignore -v <file>`). Never paste the file's contents anywhere; production uses no key file.
- Turnstile: Cloudflare's always-pass test keys (see `.env.example`) until the real ones exist (Q5).

Why the key file is passed explicitly (`apps/api/src/auth/firebase-app.ts`): with plain application-default credentials, firebase-admin signs custom tokens through the IAM Credentials API, which a new project has not enabled (`auth/insufficient-permission`). With the key file it signs locally.

## Production (Cloud Run) — do before launch

1. Create `mechdost-prod`; Blaze plan; budget alert on SMS spend.
2. Authentication: Phone + Email/Password (password required); SMS region allow-list India; authorized domains `mechdost.com`, `www.mechdost.com`; no test numbers.
3. reCAPTCHA SMS defense (audit mode first, then enforce) and App Check for the web app.
4. No key files: the API's runtime service account signs custom tokens through IAM — enable the **IAM Service Account Credentials API** and grant the service account `roles/iam.serviceAccountTokenCreator` on itself. The API refuses to start in production with `GOOGLE_APPLICATION_CREDENTIALS` set.
5. Secrets in Secret Manager: `TURNSTILE_SECRET_KEY`, Upstash keys; `FIREBASE_API_KEY` as plain config (it is the public web key). Production refuses to start without them.
6. Email action links (verification, password reset) on our domain (Q30).
7. First admin: the person signs up on the site (phone code, email, password), then from a machine with the production `DATABASE_URL`: `pnpm db:grant-role --phone +91XXXXXXXXXX --role super_admin --reason "first admin"` (staff roles only, `--city RPR` (the city's public code) for city roles; audited). Their next sign-in asks for the phone code and opens the admin console. **Setting customer prices** (Admin → Catalogue → Prices) needs `prices:write`, which comes with the `super_admin`, `ops_manager` and `finance` roles — grant one of those (e.g. `--role finance`) to whoever sets prices; `catalogue_manager` edits texts only.
8. Manual check on the real project with the production build: phone sign-up shows no CSP errors in the browser console (Google's reCAPTCHA scripts and frames are not exercised by the emulator; allow-list in `apps/web/src/lib/csp.ts`).

## Smoke test (no accounts created)

A password check for a made-up email must return "no" (`null`), and a custom token must sign. Both passed on `mechdost-dev` on 2026-11-09.

## End-to-end tests of real sign-in (Auth Emulator)

The emulator fakes SMS and emails, so real mode is tested with no SMS cost. `firebase-tools` is **not** a project dependency (66 direct dependencies): `pnpm emulators` runs it pinned through `pnpm dlx firebase-tools@15.35.0`, project `demo-mechdost` (offline, `firebase.json`). Java is not needed for the Auth Emulator.

1. `pnpm emulators` (port 9099).
2. API against it (overrides win over `.env`):
   `FIREBASE_PROJECT_ID=demo-mechdost FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_API_KEY=fake-emulator-key GOOGLE_APPLICATION_CREDENTIALS= TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA CORS_ORIGINS=http://localhost:3100 pnpm exec tsx --env-file-if-exists=../../.env src/server.ts` (in `apps/api`).
3. Web build in firebase mode (the web app does not read the root `.env`; values are passed explicitly):
   `NEXT_PUBLIC_AUTH_MODE=firebase NEXT_PUBLIC_API_URL=http://localhost:4000 NEXT_PUBLIC_FIREBASE_API_KEY=fake-emulator-key NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-mechdost NEXT_PUBLIC_FIREBASE_APP_ID=1:1:web:1 NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm --filter @mechdost/web build`.
4. `E2E_AUTH_MODE=firebase pnpm exec playwright test e2e/real-auth.spec.ts --workers=1` (in `apps/web`; desktop runs the flows, mobile skips them). The last test grants the run's account `support_agent` with `pnpm db:grant-role` and checks the staff two-step: password → phone code → admin console.
5. Rebuild in demo mode afterwards (`pnpm --filter @mechdost/web build`) before any other e2e run.

The API writes the test accounts to the database in `.env` (the dev project): they are dev data, one per run.

**Why sign-up and the phone reset sign in again:** once a password is linked or changed, Firebase marks the session as a `password` sign-in, and the API refuses those by design (only `phone` and `custom` tokens, so nobody can skip its limits by signing in to Firebase directly). The browser therefore signs in again through `POST /v1/auth/password` and gets a custom-token session. Right after sign-up the profile row has no email yet; the API then asks Firebase which email the password belongs to.
