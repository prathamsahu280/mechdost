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

- `packages/shared/src/email-templates.ts` holds the templates (English and Hindi; each declares its purpose).
- Plain HTML: no images, no tracking pixels.
