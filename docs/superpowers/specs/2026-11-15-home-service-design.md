# Home servicing (design)

Date: 2026-11-15 · Specs: 06 (workshops & service requests), 07 (partner portals), 15 (multi-city) · Decisions:
"2026-11-15 — Launch features round" (home servicing) and "… second answers" (visit fee, move to workshop) · Research:
`docs/research/market-scan-2026-11-15.md` § 1

## Intent

Many Raipur owners (mostly two-wheelers) want routine service without riding to a workshop. A workshop mechanic comes
to the customer's home and services the vehicle there. Market evidence: doorstep players do simple periodic jobs at home
and move lift jobs to the workshop; the complaints are surprise charges and not knowing who turns up.

## Goals / non-goals / anti-goals

- Goals: workshops opt in with their own visit fee and travel radius and mark which menu services they can do at home;
  customers choose "At my home" or "At the workshop" when booking; only workshops whose radius covers the address are
  listed; the visit fee is shown before booking and added to the bill; an arrival code at the door; if the job can't be
  done at home, the workshop offers to move it to the workshop.
- Non-goals: MechDost's own mechanics (mechanic network, spec 17); live mechanic tracking on a map; roadside assistance.
- Anti-goals: a price surprise (fee not shown upfront); an unknown person at the door; listing a workshop that does not
  travel that far; a home job that silently becomes a workshop job.

## Approaches

1. **A service mode on the existing request flow (chosen):** `service_requests.service_mode` `workshop|home`; the same
   state machine (proposal → confirmed → vehicle received → estimate per line → work → ready → bill → pay); "vehicle
   received" means "mechanic arrived and checked the code" for home jobs. Smallest change, reuses estimates, bills,
   reviews, notifications and analytics.
2. A separate home-visit entity and machine: duplicates estimates/bills/reviews. Dropped.
3. Pickup-only (vehicle collected and returned): already modelled as `pickup_requested`; different from what the user
   asked ("the workshop guy would go to the customers home"). Kept as is, separate.

## Decided (user rulings in quotes)

- **Workshop settings** (portal + admin, audited): `home_service` on/off, `home_radius_km` (1–25, default 5),
  `home_visit_fee_paise` (0–₹500 default ₹99; admin-editable range per city setting `service.home_fee_max_paise`),
  per menu item `home_available` (default off). "Workshop opts in" with its own fee and radius.
- **Booking:** location first (as today). A mode switch "At the workshop / At my home"; home needs a saved address (the
  account API) with a map pin. Listing for home mode: `ST_DWithin(workshop.location, address.location, home_radius_km)`,
  published + location-verified + not busy + home on + at least one chosen service `home_available`.
- **Visit fee:** shown on the workshop card and the booking review ("Visit fee ₹99, added to your bill"), snapshotted on
  the request, added as a bill line `visit_fee` ("On the final bill"); the workshop may waive it (line set to 0 with
  reason code). Not charged if the customer or workshop cancels before arrival.
- **Arrival code:** a 4-digit code generated at "confirmed", shown to the customer in the request page (and push/email);
  the mechanic enters it to mark arrival (`vehicle_received`), same protection as the delivery code (attempt limit,
  admin override audited). The workshop names the visiting mechanic at "confirmed" (first name; shown to the customer).
- **Move to workshop** ("Offer to move it"): after arrival, the workshop can propose moving the job to the workshop with
  a reason code (`needs_lift`, `needs_tools`, `parts_unavailable`, `other`) and how the vehicle gets there (customer
  drops / workshop picks up); the customer accepts or declines. Accept → `service_mode` becomes `workshop` (event logged;
  the visit fee stays unless waived), the flow continues at the workshop with a new estimate. Decline → the workshop
  bills the visit fee (unless waived) and closes the job (`no_work_approved` → `billed`).
- **Safety and trust:** the request page shows the workshop, its rating, the visiting mechanic's first name and the
  arrival code; the mechanic never sees the customer's full phone before "confirmed" (spec 13 masking follows Q99).
- **Analytics:** `service_mode_selected {mode}`, `home_visit_arrived`, `home_move_proposed {reason}`,
  `home_move_answered {accepted}`; mode on every service event for workshop analytics.
- **i18n / UI:** en + hi; calm UI (one primary action); state-audit rows for the mode switch, home listing (none / some
  / at radius edge), visit-fee line, arrival code entry (right/wrong/locked), move proposal card.

## Left to the builder

Migration shape (columns vs a `workshop_home_settings` table), how the code is stored (hashed like the delivery code),
listing query plan (index on location already exists), whether the fee range is per city or global (spec 15 says per
city if cheap).

## Builder check (2026-11-15): coordinator calls

- **The move proposal is a side record, not a new state:** `service_moves` (request_id, reason_code, transport
  `customer_drops|workshop_picks_up`, status `proposed|accepted|declined`, decided_at). It is allowed while the request
  is `vehicle_received` or `estimate_sent`. Accept switches `service_mode` to `workshop` (event logged; the status stays,
  and the workshop then sends or revises the estimate). Decline moves the request `vehicle_received` → `estimate_sent`
  with a zero-line estimate → `no_work_approved` → `billed` (visit fee only). Add the edge `vehicle_received →
no_work_approved` (actor workshop, only through the decline path) only if that is simpler, and record it in spec 06.
- **Odometer:** entered with the arrival code. The existing CHECK requires it after `confirmed`.
- **Visit fee GST:** it follows the workshop's GST registration like any other bill line (`service_bills` rules; the
  `service_bills_unregistered_no_gst` CHECK stays). It is snapshotted on the request at "confirmed". Cancelled before
  arrival: no fee. Declined after arrival: a bill with the visit fee only, unless waived.
- **Pickup:** `pickup_requested` is allowed only in `workshop` mode (CHECK). Home mode means no pickup.
- `addresses.location` exists (geography point). Home booking requires a pinned address.
