# 15 · Multi-city

Status: decided (foundation in Phase 1) · Research: `../research/industry-features.md` §7

## Goal

Launch Raipur only, but make adding Durg/Bhilai, Bilaspur and other states an operations task, not a code change.

## Model

`states`, `cities` (slug, status live|coming_soon|paused, centroid, radius_km, timezone IST, launch_at), `zones` (optional polygons, GeoJSON), `pincodes` (pincode, city_id, zone_id, centroid, serviceable_for {parts_delivery, doorstep_service, pickup_drop, rsa}, cod_allowed), `settings` scoped by city (acceptance timeout, cancel/return windows, COD cap, fees), partner coverage (`shop_pincodes`, workshop radius), staff `city_ids` scope, `waitlist` (pincode, phone, interest) for non-live areas.

## Behaviour

- City selector in header (default Raipur; auto from pincode/GPS; cookie + URL param); storefront content and prices scoped by city; ISR keys include city.
- Serviceability check at address entry: point-in-polygon or pincode lookup; non-live → "Not serviceable yet — notify me" (captures demand analytics).
- Admin: city launch checklist page (anchor shops/workshops count, catalogue coverage, settings, templates), toggle live; all lists filter by city; city_manager role scoped.
- Analytics by city; "shops per pincode" density KPI.

## Launch playbook (admin-driven)

waitlist demand → seed partners → verify docs → catalogue coverage → settings → train partners on timer → soft launch 2–3 pincodes → monitor acceptance/time-to-accept → expand.

## Acceptance tests

Order in a paused city blocked; staff scoped by city cannot see others; pincode import validates; city switch changes prices/offers.

## Seller onboarding (2026-11-13)

Invites and applications belong to a city; staff see and decide only their cities' applications, invites and price requests. The delivery area offered at approval is the city's PIN codes; the default charge and days are operational settings. Nothing assumes Raipur: the demo pre-fills from the demo city's PIN list.
