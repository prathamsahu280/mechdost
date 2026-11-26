# Spec 24 — Delivery agents

Design: `docs/superpowers/specs/2026-11-26-delivery-agents-design.md` (approved, Lead's calls 1–13, contract and route
table). The backend sections (data, machines, API, worker, notifications) are written by the backend stream; this
file's **Web screens** section is the web stream's (branch worktree-agent-a36d3c6ca1dc56788, 2026-11-27). Merge both.

## Web screens (web stream, 2026-11-27)

One set of screens serves both builds through a client seam: `apps/web/src/lib/delivery/types.ts` (interfaces, types
from the contract DTOs with type-only imports), `lib/delivery/api-clients.ts` (real sign-in: the route table, every
answer checked with the shared schemas; loaded with `import()` so Zod never reaches a page's first load) and
`demo/delivery-clients.ts` on the browser demo store `demo/delivery-store.ts`. `lib/delivery/use-delivery-client.ts`
picks one; demo screens reload on every demo change, API screens poll (offers 10 s, lists 15–20 s).

### Public

- **Apply as a delivery agent** — `/partners/apply/delivery_agent`: name, mobile, city (Raipur for now), vehicle
  (native radios), consent; Turnstile + `POST /v1/delivery-agent-applications` in real builds. No documents on this
  form (Lead's call 10). Confirmation with the `PA-…` reference and a link to the status page.
- **Partners page** card "Deliver with MechDost" and a footer link. No pay, insurance or uniform words anywhere
  (founder ruling 2026-11-26).
- **Status lookup** (`/partners/status`) recognises delivery-agent references (demo; the API's status DTO does not
  list the kind yet — contract gap G3).
- **Invite** — `/partners/delivery-invite/{token}` (noindex, no referrer; token redacted in analytics and in the
  access log): shows name, city, vehicle, the last 4 digits of the invited mobile number and the expiry; signed out →
  sign in (phone OTP) and come back; signed in → **Accept invite** → "Upload documents".

### Agent portal — `/partner/delivery` (role `delivery_agent`, mobile first, en + hi)

Frame in the layout (stays mounted between tabs): navy status strip with the agent's first name and vehicle, a
**Help** call button (MechDost support), the **Take new jobs** switch (online/offline; only for `active` agents, else
the onboarding/paused/suspended reason in words), and a 4-tab bar (Offers · My jobs · History · Profile; links with
`aria-current`).

- **Offers**: each open offer with a ticking `m:ss` countdown (warning colour under a minute), order code, pickup
  area, drop PIN, items, load class, distance, attempt; **Accept** (primary) opens the job; **Decline** asks for a
  reason (native radios; `other` needs a note). Empty states: "Go online" or "the next one comes here".
- **Job** (`/partner/delivery/jobs/{jobId}`) in 4 steps with "Step n of 4": (1) go to the shop — shop name, area +
  PIN, **Call the shop**, **Open in maps**, what to collect, customer area + PIN only, **I'm at the shop**; (2) the
  shop's 4-digit pickup code + parcel photo (camera, shrunk and re-encoded on the phone: no EXIF) → **Confirm
  pickup**; (3) the customer's name, address and phone appear (call + maps), **I'm at the customer**; (4) the
  customer's delivery code + handover photo → **Delivered**. Codes are sent by themselves at 4 digits; a wrong code
  says the tries left; 5 wrong tries lock it (MechDost support takes over). **Couldn't deliver** (steps 3–4): reason +
  photo → "MechDost tells you what to do next". **I can't do this job** (before pickup): reason. Returning: the
  agent's 4-digit **return code** to tell the shop. A job never offered to this agent: "This job is not available to
  you" (404). Finished jobs show codes only.
- **My jobs** (accepted, picked up, failed, returning) and **History** (delivered, returned, cancelled).
- **Profile**: status, vehicle (changed by MechDost only), own rating average (founder ruling: average only), the
  three documents (PAN card, driving licence, vehicle RC: number + photo, status, rejection reason; Aadhaar refused),
  and **Earnings**: the agent's payouts as recorded by MechDost (date, period, amount, method, reference; a correction
  shows as a minus line) and the delivered-jobs count (founder ruling 2026-11-26: manual payouts).

### Shop portal (agent-mode shops; self-delivery shops unchanged)

On an agent-delivered order from **Packed**: **Mark ready for pickup** (instead of "Out for delivery") → "Finding a
delivery partner" with the **pickup code** (big digits, "tell it only at handover"); when accepted "{first name}
({vehicle}) is coming to pick it up"; after pickup "Picked up by …"; **Parcel coming back** with the agent's return
code entry; MechDost's **"Can you deliver this order yourself?"** with Yes / We can't (reason). A **Who delivers your
orders** card: the mode in words, one request at a time to change it (owner only; reason codes), withdraw, earlier
requests with their outcome.

### Customer order page

For an agent-delivered part: "Finding a delivery partner" → "{name} will pick up your order" → "Picked up by {name}
({vehicle})" + the existing delivery code and "give it only when the parcel is in your hands" → delivered; a failed
try with its reason; "Returned, refund on its way" with the refund wording of Lead's call 13 (full, or parts only
when refused / unreachable again; Coins and coupon restored). Never the shop, never the agent's phone. After
delivery: **Rate your delivery** (1–5 stars as native radios, quick reasons: on time, polite, careful with the parcel,
late, rude, parcel damaged, other + note), editable for 24 h (founder ruling 2026-11-26).

### Admin → Delivery (`/admin/delivery`, Operations group; demo and API)

Tabs: **Jobs** (queues Needs an agent / Offered / On the road / Failed / Coming back / Done; table with order, shop,
PIN, agent, load, waiting minutes + a Late chip from 15 min, offer countdown; **Open** shows ranked suggestions —
vehicle fits the load first, then fewest active jobs, then distance; accept rate — with **Offer to {name}**, take
back (reason), failure decision (retry same agent / another agent / send back to the shop; retry limit), audited
overrides when a code is locked (reason ≥ 5 characters), "Ask the shop to deliver" (reason), and the job timeline:
events, offers, photos). **Applications** (invite → the one-time link shown once with copy; reject with the partner
reasons; invite someone who did not apply; invites list with revoke). **Agents** (status filter; name, masked phone,
vehicle, status, online, active jobs, documents verified, rating average + count; detail: 30-day numbers, documents
with an audited **View**, verify / not accepted with a reason, status change with reason + note and history, vehicle).
**Payouts** (record: agent, amount in ₹ → paise, period, method UPI / bank transfer / cash / other, reference/UTR,
note; filters by agent and period; delivered jobs and amount paid per agent for the period; **Correct this payout**
adds a reversing entry; CSV download). **Shop requests** (approve / reject with a reason). **Settings** (demo: the
city's switch, timer, limits, photos, attempts, vehicle loads; real builds: Admin → Settings → Partners, per city).
The admin order card shows the delivery timeline of an agent-delivered order.

### Browser demo

Logins (password `Raipur@2026`): agent **Sunil Yadav 9000000005** (motorcycle), agent **Deepak Sahu 9000000007**
(three-wheeler, offline), shop **Gupta Lubes & Spares 9000000006** (the agent-mode shop). Agents are on in the demo
city; existing shops deliver themselves. The demo has no payments, so its orders count as prepaid for the delivery
mode (decision 2026-11-27). Photos are never stored in the browser (a flag only).

### Analytics (client, `click` ids; spec 12)

`agent_screen_{offers|jobs|history|profile|job}`, `agent_go_online|offline`, `agent_help_call`,
`agent_offer_accepted|accept_failed|declined`, `agent_at_shop|customer`, `agent_photo_{pickup|delivery|failure|document}`,
`agent_pickup_code_ok|wrong`, `agent_delivery_code_ok|wrong`, `agent_picked_up`, `agent_delivered`,
`agent_delivery_failed`, `agent_job_given_up`, `agent_call_shop|customer`, `agent_map_shop|customer`,
`agent_document_saved_{kind}|refused_{kind}`, `agent_invite_accepted|accept_failed`,
`partner_application_delivery_agent`, `shop_ready_for_pickup(_failed)`, `shop_return_code_ok|wrong`,
`shop_switch_confirmed|declined`, `shop_mode_request_{self|agents}|withdrawn`, `delivery_rated|rate_failed`,
`admin_delivery_tab_{tab}`, `admin_delivery_offered|withdrawn|retry_same|retry_other|return_to_shop|switch_to_shop`,
`admin_delivery_override_{kind}`, `admin_delivery_invited(_direct)|invite_failed|invite_revoked|application_rejected`,
`admin_agent_status_{status}|vehicle_saved|document_viewed_{kind}|document_verified_{kind}|document_rejected_{kind}`,
`admin_shop_mode_approved|rejected`, `admin_delivery_settings_saved`, `admin_delivery_payouts_viewed|payouts_csv|
payout_recorded|payout_corrected` (+ `_failed` variants), and `code_submitted {kind:'delivery'}` for every code.
Typed events in the shared catalogue are a contract gap (G6).

### Tests

Unit: `apps/web/test/demo-delivery.test.ts` (machines, CAS, 404, stage reveal, codes, photo, failed/return,
switch, shop mode, invite), `demo-delivery-payouts.test.ts`, `delivery-view.test.ts`,
`delivery-invite-redaction.test.ts`, `caddy-secret-paths.test.ts`. E2E `apps/web/e2e/delivery-agents.spec.ts`
(happy path desktop + mobile, role leak, failed + return, offer expiry at 15 min, shop ready + self-delivery request,
customer view) on `fixtures/delivery-world.ts`. Hindi gate: apply, invite, agent portal, agent-mode shop, customer and
admin pages. State audit: rows `DLV-*` (chunk E).

### Contract gaps (for the backend stream)

- G1 Invite web link path: the web serves `/partners/delivery-invite/{token}`; the email/WhatsApp link must use it.
- G2 `ShopOrder` (order-views) and `MyOrder` schemas must carry `delivery` (they strip unknown keys today); the web
  reads it when present.
- G3 `ApplicationStatusDto.kind` and the partner `ApplicationPage` row (PIN required) do not accept delivery-agent
  applications; the web reads the list with a tolerant guard and needs `vehicleType` and `cityCode` on the row.
- G4 Admin order → jobs: no route lists the jobs of one order; the web calls `GET /admin/delivery/jobs?view=all&orderCode=`.
- G5 Ratings and payouts DTOs/routes (founder rulings 2026-11-26) are pending; the web uses
  `PUT /me/orders/{code}/delivery-rating`, `GET /agent/me/earnings`, `GET|POST /admin/delivery/payouts`,
  `POST /admin/delivery/payouts/{id}/correct`, `GET /admin/delivery/payouts/summary?from&to`, and `rating`,
  `ratingAvg`, `ratingCount` fields on the agent DTOs.
- G6 Typed client analytics events for delivery (the web uses `click` ids meanwhile).
- G7 Pickup-code lock and job-detail flags for admin (`pickupLocked`, `deliveryLocked`, `retryAllowed`) are not on
  `AdminJobDetail`; the web hides the override/retry choices it cannot judge.
- G8 SOS / help number: the web calls the company support number (`lib/site.ts`); a per-city admin-editable number
  (like roadside's `sosPhone`) would satisfy rule 8.
