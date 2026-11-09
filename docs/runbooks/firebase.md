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

- Web config (public): `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.
- API: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` (same value as the web key: the API checks passwords with it), `GOOGLE_APPLICATION_CREDENTIALS` = path of the Admin key file, kept **outside** the repo (e.g. `C:\Users\<you>\secrets\…json`). Never paste the file's contents anywhere.
- Turnstile: Cloudflare's always-pass test keys (see `.env.example`) until the real ones exist (Q5).

Why the key file is passed explicitly (`apps/api/src/auth/firebase-app.ts`): with plain application-default credentials, firebase-admin signs custom tokens through the IAM Credentials API, which a new project has not enabled (`auth/insufficient-permission`). With the key file it signs locally.

## Production (Cloud Run) — do before launch

1. Create `mechdost-prod`; Blaze plan; budget alert on SMS spend.
2. Authentication: Phone + Email/Password (password required); SMS region allow-list India; authorized domains `mechdost.com`, `www.mechdost.com`; no test numbers.
3. reCAPTCHA SMS defense (audit mode first, then enforce) and App Check for the web app.
4. No key files: the API's runtime service account signs custom tokens through IAM — enable the **IAM Service Account Credentials API** and grant the service account `roles/iam.serviceAccountTokenCreator` on itself. The API refuses to start in production with `GOOGLE_APPLICATION_CREDENTIALS` set.
5. Secrets in Secret Manager: `TURNSTILE_SECRET_KEY`, Upstash keys; `FIREBASE_API_KEY` as plain config (it is the public web key). Production refuses to start without them.
6. Email action links (verification, password reset) on our domain (Q30).

## Smoke test (no accounts created)

A password check for a made-up email must return "no" (`null`), and a custom token must sign. Both passed on `mechdost-dev` on 2026-11-09.
