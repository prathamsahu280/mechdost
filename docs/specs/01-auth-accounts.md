# 01 · Auth & accounts

Status: decided · Phase 1 · Decisions: `decisions.md` → Authentication, Customer account (P0 details)

## Goal

Frictionless phone-OTP sign-in for every role, one-time email verification, and a calm account area that holds profile, addresses, vehicles, orders, bookings, support, notifications and privacy controls.

## Roles

customer, seller_owner/staff, workshop_owner/staff, mechanic (later), staff roles (admin/ops/support/finance/catalogue/city_manager).

## User stories

- As a visitor I can browse and fill a cart without an account.
- As a customer I sign up with my phone (OTP), give my name and email, verify email once, and I'm in.
- As a customer I can change phone (OTP to old and new) or email (re-verify) and set language (English/Hindi).
- As a customer I manage addresses (pincode-first, "use my current location" via reverse geocoding and typed-address autocomplete (provider from the Raipur bake-off, pending #7), full written address, label, contact), vehicles, wishlist, notification preferences, consent, and can deactivate or request deletion.
- As a partner I sign in the same way; my role and partner id come from admin approval.
- As staff I sign in the same way and, once staff beyond founders exist, TOTP 2FA is enforced.

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

Registration-number lookup (Vahan), saved cards (gateway tokens), wallet + referral, recently viewed, data export, device sessions UI, customer 2FA (P2), loyalty tiers (P2).
