# Quote follow-ups (spec 19 "Not built yet") — plan 2026-11-16

Goal: close the four items of spec 19 "Not built yet". Order: WhatsApp catalogue (W), PIN-aware minimum (R), online payment (P), attachments + read receipts (A). Each step is red first, then green; SQL only in `packages/db/src/repo`, permissions in the API.

## W. WhatsApp templates for quote events

- `packages/shared/src/whatsapp.ts`: entries `quote.offer_sent`, `quote.message`, `quote.expiring`, `quote.withdrawn` (utility, param `quoteCode`, URL button `quoteCode`), each with an optional `bodies: { en, hi }` Meta submission text (no offer/discount wording, no variable at the start or end).
- `packages/db/src/repo/quote-notifications.ts`: `queueQuoteWhatsApp` through `enqueueNotification` (outbox), only when staff switched the event on (`notificationChannelEnabled`), dedupe per offer version / message / quote. Called inside the transactions of offer, staff reply, withdraw. Sending stays off.
- Tests: `packages/shared/test/whatsapp.test.ts` (bodies pass the utility and placeholder checks), `packages/db/test/quote-notifications.test.ts`.

## R. Request form re-reads the rules after the PIN

- `quote-request-form-api.tsx` calls `GET /v1/quotes/rules?pincode=` once the PIN has 6 digits (the API already supports it); the minimum shown and checked client-side is the city's value.

## P. Online payment of an accepted quote

- Accept takes `paymentMethod: 'cod' | 'online'` (default `cod`). Online: `placeOrder(method: 'online')` with the negotiated prices (no COD cap: the cap is a cash ceiling); the group is `payment_status = created`; the API route then returns the Razorpay handle from `ensureRazorpayOrder` (one open payment per group, amount from the DB, verify + webhook unchanged). A replay with the same key returns the same order and the open handle.
- Web: "Pay online" beside "Cash on delivery" on the offer card; Razorpay opens through `payQuoteOnline` (dynamic import, reuses `loadCheckout`).
- Tests: db (online accept: group online/created, no COD cap, replay), api (handle returned, 422 when the gateway is off, verify path reused).

## A. Attachments and read receipts

- Migration: `media_objects.owner_kind` += `quote_message`; `quote_reads (quote_id, reader_side, last_read_at)` per participant side (customer / staff).
- Images only (JPEG/PNG/WebP through `photos/image.ts`: EXIF stripped, random keys, private bucket); PDF stays refused by the upload rule (spec 13) and is queued as a question.
- Routes: multipart `POST /v1/quotes/{code}/photo-messages` (customer), `POST /v1/admin/quotes/{code}/photo-messages` (staff), signed `GET /quote-photos/:id/:variant`; `POST .../read` marks the thread read; DTOs expose `attachments` and `otherReadAt` only (no user ids, no names).
- Tests: db (attach, foreign 404, limits, read marker per side), api (multipart, role-leak, signed URL), shared (schemas).
