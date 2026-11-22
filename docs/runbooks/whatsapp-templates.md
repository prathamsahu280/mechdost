# WhatsApp templates: submit, check and switch on (`pnpm wa:templates`)

Decision 2026-11-16 (see `docs/decisions.md`), Q173, spec 10. The catalogue is `packages/shared/src/whatsapp.ts`; the
text of each template (English and Hindi) is the whole file `packages/shared/src/notify-templates/{en,hi}.json` (not in the ICU locale files, which are precompiled at build time: spec 16 incident 2026-11-22); button labels
and sample values are `packages/shared/src/whatsapp-meta.ts`. The CLI is `apps/api/src/notify/wa-templates-cli.ts`.
Nothing is submitted to Meta unless you run `--submit --yes`.

## Variables (names only; never put values in docs or chat)

| Variable                       | Needed for             | Notes                                                                                          |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `--status`, `--submit` | The WhatsApp Business **Account** id (not the phone number id). Digits only.                   |
| `WHATSAPP_ACCESS_TOKEN`        | `--status`, `--submit` | The existing sending token is reused if it also has `whatsapp_business_management`.            |
| `WHATSAPP_MANAGEMENT_TOKEN`    | optional               | A separate System User token with `whatsapp_business_management`; wins over the sending token. |
| `WHATSAPP_API_VERSION`         | optional               | Pinned Graph version, default `v23.0`.                                                         |
| `DATABASE_URL`                 | `--status --save` only | To store the statuses for the admin screen and the send gate.                                  |

## Steps

1. `pnpm wa:templates` (same as `--dry-run`): prints every template in English and Hindi with its button and sample
   values and checks Meta's rules (name pattern, `{{n}}` numbering, one sample per variable, 1024 characters, no
   variable at the start or end, button label 25 characters, no offer wording). No network, no credentials. Exit code 1 if
   any template has a problem.
2. Set the variables above in `.env` (or the server's secrets).
3. `pnpm wa:templates --status`: lists what Meta has (name, language, status, category) and marks catalogue templates Meta
   does not have as `missing`. Read-only.
4. **Only after your go-ahead:** `pnpm wa:templates --submit --yes`. Creates the missing templates only (never edits or
   deletes one that exists), waits through Meta rate limits, prints each result. Meta then reviews them (minutes to a day).
5. `pnpm wa:templates --status --save`: stores each template's status (`approved`, `pending`, `rejected` ...) in the
   `notifications.whatsapp_template_status` setting. From the first save, the app queues a WhatsApp message for an event
   only while Meta has **approved** that language of its template **and** staff switched the event on in
   Admin → Notifications. Admin → Notifications shows "WhatsApp approval: English …, Hindi …" on each card.
6. Global sending stays off (`WHATSAPP_ENABLED=off`) until you switch it on; see `docs/runbooks/deploy.md`.

## Catalogue (compare with what Meta approved)

All are category **UTILITY**, languages `en` and `hi`, no header or footer. `{{1}}` / `{{2}}` are positional.

| Event key                | Meta name                | Purpose                                                  | Placeholders                        | Button (en / hi) → URL                                                               |
| ------------------------ | ------------------------ | -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `order.confirmed`        | `order_confirmed`        | Shop accepted: order confirmed, will be shipped          | `{{1}}` order code                  | Track order / ऑर्डर ट्रैक करें → `https://mechdost.com/orders/{{1}}`                 |
| `order.out_for_delivery` | `order_out_for_delivery` | Parcel out for delivery (no code in the text)            | `{{1}}` order code                  | Track order / ऑर्डर ट्रैक करें → `https://mechdost.com/orders/{{1}}`                 |
| `order.rejected`         | `order_rejected_refund`  | Order could not be fulfilled; refund to original method  | `{{1}}` order code                  | View order / ऑर्डर देखें → `https://mechdost.com/orders/{{1}}`                       |
| `service.estimate_sent`  | `service_estimate_ready` | Workshop sent an estimate to review per item             | `{{1}}` service request code        | Review estimate / अनुमान देखें → `https://mechdost.com/service/{{1}}`                |
| `ticket.replied`         | `ticket_reply`           | Support replied to a request                             | `{{1}}` ticket code                 | Open request / रिक्वेस्ट खोलें → `https://mechdost.com/account/support?ticket={{1}}` |
| `order.routed` (shops)   | `partner_new_order`      | New order for a shop; accept or decline within the timer | `{{1}}` order code, `{{2}}` minutes | none                                                                                 |

Sample values sent to Meta: order `MD-RPR-2026-7K3QWX`, request `SR-RPR-2026-4H2MNP`, ticket `REQ-RPR-2026-9D5TXA`, minutes `10`.
The exact English and Hindi body of each is printed by the dry run. `mechdost_otp` (Authentication) is registered by hand
and is not part of this catalogue (WhatsApp OTP sending is not built, Q56).

Templates added to the catalogue later (for example quote events) appear in the dry run, this table and the admin screen
automatically; a new key without Meta copy fails typecheck until `META_TEMPLATE_COPY` has an entry for it.

## If something fails

- `FAILED name/lang: HTTP 400, Meta code 100 ...`: Meta refused the payload; the message is printed (the token never is).
  Fix the text in the locale file, re-run the dry run, then `--submit --yes` again: it only creates what is still missing.
- `already exists`: Meta already has that name and language; nothing to do.
- Rate limits (HTTP 429, codes 4, 17, 613, 80008, 130429, 131056) are retried up to 4 times with 1, 2, 4 second waits.
- Meta may recategorise a template to Marketing (about 7.5 times the price). `--status` shows the category; check it before
  switching the event on.
