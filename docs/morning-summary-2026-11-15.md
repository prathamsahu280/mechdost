# Morning summary — 2026-11-15

Overnight work (from about 01:30 to 09:30 IST). The details are in `docs/progress.md`, decisions in `docs/decisions.md`,
and open questions in `docs/questions-for-user.md`.

## The one thing that needs you first

**Q113 (P0): GitHub Actions stopped starting jobs at about 06:08 IST.** The message was "recent account payments have
failed or your spending limit needs to be increased". There has been no CI and no deploy since then.

- **Production runs `14a15a9`.** That build includes shops, analytics, Admin → Errors, the compare checkbox, shop
  give-up and warnings, refunds, the account API and emails.
- **Merged to main and migrated, but not deployed:** bell and push, trust wording, home service, admin tiers 1 and 2,
  job photos, shop tier 1. Their migrations are on the live database and the old code is compatible with them
  (checked: no new required columns without a default).
- **Your options:**
  - (a) Fix billing or raise the Actions spending limit.
  - (b) Make the repository public, which makes Actions free.
  - (c) Run a self-hosted runner on the AWS server.
  - (d) Let me deploy once by hand from this PC.

## Merged and live on the database (migrations)

| Migration | Feature                                                                                             | Notes                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0051      | Shop management and working hours                                                                   |                                                                                                     |
| 0052      | Admin → Analytics                                                                                   |                                                                                                     |
| 0053      | Sentry/PostHog (EU), Admin → Errors                                                                 |                                                                                                     |
| 0054      | Shop gives up an order, partner warnings                                                            | Security fix: the shop history no longer shows the next shop's price.                               |
| 0055      | Refunds with finance approval, manual COD payout, reconciliation                                    | Security fixes: uncertain outcomes keep the money reserved; the Razorpay lookup scans every page.   |
| —         | Customer account on the API: addresses, vehicles, profile                                           | No migration.                                                                                       |
| 0056      | 28 transactional emails (en/hi, admin-editable), `refund_declined`                                  | Security fix: public applications are not emailed (spam relay).                                     |
| 0057      | Bell, notification centre, Firebase web push                                                        | Security fix: sign-out unsubscribes the browser. Push stays off until Q103.                         |
| 0058      | Trust wording, "genuine parts only" seller clause (draft), labour promise (off), dark-pattern audit |                                                                                                     |
| 0059      | Home servicing                                                                                      | Workshop opt-in with its own fee and radius, fee on the bill, arrival code, move-to-workshop offer. |
| 0060      | Admin tier 1: staff and roles, customer search and view, audit log                                  |                                                                                                     |
| 0061      | Before/after job photos and the shared upload pipeline                                              | Security fix: the last photo cannot be removed once its check has passed. Storage keys: Q112.       |
| 0062      | Shop tier 1: polish, busy/closed toggle, staff invites                                              | Security fix: the invitee must accept.                                                              |
| 0063      | Admin tier 2: policy editor with history, home layout, city overrides, company details              |                                                                                                     |

The UI state audit covers navigation and every new screen, including real-sign-in screens (mocked API): 3,473 items.
It has **not** been run in a browser yet. The full run on this PC is the last step, after everything is built.

## CI incidents overnight (all fixed on main)

- **Compare checkbox:** it was 20 px; the minimum tap target is 24 px. Fixed by making it `size-6`.
- **Web Dockerfile:** the `ENV` line was missing a space. Fixed, and a syntax test now runs in `pnpm check`.
- **Hindi check:** placeholders like `{brand}` were flagged as English. They now count as code.
- **JS budget, found by local A/B builds:** `/shop` reached 181.3 KB.
  - Cause: the header bell's `next/dynamic` added 1.5 KB to every page, and the state machines were not marked pure.
  - Result: `/shop` 179.6, `/cart` 179.6, `/workshops` 178.7 KB.

## Still building or merging

- **Merging:** workshop analytics (admin Workshops tab, portal Performance). Its migration becomes 0064.
  - Security fix: the portal benchmark leaves out all of the owner's workshops and needs 5 others.
- **Next to merge:** support tier 1 (threads with MechDost support, photo attachments, COD refund destination).
- **Building:**
  - coupons (MechDost-funded and shop-funded; admin creates them);
  - workshops tier 1 (self-edit, hourly slots, acceptance timeout, reschedule).
- **Queue:**
  - shop tier 2 (CSV upload, packing slip, performance);
  - support tier 2 (inbox tools, auto-close, guest tickets);
  - admin CSV exports;
  - catalogue tier 2 (product photos, recommendations, server cart, wishlist, privacy, notify-me);
  - workshops tier 2 (online bill payment, staff cancel, ranking);
  - then the full UI audit run on this PC, the bug report with screenshots, and the shutdown you allowed.

## Vendor confirmation screens

See `docs/qa/vendor-portal-assessment-2026-11-15.md`. Shop tier 1 (merged) fixed items 2, 4, 5 and 6, and the bell and
push work fixed item 1 (live offers). Item 3 (packing slip, invoices) is in shop tier 2 and Q97.

## Questions for you (most urgent first)

1. **Q113 (P0):** GitHub billing. Blocks all deploys.
2. **Q103:** the web-push VAPID key and messaging sender ID.
3. **Q107:** add `refund.processed` and `refund.failed` to the Razorpay webhook.
4. **Q112:** Supabase storage keys on the server for job photos. Until they are set, keep the photo requirement off.
5. **Q110:** legal review of the "genuine" clause and the "100% genuine" wording.
6. **Q100:** the WhatsApp authentication template for the delivery code.
7. **Q109:** which payment method is preselected when a COD fee is set.
8. **Q111:** the terms of the labour promise.
9. **Q108:** whether API-mode test rows run on every push.
10. Still open from before: Q97 invoicing, Q98 support inbox, Q99 masked phone, Q77 agreement text, Q79 Resend
    domain, Q23 Supabase SSL.

## Overnight mistakes (owned)

- **Times:** I gave several check-in times in the terminal that ran about two hours ahead of the clock.
- **First budget fix:** it was a guess (`d7c3c86`). The real cause was found with A/B builds.
- **Stale measurement:** a leftover `next start` on port 3100 answered one local budget measurement, so the numbers
  were wrong.
- **Memory:** two agents ran full checks at once and the PC ran out of memory. Now only one full check runs at a time.
