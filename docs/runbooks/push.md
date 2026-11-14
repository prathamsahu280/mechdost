# Bell and web push runbook (Firebase Cloud Messaging)

Spec 10 "Bell and web push", design `docs/superpowers/specs/2026-11-15-bell-push-design.md`. The **bell** (in-app notifications) works as soon as the code is deployed. **Web push** also needs the three steps below; until they are done the "Turn on notifications" card stays hidden and nothing else changes.

## Turn push on (once the Firebase values are in hand, Q103)

1. **Firebase console → Project settings → Cloud Messaging.**
   - Under **Web configuration → Web Push certificates**, generate a key pair. Copy the **public key** (the VAPID key).
   - Copy the **Sender ID** (the project number, shown under Cloud Messaging; it is also in Project settings → General).
   - If the **Firebase Cloud Messaging API (V1)** shows as disabled, enable it (Google Cloud console → APIs & Services → Firebase Cloud Messaging API).
2. **Repository variables** (public values: they ship in the browser). With the `gh` CLI:
   - `gh variable set NEXT_PUBLIC_FIREBASE_VAPID_KEY --body "<the public key>"`
   - `gh variable set NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID --body "<the sender id>"`
   - They are passed to the website build by the CI build and the Deploy workflow (build args). A new deploy is needed for them to take effect.
3. **The server's service account** (`GOOGLE_APPLICATION_CREDENTIALS`, mounted at `/run/secrets/firebase-admin.json`, the same account the live updates use) must be allowed to send: the **Firebase Cloud Messaging API Admin** role, or any role with `cloudmessaging.messages.create` (the default "Firebase Admin SDK Administrator Service Agent" already has it). Nothing is added to `/opt/mechdost/.env`.
4. **Check:** sign in on the website, open the account home: the card "Get order and booking updates on this device" appears. Tap **Turn on**, allow the browser's question, then place a test order in the demo city: the worker log shows `push_sent` events and the browser shows the notification. In Admin → Notifications → Messages you can change any message's text.

Locally: leave both variables empty (the card is hidden); the dispatcher's push adapter starts only with a real Firebase project (not the emulator or a `demo-` project).

## What runs where

- **Web:** `apps/web/public/firebase-messaging-sw.js` is a plain service worker (no Firebase code, no keys). `lib/push/enable-push.ts` is the only code that loads `@firebase/messaging`, and only after the person taps "Turn on" or "Turn off". The token is registered with `POST /v1/me/push-devices`.
- **API worker:** `apps/api/src/notify/push.ts` reads the person's live tokens when it sends, calls `firebase-admin` `sendEach`, revokes tokens Firebase calls gone and retries busy errors (the dispatcher's back-off). The message is title, short body and a link on this site, nothing else.
- **Jobs (worker):** offer-expiry reminder (every minute), refund-SLA alert (hourly), 90-day retention (daily). Settings in Admin → Settings: `notifications.retention_days`, `notifications.push_prompt_snooze_days`, `notifications.promo_per_week`, `notifications.offer_expiry_reminder_min`.

## Things that look like bugs but are not

- **iPhone:** push works only when the site is added to the Home Screen; Safari shows the card with those steps instead of the button.
- **"Notifications are blocked":** the person chose Block in the browser; only the browser's site settings can undo it. The card never asks again; the settings page explains how.
- **No push but the bell updates:** the person has no live device, switched push off in Account → Notifications, or the key is not set. The bell is always written.
- **A new order appears up to 15 s late in the shop portal with the tab open and no push:** the bell polls (live pings in the browser are not built yet).

## Privacy

Tokens are personal data: never in logs, analytics events or any API response. Sign-out revokes the browser's device first. Push carries no addresses, phone numbers, amounts or delivery codes (the placeholder lists are closed per message; `packages/shared/test/notice-catalogue.test.ts` fails if one is added).
