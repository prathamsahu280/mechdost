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

`workshops` (concept editor fields: name, owner private, address, area, city, state, pincode, location PostGIS point, maps_url, vehicle_types[], ev_basic, services text, hours jsonb, pickup, location_verified, verification_method/notes/at/by, owner_consent, published, private_notes, rating, busy_mode, version), `workshop_services` (menu: title, description, inclusions, exclusions, low/high paise, duration, vehicle segments, active), `workshop_hours`, `workshop_slots` (date, hour, capacity, booked), `service_requests` (code SR-…, user, vehicle snapshot, location point + pincode + address snapshot, category, concern, preferred_at, pickup_requested, routing_mode, workshop_id, status, version, cancellable_until), `service_assignments` (as order_assignments), `service_proposals` (slot_at, scope, low/high paise, status), `estimates` (version, status) + `estimate_items` (description, qty, unit_paise, gst_rate_bp, decision pending|approved|declined), `service_events`, `service_bills` (gapless series, from approved lines, round-off), payments/refunds reused, `reviews`.

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
