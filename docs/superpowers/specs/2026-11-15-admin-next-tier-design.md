# Admin console, next tier (design)

Date: 2026-11-15 · Specs: 08 (admin console), 13 (RBAC), 01, 12, 15 · Decisions: "2026-11-15 — Next tier answers" and
the gap list (2026-11-15) · User: "after all this is done then we can go ahead and work on the next tier for the admin …"

## Intent

Admin must run the marketplace from the website alone (hard rule 8): grant staff roles, find a customer, see who
changed what, export data, edit policies, the home layout and city settings, without a developer.

## Goals / non-goals / anti-goals

- Goals (each a separate build task, in this order): (1) **staff and roles** screen; (2) **customer search + customer
  view**; (3) **audit log viewer**; (4) **CSV exports**; (5) **policy page editor**; (6) **home layout editor on the
  API**; (7) **city setting overrides**; (8) **grievance officer and company details** settings (CIN etc.), hidden on the
  site until filled.
- Non-goals: theme editor (decided no), BI tool, payouts (wait on the commission model).
- Anti-goals: support agents seeing full phone numbers (masked unless the permission allows), exports that leak
  personal data to roles without the permission, a staff member granting themselves a higher role, unbounded queries.

## Approaches

1. **Screens over the existing repos and permissions (chosen):** every screen reads/writes through actor-scoped repos and
   the RBAC catalogue already in `packages/shared/src/rbac.ts`; new permissions only where none fits (`staff:manage`
   exists? reuse; `exports:run` new if missing). Cheapest, consistent with the console.
2. A generic admin framework (auto-CRUD): faster per screen later, but weak on rules (four-eyes, masking). Not chosen.

## Decided

- **Staff and roles:** list staff (role, city scope, last sign-in, 2FA status), grant/revoke a role with a reason, city
  scope picker; only `super_admin` grants `super_admin`/`finance`; nobody edits their own roles; every change audited
  and the user's sessions refreshed (claims). Replaces the `pnpm db:grant-role` CLI for daily use (CLI stays for the
  first admin).
- **Customer search:** by phone (last 10 digits), email, order/request/ticket code, name prefix; results capped at 20;
  customer view shows profile, orders, service requests, tickets, refunds, blocks, coins, consents; phone/email masked
  unless `customers:pii` (support sees last 4 digits). Every view of an unmasked profile is audited (who looked).
- **Audit log viewer:** filters entity type, entity id/code, actor, action, date range (IST), cursor paging; before/after
  JSON diff view; read-only; `audit:read`.
- **CSV exports:** orders, sub-orders, refunds, service requests, partners, customers (masked unless `customers:pii`),
  events (pseudonymous). Run as a pg-boss job, file to the private storage bucket (photos design pipeline), a signed
  download link valid 10 minutes, the request audited; max 180 days per export; IST dates; amounts in rupees with
  paise columns too.
- **Policy editor:** edit the policy pages (API exists: `GET /v1/content/policies/{key}`) per language with a preview,
  versioned (old versions kept), publish needs `content:publish`; the site revalidates by tag.
- **Home layout editor on the API:** the demo layout editor (`admin-site.tsx` `LayoutEditor`) gets a real-mode twin
  storing the same layout JSON in settings/content; server-rendered; no client JS added to the home page.
- **City overrides:** the settings screen gains a city picker for settings that are not `globalOnly`; shows inherited
  vs overridden values.
- **Company details:** settings for legal name, CIN, GSTIN, registered address, grievance officer name/email/phone,
  shown in the footer/policies/emails when set (Consumer Protection E-commerce rules), hidden until filled.
- Every screen: en + hi, empty states with one next action, state-audit rows (API-mode chunk G), analytics admin
  events.

## Left to the builder

Exact permission names (reuse first), the diff viewer component (shadcn registries first), export file format details.
