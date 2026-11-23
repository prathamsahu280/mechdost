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
7. First admin (later staff are given roles in Admin → Staff, `docs/runbooks/staff-roles.md`): the person signs up on the site (phone code, email, password), then from a machine with the production `DATABASE_URL`: `pnpm db:grant-role --phone +91XXXXXXXXXX --role super_admin --reason "first admin"` (staff roles only, `--city RPR` (the city's public code) for city roles; audited). Their next sign-in asks for the phone code and opens the admin console. **Setting customer prices** (Admin → Catalogue → Prices) needs `prices:write`, which comes with the `super_admin`, `ops_manager` and `finance` roles — grant one of those (e.g. `--role finance`) to whoever sets prices; `catalogue_manager` edits texts only.
8. Manual check on the real project with the production build: phone sign-up shows no CSP errors in the browser console (Google's reCAPTCHA scripts and frames are not exercised by the emulator; allow-list in `apps/web/src/lib/csp.ts`).

## Email links on mechdost.com (2026-11-23)

Firebase sends the verification, password-reset and email-change emails with links to its own page
(`https://<project>.firebaseapp.com/__/auth/action?mode=…&oobCode=…`). The site has its own page for these links,
`/auth/action` (and `/hi/auth/action`, `apps/web/src/components/auth/email-action.tsx`), so the links can say
`mechdost.com`. **Deploy the page first, then change the template** (the other order sends people to a 404).

Modes the page handles (Firebase appends `mode`, `oobCode`, `continueUrl`, `lang`): `verifyEmail` and
`verifyAndChangeEmail` (apply the code, refresh the signed-in session so the "verify your email" card goes away),
`resetPassword` (shows the email, asks for a new password with the sign-in rules, then "Sign in"), `recoverEmail`
(restores the old address, suggests a new password). A missing, wrong, used or expired code shows a localised reason
and one next step (verify → account page for a new link; reset → sign-in page, "Forgot password?"). `lang=hi` moves
to the Hindi page. Works signed out; never indexed.

**Why Firebase's reset is the right mechanism for our passwords:** passwords live only in Firebase Auth (scrypt).
`POST /v1/auth/password` checks them with Identity Toolkit `accounts:signInWithPassword`
(`apps/api/src/auth/password-authority.ts`) and then mints a custom token; the API stores no password or hash. So
`confirmPasswordReset` sets the very password the API later checks, and ends the account's older sessions.

**The console change (do after the page is deployed):**

1. Firebase console → `mechdost-prod` → Authentication → Templates.
2. For each of **Email address verification**, **Password reset**, **Email address change**: pencil icon → "Customize
   action URL" → `https://mechdost.com/auth/action` → Save. (Optionally set the sender name and reply-to here too.)
3. `mechdost.com` must be in Authentication → Settings → Authorised domains (step 2 of Production above).

Equivalent Identity Toolkit Admin API call (sets the action URL for all templates at once; field
`notification.sendEmail.callbackUri` of the project config, v2 `Config` resource; check against the current reference
before relying on it, it was not run from here):

```
curl -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: <project-id>" -H "Content-Type: application/json" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/<project-id>/config?updateMask=notification.sendEmail.callbackUri" \
  -d '{"notification":{"sendEmail":{"callbackUri":"https://mechdost.com/auth/action"}}}'
```

Check: sign up with a test email, open the verification email, the link starts with `https://mechdost.com/auth/action`
and ends on "Email confirmed". Repeat with "Forgot password" by email. Tests: `apps/web/test/email-action.test.ts`
(unit), `apps/web/e2e/email-action.spec.ts` (states without Firebase, both languages, axe); the Hindi coverage crawl
includes `/auth/action`. Events (spec 12): `auth_email_action_opened`, `auth_email_verified`,
`auth_password_reset_done`, `auth_email_action_failed`.

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

## Realtime Database live updates (2026-11-15)

1. Firebase console, Build, Realtime Database: create in `asia-southeast1`. Copy its URL.
2. Set `FIREBASE_DATABASE_URL` and `LIVE_TRANSPORT=rtdb` for the API worker, and `NEXT_PUBLIC_FIREBASE_DATABASE_URL` (same URL) at **web build time** (it is inlined). The web CSP then allows its `https` and `wss` host automatically.
3. Deploy the rules: `firebase deploy --only database` from the repo root (`firebase.json` points at `firebase/database.rules.json`). Check in the console Rules tab. Rules are not deployed by CI.
4. Verify: sign in on two browsers; add to the cart on one; the other updates within about a second. With the URL unset or the rules missing, nothing breaks: the pages poll (cart 60 s).

## Sign-in speed and captchas (2026-11-23) — what to set in the consoles

Two different checks can appear, and they are not the same thing:

1. **Cloudflare Turnstile** (our own check on password sign-in). The site now asks for it in the quietest mode
   (`interaction-only`: normally nothing is shown) and starts it while you type, so the button does not wait. It
   shows a box only when Cloudflare is unsure about the visitor. To make that rarer: Cloudflare dashboard →
   Turnstile → the MechDost widget → set **Widget mode** to **Managed** (not "Non-interactive" or "Invisible" with
   strict rules), confirm **Hostnames** list `mechdost.com` and `www.mechdost.com` only, and in Security → Settings
   turn **Bot Fight Mode** off for the sign-in path only if it is causing challenges for real users (check Security →
   Events for "challenge" rows on `/v1/auth/password`).
2. **Google reCAPTCHA** (Firebase phone sign-in, only when an SMS code is sent: sign-up, staff code, forgot
   password). The console line "Failed to initialize reCAPTCHA Enterprise config. Triggering the reCAPTCHA v2
   verification" means the project has no reCAPTCHA Enterprise provider, so Firebase falls back to the older v2 check,
   which is the one that can show picture puzzles. Fix (console only, no code change): Firebase console →
   Authentication → **Settings** → **SMS defense** (or "reCAPTCHA") → enable **reCAPTCHA Enterprise** for Phone
   (this creates a reCAPTCHA Enterprise key in the Google Cloud project; the project must have billing and the
   "reCAPTCHA Enterprise API" enabled in Google Cloud → APIs & Services). Also check Authentication → Settings →
   **Authorized domains** has `mechdost.com`. Until then v2 keeps working; password sign-in never uses it.

Harmless console lines (they come from third-party iframes, not our page, and block nothing we need): `Framing
'https://www.google.com/' violates … frame-ancestors 'self'` (report-only policy of Google's own iframe),
`Connecting to 'data:,' violates … connect-src` and `Fetch API cannot load data:,` (Cloudflare's challenge probes its
own browser support from inside its iframe; the iframe has its own policy), `OTS parsing error: Size of decompressed
WOFF 2.0 …` (a font in Cloudflare's challenge iframe, `normal?lang=en`). Nothing to change in `csp.ts`.

What the sign-in does on our side now: the Firebase code, the Cloudflare script and connections to Cloudflare,
Google and the API start loading when `/login` opens; the Cloudflare check starts at the first touch of the form and
its token (valid 5 minutes, used once) is ready when the button is pressed; no extra token refresh after sign-in
(one Google round trip less); the API looks up the account while it asks Cloudflare; an expired or used Cloudflare
token, a network blink on the API call or on the token exchange is retried once silently before any error shows.
