# Vendor (shop) portal: confirmation screens assessment (2026-11-15)

The user asked (2026-11-15): "how well are the vendors confirmation screen etc built?" This is a code read of the real-API
shop portal (`apps/web/src/components/portal/shop-portal-api.tsx` and related), done by the give-up build agent and
checked by the coordinator. No browser run yet; those screens get state-audit rows through the API-mode fixture (Q106).

## What works

- New-order offer with a countdown timer; the customer's address is hidden until the shop accepts (DPDP minimisation).
- Decline needs a reason code; the shop can give up an accepted order before packing (new, 2026-11-15) with a reason.
- Delivery-code entry: format check, wrong-attempt count, locked state.
- Pause banner and working-hours card; "Notes from MechDost" (warnings, new) without threats or thresholds.
- en + hi strings, Hindi item titles; loading, error and retry states on the lists; single column on phones with 44 px
  targets.

## Missing or weak (worst first)

1. **New offers arrive by 30-second polling only:** no push, sound or live ping on the screen, although the live outbox
   exists. A shop can miss a short accept timer. → Fixed by the bell + push build (queued) and a live ping subscription
   on the offers list.
2. **Expired offers stay on screen showing "0 min" until the next poll.** A late accept returns a generic "unavailable"
   error instead of "This offer expired". → Small fix: hide at expiry on the client and map the error code.
3. **Hand-over is own delivery only** (user ruling). "Mark shipped" jumps straight to out for delivery. There is no
   packing slip or invoice link in real mode (the demo has the GST line). → Packing slip is in the next tier; invoices
   wait on Q97.
4. **No success feedback after pack or ship:** the list just reloads, and errors show per card.
5. **The locked delivery-code state lives in the page only:** a reload forgets it, and the message gives no support
   phone or link.
6. **Empty states are plain text with no next action.** There is no "busy / closed today" toggle (the schema has `busy`
   and `busy_until`), no earnings view (payouts wait on the commission model), and history covers 30 days with no
   search.
7. The Hindi gate was not run for these screens (no browser run yet).

## Plan

- Items 1, 2 and 4–6 go into the queue as "shop portal polish" right after the bell + push build. The UI state audit
  rows for these screens come with the API-mode fixture (coverage agent).
- Item 3 is in the next tier (packing slip) and waits on the invoicing decision (Q97).
