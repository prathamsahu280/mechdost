---
name: firebase-phone-auth-rbac
description: Use for any MechDost work on sign-in, phone OTP, email verification, sessions, ID-token verification, custom claims, roles/permissions or account security (Firebase Authentication + Hono API + Postgres RBAC). Covers the client OTP flow, the emulator for dev/tests, server-side verification with firebase-admin, mapping identities to the users table, RBAC resolution, abuse protection and the known pitfalls.
---

# Firebase phone auth + RBAC (MechDost)

Decisions: phone OTP is the primary sign-in for every role; email is collected at signup and verified once;
both must be verified before ordering/booking/partner/staff actions (`docs/decisions.md`, spec 01, spec 13).

## Architecture

> **2026-11-01 decision:** phone OTP **once at sign-up** (then name, email, password, confirm); afterwards phone **or** email + password through `POST /v1/auth/password` (server-side check, limits, lockout, custom token). Forgot password: phone code or email link. Staff: password + phone code. API accepts `phone` + `custom` tokens only; `ensureUser` refuses to create users without a phone. See spec 01 "Password sign-in" and spec 13 "Encryption".

- **Client (apps/web):** Firebase JS SDK v13 modular. `signInWithPhoneNumber(auth, phone, appVerifier)` with an
  invisible `RecaptchaVerifier`; confirm with the 6-digit code. Email: after phone sign-in, collect email and link
  email + password (`linkWithCredential`). **The browser never sends Firebase emails** (decision 2026-11-24: Firebase
  refuses a custom action URL, `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`): the API sends the verification and reset emails
  itself (`POST /v1/auth/verification-email`, `POST /v1/auth/password-reset-email`; Admin SDK `generate*Link`, outbox,
  Resend), linking to our `/auth/action` page, which applies the code with `applyActionCode` / `confirmPasswordReset`;
  `emailVerified` becomes true on the next token refresh. Send `Authorization: Bearer <idToken>` to the API; refresh with `getIdToken()` (auto) and
  `getIdToken(true)` after role changes.
- **API (apps/api):** `firebase-admin` `getAuth().verifyIdToken(token, checkRevoked)` behind a `TokenVerifier`
  interface (fake in tests). `checkRevoked = true` for sensitive routes (money, admin, partner actions) and
  always for staff. Credentials: Workload Identity on Cloud Run; locally `GOOGLE_APPLICATION_CREDENTIALS` path
  outside the repo, or the emulator (`FIREBASE_AUTH_EMULATOR_HOST`).
- **Identity → users row:** `ensureUser(identity)` selects by `firebase_uid`, inserts if missing, updates only when
  phone/email/verification changed (avoid a write per request). Cache by uid for 60 s.
- **RBAC source of truth = Postgres** (`roles`, `permissions`, `role_permissions`, `user_roles` with city/shop/workshop
  scope). Permission catalogue lives in `packages/shared/src/rbac.ts` and is synced by the seed. Custom claims are
  only a hint for the client UI (`{ r: ['ops_manager'], s: shopId }`, ≤ 1000 bytes); **the API never trusts claims
  for authorization** — it resolves permissions from the DB (cached ≤ 60 s, invalidated on change).
- Every authenticated user is implicitly `customer`; other roles come from `user_roles`.

## Rules

- Never accept uid, role, shopId or permissions from the request body. Never put roles in client-editable metadata.
- Verification gates: `phone_verified_at` and `email_verified_at` required for checkout, booking, partner and staff
  routes → 403 `VERIFICATION_REQUIRED`.
- Staff: second factor on every sign-in (phone code now, TOTP once staff beyond founders exist; secret stored encrypted in `staff_security.totp_secret_enc`).
- Passwords: never log, never store, never compare in our DB; one generic error for unknown account / wrong password; lock after 5 failures in 15 minutes; revoke all sessions on password change.
- Deactivating staff/partner: `revokeRefreshTokens(uid)` + delete their `user_roles` + bust the permission cache.
- Phone numbers stored E.164 (`+91…`); validate with the shared helper before any SMS.

## Abuse protection (spec 13, research/security-vulnerabilities.md §5)

- Firebase console: SMS region policy **allow India only**; enable reCAPTCHA Enterprise SMS defense (audit → enforce);
  App Check for web; disable test phone numbers in production; billing alert on SMS spend.
- Our limits (Upstash): OTP send 5/phone/hour, 20/IP/hour, 3/device/10 min; verify attempts 5 per code; Turnstile on
  the send step; identical responses whether or not a phone exists (no enumeration).
- Watch the OTP success rate; < 50 % suggests SMS pumping.

## Dev & tests

- Emulator: `firebase emulators:start --only auth` (port 9099); test OTP codes from
  `GET http://127.0.0.1:9099/emulator/v1/projects/<projectId>/verificationCodes`.
- Unit/API tests inject a fake `TokenVerifier` returning chosen identities; never hit real Firebase.
- Role-leak matrix (website-testing recipe) for every new route.

## Pitfalls

- Custom claims vanish after `updateEmail`/`updateProfile` in some SDK versions (firebase-js-sdk #9260) — re-read from
  the DB, never rely on claims for authorization.
- Claims are stale up to 1 h until the client refreshes the token.
- `verifyIdToken` must check the project (`aud`); never accept custom tokens as ID tokens.
- Do not use `hono/jwt` to verify Firebase tokens (key rotation, `aud`, revocation); use firebase-admin.

Open inbox item: Q3 (Firebase project + config). Until then the emulator is the default.
