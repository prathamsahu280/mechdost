# Which docs each kind of task needs

| Task touches                                        | Read (in addition to CLAUDE.md, progress, decisions, questions inbox, learnings)                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Login, OTP, profile, addresses, vehicles            | `specs/01-auth-accounts.md`, `specs/13-rbac-security-abuse.md`, `research/security-vulnerabilities.md` §5, skill `firebase-phone-auth-rbac` |
| Catalogue, product pages, search, fitment           | `specs/02-catalogue-search.md`, `concept/customer-site.md` §3.4, `research/ecommerce-baseline.md` §2                                        |
| Cart, checkout, coupons, COD                        | `specs/03-cart-checkout.md`, `research/data-integrity.md` §3–4, §6, skill `razorpay-payments`                                               |
| Orders, routing, shop accept/decline, tracking      | `specs/04-orders-routing-fulfilment.md`, `specs/14-data-integrity.md`, `packages/shared/src/state/index.ts`                                 |
| Cancel, return, refund, replacement                 | `specs/05-cancellations-returns-refunds.md`, `research/data-integrity.md` §4, §6                                                            |
| Workshops, service requests, estimates, maps        | `specs/06-workshops-service-requests.md`, `concept/customer-site.md` §3.6, `concept/account-support.md` §1.6–1.7                            |
| Shop / workshop portals, onboarding                 | `specs/07-partner-portals.md`, `concept/admin.md` (workshop editor)                                                                         |
| Admin console, CMS, dashboards                      | `specs/08-admin-console.md`, `concept/admin.md`, skill `dataviz`                                                                            |
| Support tickets                                     | `specs/09-support.md`, `concept/account-support.md` §2                                                                                      |
| Notifications                                       | `specs/10-notifications.md`, skill `msg91-messaging`                                                                                        |
| Recommendations                                     | `specs/11-recommendations.md`                                                                                                               |
| Analytics / events                                  | `specs/12-analytics-events.md`                                                                                                              |
| RBAC, rate limits, abuse                            | `specs/13-rbac-security-abuse.md`, `research/security-vulnerabilities.md`                                                                   |
| Schema, migrations, SQL                             | `specs/14-data-integrity.md`, `research/data-integrity.md`, skills `drizzle-postgis-supabase`, `supabase-postgres-best-practices`           |
| Multi-city, pincodes                                | `specs/15-multi-city.md`                                                                                                                    |
| Performance, images, smoothness                     | `specs/16-performance-scalability.md`, skills `core-web-vitals`, `vercel-react-best-practices`                                              |
| Future modules (discovery, academy, lens, roadside) | `specs/17-future-modules.md`, `concept/customer-site.md` §9                                                                                 |
| Any UI                                              | `design-system.md`, `screenshots/concept/`, `concept/*.md` copy, skills `ui-ux-pro-max`, `shadcn-component-discovery`                       |
| Hindi / i18n                                        | skill `next-intl-hindi`                                                                                                                     |
| PWA / offline                                       | skill `serwist-pwa`                                                                                                                         |
| Dependencies, CI, deploy                            | `research/security-vulnerabilities.md` (dependency policy), `research/tooling-audit.md`, `runbooks/setup.md`                                |
| Code structure / quality                            | `conventions/code-style.md`                                                                                                                 |
