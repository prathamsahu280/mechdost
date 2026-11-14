# Shop gives up an accepted order, and warnings to partners: design note (2026-11-15)

Status: built on branch `worktree-agent-ae36b855027f92e10` (not merged). Specs 04, 07, 08, 12, 14 carry the behaviour.

## User rulings (fixed)

- A shop that accepted an order may give it up **before it is packed**, with a **reason code** (free text only as an
  extra note, rule 16). The order goes **back to admin to reroute**; it is never auto-cancelled.
- The customer is **not told** the shop dropped it. The status they see goes back to "confirming with a seller".
- It **counts against the shop's score** and shows in the shop's history. Stock and holds are released correctly.
- Admin can **warn** a shop (the model also works for workshops) with a reason code and an optional note. The shop sees
  its warnings in its portal. After N warnings in a window (settings, default 3 in 30 days) admin is **prompted** to
  pause, on the warning form and on the shop page. **Never automatic.** Pausing is the existing standing flow.
- Staff are notified through the existing live-ping/outbox pattern; push/email are being built elsewhere (a hook is left).

## Design

| Piece         | Decision                                                                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment    | New status `given_up` (`accepted -> given_up`, shop only), columns `given_up_at`, `give_up_reason` (code), `give_up_note`; CHECK ties them to the status. `accepted` stops being terminal. The partial unique index (one `offered`/`accepted` per order) is untouched. |
| Order         | New transition `confirmed -> needs_rerouting` (shop only). One conditional UPDATE on (status, version); `shop_id` and `confirmed_at` are cleared. Packed or later cannot be given up.                                                                                  |
| Stock         | `restoreCommittedStock` reverses `commitReservation` exactly (committed -> released, `on_hand` + qty) in the same transaction. Rerouting reserves again at the new shop through the existing routing code.                                                             |
| Customer view | The status trigger (migration 0053) writes the `confirmed -> needs_rerouting` timeline row with `visible_to_customer = false`. The customer status map already shows `needs_rerouting` as step 1.                                                                      |
| Score         | Routing stats count `given_up` as answered, not accepted; analytics `offersAnswered` includes it; `attempts` in the queue counts it.                                                                                                                                   |
| Admin queue   | Queue item `gaveUpReason`, history `giveUpReason`, ranked shop `gaveUpBefore`. A shop that gave an order up is **not** auto-excluded (see ruling R2).                                                                                                                  |
| Warnings      | Table `partner_warnings`, append-only (`forbid_update_delete`): `issued` rows and `withdrawn` rows pointing at them (`withdraws_id`, unique). Real FKs `shop_id` / `workshop_id`, exactly one set.                                                                     |
| Prompt        | `suggestPause = status = 'approved' and live warnings in window >= threshold`. Staff-only DTO; the shop DTO has no threshold.                                                                                                                                          |
| Permissions   | Give up: `orders:fulfil` (shop owner/staff, own shop only, else 404). Warn / withdraw: `partners:approve` in the shop's city (same as pausing). Shop reads its own: `orders:read`. No new permission, so no RBAC sync.                                                 |
| Abuse         | `shop_give_up_user` 10 per 10 min per user; strict Zod bodies; per-user API limit as for every route.                                                                                                                                                                  |

## Rulings I made (cost if wrong)

- **R1. Rolling window = 30 x 24 h back from now in UTC, from settings `partners.warning_window_days` (7 to 180) and
  `partners.warning_threshold` (1 to 20), both global-only.** Cost if wrong: a one-line setting change; no data change.
- **R2. A shop that gave an order up is still offerable for it** (flag `gaveUpBefore` shown; declined/expired shops stay
  excluded). Reason: "out of stock" may be fixed minutes later and the coordinator asked for "same or another shop".
  Cost if wrong: admin offers it to the same shop again; one line in `rankShopsForOrder` (`tried`) excludes it.
- **R3. Give-up stock goes back on the shelf** (like a cancel), so the count is the shop's to correct if it was wrong.
  Cost if wrong: an out-of-stock shop shows stock until it edits inventory; routing re-checks stock at offer time.
- **R4. The customer timeline keeps the earlier "confirmed" row** and hides only the step back. A customer who saw
  "confirmed" then sees "confirming with a seller" again. Cost if wrong: confusion; fix is a customer-facing note or hiding
  the earlier row (a data-only change).
- **R5. Warnings cannot be edited or deleted; revoking is a new row.** Cost if wrong: none (history only grows).
- **R6. Workshop warnings: model and repository work; HTTP routes and screens are not built** (the workshop portal and
  admin workshop screens are separate surfaces). Cost: one router and one panel, same components.
- **R7. Staff notification:** live pings (orders and assignments triggers already fire) plus the queue; the push/email hook
  is `notifyStaffShopGaveUp` in `shop-give-up.ts`.

## Not in scope

Automatic pause; customer messages; shop score screen; workshop HTTP/UI for warnings; a runnable API-mode UI audit.
