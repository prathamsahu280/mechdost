# 06 · Workshops & service requests

Status: decided · Phase 2 · Decisions: Core flow, Workshop slots, Catalogue (reviews)

## Goal

Location-first discovery of verified workshops and a service request that moves from proposal to per-line estimate approval to bill and payment, faithful to the concept's "Know the work. Approve the cost." promise.

## User stories

- "Find a workshop": tell us where the vehicle is (GPS / saved address / pincode), which vehicle, what concern or service category, preferred date and hourly slot, pickup needed → list + map of nearby workshops (distance, verified badge, rating, services, hours, pickup) → pick one or "Let MechDost choose".
- Workshop proposes slot + expected expense range (or declines); I accept; I drop the vehicle (or pickup); workshop records odometer; sends itemised estimate; I approve line by line; work; ready; bill; pay online or at workshop; review.
- Reschedule or cancel before the vehicle is received.

## States

`requested` → (`needs_routing` if MechDost chooses) → `awaiting_workshop` → `proposed` → `confirmed` → `vehicle_received` → `estimate_sent` → `approved` (≥1 line) | `no_work_approved` → `in_progress` → `ready` → `billed` → `paid` → `completed`; `rejected` (admin), `cancelled` (customer/admin; workshop for no-show after confirmation), `rescheduled` (event, not state). A workshop **decline or acceptance timeout returns the request to `needs_routing`** for admin to reroute or reject (ruling 2026-10-31, mirrors orders); a customer may also turn down a proposal (`proposed → awaiting_workshop`). Canonical machine: `packages/shared/src/state/index.ts`.

## Data

`workshops` (concept editor fields: name, owner private, address, area, city, state, pincode, location PostGIS point, maps_url, vehicle_types[] (2W, 3W, 4W; `packages/shared/src/vehicles.ts`), ev_basic, services text, hours jsonb, pickup, location_verified, verification_method/notes/at/by, owner_consent, published, private_notes, rating, busy_mode, version), `workshop_services` (menu: title, description, inclusions, exclusions, low/high paise, duration, vehicle segments, active), `workshop_hours`, `workshop_slots` (date, hour, capacity, booked), `service_requests` (code SR-…, user, vehicle snapshot, location point + pincode + address snapshot, category, concern, preferred_at, pickup_requested, routing_mode, workshop_id, status, version, cancellable_until), `service_assignments` (as order_assignments), `service_proposals` (slot_at, scope, low/high paise, status), `estimates` (version, status) + `estimate_items` (description, qty, unit_paise, gst_rate_bp, decision pending|approved|declined), `service_events`, `service_bills` (gapless series, from approved lines, round-off), payments/refunds reused, `reviews`.

**Localised fields (hard rule 10, decision 2026-11-02 "Localised content columns").** `workshops.name_hi` and `address_hi` (business name and street transliterated: "शंकर नगर ऑटो हब"), `areas.name/name_hi` (localities: "शंकर नगर"; also used by shops and reviews), `workshop_services.title_hi`, `description_hi`, `inclusions_hi`, `exclusions_hi`; durations and hours are stored as numbers/`jsonb` and formatted per locale (never stored as English text like "Mon–Sat" or "30–60 min"). Snapshots on `service_requests` keep the text the customer saw plus the stable `service key`/`workshop_id`, so screens show the current translation by id. Missing Hindi falls back to English and is flagged in admin/partner editors. Demo mirror: `WORKSHOP_HI`, `SERVICE_HI`, `AREA_HI`, `DAY_HI` in `apps/web/src/demo/i18n/hi.ts`.

## API

`GET /workshops/nearby?lat&lng|pincode&type&fuel&category&radius` (PostGIS `ST_DWithin`, sorted by distance, verified first), `GET /workshops/:slug`, `POST /service-requests`, `POST /service-requests/:code/accept-proposal|cancel|reschedule`, `POST /service-requests/:code/estimates/:id/approve {item_ids}`, `POST /service-requests/:code/pay`; workshop: `GET /workshop/requests`, `POST /workshop/requests/:id/propose|decline`, `POST /workshop/requests/:id/vehicle-received {odometer}`, `POST /workshop/requests/:id/estimates` (new version clears approvals), `POST …/start|ready|bill|mark-paid-at-workshop`; admin: route/reroute/reject like orders.

## UI

Concept service hub (`02-view-service-packages.png`, `03-section-11-service-packages.png`): heading "A nearby workshop. A clear estimate.", tabs, search card (Location/PIN, Saved vehicle, Vehicle type, Power, "Use my location"), results + sticky map (**MapLibre GL JS** with free OSM/MapTiler tiles, MechDost-styled, via the map adapter), straight-line distance from PostGIS now and road ETA via the routing provider once chosen, promise strip. "Use my location" → reverse geocoding prefills the address; typed addresses use the autocomplete provider; both providers decided by the Raipur bake-off (pending #7). Wizard "Start a service request" with concept 4-step progress (Vehicle · Your concern · Workshop · Review). Service desk page (`03-section-14-service-desk.png`) for request detail: stepper "Request, Estimate, Approved, In progress, Ready, Billed", estimate table with approve/decline per line and consent checkbox copy from concept, bill with GST lines, "Explain estimate / हिन्दी" toggle (Hindi at launch).

## Map quality bar (free stack, must still be excellent)

MapLibre GL JS with MapTiler free-tier vector tiles (Protomaps self-host as alternative; OSM raster as last fallback); custom style in MechDost tokens with Devanagari label glyphs; clustered workshop markers with hover/active states; smooth `flyTo` on result selection and on "use my location"; locate-me and zoom controls; popups with name, distance, verified badge and "View services" CTA; list ↔ map sync (hover highlights pin); offline/tile-failure fallback card (concept "Open this area in OpenStreetMap →"); loads lazily (dynamic import) and only on pages that need it; keyboard accessible; attribution shown.

## Rules

Workshop must be `published AND location_verified` to be listed; busy mode hides from new requests; proposal slot must have capacity (conditional decrement on `workshop_slots`, exclusion constraint per workshop-hour when capacity=1); estimate revision clears prior approvals; only approved lines can be started/billed; odometer ≥ last recorded; bill = approved lines + GST per workshop registration (0% unregistered) + round-off; reviews only after `completed`, admin-approved before publish.

## Edge cases

No workshops in radius → concept "Building our Raipur workshop network" card + "Request workshop support" (admin-routed request); GPS denied → pincode centroid; customer no-show → workshop marks, admin policy; additional work found → new estimate version, customer notified; payment at workshop disputed → ticket.

## Notifications

`service.requested|routed|proposed|confirmed|vehicle_received|estimate_sent|approved|started|ready|billed|paid|completed|declined|cancelled`, reminder day-before (P1 km/date reminders).

## Analytics

`booking_started`, `slot_selected`, `booking_confirmed`, `estimate_viewed`, `job_card_approved` (lines approved/declined), `booking_rescheduled`, `booking_cancelled`, `review_submitted`.

## Acceptance tests

Nearby query ordering and radius; capacity race (two bookings last slot); estimate revision resets approvals; bill totals property tests; workshop cannot see other workshops' requests; map renders with Devanagari labels when Hindi.

## Open decisions

None beyond register (#2 reminders).

## P1/P2

Pickup/drop driver assignment with handover photos; mechanic app view; per-bay calendar; network warranty; "MechDost Certified" tiers; roadside assistance (spec 17).

## Map (implemented in demo, 2026-11-01)

`apps/web/src/components/workshops/workshop-map.tsx` — MapLibre GL 6 + OpenFreeMap tiles (light/dark follow the site theme), loaded only on map pages. The finder shows the map beside the list (sticky, ≥1024px) or above it (phones). Pins = buttons named after the workshop; selecting a pin highlights its card and vice versa ("Show on map"). Controls: zoom, full screen, locate me (sets the finder origin → distance sort), show all, scale. Popups: name, rating, area/distance, "View & book", "Directions" (Google Maps). Escape / empty-map click closes popups. Touch screens use two-finger panning outside full screen. Worker served from `/vendor` (decisions 2026-11-01). Acceptance test: `e2e/demo-flows.spec.ts` "workshop map".

**Map labels in the page language (2026-11-02).** `localizeLabels(style, locale)` in `lib/map-styles.ts` rewrites every symbol layer whose `text-field` reads a name property: Hindi → `["coalesce", ["get","name:hi"], ["get","name"]]`, English → `name:en`, `name_en`, `name`; road refs (NH30) stay. Applied to the light, dark and hybrid styles through `transformStyle` (hybrid = `localizeLabels(toHybrid(style))`). Devanagari is shaped by the browser (MapLibre ≥ 6.15 draws Indic grapheme clusters locally even with a `glyphs` URL) — verified on `/hi/workshops` 2026-11-02 ("रायपुर"). OSM roads without a `name:hi` tag keep their local (usually English) name — see inbox. Unit test: `test/map-styles.test.ts`.

## Estimates and bills (implemented in demo, 2026-11-14)

User: "add the service estimates and billing in the demo too". Browser demo (`apps/web/src/demo/store.ts`), same rules as above:

- **States** (`REQUEST_STAGES`, a subset of `serviceRequestMachine`): requested → proposed → confirmed → received (odometer) → estimate_sent → approved | no_work_approved → in_progress → ready → billed → completed. Stored as an index; records saved before 2026-11-14 (6 stages) are remapped on read (`flow: 2`).
- **Workshop job card** (`components/portal/workshop-job.tsx`): odometer (≥ the vehicle's last reading on the device) → estimate builder (lines prefilled from the requested services; description, qty 1–99, price, GST slab 0/5/12/18/28 %; up to 20 lines; per-line errors) → waiting → start approved work → ready → create bill → mark paid at the workshop; "Revise estimate" from approved, in progress or no work — not while the customer is deciding, as the machine (new version, every decision back to pending, prefilled with the approved lines); "Vehicle returned" closes a no-work job. Completed jobs are listed with the bill total.
- **Customer** (`components/workshops/service-estimate.tsx`, `request-view.tsx`): stepper Request sent · Appointment confirmed · Vehicle received · Estimate approved · Work in progress · Ready · Bill · Paid; "Review estimate v{n}" with Approve/Decline per line (nothing preselected), live approved total, concept consent text, errors "Approve or decline every item." / "Confirm your choices using the checkbox."; a stale version is refused; the bill shows approved lines only, taxable value, CGST/SGST (rate shown when one slab), round-off and total, then "Paid at the workshop on …" and "Rate {workshop}". The account's Services link shows a badge while a proposal or estimate waits.
- **Maths** (`packages/shared/src/service-bill.ts`): tax on top per approved line (`splitExclusiveGst`, intra-state), 0 % when the workshop is not GST-registered (`workshopGstRegistered`; demo: Amapara Express Service), grand total rounded to the rupee (`invoiceRoundOff`). Property tests in `packages/shared/test/service-bill.test.ts`.
- **Analytics**: `estimate_viewed {code, version, lines}`, `job_card_approved {code, version, approved, declined}`; workshop steps as `click` ids `workshop_vehicle_received`, `workshop_estimate_sent`, `workshop_job_{start|ready|bill|paid|return}`.
- **Demo control** performs the workshop's next real action with sample values (proposal from the menu ranges, a sample estimate from the requested services, bill, paid); it never makes the customer's choices.
- **Tests**: `e2e/service-estimate.spec.ts` (per-line approval → bill from approved lines with GST and round-off → paid → rate; revision clears approvals; all declined → no work → vehicle returned; odometer and line validation; demo control; Hindi).
