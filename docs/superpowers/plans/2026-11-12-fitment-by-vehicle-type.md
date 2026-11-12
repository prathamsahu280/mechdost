# Fitment by vehicle type — implementation plan

> For agentic workers: executed inline (executing-plans); TDD per task.

**Goal:** products carry the vehicle types they are for (2W, 3W, 4W); the catalogue shows it ("For 2W · 3W") and can be filtered by vehicle type, in demo and API mode.

**Architecture:** `products.vehicle_types text[]` (subset of the shared `VEHICLE_TYPES`, empty = not listed) → catalogue repo returns `vehicleTypes` and filters on `vehicleType` → API DTO + `?vehicle=` → web view model `vehicleTypes` → card chip + shop filter select (URL param `vehicle`). Admin edits the tags.

**Spec:** `docs/specs/02-catalogue-search.md`; decision 2026-11-12 "Three-wheelers first-class; fitment by vehicle type" (Q76 default).

## Global constraints

- Wording: a type tag never claims an exact fit. Chip shows the codes ("2W · 3W"); a product without tags shows "Fitment not listed". Never "Fits your vehicle" (decision 2026-11-12).
- No fitment written from memory: seed tags come only from the existing demo `fits` values (`2W` → [2W], `4W` → [4W], `2W/4W` → [2W, 4W]); `EV` is a fuel, so those products get no tag.
- Admin-editable (rule 8), audited; Zod at the boundary; codes from `@mechdost/shared/vehicles` only.
- en + hi strings; analytics event for the filter (rule 9); JS budget 180 KB gz.

## Tasks

1. **DB** — migration 0037: `vehicle_types text[] not null default '{}'`, CHECK `vehicle_types <@ array['2W','3W','4W']`, GIN index. Seed fixture gets `vehicleTypes`. Repo: card/product return `vehicleTypes`; `listCatalogue({ vehicleType })` keeps only products tagged with it. Admin repo: set tags (audited). Tests: filter keeps tagged only; bad tag refused by the CHECK; admin edit audited.
2. **API** — shared DTO `vehicleTypes: VehicleType[]`; `GET /v1/catalogue?vehicle=3W` (enum); admin product update accepts `vehicleTypes`. Tests: filter over HTTP, bad value 400, admin edit.
3. **Web** — view model `vehicleTypes: readonly VehicleType[]` (empty = not listed); demo mapper from `fits`; API mapper; card chip; shop filter select "Vehicle type" (Any / 2W / 3W / 4W) in URL `vehicle`, demo filters in the browser, API mode passes it on. Tests: mappers; e2e filter in demo mode.
4. **Docs** — spec 02, decisions (Q76 default applied), progress, learnings.

## Review focus

- Untagged products disappear under a vehicle filter (intended: a filter shows tagged products only; the empty state offers "clear filters").
- Hindi pages: codes 2W/3W/4W are allowed Latin tokens; the select labels are Hindi.
- Cursor pagination with the new filter (filter is in `where`, so cursors stay valid).
