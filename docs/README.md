# MechDost documentation index

Read `../CLAUDE.md` first (hard rules). Then:

| File | What it holds |
|---|---|
| `decisions.md` | Confirmed decisions log (brand, stack, auth, scope, providers, P0 details, tooling) and the **PENDING DECISIONS** register. Append-only with dates. |
| `design-system.md` | Design tokens, fonts, layout and chrome rules, copy to preserve, UX rules, screenshot references. |
| `concept/customer-site.md` | Exhaustive inventory of the concept's customer site: views, sections, buttons, labels, modals, cart/checkout, hub, partners, policies, APIs, storage keys, reference data, state machines, bugs. |
| `concept/account-support.md` | Inventory of `/account`, `/support.html`, product pages and the public API. |
| `concept/admin.md` | Inventory of the concept `/admin` dashboard (12 tabs, fields, endpoints, data model, workshop editor, backups, bugs). |
| `concept/source/` | Captured HTML/CSS/JS of the concept (reference only; never import). |
| `research/industry-features.md` | Indian parts/service platforms, Swiggy/Zomato/Urban Company patterns, marketplace ops, compliance, analytics, growth, multi-city. |
| `research/ecommerce-baseline.md` | Complete checklist of ordinary e-commerce + booking features with P0/P1/P2 and decision annotations. |
| `research/tooling-audit.md` | Verified Claude Code plugins, MCP servers, skills and registries; what is installed. |
| `research/data-integrity.md` | Known marketplace concurrency/data bugs and the exact Postgres/Drizzle/Razorpay patterns that prevent them. |
| `research/security-vulnerabilities.md` | Recent CVEs/incidents for the stack (2025–2026), 40-item day-one checklist, dependency policy. |
| `specs/README.md` + `specs/NN-*.md` | One spec per feature (auth, catalogue, cart/checkout, orders & routing, cancellations/returns/refunds, workshops, partner portals, admin & CMS, support, notifications, recommendations, analytics, RBAC & abuse, data integrity, multi-city, performance & scalability, future modules). |
| `screenshots/concept/` | Playwright captures of every concept view, hidden section, modal, page and mobile layout (+ `capture.mjs`). |
| `plan.md` | The approved build plan (copied from the Claude plan file on approval). |

## Working rules for these docs
- Update the relevant file **in the same change** as any code/config/decision change (CLAUDE.md hard rule 1).
- Deferred choices go into the PENDING DECISIONS table in `decisions.md`; decided ones move to a dated entry.
- Specs carry acceptance tests; the `website-testing` skill reads them.
- Research files are snapshots dated in their header; re-verify versions/prices before external use.
