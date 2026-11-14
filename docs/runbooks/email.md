# Email runbook (Resend)

## Setup

- **The key:** `RESEND_API_KEY` goes in the git-ignored `.env` locally and in Secret Manager in production. A **send-only** key is enough.
- **Senders** (decision 2026-11-13). `EMAIL_DOMAIN` defaults to `mechdost.com`; each sender is an address on that domain:
  - updates@: order and service updates, seller invites, decisions;
  - billing@: invoices, receipts, refunds;
  - support@: ticket replies, and the reply-to address on every email;
  - promotions@: campaigns, only to customers who consented;
  - noreply@: account and security emails.
- **The domain must be verified in Resend** before mail reaches anyone except the account owner (Q79). Add the SPF, DKIM and DMARC records that Resend shows to the DNS of `mechdost.com`.
- **Links in emails** use `WEB_BASE_URL`, which must be `https://` in production.

## How it sends

- Code queues an `email` row in `notification_outbox`; the worker's dispatcher sends it.
- **Secret values** (for example an invite token) are encrypted in the payload and opened only just before sending.
- **Idempotency:** each send carries `Idempotency-Key: outbox-<row id>`, so a retry after a lost answer is not sent twice.
- **Failures:**
  - 429 and 5xx: retried with backoff.
  - 401 and 403: retried a day later (key or domain problem).
  - 422: failed for good.

## Templates

- `packages/shared/src/email-catalogue.ts` holds the templates (English and Hindi default copy, closed placeholder list, purpose, button path); `email-templates.ts` composes them; `email-layout.ts` is the one fixed layout; `email-phrases.ts` holds the localized words that fill placeholders (reasons, refund notes, payment methods).
- Layout: table-based, inline styles, light with a dark-mode block, no images, no scripts, no tracking pixels. Footer: company, support phone 7978776551, and the grievance contact **only once `EMAIL_GRIEVANCE_CONTACT` is set** (Q15b).

## Editing, previewing and testing an email (Admin → Notifications → Emails)

1. Sign in as staff with `notifications:manage` (all-city grant; verified phone and email) → Admin → Notifications → **Emails**.
2. Pick the email → **Edit** → choose English or Hindi. Edit the subject, heading, body and button label. Tap a placeholder chip to insert it at the cursor. Only the listed placeholders work; unknown ones, HTML and over-long text are refused on save. The preview on the right renders the real layout with sample data as you type.
3. **Save text.** A field left equal to the default stays "default" and keeps following the code text. **Reset to default** removes your override for that language (audited).
4. **Send a test to me** queues the email, with sample data, to your own verified address through the real pipeline (subject starts "[Test]"). It needs `RESEND_API_KEY` on the worker. Limit: 20 an hour.
5. The **switch** turns the email off for both languages. Transactional emails ask for confirmation first. No row = default text and on.
6. Every save, reset, switch and test is in the audit log (`email_template.saved|reset|test_sent`).

Adding a new email in code: add its definition to `EMAIL_CATALOGUE` (both languages, closed placeholder list, sample data), add `tpl_<key>` to `adminEmails` in both locale files, and call `queueEmail` inside the transaction of the state change (never outside it). Tests: `packages/shared/test/email-templates.test.ts` covers every template automatically.

## Queuing an email from code

- `queueEmail(tx, { template, entityId, version, userId | to, payload })` in `packages/db/src/repo/email-notifications.ts`. Dedupe key `{template}:{entityId}:v{version}:email`; a rolled-back change sends nothing; staff-switched-off templates and unverified addresses (when `customers.require_verified_email` is on; partners always) send nothing.
- Refunds code: call `queueRefundEmail(tx, { template: 'refund_requested' | 'refund_processed' | 'refund_failed', refundId, refundVersion, userId, orderCode, amount })` (amount from `rupees(paise)`).
- Server events `email_sent {template, locale}` and `email_failed {template, code}` are written by the dispatcher; no addresses.

## Not built yet

- Resend bounce and complaint webhooks (mark an address undeliverable); promotional emails and the unsubscribe link (no campaigns at launch).
- `coins_expiring` (no reminder job exists).
- Warning emails for workshops (workshops have no login email yet); the applicant's language (applications carry none, so `en`).
