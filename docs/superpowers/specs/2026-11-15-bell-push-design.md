# In-app notification bell and Firebase web push (design)

Date: 2026-11-15 · Specs: 10 (notifications), 01, 12 (consent), 16 (JS budget) · Decisions: "2026-11-15 — Launch features
round" item 5 · Research: `docs/research/market-scan-2026-11-15.md` § push

## Intent

People should hear about what matters to them without reloading pages: a customer when the shop confirms, a shop when an
order arrives with its timer running, staff when an order needs routing. The bell keeps the list; push reaches them when
the tab is closed.

## Goals / non-goals / anti-goals

- Goals: a bell with unread count and a notification centre for every signed-in role; web push through Firebase Cloud
  Messaging for customers, shops, workshops, staff and admin; promotions only after a separate opt-in.
- Non-goals: the native app (later, same FCM project); WhatsApp (separate channel); quiet hours for transactional.
- Anti-goals: asking for push permission on page load; pushes that carry personal data on the lock screen beyond what the
  person needs; a push for a change that rolled back; the 180 KB JS budget broken by the Firebase library.

## Approaches

Push transport (user chose 2026-11-15: "Firebase Messaging"):

1. **Firebase Cloud Messaging (chosen):** `firebase/messaging` in the browser, loaded with a dynamic import only after the
   person taps "Turn on"; a `firebase-messaging-sw.js` service worker; server sends with `firebase-admin` messaging (the
   service account already on the server, decision Q93). The same project serves the future mobile app.
2. Standard Web Push (VAPID) with our own server keys: smallest JS, but the app would need FCM anyway. Not chosen.

When to ask (user chose 2026-11-15: "Soon after sign-in"): a small card after the first sign-in ("Get order and booking
updates on this device" · Turn on · Not now), never a browser prompt before the person taps Turn on; "Not now" hides it
for 14 days (setting); always available in Account → Notifications and in each portal's settings. Partners and staff see
the card on their first portal visit. iPhone: push only works when the site is added to the Home Screen, so on iOS
Safari the card explains "Add to Home Screen" first. A browser "denied" is shown as such with how to re-enable.

## Decided

- **One fan-out:** a notification event (existing outbox pattern, written in the business transaction) creates per
  recipient: an in-app row (always for transactional), a push row (if a live device token and the preference allows), an
  email row (emails design). Dedupe key per channel. The bell updates through the existing live pings.
- **In-app:** extend `notifications` with `category` (`transactional|promotional`), `kind` (code, e.g. `order.confirmed`),
  `entity_type` + `entity_id`, `link`; title/body rendered in the recipient's language at write time. API:
  `GET /v1/me/notifications` (cursor), `POST /v1/me/notifications/read` (ids or all), unread count. Kept 90 days.
- **Devices:** new table `push_devices` (user_id, fcm_token unique, platform `web`, user_agent family, locale, created_at,
  last_seen_at, revoked_at). Register/refresh `POST /v1/me/push-devices`, remove on sign-out or opt-out
  `DELETE /v1/me/push-devices/{id}`; tokens that FCM reports as invalid are revoked by the dispatcher. RLS on, revoked from
  anon/authenticated. Tokens are personal data: never in analytics or logs.
- **Preferences:** `notification_preferences` (channel `push`|`email`|`inapp`, category) already exists; promotions need
  both the `marketing` consent (consents table, notice version) and the push/promotional preference on. Transactional
  push can be turned off per person; in-app transactional cannot.
- **Payload:** title + short body + link only (e.g. "Order MD-RPR-… confirmed"), no addresses, phones or amounts on the
  lock screen for staff/partner pushes beyond the order code.
- **Who gets what (launch):** customers: order/service/quote/support/refund milestones (same list as emails);
  shops/workshops: new order or request with timer, 5-minute reminder before an offer expires, warnings; staff/admin
  (permission- and city-scoped, same recipient resolution as live pings): needs routing, shop declined/gave up/timed out,
  refund awaiting approval past SLA, new application, new ticket.
- **Frequency:** transactional uncapped; promotional at most 2 per week per person (setting).
- **Key:** `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (Q103). Until it is set the Turn on card is hidden and the bell still works.
- **Analytics:** `push_prompt_shown`, `push_prompt_answered {answer}`, `push_enabled`, `push_disabled`,
  `notification_opened {kind, channel}`, `bell_opened`; server `push_sent {kind}`, `push_failed {code}`.
- **UI:** bell in the header (customer) and in each portal top bar, unread badge (aria-live "3 new notifications"),
  dropdown of the latest 10 + "See all" page; en + hi; empty state with one next action; state-audit rows (0 / 1 / 99+
  unread, long Hindi titles, open/closed dropdown, the Turn on card at every audit width, iOS variant).

## Left to the builder

Service worker registration path and scope (serwist-pwa skill if a PWA worker is added; otherwise a plain worker at
`/firebase-messaging-sw.js` served with the public Firebase config), foreground message handling (toast + bell refresh),
how the bell lazy-loads, exact retry/backoff (reuse the dispatcher).
