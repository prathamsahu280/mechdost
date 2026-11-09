# 01 · Auth & accounts

Status: decided · Phase 1 · Decisions: `decisions.md` → Authentication, Customer account (P0 details)

## Goal

Phone-verified sign-up, then phone-or-email + password sign-in (decision 2026-11-01), one-time email verification, and a calm account area that holds profile, addresses, vehicles, orders, bookings, support, notifications and privacy controls.

## Roles

customer, seller_owner/staff, workshop_owner/staff, mechanic (later), staff roles (admin/ops/support/finance/catalogue/city_manager).

## User stories

- As a visitor I can browse and fill a cart without an account.
- As a customer I sign up once with my phone (OTP), then give my name, email and a password (twice); I verify my email once.
- As a returning customer I sign in with my phone number **or** email and my password.
- If I forget my password I choose: a code to my phone, or a reset link by email (single use, 30 minutes).
- As a customer I can change phone (OTP to old and new) or email (re-verify) and set language (English/Hindi).
- As a customer I manage addresses (pincode-first, "use my current location" via reverse geocoding and typed-address autocomplete (provider from the Raipur bake-off, pending #7), full written address, label, contact), vehicles, wishlist, notification preferences, consent, and can deactivate or request deletion.
- As a partner I sign in the same way (password); my role and partner id come from admin approval.
- As staff I sign in with my password **plus a code sent to my phone** every time; TOTP replaces the SMS code once staff beyond founders exist.

## Flow & states

1. `/login`: phone → Firebase sends OTP (Auth Emulator in dev, test OTP 123456) → verify → if new user: name + email screen → `email_verification_sent` → banner until link clicked (`email_verified_at`).
2. API `POST /auth/session` exchanges the Firebase ID token; `users` row auto-provisioned; claims `{role, partner_id, city_ids}` set via Admin SDK on approval events.
3. Gates: browse/cart = none; checkout/booking/partner/staff actions require `phone_verified_at AND email_verified_at`.
4. Sessions: Firebase refresh tokens; server keeps `sessions` (device, ip, city, last_seen) for the P1 device list; sign-out-all revokes refresh tokens.

## Data

`users` (id uuid v7, firebase_uid UNIQUE, name, phone E.164 UNIQUE WHERE deleted_at IS NULL, phone_verified_at, email citext UNIQUE WHERE deleted_at IS NULL, email_verified_at, language, role, status active|deactivated|deleted, deactivated_at, deleted_requested_at, created_at, updated_at, version), `addresses` (user_id, label, contact_name, contact_phone, line1, line2, landmark, pincode, city_id, state, lat, lng (PostGIS point), is_default_shipping, is_default_billing, deleted_at), `vehicles` (user_id, type 2W|3W|4W, make, model, variant, year, fuel, registration, odometer_km, last_service_km, last_service_at, is_primary, deleted_at), `vehicle_history`, `consents` (user_id, purpose, granted, version, at, source), `notification_preferences` (user_id, channel, category, enabled), `wishlist_items`.

## API

`POST /auth/session`, `GET/PATCH /me`, `POST /me/phone/change` (two OTPs), `POST /me/email/change`, `GET/POST/PATCH/DELETE /me/addresses`, `GET/POST/PATCH/DELETE /me/vehicles`, `GET/PUT /me/notification-preferences`, `GET/PUT /me/consents`, `POST /me/deactivate`, `POST /me/deletion-request` (creates support ticket; staff confirms), `GET /me/sessions` (P1), `DELETE /me/sessions/:id` (P1). All rate-limited (OTP send 5/phone/hour, 20/IP/hour).

**Implemented (2026-10-31, `apps/api`):** `GET /v1/me` (auto-provisions the `users` row from the verified token via `ensureUser`: phone verified on first sign-in, email verified when Firebase reports `email_verified`, email change resets verification, phone/email owned by another active account → 409 `IDENTITY_IN_USE`; audit entries record field names only, never values) and `PATCH /v1/me` (name, language; `.strict()` body with `version` for optimistic locking → 409 `STALE_PROFILE`). Only `phone` sign-in-provider tokens are accepted. `requireVerified` middleware returns 403 `VERIFICATION_REQUIRED` with `{ phoneVerified, emailVerified }` for checkout/booking/partner/staff routes. Deactivated accounts → 403 `ACCOUNT_DEACTIVATED`; disabled Firebase users → 403 `ACCOUNT_DISABLED`; bad/expired/revoked tokens → 401 `TOKEN_INVALID|TOKEN_EXPIRED|TOKEN_REVOKED`.

## UI

Concept: `/account` views (screenshots `05-page-account*.png`, `06-mobile-account.png`); keep eyebrow "YOUR MECHDOST ACCOUNT", h1 "Welcome back." / "A home for your vehicle care."; account nav: Orders · Service requests · My vehicles · Addresses · Wishlist · Support · Notifications · Privacy · Profile. Mobile bottom tabs unchanged. OTP input follows the `modern-web-guidance` sms-otp-form pattern (autocomplete=one-time-code, 6 boxes, resend timer 30 s).

## Rules & validations

Phone E.164 (+91 default), email RFC + citext uniqueness, name 2–100 chars, pincode `[1-9][0-9]{5}` must exist in `pincodes`, max 10 addresses, max 10 vehicles, registration format optional validation (IN state code pattern), odometer ≥ last service km.

## Edge cases

OTP exhausted → cooldown with clear copy; phone already registered as partner staff → merge prompt; email already used → cannot proceed, link to login; GPS denied → manual pincode; deletion with open orders/refunds → blocked with reason; deactivated user signing in → reactivate prompt within 30 days.

## Notifications & events

`user.signed_up`, `user.email_verified`, `user.phone_changed`, `user.deactivated`, `user.deletion_requested` → in-app + email; analytics `sign_up`, `login`, `otp_failed`, `address_added`, `vehicle_added`.

## Acceptance tests

Signup e2e (emulator), email gate at checkout, phone change double-OTP, cross-user address access returns 404, rate limit returns 429 with Retry-After, deletion request creates ticket and blocks with open order.

## Open decisions

Vehicle fields may change (register #5).

## P1/P2

Registration-number lookup (Vahan), saved cards (gateway tokens), referral (rewarded in MechDost Coins, spec 20; no wallet), recently viewed, data export, device sessions UI, customer 2FA (P2), loyalty tiers (P2).

## Demo implementation (2026-11-01)

`/login` (`components/auth/login-flow.tsx`) and `/account/{section}` (`components/account/account-area.tsx`) run on `apps/web/src/demo/session.ts` until Firebase is linked: same three steps, code 123456, seeded role logins (decisions 2026-11-01). Max 10 vehicles / 10 addresses, one default address. Acceptance tests: `e2e/roles.spec.ts`.

## Password sign-in (decision 2026-11-01)

**Flows.** Sign-up: phone → OTP → name, email, password, confirm → account (customer). Sign-in: identifier (phone or email) + password → session; staff → + phone code. Forgot: choose phone (OTP → new password + confirm → signed in) or email (generic "if an account uses …" message → link, single use, 30 min → new password + confirm → sign in).

**Production.** Firebase Auth holds the password (email/password provider linked to the phone user at sign-up via `linkWithCredential`; scrypt). `POST /v1/auth/password {identifier, password, turnstileToken}`: resolve phone/email → account (constant work for unknown ones), verify the password server-side (Identity Toolkit `accounts:signInWithPassword`), enforce limits, return a Firebase **custom token** → client `signInWithCustomToken`. Reset by phone: client phone sign-in → `updatePassword`. Reset by email: `sendPasswordResetEmail` (custom action URL on our domain, 30-minute expiry). API accepts `phone` and `custom` tokens only; `ensureUser` never creates an account without a verified phone.

**Rules.** 8–64 characters (graphemes), blocklist (common, brand, name/phone/email), no composition rules, show/hide, paste allowed; same error for unknown account and wrong password; 5 failures / 15 min per account → 15-minute lock (+ per-IP limit, Turnstile after 3 failures); lockout and limits fail closed without Redis; all sessions revoked when the password changes; minimum 8 decided 2026-11-01 (Q22); new-device sign-in sends a code to the phone (P1); every event audited (`auth.password_failed`, `auth.locked`, `auth.password_reset_requested|completed`) without the identifier in clear text.

**Built (2026-11-09, server side):** `POST /v1/auth/password {identifier, password, turnstileToken}` (`apps/api/src/routes/auth.ts`):

- Identifier: Indian mobile however typed (spaces, dashes, +91, 0, 091) or email (`@mechdost/shared/auth` `parseSignInIdentifier`); account lookup `findPasswordAccount` (deleted accounts never found; email case-insensitive).
- Order of checks: per-IP limit (60/hour) → Turnstile (`TURNSTILE_FAILED` 400) → identifier lock (every attempt counted atomically before the password check, the 6th in 15 min per identifier hash refused, a success clears the count — in effect 5 failures lock it, known or unknown → `ACCOUNT_LOCKED` 429 + Retry-After; parallel guesses cannot slip past, security review 2026-11-09) → Firebase password check (Identity Toolkit `signInWithPassword`, server side; an unknown account is checked against a fixed non-existent email, so both cost the same) → `INVALID_CREDENTIALS` 401 for both, audited as `auth.password_failed` / `auth.locked` with the account id (if any) and a truncated IP, never the identifier.
- Limits and Turnstile **fail closed**: store or Cloudflare or Firebase not answering → `AUTH_UNAVAILABLE` 503 (also when `FIREBASE_API_KEY`/`TURNSTILE_SECRET_KEY` are not set).
- Result: `{status:'signed_in', customToken}` → client `signInWithCustomToken`. **Staff** (any platform/city grant, `isStaffGrant`): the password alone returns `{status:'staff_code', phone}`; the client signs in with a phone code and repeats the call with that phone ID token as Bearer (same account, code ≤ 5 min old → `STAFF_CODE_MISMATCH` 403 / `STAFF_CODE_EXPIRED` 401) → custom token with the `staff_2fa` claim.
- **Staff routes** (middleware `authenticate`): staff grants count only for a `staff_2fa` session at most 12 h old (spec 13 absolute staff session); any other session of a staff member keeps its customer/partner grants, and a staff permission answers `STAFF_2FA_REQUIRED` 403. So a phone code alone (sign-up, phone reset) never opens the admin side.
- Firebase Admin init: `apps/api/src/auth/firebase-app.ts` (runbook `docs/runbooks/firebase.md`). Tests: `apps/api/test/auth-password.test.ts` (10, incl. 10 parallel guesses → ≤ 5 reach Firebase), `packages/shared/test/auth.test.ts`, db `identity.test.ts` § findPasswordAccount.
- **Web side (built 2026-11-09):** `components/auth/login-flow.tsx` runs the same screens in two modes, `NEXT_PUBLIC_AUTH_MODE` (`lib/auth/mode.ts`, Q69 default: demo unless set to `firebase`). Real mode loads `lib/auth/firebase-client.ts` (only `@firebase/app` + `@firebase/auth`) and `lib/auth/turnstile.ts` by dynamic import on the sign-in page only (page JS budgets unchanged). Sign-up: phone code (invisible reCAPTCHA, badge inline, 60 s timeout if the challenge is closed) → name, email, password → email/password linked to the phone account, verification email sent, name + language saved with `PATCH /v1/me` → "Your account is ready" step. Sign-in: Turnstile token → `POST /v1/auth/password` → custom token; staff: code to the phone the API names → second call with the phone token. Forgot: phone code → `updatePassword`; email → Firebase reset email (Firebase's link lasts **60 minutes**, not 30: ruling 2026-11-09). After any real sign-in, `adoptRealAccount` mirrors `GET /v1/me` into the browser account so the account, cart and portal screens (still on browser data) work; real staff land on admin, everyone else on the account area until the partner portals move to the API.
- **Accessibility (review 2026-11-09: forms, live regions, keyboard; 13 serious findings fixed):** errors next to their field, form-level errors above the button; focus moves after render, and only when it moves does the field's description carry the message, otherwise one always-mounted alert/status region reads it (repeats re-read); busy buttons stay focusable (`aria-disabled`) and slow work is announced after 0.7 s; field-less steps focus their heading; forms are named by their step heading; the resend button never unmounts and the countdown is not a live region; pasted codes are reduced to 6 digits; hidden username field for password managers; email/phone carried into the reset steps; Turnstile challenge sits before the button and is labelled when shown; password toggle has a fixed name with `aria-pressed`.
- **Real mode tested end-to-end (2026-11-09)** on the Firebase Auth Emulator: `e2e/real-auth.spec.ts` (sign-up → verify-email step → account; password sign-in by email and by phone; one generic answer; reset by phone code; reset by email) — runbook `docs/runbooks/firebase.md` § End-to-end. Found and fixed by it: a linked or changed password turns the Firebase session into a `password` sign-in, which the API refuses → sign-up and the phone reset finish with an API sign-in (custom token); the profile row has no email right after sign-up → the API asks Firebase (`emailOf`); the bot check could wait forever on a blocked network → gives up after 20 s (not while a visible challenge waits). Sign-out now also signs out of Firebase (`lib/auth/sign-out.ts`).
- Not yet: staff two-step in the browser e2e (covered by API tests; needs a staff grant in the test database), account-area "verify your email" banner with resend, nonce CSP for the Turnstile/reCAPTCHA scripts (spec 13, before real mode goes live).

**Analytics.** `login_<role>`, `login_password_failed`, `signup_otp_sent`, `sign_up`, `reset_otp_sent`, `password_reset_phone`, `password_reset_email`, `password_reset_link`.

**Demo** (`apps/web/src/demo/session.ts`, `demo/passwords.ts`, `components/auth/login-flow.tsx`): same screens on the browser store; PBKDF2-SHA-256 + salt (WebCrypto), lockout and single-use reset links in localStorage; demo password `Raipur@2026`, code `123456`; the email route shows an on-screen "demo inbox" instead of sending mail. Acceptance tests: `e2e/roles.spec.ts` "sign-in (spec 01 …)" — generic error, lockout, sign-up password checks, plain text never stored, both reset routes, staff two-step, safe `next`.
