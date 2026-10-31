# Feature specs — index and template

Each feature has one spec. Specs are living documents: **any change to behaviour must update the spec in the same change** (CLAUDE.md hard rule 1). Status values: `decided`, `pending-decision`, `building`, `shipped`, `future`.

| #   | Spec                                                                                            | Phase          | Status                            |
| --- | ----------------------------------------------------------------------------------------------- | -------------- | --------------------------------- |
| 01  | [Auth & accounts](01-auth-accounts.md)                                                          | 1              | decided                           |
| 02  | [Catalogue, fitment & search](02-catalogue-search.md)                                           | 1              | decided (vehicle master pending)  |
| 03  | [Cart & checkout](03-cart-checkout.md)                                                          | 1              | decided (payment mix pending)     |
| 04  | [Orders, admin routing, shop acceptance, fulfilment, tracking](04-orders-routing-fulfilment.md) | 1              | decided                           |
| 05  | [Cancellations, returns, refunds, replacements](05-cancellations-returns-refunds.md)            | 2              | decided (P1 pull-forward pending) |
| 06  | [Workshops & service requests](06-workshops-service-requests.md)                                | 2              | decided                           |
| 07  | [Partner portals (shop, workshop) & onboarding](07-partner-portals.md)                          | 1–2            | decided (commission pending)      |
| 08  | [Admin console, CMS & analytics](08-admin-console.md)                                           | 1–3            | decided                           |
| 09  | [Support tickets](09-support.md)                                                                | 2              | decided (WhatsApp pending)        |
| 10  | [Notifications](10-notifications.md)                                                            | 1–3            | decided                           |
| 11  | [Recommendations](11-recommendations.md)                                                        | 1              | decided                           |
| 12  | [Analytics & event tracking](12-analytics-events.md)                                            | 1              | decided                           |
| 13  | [RBAC, security & abuse protection](13-rbac-security-abuse.md)                                  | 1              | decided                           |
| 14  | [Data integrity & identifiers](14-data-integrity.md)                                            | 1              | decided                           |
| 15  | [Multi-city](15-multi-city.md)                                                                  | 1 (foundation) | decided                           |
| 16  | [Performance & scalability](16-performance-scalability.md)                                      | 1              | decided                           |
| 17  | [Future modules](17-future-modules.md)                                                          | 4+             | future                            |
| 18  | [MechDost assistant (floating chat)](18-assistant.md)                                           | 0 (static), 1  | static shipped; LLM pending Q19   |
| 19  | [Bulk orders: negotiate with admin](19-bulk-quotes.md)                                          | 1              | decided (thresholds pending Q20)  |

## Spec template

```
# <Feature>
Status · Phase · Owner decisions (link to decisions.md entries)
## Goal (one paragraph)
## Roles involved
## User stories (As a … I can … so that …)
## Flow & states (diagram or list; every transition names the actor)
## Data (tables/fields touched; link to packages/db)
## API (endpoints, auth, idempotency)
## UI (pages/components; concept screenshot refs; copy)
## Rules & validations
## Edge cases & failure modes
## Notifications & events emitted
## Analytics events
## Acceptance tests (what Playwright/Vitest must prove)
## Open decisions (pending register rows)
## P1/P2 extensions (documented so they can be pulled forward)
```
