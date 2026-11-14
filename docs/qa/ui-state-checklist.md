# UI state checklist

Generated from the component state model (`apps/web/e2e/state-audit/model.ts`) by the deterministic pairwise
generator (`apps/web/e2e/state-audit/pairwise.ts`); background in `docs/research/ui-testing-gap-2026-11-14.md`.
Every line is one Playwright test whose title starts with the same id
(`apps/web/e2e/state-audit/state-audit.audit.ts`). Do not edit the item lines by hand: change the model and run
`node apps/web/scripts/state-audit-checklist.mjs` (ticks and results on unchanged lines are kept; a line whose state
changed starts unticked again). `apps/web/test/state-audit-checklist.test.ts` fails when this file and the model
disagree.

## How items get ticked

- `- [ ]` not run yet.
- `- [x] … — 2026-11-15 pass` passed on that date (P2 notes, if any, follow in brackets).
- `- [!] … — 2026-11-15 FAIL: <summary> · [screenshot](…)` failed; the bug goes into **Found bugs** below with
  the id.
- Ticks are written by `node apps/web/scripts/state-audit-tick.mjs <playwright-json-report>` after a run
  (runbook: `docs/runbooks/ui-test-catalogue.md` § 9). Never tick by hand without running the test.

## Reading a line

`<id> · <width> · <theme> · <language> · <who> · world=<stored data> · <route> · <component state> · asserts: <checks> · core`

- **world**: `empty` (only the privacy choice stored), `cart` (cart + compare list), `busy` (orders, service
  requests, quote, ticket, reviews: `apps/web/e2e/fixtures/demo-world.ts`).
- **cart** / **compare**: the stored lists (`CARTS` / `COMPARES` in the model), e.g. `compare=bat-2` = two
  batteries in the compare list while the page shows other categories.
- **stress**: data shapes the demo catalogue lacks, applied to the rendered page: `long-text` (70+ character
  names), `long-price` (₹1,00,000), `mixed-shape` (every other card without rating, MRP, saving and badge).
- **interaction** / **action** / **open** / **form**: what is hovered, focused, pressed or clicked before measuring.
- **core**: also runs on every push (CI `e2e-demo` job); everything runs nightly.

Assertions (every state, plus a hover and keyboard-focus sweep over the component's controls):

- `present`: the component and its must-show content render.
- `inside`: every control and text line stays inside its card or container.
- `overlap`: no two controls or text lines overlap, also while each control is hovered and focused.
- `covered`: no control or text is painted over by another control (hover backgrounds included).
- `clipped`: no text is clipped; ellipsis only where designed and never on prices or button labels.
- `aligned`: cards in a row are equal height with aligned action rows; table cells line up across columns.
- `tap`: every target is at least 24 px (or spaced); under 44 px is noted.
- `hscroll`: the page does not scroll sideways.
- `focus`: a visible, unclipped focus ring on every control reached by Tab.
- `console`: no console error, page error or failed request to our server.
- `sync`: controls agree with the stored state (compare pressed = in list, stepper = in cart, tray count).
- `axe`: axe WCAG 2.2 AA on the component.
- `hindi`: on /hi no English outside the allowlist (test/hindi-allowlist.ts).
- `nav`: navigation: one current marker where the route is a nav target, the current item in view, and with walk=yes every item opens a page with its heading (no 404, no wrong landing).

Severity on failure: **P0** a control is covered, overlapped by another control, or out of sync with the stored
state; **P1** a visible layout defect (outside its card, overlap with text, clipped, misaligned, sideways scroll,
no focus ring, page error, axe serious); **P2** polish (targets under 44 px, focus ring partly clipped, axe moderate).

## Counts

| Id prefix          | Page                                              | Component                                                                                                                                                               | Strategy | States   | In core |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ------- |
| CHR-HEADER         | Chrome                                            | Header (brand, nav, search, language, theme, account, cart pill)                                                                                                        | cross    | 26       | 11      |
| CHR-TABBAR         | Chrome                                            | Bottom tab bar (under 1024 px)                                                                                                                                          | pairwise | 20       | 5       |
| CHR-FOOTER         | Chrome                                            | Footer (help, columns, privacy choices, theme)                                                                                                                          | pairwise | 16       | 0       |
| CHR-FLOAT          | Chrome                                            | Floating stack: assistant launcher, compare tray, consent banner, tab bar together                                                                                      | cross    | 24       | 3       |
| CHR-ASSIST         | Chrome                                            | Assistant launcher and panel                                                                                                                                            | pairwise | 16       | 0       |
| CHR-CONSENT        | Chrome                                            | Cookie and consent banner                                                                                                                                               | pairwise | 16       | 0       |
| HOME-HERO          | Home                                              | Hero with search                                                                                                                                                        | pairwise | 25       | 0       |
| HOME-TRUST         | Home                                              | Trust strip                                                                                                                                                             | pairwise | 25       | 0       |
| HOME-CATS          | Home                                              | Category tiles                                                                                                                                                          | pairwise | 25       | 0       |
| HOME-RANGE         | Home                                              | Product range (cards without compare)                                                                                                                                   | pairwise | 25       | 7       |
| HOME-ROUTE         | Home                                              | How an order travels (order route)                                                                                                                                      | pairwise | 25       | 0       |
| HOME-SERVICE       | Home                                              | Workshop service section                                                                                                                                                | pairwise | 25       | 0       |
| HOME-WORKSHOPS     | Home                                              | Top workshops                                                                                                                                                           | pairwise | 25       | 0       |
| HOME-PARTNER       | Home                                              | Partner teaser                                                                                                                                                          | pairwise | 25       | 0       |
| HOME-FAQ           | Home                                              | FAQ (details/summary accordion)                                                                                                                                         | pairwise | 24       | 0       |
| SHOP-CARD          | Shop (/shop)                                      | Product card × compare list × cart (full cross)                                                                                                                         | cross    | 128      | 14      |
| SHOP-ACTION        | Shop (/shop)                                      | Card actions clicked, then every card re-checked (cross-entity sync)                                                                                                    | cross    | 40       | 2       |
| SHOP-FILTERS       | Shop (/shop)                                      | Search, category chips, vehicle chips, sort, results count, empty result                                                                                                | pairwise | 48       | 6       |
| SHOP-POPOVER       | Shop (/shop)                                      | Quick-details popover (ⓘ) on the first and the last card of a row                                                                                                       | pairwise | 16       | 0       |
| SHOP-TRAY          | Shop (/shop)                                      | Compare tray (count, open, clear) over the listing                                                                                                                      | cross    | 32       | 2       |
| STEP               | Quantity stepper (card, product page, cart)       | Stepper − / count / + × quantity × hover/focus/active/disabled (full cross)                                                                                             | cross    | 180      | 6       |
| PDP-BUYBOX         | Product page (/shop/[slug])                       | Buy box: price, MRP and saving, stock, add to cart / stepper, compare                                                                                                   | pairwise | 41       | 3       |
| PDP-REVIEWS        | Product page (/shop/[slug])                       | Ratings summary, review list, write-a-review entry                                                                                                                      | pairwise | 16       | 0       |
| PDP-RELATED        | Product page (/shop/[slug])                       | Related products row (cards)                                                                                                                                            | pairwise | 16       | 0       |
| CMP-TABLE          | Compare (/compare)                                | Comparison table × column count × badges × partial in-cart (full cross)                                                                                                 | cross    | 126      | 2       |
| CMP-EMPTY          | Compare (/compare)                                | Compare with one or no product (empty state and next action)                                                                                                            | pairwise | 16       | 0       |
| CART-LINES         | Cart (/cart)                                      | Cart lines (stepper, remove, line total) and summary                                                                                                                    | pairwise | 40       | 10      |
| CART-EMPTY         | Cart (/cart)                                      | Empty cart (one next action, category shortcuts)                                                                                                                        | pairwise | 16       | 0       |
| CHK-FORM           | Checkout (/checkout)                              | Checkout form (contact, address, business GSTIN, payment) and summary                                                                                                   | pairwise | 25       | 1       |
| ORD-VIEW           | Order (/orders/[code])                            | Order status, timeline, lines, delivery code, cancel/rate/support                                                                                                       | pairwise | 24       | 1       |
| SR-VIEW            | Service request (/service/[code])                 | Request status, proposal, itemised estimate (per-line approval), bill                                                                                                   | pairwise | 40       | 1       |
| QT-PAGES           | Bulk quotes (/quotes)                             | Quote request form and quote thread                                                                                                                                     | pairwise | 16       | 0       |
| ACC-OVERVIEW       | Account (/account)                                | Account section: overview (section bar + content)                                                                                                                       | pairwise | 16       | 2       |
| ACC-ORDERS         | Account (/account)                                | Account section: orders (section bar + content)                                                                                                                         | pairwise | 16       | 2       |
| ACC-SERVICES       | Account (/account)                                | Account section: services (section bar + content)                                                                                                                       | pairwise | 16       | 0       |
| ACC-QUOTES         | Account (/account)                                | Account section: quotes (section bar + content)                                                                                                                         | pairwise | 16       | 0       |
| ACC-SUPPORT        | Account (/account)                                | Account section: support (section bar + content)                                                                                                                        | pairwise | 16       | 0       |
| ACC-COINS          | Account (/account)                                | Account section: coins (section bar + content)                                                                                                                          | pairwise | 16       | 0       |
| ACC-VEHICLES       | Account (/account)                                | Account section: vehicles (section bar + content)                                                                                                                       | pairwise | 16       | 0       |
| ACC-ADDRESSES      | Account (/account)                                | Account section: addresses (section bar + content)                                                                                                                      | pairwise | 16       | 0       |
| ACC-PROFILE        | Account (/account)                                | Account section: profile (section bar + content)                                                                                                                        | pairwise | 16       | 0       |
| ACC-VEHICLES-DATA  | Account (/account)                                | Account vehicles: empty, one, at the limit of 10, long Hindi text                                                                                                       | pairwise | 32       | 2       |
| ACC-ADDRESSES-DATA | Account (/account)                                | Account addresses: empty, one, at the limit of 10, long Hindi text                                                                                                      | pairwise | 32       | 2       |
| WS-FINDER          | Workshops (/workshops)                            | Finder: PIN, vehicle, use my location, list cards, map toggle (map canvas excluded)                                                                                     | pairwise | 16       | 2       |
| WS-PROFILE         | Workshop page (/workshops/[slug])                 | Workshop profile: services menu, reviews, booking form                                                                                                                  | pairwise | 25       | 1       |
| PTN-LANDING        | Partners (/partners)                              | Partner landing (kinds, benefits, apply links)                                                                                                                          | pairwise | 16       | 0       |
| PTN-APPLY          | Partners (/partners/apply/[kind])                 | Application form (GSTIN, tick lists, location picker; map canvas excluded)                                                                                              | pairwise | 24       | 1       |
| SUP-PAGE           | Support (/support)                                | Support page and request form                                                                                                                                           | pairwise | 16       | 0       |
| LOGIN-FORM         | Sign in (/login)                                  | Sign-in form (password, errors, show password)                                                                                                                          | pairwise | 16       | 0       |
| POL-PAGE           | Policies                                          | Policy pages (sections, anchors)                                                                                                                                        | pairwise | 40       | 0       |
| PRT-SHOP           | Shop portal (/partner/shop)                       | Shop portal: offers with timer, accept/decline, orders, prices                                                                                                          | pairwise | 16       | 1       |
| PRT-WORKSHOP       | Workshop portal (/partner/workshop)               | Workshop portal: requests, proposal, estimate lines, bill                                                                                                               | pairwise | 16       | 0       |
| ADM-OVERVIEW       | Admin console (/admin)                            | Admin section: overview (section bar, tables, actions)                                                                                                                  | pairwise | 16       | 0       |
| ADM-ORDERS         | Admin console (/admin)                            | Admin section: orders (section bar, tables, actions)                                                                                                                    | pairwise | 16       | 1       |
| ADM-SERVICES       | Admin console (/admin)                            | Admin section: services (section bar, tables, actions)                                                                                                                  | pairwise | 16       | 0       |
| ADM-QUOTES         | Admin console (/admin)                            | Admin section: quotes (section bar, tables, actions)                                                                                                                    | pairwise | 16       | 0       |
| ADM-APPLICATIONS   | Admin console (/admin)                            | Admin section: applications (section bar, tables, actions)                                                                                                              | pairwise | 16       | 0       |
| ADM-PARTNERS       | Admin console (/admin)                            | Admin section: partners (section bar, tables, actions)                                                                                                                  | pairwise | 16       | 0       |
| ADM-CATALOGUE      | Admin console (/admin)                            | Admin section: catalogue (section bar, tables, actions)                                                                                                                 | pairwise | 16       | 0       |
| ADM-CUSTOMERS      | Admin console (/admin)                            | Admin section: customers (section bar, tables, actions)                                                                                                                 | pairwise | 16       | 0       |
| ADM-REVIEWS        | Admin console (/admin)                            | Admin section: reviews (section bar, tables, actions)                                                                                                                   | pairwise | 16       | 0       |
| ADM-SUPPORT        | Admin console (/admin)                            | Admin section: support (section bar, tables, actions)                                                                                                                   | pairwise | 16       | 0       |
| ADM-COINS          | Admin console (/admin)                            | Admin section: coins (section bar, tables, actions)                                                                                                                     | pairwise | 16       | 0       |
| ADM-CONTENT        | Admin console (/admin)                            | Admin section: content (section bar, tables, actions)                                                                                                                   | pairwise | 16       | 0       |
| ADM-LAYOUT         | Admin console (/admin)                            | Admin section: layout (section bar, tables, actions)                                                                                                                    | pairwise | 16       | 0       |
| ADM-SETTINGS       | Admin console (/admin)                            | Admin section: settings (section bar, tables, actions)                                                                                                                  | pairwise | 16       | 0       |
| ADM-NOTIFICATIONS  | Admin console (/admin)                            | Admin section: notifications (section bar, tables, actions)                                                                                                             | pairwise | 16       | 0       |
| NAV-HEADER         | Navigation                                        | Header nav (1024 px and up): current item, hover, focus, every role and route                                                                                           | cross    | 31       | 2       |
| NAV-TABBAR         | Navigation                                        | Bottom tab bar (under 1024 px): current tab, long Hindi labels, every role, walk                                                                                        | cross    | 26       | 2       |
| NAV-ACCOUNT        | Navigation                                        | Account section bar: current section on each of the nine sections (scrolls on phones)                                                                                   | cross    | 72       | 0       |
| NAV-ADMIN          | Navigation                                        | Admin section bar: current section on each demo section (scrolls on phones, column from 1024 px)                                                                        | cross    | 120      | 0       |
| NAV-CATEGORY       | Navigation                                        | Shop category chips (scroll row): current chip, every chip applies its filter                                                                                           | pairwise | 24       | 0       |
| NAV-FOOTER         | Navigation                                        | Footer links: every link opens its page (help, policies, partners, support)                                                                                             | pairwise | 16       | 0       |
| ADM-PARTNERS-TABS  | Admin console (/admin/partners)                   | Partners: invites, price requests, agreement card, shop / workshop / mechanic tabs, pause prompt                                                                        | pairwise | 25       | 0       |
| API-SVC-HOMEFIND   | Workshop finder (/workshops), real sign-in        | Mode switch (at the workshop / at my home), saved-address picker, home listing with the visit fee: none, some, at the radius edge                                       | pairwise | 8        | 0       |
| API-SVC-HOMEREQ    | Service request (/service/{code}), real sign-in   | Home visit panel: mechanic, rating, address, visit fee, arrival code (shown / locked / used), offer to move (waiting / accepted / declined), visit-fee line on the bill | pairwise | 72       | 0       |
| API-WS-HOMEJOB     | Workshop portal (/partner/workshop), real sign-in | Home servicing settings card; new home request (mechanic name); arrival entry (code and odometer: right / wrong / locked); offer to move; fee due after a declined move | pairwise | 56       | 0       |
| API-ADM-REFUNDQ    | Admin console (/admin/refunds)                    | Refund queue: view buttons, list rows, detail (approve / decline with reason / pay by hand with UTR), alerts                                                            | pairwise | 65       | 0       |
| API-ORD-REFUNDLINE | Order page (/orders/{code})                       | Refund status line under a part: under review, processing, refunded, declined, failed (+ support link)                                                                  | pairwise | 48       | 0       |
| API-SHOP-PORTAL    | Shop portal (/partner/shop), real sign-in         | Orders from the API with the give-up form, the shop's warnings, its hours and standing, its agreement                                                                   | pairwise | 63       | 0       |
| API-ADM-SHOPS      | Admin → Partners → Shops, real sign-in            | Shop list with status filter and one shop open: profile (hours), PIN codes, products, standing, warnings (pause prompt), access                                         | pairwise | 58       | 0       |
| API-ADM-QUEUE      | Admin → Orders (needs routing), real sign-in      | Reroute queue card with the shop's give-up reason and the "gave this order up before" tag                                                                               | pairwise | 56       | 0       |
| API-ADM-ERRORS     | Admin → Errors, real sign-in                      | Sentry issues of the website and the API: not connected, none, many, one project down                                                                                   | pairwise | 48       | 0       |
| API-ADM-ANALYTICS  | Admin → Analytics, real sign-in                   | Dashboard: KPI tiles, daily chart, funnel, top lists, areas, shop and workshop tables, range and city                                                                   | pairwise | 40       | 0       |
| API-ADM-COINS      | Admin → Coins, real sign-in                       | Coin activity list (earn, redeem, adjust, expire, restore), account look-up and adjust form                                                                             | pairwise | 40       | 0       |
| API-ADM-REVIEWS    | Admin → Reviews, real sign-in                     | Review moderation queue: pending / approved / hidden, long text, hide reasons                                                                                           | pairwise | 40       | 0       |
| API-ADM-QUOTES     | Admin → Bulk quotes, real sign-in                 | Quote desk: queue views, every quote status, offer and order chips                                                                                                      | pairwise | 32       | 0       |
| API-NAV-ADMIN      | Navigation, real sign-in                          | Admin section bar with every real-mode section (Analytics, Refunds, Errors included): current item, scroll, walk                                                        | cross    | 144      | 0       |
| API-NAV-ACCOUNT    | Navigation, real sign-in                          | Account section bar in a real-sign-in build: current item, scroll, walk                                                                                                 | cross    | 72       | 0       |
| **Total**          |                                                   |                                                                                                                                                                         |          | **2951** | **92**  |

## Chrome

### CHR-HEADER — Header (brand, nav, search, language, theme, account, cart pill)

Full cross of the high-risk dimensions, the rest pairwise; 26 states; scope `header.sticky`.

- [ ] CHR-HEADER-001 · 320px · light · en · signed out · world=empty · / · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-HEADER-002 · 320px · dark · hi · customer · world=empty · /shop · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] CHR-HEADER-003 · 390px · dark · en · signed out · world=empty · /shop · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-HEADER-004 · 390px · light · hi · customer · world=empty · /account · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] CHR-HEADER-005 · 480px · light · hi · signed out · world=empty · / · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe
- [ ] CHR-HEADER-006 · 480px · dark · en · customer · world=empty · /account · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-HEADER-007 · 768px · light · en · signed out · world=empty · /shop · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-HEADER-008 · 768px · dark · hi · customer · world=empty · / · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-HEADER-009 · 1024px · light · en · signed out · world=empty · / · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-HEADER-010 · 1024px · dark · hi · customer · world=empty · /shop · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] CHR-HEADER-011 · 1280px · light · en · signed out · world=empty · / · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-HEADER-012 · 1280px · dark · hi · customer · world=empty · /account · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-HEADER-013 · 1440px · light · en · signed out · world=empty · /shop · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-HEADER-014 · 1440px · dark · hi · customer · world=empty · /account · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-HEADER-015 · 1920px · light · en · signed out · world=empty · / · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-HEADER-016 · 1920px · dark · hi · customer · world=empty · /account · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-HEADER-017 · 320px · light · en · signed out · world=empty · /shop · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-HEADER-018 · 390px · dark · hi · customer · world=empty · / · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] CHR-HEADER-019 · 480px · light · en · signed out · world=empty · /shop · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-HEADER-020 · 768px · dark · hi · customer · world=empty · /account · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-HEADER-021 · 1024px · light · en · signed out · world=empty · / · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-HEADER-022 · 1280px · dark · hi · customer · world=empty · /shop · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-HEADER-023 · 1440px · light · en · signed out · world=empty · / · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-HEADER-024 · 1920px · dark · hi · customer · world=empty · /shop · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-HEADER-025 · 320px · light · en · customer · world=empty · /account · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-HEADER-026 · 1024px · dark · hi · customer · world=empty · /account · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core

### CHR-TABBAR — Bottom tab bar (under 1024 px)

Pairwise (all pairs of values); 20 states; scope `nav.fixed`.

- [ ] CHR-TABBAR-001 · 320px · light · en · signed out · world=empty · / · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-TABBAR-002 · 320px · dark · hi · customer · world=empty · /shop · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-TABBAR-003 · 390px · light · hi · signed out · world=empty · /workshops · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] CHR-TABBAR-004 · 390px · dark · en · customer · world=empty · /account · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-TABBAR-005 · 480px · light · en · customer · world=empty · /cart · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-TABBAR-006 · 480px · dark · hi · signed out · world=empty · / · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-TABBAR-007 · 768px · light · en · signed out · world=empty · /shop · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-TABBAR-008 · 768px · dark · hi · customer · world=empty · /workshops · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-TABBAR-009 · 320px · light · en · signed out · world=empty · /workshops · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-TABBAR-010 · 320px · light · hi · customer · world=empty · /account · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-TABBAR-011 · 320px · dark · hi · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-TABBAR-012 · 390px · dark · en · customer · world=empty · / · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-TABBAR-013 · 390px · light · en · signed out · world=empty · /shop · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] CHR-TABBAR-014 · 390px · dark · hi · customer · world=empty · /cart · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] CHR-TABBAR-015 · 480px · light · en · signed out · world=empty · /shop · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-TABBAR-016 · 480px · dark · hi · customer · world=empty · /workshops · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-TABBAR-017 · 480px · light · en · customer · world=empty · /account · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-TABBAR-018 · 768px · dark · hi · signed out · world=empty · / · cart=c1 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-TABBAR-019 · 768px · light · en · customer · world=empty · /account · cart=many20 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-TABBAR-020 · 768px · dark · hi · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### CHR-FOOTER — Footer (help, columns, privacy choices, theme)

Pairwise (all pairs of values); 16 states; scope `footer`.

- [ ] CHR-FOOTER-001 · 320px · light · en · signed out · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-FOOTER-002 · 320px · dark · hi · customer · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-FOOTER-003 · 390px · light · hi · signed out · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-FOOTER-004 · 390px · dark · en · customer · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-FOOTER-005 · 480px · light · en · customer · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-FOOTER-006 · 480px · dark · hi · signed out · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-FOOTER-007 · 768px · light · en · signed out · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-FOOTER-008 · 768px · dark · hi · customer · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-FOOTER-009 · 1024px · light · en · signed out · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-FOOTER-010 · 1024px · dark · hi · customer · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-FOOTER-011 · 1280px · light · en · signed out · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-FOOTER-012 · 1280px · dark · hi · customer · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-FOOTER-013 · 1440px · light · en · signed out · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-FOOTER-014 · 1440px · dark · hi · customer · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-FOOTER-015 · 1920px · light · en · signed out · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-FOOTER-016 · 1920px · dark · hi · customer · world=empty · / · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### CHR-FLOAT — Floating stack: assistant launcher, compare tray, consent banner, tab bar together

Full cross of the high-risk dimensions, the rest pairwise; 24 states; scope `body`.

- [ ] CHR-FLOAT-001 · 320px · light · en · signed out · world=empty · /shop · consent=decided · compare=none · asserts: present overlap covered tap hscroll console axe
- [ ] CHR-FLOAT-002 · 320px · dark · hi · signed out · world=empty · / · consent=open · compare=lub-1 · asserts: present overlap covered tap hscroll console hindi axe · core
- [ ] CHR-FLOAT-003 · 390px · dark · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · consent=decided · compare=lub-4 · asserts: present overlap covered tap hscroll console
- [ ] CHR-FLOAT-004 · 390px · light · hi · signed out · world=empty · /shop · consent=open · compare=none · asserts: present overlap covered tap hscroll console hindi axe · core
- [ ] CHR-FLOAT-005 · 480px · light · en · signed out · world=empty · / · consent=decided · compare=lub-1 · asserts: present overlap covered tap hscroll console axe
- [ ] CHR-FLOAT-006 · 480px · light · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · consent=open · compare=lub-4 · asserts: present overlap covered tap hscroll console hindi
- [ ] CHR-FLOAT-007 · 768px · dark · hi · signed out · world=empty · / · consent=decided · compare=none · asserts: present overlap covered tap hscroll console hindi
- [ ] CHR-FLOAT-008 · 768px · dark · en · signed out · world=empty · /shop · consent=open · compare=lub-1 · asserts: present overlap covered tap hscroll console
- [ ] CHR-FLOAT-009 · 1024px · light · en · signed out · world=empty · /shop · consent=decided · compare=lub-4 · asserts: present overlap covered tap hscroll console axe
- [ ] CHR-FLOAT-010 · 1024px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · consent=open · compare=none · asserts: present overlap covered tap hscroll console hindi
- [ ] CHR-FLOAT-011 · 1280px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · consent=decided · compare=lub-1 · asserts: present overlap covered tap hscroll console
- [ ] CHR-FLOAT-012 · 1280px · dark · hi · signed out · world=empty · / · consent=open · compare=lub-4 · asserts: present overlap covered tap hscroll console hindi
- [ ] CHR-FLOAT-013 · 1440px · light · en · signed out · world=empty · /shop · consent=decided · compare=none · asserts: present overlap covered tap hscroll console axe
- [ ] CHR-FLOAT-014 · 1440px · dark · hi · signed out · world=empty · / · consent=open · compare=lub-1 · asserts: present overlap covered tap hscroll console hindi
- [ ] CHR-FLOAT-015 · 1920px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · consent=decided · compare=lub-4 · asserts: present overlap covered tap hscroll console
- [ ] CHR-FLOAT-016 · 1920px · dark · hi · signed out · world=empty · /shop · consent=open · compare=none · asserts: present overlap covered tap hscroll console hindi
- [ ] CHR-FLOAT-017 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · consent=decided · compare=lub-4 · asserts: present overlap covered tap hscroll console axe
- [ ] CHR-FLOAT-018 · 390px · dark · hi · signed out · world=empty · / · consent=open · compare=lub-1 · asserts: present overlap covered tap hscroll console hindi axe · core
- [ ] CHR-FLOAT-019 · 480px · dark · en · signed out · world=empty · /shop · consent=decided · compare=none · asserts: present overlap covered tap hscroll console
- [ ] CHR-FLOAT-020 · 768px · light · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · consent=open · compare=lub-4 · asserts: present overlap covered tap hscroll console hindi
- [ ] CHR-FLOAT-021 · 1024px · light · en · signed out · world=empty · / · consent=decided · compare=lub-1 · asserts: present overlap covered tap hscroll console axe
- [ ] CHR-FLOAT-022 · 1280px · dark · hi · signed out · world=empty · /shop · consent=open · compare=none · asserts: present overlap covered tap hscroll console hindi
- [ ] CHR-FLOAT-023 · 1440px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · consent=decided · compare=lub-4 · asserts: present overlap covered tap hscroll console
- [ ] CHR-FLOAT-024 · 1920px · dark · hi · signed out · world=empty · / · consent=open · compare=lub-1 · asserts: present overlap covered tap hscroll console hindi

### CHR-ASSIST — Assistant launcher and panel

Pairwise (all pairs of values); 16 states; scope `.assistant-launcher, [role="dialog"]`.

- [ ] CHR-ASSIST-001 · 320px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-ASSIST-002 · 320px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-ASSIST-003 · 390px · light · hi · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-ASSIST-004 · 390px · dark · en · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-ASSIST-005 · 480px · light · en · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-ASSIST-006 · 480px · dark · hi · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-ASSIST-007 · 768px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-ASSIST-008 · 768px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-ASSIST-009 · 1024px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-ASSIST-010 · 1024px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-ASSIST-011 · 1280px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-ASSIST-012 · 1280px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-ASSIST-013 · 1440px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-ASSIST-014 · 1440px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHR-ASSIST-015 · 1920px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHR-ASSIST-016 · 1920px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### CHR-CONSENT — Cookie and consent banner

Pairwise (all pairs of values); 16 states; scope `[data-testid="consent-banner"]`.

- [ ] CHR-CONSENT-001 · 320px · light · en · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-CONSENT-002 · 320px · dark · hi · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] CHR-CONSENT-003 · 390px · light · hi · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] CHR-CONSENT-004 · 390px · dark · en · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-CONSENT-005 · 480px · light · en · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-CONSENT-006 · 480px · dark · hi · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] CHR-CONSENT-007 · 768px · light · en · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-CONSENT-008 · 768px · dark · hi · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] CHR-CONSENT-009 · 1024px · light · en · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-CONSENT-010 · 1024px · dark · hi · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] CHR-CONSENT-011 · 1280px · light · en · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-CONSENT-012 · 1280px · dark · hi · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] CHR-CONSENT-013 · 1440px · light · en · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-CONSENT-014 · 1440px · dark · hi · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] CHR-CONSENT-015 · 1920px · light · en · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHR-CONSENT-016 · 1920px · dark · hi · signed out · world=empty · / · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi

## Home

### HOME-HERO — Hero with search

Pairwise (all pairs of values); 25 states; scope `section[aria-labelledby="hero-title"]`.

- [ ] HOME-HERO-001 · 320px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-HERO-002 · 320px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-003 · 390px · light · hi · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-004 · 390px · dark · en · customer · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-HERO-005 · 480px · light · en · customer · world=cart · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-HERO-006 · 480px · dark · hi · signed out · world=busy · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-007 · 768px · light · en · signed out · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-HERO-008 · 768px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-009 · 1024px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-HERO-010 · 1024px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-011 · 1280px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-HERO-012 · 1280px · dark · hi · customer · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-013 · 1440px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-HERO-014 · 1440px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-015 · 1920px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-HERO-016 · 1920px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-017 · 320px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-HERO-018 · 390px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-019 · 480px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-HERO-020 · 768px · dark · hi · customer · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-021 · 1024px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-HERO-022 · 1280px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-023 · 1440px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-HERO-024 · 1920px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-HERO-025 · 390px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe

### HOME-TRUST — Trust strip

Pairwise (all pairs of values); 25 states; scope `main section[aria-label]:not([aria-labelledby])`.

- [ ] HOME-TRUST-001 · 320px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-TRUST-002 · 320px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-003 · 390px · light · hi · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-004 · 390px · dark · en · customer · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-TRUST-005 · 480px · light · en · customer · world=cart · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-TRUST-006 · 480px · dark · hi · signed out · world=busy · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-007 · 768px · light · en · signed out · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-TRUST-008 · 768px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-009 · 1024px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-TRUST-010 · 1024px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-011 · 1280px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-TRUST-012 · 1280px · dark · hi · customer · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-013 · 1440px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-TRUST-014 · 1440px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-015 · 1920px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-TRUST-016 · 1920px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-017 · 320px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-TRUST-018 · 390px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-019 · 480px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-TRUST-020 · 768px · dark · hi · customer · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-021 · 1024px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-TRUST-022 · 1280px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-023 · 1440px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-TRUST-024 · 1920px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-TRUST-025 · 390px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe

### HOME-CATS — Category tiles

Pairwise (all pairs of values); 25 states; scope `section[aria-labelledby="categories-title"]`.

- [ ] HOME-CATS-001 · 320px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-CATS-002 · 320px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-003 · 390px · light · hi · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-004 · 390px · dark · en · customer · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-CATS-005 · 480px · light · en · customer · world=cart · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-CATS-006 · 480px · dark · hi · signed out · world=busy · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-007 · 768px · light · en · signed out · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-CATS-008 · 768px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-009 · 1024px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-CATS-010 · 1024px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-011 · 1280px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-CATS-012 · 1280px · dark · hi · customer · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-013 · 1440px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-CATS-014 · 1440px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-015 · 1920px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-CATS-016 · 1920px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-017 · 320px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-CATS-018 · 390px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-019 · 480px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-CATS-020 · 768px · dark · hi · customer · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-021 · 1024px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-CATS-022 · 1280px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-023 · 1440px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-CATS-024 · 1920px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-CATS-025 · 390px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe

### HOME-RANGE — Product range (cards without compare)

Pairwise (all pairs of values); 25 states; scope `section[aria-labelledby="range-title"]`.

- [ ] HOME-RANGE-001 · 320px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] HOME-RANGE-002 · 320px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-003 · 390px · light · hi · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi axe · core
- [ ] HOME-RANGE-004 · 390px · dark · en · customer · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe · core
- [ ] HOME-RANGE-005 · 480px · light · en · customer · world=cart · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] HOME-RANGE-006 · 480px · dark · hi · signed out · world=busy · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-007 · 768px · light · en · signed out · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] HOME-RANGE-008 · 768px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-009 · 1024px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] HOME-RANGE-010 · 1024px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-011 · 1280px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] HOME-RANGE-012 · 1280px · dark · hi · customer · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-013 · 1440px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe · core
- [ ] HOME-RANGE-014 · 1440px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi axe · core
- [ ] HOME-RANGE-015 · 1920px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] HOME-RANGE-016 · 1920px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-017 · 320px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] HOME-RANGE-018 · 390px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi axe · core
- [ ] HOME-RANGE-019 · 480px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] HOME-RANGE-020 · 768px · dark · hi · customer · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-021 · 1024px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] HOME-RANGE-022 · 1280px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-023 · 1440px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe · core
- [ ] HOME-RANGE-024 · 1920px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] HOME-RANGE-025 · 390px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe · core

### HOME-ROUTE — How an order travels (order route)

Pairwise (all pairs of values); 25 states; scope `section[aria-labelledby="route-title"]`.

- [ ] HOME-ROUTE-001 · 320px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-ROUTE-002 · 320px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-003 · 390px · light · hi · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-004 · 390px · dark · en · customer · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-ROUTE-005 · 480px · light · en · customer · world=cart · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-ROUTE-006 · 480px · dark · hi · signed out · world=busy · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-007 · 768px · light · en · signed out · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-ROUTE-008 · 768px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-009 · 1024px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-ROUTE-010 · 1024px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-011 · 1280px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-ROUTE-012 · 1280px · dark · hi · customer · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-013 · 1440px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-ROUTE-014 · 1440px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-015 · 1920px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-ROUTE-016 · 1920px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-017 · 320px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-ROUTE-018 · 390px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-019 · 480px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-ROUTE-020 · 768px · dark · hi · customer · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-021 · 1024px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-ROUTE-022 · 1280px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-023 · 1440px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-ROUTE-024 · 1920px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-ROUTE-025 · 390px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe

### HOME-SERVICE — Workshop service section

Pairwise (all pairs of values); 25 states; scope `section[aria-labelledby="service-title"]`.

- [ ] HOME-SERVICE-001 · 320px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-SERVICE-002 · 320px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-003 · 390px · light · hi · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-004 · 390px · dark · en · customer · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-SERVICE-005 · 480px · light · en · customer · world=cart · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-SERVICE-006 · 480px · dark · hi · signed out · world=busy · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-007 · 768px · light · en · signed out · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-SERVICE-008 · 768px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-009 · 1024px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-SERVICE-010 · 1024px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-011 · 1280px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-SERVICE-012 · 1280px · dark · hi · customer · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-013 · 1440px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-SERVICE-014 · 1440px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-015 · 1920px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-SERVICE-016 · 1920px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-017 · 320px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-SERVICE-018 · 390px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-019 · 480px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-SERVICE-020 · 768px · dark · hi · customer · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-021 · 1024px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-SERVICE-022 · 1280px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-023 · 1440px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-SERVICE-024 · 1920px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-SERVICE-025 · 390px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe

### HOME-WORKSHOPS — Top workshops

Pairwise (all pairs of values); 25 states; scope `section[aria-labelledby="top-workshops"]`.

- [ ] HOME-WORKSHOPS-001 · 320px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-WORKSHOPS-002 · 320px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-003 · 390px · light · hi · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-004 · 390px · dark · en · customer · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-WORKSHOPS-005 · 480px · light · en · customer · world=cart · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-WORKSHOPS-006 · 480px · dark · hi · signed out · world=busy · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-007 · 768px · light · en · signed out · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-WORKSHOPS-008 · 768px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-009 · 1024px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-WORKSHOPS-010 · 1024px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-011 · 1280px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-WORKSHOPS-012 · 1280px · dark · hi · customer · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-013 · 1440px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-WORKSHOPS-014 · 1440px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-015 · 1920px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-WORKSHOPS-016 · 1920px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-017 · 320px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-WORKSHOPS-018 · 390px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-019 · 480px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-WORKSHOPS-020 · 768px · dark · hi · customer · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-021 · 1024px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-WORKSHOPS-022 · 1280px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-023 · 1440px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-WORKSHOPS-024 · 1920px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-WORKSHOPS-025 · 390px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe

### HOME-PARTNER — Partner teaser

Pairwise (all pairs of values); 25 states; scope `section[aria-labelledby="partners-teaser"]`.

- [ ] HOME-PARTNER-001 · 320px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-PARTNER-002 · 320px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-003 · 390px · light · hi · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-004 · 390px · dark · en · customer · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-PARTNER-005 · 480px · light · en · customer · world=cart · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-PARTNER-006 · 480px · dark · hi · signed out · world=busy · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-007 · 768px · light · en · signed out · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-PARTNER-008 · 768px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-009 · 1024px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-PARTNER-010 · 1024px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-011 · 1280px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-PARTNER-012 · 1280px · dark · hi · customer · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-013 · 1440px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-PARTNER-014 · 1440px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-015 · 1920px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-PARTNER-016 · 1920px · dark · hi · customer · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-017 · 320px · light · en · signed out · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-PARTNER-018 · 390px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-019 · 480px · light · en · signed out · world=empty · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-PARTNER-020 · 768px · dark · hi · customer · world=busy · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-021 · 1024px · light · en · signed out · world=cart · / · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-PARTNER-022 · 1280px · dark · hi · customer · world=empty · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-023 · 1440px · light · en · signed out · world=busy · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-PARTNER-024 · 1920px · dark · hi · customer · world=cart · / · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-PARTNER-025 · 390px · light · en · signed out · world=empty · / · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe

### HOME-FAQ — FAQ (details/summary accordion)

Pairwise (all pairs of values); 24 states; scope `section[aria-labelledby="faq-title"]`.

- [ ] HOME-FAQ-001 · 320px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-FAQ-002 · 320px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-003 · 390px · light · hi · signed out · world=empty · / · open=all · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-004 · 390px · dark · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-FAQ-005 · 480px · light · en · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-FAQ-006 · 480px · dark · hi · signed out · world=empty · / · open=all · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-007 · 768px · light · en · signed out · world=empty · / · open=all · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-FAQ-008 · 768px · dark · hi · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-009 · 1024px · light · en · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-FAQ-010 · 1024px · dark · hi · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-011 · 1280px · light · en · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-FAQ-012 · 1280px · dark · hi · signed out · world=empty · / · open=all · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-013 · 1440px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-FAQ-014 · 1440px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-015 · 1920px · light · en · signed out · world=empty · / · open=all · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-FAQ-016 · 1920px · dark · hi · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-017 · 320px · light · en · signed out · world=empty · / · open=all · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-FAQ-018 · 390px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-019 · 480px · light · en · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-FAQ-020 · 768px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-021 · 1024px · light · en · signed out · world=empty · / · open=all · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] HOME-FAQ-022 · 1280px · dark · hi · signed out · world=empty · / · open=closed · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] HOME-FAQ-023 · 1440px · light · en · signed out · world=empty · / · open=all · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] HOME-FAQ-024 · 1920px · dark · hi · signed out · world=empty · / · open=first · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Shop (/shop)

### SHOP-CARD — Product card × compare list × cart (full cross)

Full cross of the high-risk dimensions, the rest pairwise; 128 states; scope `main article`.

- [ ] SHOP-CARD-001 · 320px · light · en · signed out · world=empty · /shop · compare=none · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-002 · 320px · dark · hi · customer · world=empty · /shop · compare=none · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-003 · 320px · light · hi · signed out · world=empty · /shop · compare=none · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-004 · 320px · dark · en · customer · world=empty · /shop · compare=none · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-005 · 320px · dark · hi · signed out · world=empty · /shop · compare=lub-1 · cart=none · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi axe
- [ ] SHOP-CARD-006 · 320px · light · en · customer · world=empty · /shop · compare=lub-1 · cart=c1 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-007 · 320px · dark · en · customer · world=empty · /shop · compare=lub-1 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-008 · 320px · light · hi · signed out · world=empty · /shop · compare=lub-1 · cart=c99 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-009 · 320px · light · en · customer · world=empty · /shop · compare=lub-4 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-010 · 320px · dark · hi · signed out · world=empty · /shop · compare=lub-4 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-011 · 320px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=mixed · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-012 · 320px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c99 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-013 · 320px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=none · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-014 · 320px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c1 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-015 · 320px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-016 · 320px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c99 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-017 · 390px · light · en · signed out · world=empty · /shop · compare=none · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-018 · 390px · dark · hi · customer · world=empty · /shop · compare=none · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-019 · 390px · light · en · signed out · world=empty · /shop · compare=none · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-020 · 390px · dark · hi · customer · world=empty · /shop · compare=none · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-021 · 390px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-022 · 390px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-023 · 390px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-024 · 390px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-025 · 390px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-026 · 390px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-027 · 390px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-028 · 390px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-029 · 390px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-030 · 390px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi axe · core
- [ ] SHOP-CARD-031 · 390px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-032 · 390px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi axe · core
- [ ] SHOP-CARD-033 · 480px · light · en · signed out · world=empty · /shop · compare=none · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-034 · 480px · dark · hi · customer · world=empty · /shop · compare=none · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-035 · 480px · light · en · signed out · world=empty · /shop · compare=none · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-036 · 480px · dark · hi · customer · world=empty · /shop · compare=none · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-037 · 480px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-038 · 480px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-039 · 480px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-040 · 480px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-041 · 480px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-042 · 480px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-043 · 480px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-044 · 480px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-045 · 480px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-046 · 480px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-047 · 480px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-048 · 480px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-049 · 768px · light · en · signed out · world=empty · /shop · compare=none · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-050 · 768px · dark · hi · customer · world=empty · /shop · compare=none · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-051 · 768px · light · en · signed out · world=empty · /shop · compare=none · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-052 · 768px · dark · hi · customer · world=empty · /shop · compare=none · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-053 · 768px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-054 · 768px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-055 · 768px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-056 · 768px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-057 · 768px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-058 · 768px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-059 · 768px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-060 · 768px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-061 · 768px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-062 · 768px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-063 · 768px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-064 · 768px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-065 · 1024px · light · en · signed out · world=empty · /shop · compare=none · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-066 · 1024px · dark · hi · customer · world=empty · /shop · compare=none · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-067 · 1024px · light · en · signed out · world=empty · /shop · compare=none · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-068 · 1024px · dark · hi · customer · world=empty · /shop · compare=none · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-069 · 1024px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-070 · 1024px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-071 · 1024px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-072 · 1024px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-073 · 1024px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-074 · 1024px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-075 · 1024px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-076 · 1024px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-077 · 1024px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-078 · 1024px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-079 · 1024px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-080 · 1024px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-081 · 1280px · light · en · signed out · world=empty · /shop · compare=none · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-082 · 1280px · dark · hi · customer · world=empty · /shop · compare=none · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-083 · 1280px · light · en · signed out · world=empty · /shop · compare=none · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-084 · 1280px · dark · hi · customer · world=empty · /shop · compare=none · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-085 · 1280px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-086 · 1280px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-087 · 1280px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-088 · 1280px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-089 · 1280px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-090 · 1280px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-091 · 1280px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-092 · 1280px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-093 · 1280px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-094 · 1280px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-095 · 1280px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-096 · 1280px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-097 · 1440px · light · en · signed out · world=empty · /shop · compare=none · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-098 · 1440px · dark · hi · customer · world=empty · /shop · compare=none · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-099 · 1440px · light · en · signed out · world=empty · /shop · compare=none · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-100 · 1440px · dark · hi · customer · world=empty · /shop · compare=none · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-101 · 1440px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-102 · 1440px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-103 · 1440px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-104 · 1440px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-105 · 1440px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-106 · 1440px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-107 · 1440px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-108 · 1440px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-109 · 1440px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-110 · 1440px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi axe · core
- [ ] SHOP-CARD-111 · 1440px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-CARD-112 · 1440px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi axe · core
- [ ] SHOP-CARD-113 · 1920px · light · en · signed out · world=empty · /shop · compare=none · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-114 · 1920px · dark · hi · customer · world=empty · /shop · compare=none · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-115 · 1920px · light · en · signed out · world=empty · /shop · compare=none · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-116 · 1920px · dark · hi · customer · world=empty · /shop · compare=none · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-117 · 1920px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-118 · 1920px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-119 · 1920px · light · en · signed out · world=empty · /shop · compare=lub-1 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-120 · 1920px · dark · hi · customer · world=empty · /shop · compare=lub-1 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-121 · 1920px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-122 · 1920px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-123 · 1920px · light · en · signed out · world=empty · /shop · compare=lub-4 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-124 · 1920px · dark · hi · customer · world=empty · /shop · compare=lub-4 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-125 · 1920px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-CARD-126 · 1920px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-CARD-127 · 1920px · light · en · signed out · world=empty · /shop · compare=bat-2 · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-CARD-128 · 1920px · dark · hi · customer · world=empty · /shop · compare=bat-2 · cart=c99 · stress=mixed-shape · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi

### SHOP-ACTION — Card actions clicked, then every card re-checked (cross-entity sync)

Full cross of the high-risk dimensions, the rest pairwise; 40 states; scope `main article`.

- [ ] SHOP-ACTION-001 · 320px · light · en · signed out · world=empty · /shop · action=compare-other · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-002 · 320px · dark · hi · signed out · world=empty · /shop · action=start-new · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-003 · 320px · light · hi · signed out · world=empty · /shop · action=add · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-004 · 320px · dark · en · signed out · world=empty · /shop · action=inc · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-005 · 320px · light · en · signed out · world=empty · /shop · action=dec-remove · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-006 · 390px · dark · hi · signed out · world=empty · /shop · action=compare-other · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi axe · core
- [ ] SHOP-ACTION-007 · 390px · light · en · signed out · world=empty · /shop · action=start-new · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] SHOP-ACTION-008 · 390px · dark · en · signed out · world=empty · /shop · action=add · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-009 · 390px · light · hi · signed out · world=empty · /shop · action=inc · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi axe
- [ ] SHOP-ACTION-010 · 390px · dark · hi · signed out · world=empty · /shop · action=dec-remove · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-011 · 480px · light · en · signed out · world=empty · /shop · action=compare-other · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-012 · 480px · dark · hi · signed out · world=empty · /shop · action=start-new · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-013 · 480px · light · en · signed out · world=empty · /shop · action=add · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-014 · 480px · dark · hi · signed out · world=empty · /shop · action=inc · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-015 · 480px · light · en · signed out · world=empty · /shop · action=dec-remove · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-016 · 768px · dark · hi · signed out · world=empty · /shop · action=compare-other · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-017 · 768px · light · en · signed out · world=empty · /shop · action=start-new · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-018 · 768px · dark · hi · signed out · world=empty · /shop · action=add · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-019 · 768px · light · en · signed out · world=empty · /shop · action=inc · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-020 · 768px · dark · hi · signed out · world=empty · /shop · action=dec-remove · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-021 · 1024px · light · en · signed out · world=empty · /shop · action=compare-other · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-022 · 1024px · dark · hi · signed out · world=empty · /shop · action=start-new · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-023 · 1024px · light · en · signed out · world=empty · /shop · action=add · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-024 · 1024px · dark · hi · signed out · world=empty · /shop · action=inc · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-025 · 1024px · light · en · signed out · world=empty · /shop · action=dec-remove · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-026 · 1280px · dark · hi · signed out · world=empty · /shop · action=compare-other · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-027 · 1280px · light · en · signed out · world=empty · /shop · action=start-new · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-028 · 1280px · dark · hi · signed out · world=empty · /shop · action=add · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-029 · 1280px · light · en · signed out · world=empty · /shop · action=inc · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-030 · 1280px · dark · hi · signed out · world=empty · /shop · action=dec-remove · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-031 · 1440px · light · en · signed out · world=empty · /shop · action=compare-other · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-032 · 1440px · dark · hi · signed out · world=empty · /shop · action=start-new · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-033 · 1440px · light · en · signed out · world=empty · /shop · action=add · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-034 · 1440px · dark · hi · signed out · world=empty · /shop · action=inc · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-035 · 1440px · light · en · signed out · world=empty · /shop · action=dec-remove · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-036 · 1920px · dark · hi · signed out · world=empty · /shop · action=compare-other · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-037 · 1920px · light · en · signed out · world=empty · /shop · action=start-new · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] SHOP-ACTION-038 · 1920px · dark · hi · signed out · world=empty · /shop · action=add · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] SHOP-ACTION-039 · 1920px · light · en · signed out · world=empty · /shop · action=inc · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] SHOP-ACTION-040 · 1920px · dark · hi · signed out · world=empty · /shop · action=dec-remove · compare=bat-2 · cart=c2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi

### SHOP-FILTERS — Search, category chips, vehicle chips, sort, results count, empty result

Pairwise (all pairs of values); 48 states; scope `main`.

- [ ] SHOP-FILTERS-001 · 320px · light · en · signed out · world=empty · /shop · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe · core
- [ ] SHOP-FILTERS-002 · 320px · dark · hi · signed out · world=empty · /shop?category=lubricants · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi axe · core
- [ ] SHOP-FILTERS-003 · 390px · light · hi · signed out · world=empty · /shop?category=ev-essentials&sort=price_desc · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-004 · 390px · dark · en · signed out · world=empty · /shop?vehicle=2W&sort=price_asc · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-005 · 480px · light · en · signed out · world=empty · /shop?q=battery&vehicle=4W · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-006 · 480px · dark · hi · signed out · world=empty · /shop?q=zzzz-no-match · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-007 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-008 · 768px · dark · hi · signed out · world=empty · /shop · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-009 · 1024px · light · en · signed out · world=empty · /shop?q=zzzz-no-match · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-010 · 1024px · dark · hi · signed out · world=empty · /shop?q=battery&vehicle=4W · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-011 · 1280px · light · en · signed out · world=empty · /shop?category=ev-essentials&sort=price_desc · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-012 · 1280px · dark · hi · signed out · world=empty · /shop?vehicle=2W&sort=price_asc · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-013 · 1440px · light · en · signed out · world=empty · /shop?vehicle=2W&sort=price_asc · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-014 · 1440px · dark · hi · signed out · world=empty · /shop?category=ev-essentials&sort=price_desc · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-015 · 1920px · light · en · signed out · world=empty · /shop · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-016 · 1920px · dark · hi · signed out · world=empty · /shop?category=lubricants · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-017 · 320px · light · en · signed out · world=empty · /shop?category=ev-essentials&sort=price_desc · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe · core
- [ ] SHOP-FILTERS-018 · 320px · dark · hi · signed out · world=empty · /shop?vehicle=2W&sort=price_asc · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi axe · core
- [ ] SHOP-FILTERS-019 · 320px · light · en · signed out · world=empty · /shop?q=battery&vehicle=4W · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe · core
- [ ] SHOP-FILTERS-020 · 320px · dark · hi · signed out · world=empty · /shop?q=zzzz-no-match · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi axe · core
- [ ] SHOP-FILTERS-021 · 390px · light · en · signed out · world=empty · /shop · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-022 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-023 · 390px · light · en · signed out · world=empty · /shop?q=battery&vehicle=4W · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-024 · 390px · dark · hi · signed out · world=empty · /shop?q=zzzz-no-match · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-025 · 480px · light · en · signed out · world=empty · /shop · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-026 · 480px · dark · hi · signed out · world=empty · /shop?category=lubricants · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-027 · 480px · light · en · signed out · world=empty · /shop?category=ev-essentials&sort=price_desc · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-028 · 480px · dark · hi · signed out · world=empty · /shop?vehicle=2W&sort=price_asc · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-029 · 768px · light · en · signed out · world=empty · /shop?category=ev-essentials&sort=price_desc · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-030 · 768px · dark · hi · signed out · world=empty · /shop?vehicle=2W&sort=price_asc · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-031 · 768px · light · en · signed out · world=empty · /shop?q=battery&vehicle=4W · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-032 · 768px · dark · hi · signed out · world=empty · /shop?q=zzzz-no-match · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-033 · 1024px · light · en · signed out · world=empty · /shop · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-034 · 1024px · dark · hi · signed out · world=empty · /shop?category=lubricants · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-035 · 1024px · light · en · signed out · world=empty · /shop?category=ev-essentials&sort=price_desc · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-036 · 1024px · dark · hi · signed out · world=empty · /shop?vehicle=2W&sort=price_asc · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-037 · 1280px · light · en · signed out · world=empty · /shop · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-038 · 1280px · dark · hi · signed out · world=empty · /shop?category=lubricants · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-039 · 1280px · light · en · signed out · world=empty · /shop?q=battery&vehicle=4W · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-040 · 1280px · dark · hi · signed out · world=empty · /shop?q=zzzz-no-match · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-041 · 1440px · light · en · signed out · world=empty · /shop · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-042 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-043 · 1440px · light · en · signed out · world=empty · /shop?q=battery&vehicle=4W · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-044 · 1440px · dark · hi · signed out · world=empty · /shop?q=zzzz-no-match · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-045 · 1920px · light · en · signed out · world=empty · /shop?category=ev-essentials&sort=price_desc · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] SHOP-FILTERS-046 · 1920px · dark · hi · signed out · world=empty · /shop?vehicle=2W&sort=price_asc · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] SHOP-FILTERS-047 · 1920px · light · en · signed out · world=empty · /shop?q=battery&vehicle=4W · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] SHOP-FILTERS-048 · 1920px · dark · hi · signed out · world=empty · /shop?q=zzzz-no-match · compare=lub-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### SHOP-POPOVER — Quick-details popover (ⓘ) on the first and the last card of a row

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] SHOP-POPOVER-001 · 320px · light · en · signed out · world=empty · /shop · open=first · asserts: present inside overlap clipped tap hscroll focus console axe
- [ ] SHOP-POPOVER-002 · 320px · dark · hi · signed out · world=empty · /shop · open=last · asserts: present inside overlap clipped tap hscroll focus console hindi
- [ ] SHOP-POPOVER-003 · 390px · light · hi · signed out · world=empty · /shop · open=first · asserts: present inside overlap clipped tap hscroll focus console hindi
- [ ] SHOP-POPOVER-004 · 390px · dark · en · signed out · world=empty · /shop · open=last · asserts: present inside overlap clipped tap hscroll focus console
- [ ] SHOP-POPOVER-005 · 480px · light · en · signed out · world=empty · /shop · open=last · asserts: present inside overlap clipped tap hscroll focus console axe
- [ ] SHOP-POPOVER-006 · 480px · dark · hi · signed out · world=empty · /shop · open=first · asserts: present inside overlap clipped tap hscroll focus console hindi
- [ ] SHOP-POPOVER-007 · 768px · light · en · signed out · world=empty · /shop · open=first · asserts: present inside overlap clipped tap hscroll focus console
- [ ] SHOP-POPOVER-008 · 768px · dark · hi · signed out · world=empty · /shop · open=last · asserts: present inside overlap clipped tap hscroll focus console hindi
- [ ] SHOP-POPOVER-009 · 1024px · light · en · signed out · world=empty · /shop · open=first · asserts: present inside overlap clipped tap hscroll focus console axe
- [ ] SHOP-POPOVER-010 · 1024px · dark · hi · signed out · world=empty · /shop · open=last · asserts: present inside overlap clipped tap hscroll focus console hindi
- [ ] SHOP-POPOVER-011 · 1280px · light · en · signed out · world=empty · /shop · open=first · asserts: present inside overlap clipped tap hscroll focus console
- [ ] SHOP-POPOVER-012 · 1280px · dark · hi · signed out · world=empty · /shop · open=last · asserts: present inside overlap clipped tap hscroll focus console hindi
- [ ] SHOP-POPOVER-013 · 1440px · light · en · signed out · world=empty · /shop · open=first · asserts: present inside overlap clipped tap hscroll focus console axe
- [ ] SHOP-POPOVER-014 · 1440px · dark · hi · signed out · world=empty · /shop · open=last · asserts: present inside overlap clipped tap hscroll focus console hindi
- [ ] SHOP-POPOVER-015 · 1920px · light · en · signed out · world=empty · /shop · open=first · asserts: present inside overlap clipped tap hscroll focus console
- [ ] SHOP-POPOVER-016 · 1920px · dark · hi · signed out · world=empty · /shop · open=last · asserts: present inside overlap clipped tap hscroll focus console hindi

### SHOP-TRAY — Compare tray (count, open, clear) over the listing

Full cross of the high-risk dimensions, the rest pairwise; 32 states; scope `[data-compare-tray]`.

- [ ] SHOP-TRAY-001 · 320px · light · en · signed out · world=empty · /shop · compare=lub-1 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] SHOP-TRAY-002 · 320px · dark · hi · signed out · world=empty · /shop · compare=lub-2 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-003 · 320px · light · hi · signed out · world=empty · /shop · compare=lub-4 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] SHOP-TRAY-004 · 320px · dark · en · signed out · world=empty · /shop · compare=spa-3 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] SHOP-TRAY-005 · 390px · dark · hi · signed out · world=empty · /shop · compare=lub-1 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe
- [ ] SHOP-TRAY-006 · 390px · light · en · signed out · world=empty · /shop · compare=lub-2 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] SHOP-TRAY-007 · 390px · dark · en · signed out · world=empty · /shop · compare=lub-4 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] SHOP-TRAY-008 · 390px · light · hi · signed out · world=empty · /shop · compare=spa-3 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-009 · 480px · light · en · signed out · world=empty · /shop · compare=lub-1 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] SHOP-TRAY-010 · 480px · dark · hi · signed out · world=empty · /shop · compare=lub-2 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-011 · 480px · light · en · signed out · world=empty · /shop · compare=lub-4 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] SHOP-TRAY-012 · 480px · dark · hi · signed out · world=empty · /shop · compare=spa-3 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-013 · 768px · light · en · signed out · world=empty · /shop · compare=lub-1 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] SHOP-TRAY-014 · 768px · dark · hi · signed out · world=empty · /shop · compare=lub-2 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-015 · 768px · light · en · signed out · world=empty · /shop · compare=lub-4 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] SHOP-TRAY-016 · 768px · dark · hi · signed out · world=empty · /shop · compare=spa-3 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-017 · 1024px · light · en · signed out · world=empty · /shop · compare=lub-1 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] SHOP-TRAY-018 · 1024px · dark · hi · signed out · world=empty · /shop · compare=lub-2 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-019 · 1024px · light · en · signed out · world=empty · /shop · compare=lub-4 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] SHOP-TRAY-020 · 1024px · dark · hi · signed out · world=empty · /shop · compare=spa-3 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-021 · 1280px · light · en · signed out · world=empty · /shop · compare=lub-1 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] SHOP-TRAY-022 · 1280px · dark · hi · signed out · world=empty · /shop · compare=lub-2 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-023 · 1280px · light · en · signed out · world=empty · /shop · compare=lub-4 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] SHOP-TRAY-024 · 1280px · dark · hi · signed out · world=empty · /shop · compare=spa-3 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-025 · 1440px · light · en · signed out · world=empty · /shop · compare=lub-1 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] SHOP-TRAY-026 · 1440px · dark · hi · signed out · world=empty · /shop · compare=lub-2 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-027 · 1440px · light · en · signed out · world=empty · /shop · compare=lub-4 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core
- [ ] SHOP-TRAY-028 · 1440px · dark · hi · signed out · world=empty · /shop · compare=spa-3 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-029 · 1920px · light · en · signed out · world=empty · /shop · compare=lub-1 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] SHOP-TRAY-030 · 1920px · dark · hi · signed out · world=empty · /shop · compare=lub-2 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] SHOP-TRAY-031 · 1920px · light · en · signed out · world=empty · /shop · compare=lub-4 · consent=decided · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] SHOP-TRAY-032 · 1920px · dark · hi · signed out · world=empty · /shop · compare=spa-3 · consent=open · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi

## Quantity stepper (card, product page, cart)

### STEP — Stepper − / count / + × quantity × hover/focus/active/disabled (full cross)

Full cross of the high-risk dimensions, the rest pairwise; 180 states; scope `main`.

- [ ] STEP-001 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-002 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-003 · 768px · light · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-004 · 1440px · dark · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-005 · 320px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe
- [ ] STEP-006 · 390px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-007 · 768px · dark · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-008 · 1440px · light · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-009 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-010 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-011 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-012 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-013 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-014 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-015 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-016 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-017 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-018 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-019 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-020 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=1 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-021 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-022 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-023 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-024 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-025 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-026 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-027 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-028 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-029 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-030 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-031 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-032 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-033 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-034 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-035 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-036 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-037 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-038 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-039 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-040 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=2 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-041 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-042 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-043 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-044 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-045 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-046 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] STEP-047 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-048 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-049 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-050 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] STEP-051 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-052 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-053 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-054 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-055 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-056 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-057 · 320px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-058 · 390px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-059 · 768px · light · en · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-060 · 1440px · dark · hi · signed out · world=empty · /shop?category=lubricants · surface=card · qty=99 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-061 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-062 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-063 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-064 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-065 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-066 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-067 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-068 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-069 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-070 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-071 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-072 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-073 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-074 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-075 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-076 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-077 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-078 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-079 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-080 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=1 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-081 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-082 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-083 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-084 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-085 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-086 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-087 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-088 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-089 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-090 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-091 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-092 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-093 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-094 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-095 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-096 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-097 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-098 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-099 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-100 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=2 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-101 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-102 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-103 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-104 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-105 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-106 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] STEP-107 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-108 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-109 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-110 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] STEP-111 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-112 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-113 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-114 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-115 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-116 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-117 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-118 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-119 · 768px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-120 · 1440px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · surface=pdp · qty=99 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-121 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-122 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-123 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-124 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-125 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-126 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-127 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-128 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-129 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-130 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-131 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-132 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-133 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-134 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-135 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-136 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-137 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-138 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-139 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-140 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=1 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-141 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-142 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-143 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-144 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-145 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-146 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-147 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-148 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-149 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-150 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-151 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-152 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-153 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-154 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-155 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-156 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-157 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-158 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-159 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-160 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=2 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-161 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-162 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-163 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=hover-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-164 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=hover-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-165 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-166 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] STEP-167 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=hover-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-168 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=hover-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-169 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-170 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] STEP-171 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=focus-dec · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-172 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=focus-dec · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-173 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-174 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-175 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=focus-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-176 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=focus-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-177 · 320px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] STEP-178 · 390px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] STEP-179 · 768px · light · en · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=active-inc · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] STEP-180 · 1440px · dark · hi · signed out · world=empty · /cart · surface=cart · qty=99 · interaction=active-inc · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi

## Product page (/shop/[slug])

### PDP-BUYBOX — Buy box: price, MRP and saving, stock, add to cart / stepper, compare

Pairwise (all pairs of values); 41 states; scope `main`.

- [ ] PDP-BUYBOX-001 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=none · compare=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-002 · 320px · dark · hi · signed out · world=empty · /shop/heavy-duty-battery-90ah · cart=c1 · compare=lub-2 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-003 · 390px · light · hi · signed out · world=empty · /shop/car-tyre-185-65-r15 · cart=c99 · compare=bat-3 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-004 · 390px · dark · en · signed out · world=empty · /shop/ev-portable-charger-15a · cart=none · compare=lub-2 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-005 · 480px · light · en · signed out · world=empty · /shop/motorcycle-wheel-bearing-6301 · cart=c1 · compare=bat-3 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-006 · 480px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=c99 · compare=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-007 · 768px · light · en · signed out · world=empty · /shop/heavy-duty-battery-90ah · cart=c99 · compare=lub-2 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-008 · 768px · dark · hi · signed out · world=empty · /shop/motorcycle-wheel-bearing-6301 · cart=none · compare=bat-3 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-009 · 1024px · light · en · signed out · world=empty · /shop/car-tyre-185-65-r15 · cart=c1 · compare=none · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-010 · 1024px · dark · hi · signed out · world=empty · /shop/ev-portable-charger-15a · cart=c99 · compare=bat-3 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-011 · 1280px · light · en · signed out · world=empty · /shop/ev-portable-charger-15a · cart=c1 · compare=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-012 · 1280px · dark · hi · signed out · world=empty · /shop/car-tyre-185-65-r15 · cart=none · compare=lub-2 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-013 · 1440px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=c1 · compare=lub-2 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core
- [ ] PDP-BUYBOX-014 · 1440px · dark · hi · signed out · world=empty · /shop/heavy-duty-battery-90ah · cart=none · compare=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-015 · 1920px · light · en · signed out · world=empty · /shop/motorcycle-wheel-bearing-6301 · cart=c99 · compare=none · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-016 · 1920px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=none · compare=bat-3 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-017 · 320px · light · en · signed out · world=empty · /shop/car-tyre-185-65-r15 · cart=c99 · compare=bat-3 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-018 · 320px · dark · hi · signed out · world=empty · /shop/ev-portable-charger-15a · cart=c1 · compare=lub-2 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-019 · 320px · light · en · signed out · world=empty · /shop/motorcycle-wheel-bearing-6301 · cart=none · compare=lub-2 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-020 · 390px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=c1 · compare=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] PDP-BUYBOX-021 · 390px · light · en · signed out · world=empty · /shop/heavy-duty-battery-90ah · cart=c99 · compare=bat-3 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-022 · 390px · dark · hi · signed out · world=empty · /shop/motorcycle-wheel-bearing-6301 · cart=none · compare=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-023 · 480px · light · en · signed out · world=empty · /shop/heavy-duty-battery-90ah · cart=none · compare=lub-2 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-024 · 480px · dark · hi · signed out · world=empty · /shop/car-tyre-185-65-r15 · cart=c1 · compare=bat-3 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-025 · 480px · light · en · signed out · world=empty · /shop/ev-portable-charger-15a · cart=c99 · compare=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-026 · 768px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=c1 · compare=none · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-027 · 768px · light · en · signed out · world=empty · /shop/car-tyre-185-65-r15 · cart=c99 · compare=lub-2 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-028 · 768px · dark · hi · signed out · world=empty · /shop/ev-portable-charger-15a · cart=none · compare=bat-3 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-029 · 1024px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=none · compare=lub-2 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-030 · 1024px · dark · hi · signed out · world=empty · /shop/heavy-duty-battery-90ah · cart=c1 · compare=bat-3 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-031 · 1024px · light · en · signed out · world=empty · /shop/motorcycle-wheel-bearing-6301 · cart=c99 · compare=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-032 · 1280px · dark · hi · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=c99 · compare=bat-3 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-033 · 1280px · light · en · signed out · world=empty · /shop/heavy-duty-battery-90ah · cart=c1 · compare=lub-2 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-034 · 1280px · dark · hi · signed out · world=empty · /shop/motorcycle-wheel-bearing-6301 · cart=none · compare=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-035 · 1440px · light · en · signed out · world=empty · /shop/car-tyre-185-65-r15 · cart=c99 · compare=bat-3 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-036 · 1440px · dark · hi · signed out · world=empty · /shop/ev-portable-charger-15a · cart=c1 · compare=lub-2 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-037 · 1440px · light · en · signed out · world=empty · /shop/motorcycle-wheel-bearing-6301 · cart=none · compare=none · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] PDP-BUYBOX-038 · 1920px · dark · hi · signed out · world=empty · /shop/heavy-duty-battery-90ah · cart=c1 · compare=lub-2 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-039 · 1920px · light · en · signed out · world=empty · /shop/car-tyre-185-65-r15 · cart=c99 · compare=bat-3 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] PDP-BUYBOX-040 · 1920px · dark · hi · signed out · world=empty · /shop/ev-portable-charger-15a · cart=none · compare=none · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] PDP-BUYBOX-041 · 390px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · cart=c1 · compare=lub-2 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core

### PDP-REVIEWS — Ratings summary, review list, write-a-review entry

Pairwise (all pairs of values); 16 states; scope `section[aria-labelledby^="reviews-"]`.

- [ ] PDP-REVIEWS-001 · 320px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PDP-REVIEWS-002 · 320px · dark · hi · customer · world=busy · /shop/spark-plug-iridium · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PDP-REVIEWS-003 · 390px · light · hi · signed out · world=busy · /shop/castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PDP-REVIEWS-004 · 390px · dark · en · customer · world=empty · /shop/spark-plug-iridium · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PDP-REVIEWS-005 · 480px · light · en · customer · world=busy · /shop/castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PDP-REVIEWS-006 · 480px · dark · hi · signed out · world=empty · /shop/spark-plug-iridium · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PDP-REVIEWS-007 · 768px · light · en · signed out · world=empty · /shop/spark-plug-iridium · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PDP-REVIEWS-008 · 768px · dark · hi · customer · world=busy · /shop/castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PDP-REVIEWS-009 · 1024px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PDP-REVIEWS-010 · 1024px · dark · hi · customer · world=busy · /shop/spark-plug-iridium · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PDP-REVIEWS-011 · 1280px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PDP-REVIEWS-012 · 1280px · dark · hi · customer · world=busy · /shop/spark-plug-iridium · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PDP-REVIEWS-013 · 1440px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PDP-REVIEWS-014 · 1440px · dark · hi · customer · world=busy · /shop/spark-plug-iridium · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PDP-REVIEWS-015 · 1920px · light · en · signed out · world=empty · /shop/castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PDP-REVIEWS-016 · 1920px · dark · hi · customer · world=busy · /shop/spark-plug-iridium · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### PDP-RELATED — Related products row (cards)

Pairwise (all pairs of values); 16 states; scope `section[aria-labelledby="related"]`.

- [ ] PDP-RELATED-001 · 320px · light · en · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=none · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] PDP-RELATED-002 · 320px · dark · hi · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=mixed · compare=bat-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] PDP-RELATED-003 · 390px · light · hi · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=none · compare=bat-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] PDP-RELATED-004 · 390px · dark · en · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=mixed · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] PDP-RELATED-005 · 480px · light · en · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=mixed · compare=bat-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] PDP-RELATED-006 · 480px · dark · hi · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=none · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] PDP-RELATED-007 · 768px · light · en · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=none · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] PDP-RELATED-008 · 768px · dark · hi · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=mixed · compare=bat-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] PDP-RELATED-009 · 1024px · light · en · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=none · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] PDP-RELATED-010 · 1024px · dark · hi · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=mixed · compare=bat-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] PDP-RELATED-011 · 1280px · light · en · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=none · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] PDP-RELATED-012 · 1280px · dark · hi · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=mixed · compare=bat-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] PDP-RELATED-013 · 1440px · light · en · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=none · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] PDP-RELATED-014 · 1440px · dark · hi · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=mixed · compare=bat-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] PDP-RELATED-015 · 1920px · light · en · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=none · compare=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] PDP-RELATED-016 · 1920px · dark · hi · signed out · world=empty · /shop/motul-3100-4t-10w30-1l · cart=mixed · compare=bat-2 · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi

## Compare (/compare)

### CMP-TABLE — Comparison table × column count × badges × partial in-cart (full cross)

Full cross of the high-risk dimensions, the rest pairwise; 126 states; scope `main`.

- [ ] CMP-TABLE-001 · 320px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-002 · 390px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-003 · 768px · light · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-004 · 1024px · dark · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-005 · 1440px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-006 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-007 · 320px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-008 · 390px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-009 · 768px · dark · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-010 · 1024px · light · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-011 · 1440px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-012 · 1920px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-013 · 320px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-014 · 390px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-015 · 768px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-016 · 1024px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-017 · 1440px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-018 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l · compare=lub-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-019 · 320px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-020 · 390px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-021 · 768px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-022 · 1024px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-023 · 1440px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-024 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-025 · 320px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-026 · 390px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-027 · 768px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-028 · 1024px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-029 · 1440px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-030 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-031 · 320px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-032 · 390px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-033 · 768px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-034 · 1024px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-035 · 1440px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-036 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-037 · 320px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-038 · 390px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-039 · 768px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-040 · 1024px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-041 · 1440px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-042 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-043 · 320px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-044 · 390px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-045 · 768px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-046 · 1024px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-047 · 1440px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-048 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-049 · 320px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-050 · 390px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-051 · 768px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-052 · 1024px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-053 · 1440px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-054 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,shell-advance-ax7-10w30-1l,synthetic-engine-oil-5w30-3-5l · compare=lub-4 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-055 · 320px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-056 · 390px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-057 · 768px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-058 · 1024px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-059 · 1440px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-060 · 1920px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-061 · 320px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-062 · 390px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-063 · 768px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-064 · 1024px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-065 · 1440px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-066 · 1920px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-067 · 320px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-068 · 390px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-069 · 768px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-070 · 1024px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-071 · 1440px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-072 · 1920px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah · compare=bat-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-073 · 320px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-074 · 390px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-075 · 768px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-076 · 1024px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-077 · 1440px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-078 · 1920px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-079 · 320px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-080 · 390px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi axe · core
- [ ] CMP-TABLE-081 · 768px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-082 · 1024px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-083 · 1440px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe · core
- [ ] CMP-TABLE-084 · 1920px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-085 · 320px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-086 · 390px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-087 · 768px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-088 · 1024px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-089 · 1440px · light · en · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-090 · 1920px · dark · hi · signed out · world=empty · /compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah,heavy-duty-battery-90ah · compare=bat-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-091 · 320px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-092 · 390px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-093 · 768px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-094 · 1024px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-095 · 1440px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-096 · 1920px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-097 · 320px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-098 · 390px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-099 · 768px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-100 · 1024px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-101 · 1440px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-102 · 1920px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-103 · 320px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-104 · 390px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-105 · 768px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-106 · 1024px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-107 · 1440px · light · en · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-108 · 1920px · dark · hi · signed out · world=empty · /compare?p=car-tyre-185-65-r15,scooter-tubeless-tyre-90-90-12 · compare=tyr-2 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-109 · 320px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-110 · 390px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-111 · 768px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-112 · 1024px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-113 · 1440px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-114 · 1920px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=none · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-115 · 320px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-116 · 390px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-117 · 768px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-118 · 1024px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-119 · 1440px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-120 · 1920px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-121 · 320px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-122 · 390px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-123 · 768px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync
- [ ] CMP-TABLE-124 · 1024px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi
- [ ] CMP-TABLE-125 · 1440px · light · en · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync axe
- [ ] CMP-TABLE-126 · 1920px · dark · hi · signed out · world=empty · /compare?p=brake-pad-set-front,chain-sprocket-kit-150cc,spark-plug-iridium · compare=spa-3 · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned sync hindi

### CMP-EMPTY — Compare with one or no product (empty state and next action)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] CMP-EMPTY-001 · 320px · light · en · signed out · world=empty · /compare · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CMP-EMPTY-002 · 320px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CMP-EMPTY-003 · 390px · light · hi · signed out · world=empty · /compare · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CMP-EMPTY-004 · 390px · dark · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CMP-EMPTY-005 · 480px · light · en · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CMP-EMPTY-006 · 480px · dark · hi · signed out · world=empty · /compare · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CMP-EMPTY-007 · 768px · light · en · signed out · world=empty · /compare · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CMP-EMPTY-008 · 768px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CMP-EMPTY-009 · 1024px · light · en · signed out · world=empty · /compare · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CMP-EMPTY-010 · 1024px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CMP-EMPTY-011 · 1280px · light · en · signed out · world=empty · /compare · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CMP-EMPTY-012 · 1280px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CMP-EMPTY-013 · 1440px · light · en · signed out · world=empty · /compare · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CMP-EMPTY-014 · 1440px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CMP-EMPTY-015 · 1920px · light · en · signed out · world=empty · /compare · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CMP-EMPTY-016 · 1920px · dark · hi · signed out · world=empty · /compare?p=castrol-activ-4t-20w40-900ml · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Cart (/cart)

### CART-LINES — Cart lines (stepper, remove, line total) and summary

Pairwise (all pairs of values); 40 states; scope `main`.

- [ ] CART-LINES-001 · 320px · light · en · signed out · world=empty · /cart · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core
- [ ] CART-LINES-002 · 320px · dark · hi · customer · world=empty · /cart · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] CART-LINES-003 · 390px · light · hi · signed out · world=empty · /cart · cart=many20 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-004 · 390px · dark · en · customer · world=empty · /cart · cart=below · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] CART-LINES-005 · 480px · light · en · customer · world=empty · /cart · cart=max · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] CART-LINES-006 · 480px · dark · hi · signed out · world=empty · /cart · cart=c1 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-007 · 768px · light · en · signed out · world=empty · /cart · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] CART-LINES-008 · 768px · dark · hi · customer · world=empty · /cart · cart=many20 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-009 · 1024px · light · en · signed out · world=empty · /cart · cart=below · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] CART-LINES-010 · 1024px · dark · hi · customer · world=empty · /cart · cart=max · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-011 · 1280px · light · en · signed out · world=empty · /cart · cart=many20 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] CART-LINES-012 · 1280px · dark · hi · customer · world=empty · /cart · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-013 · 1440px · light · en · signed out · world=empty · /cart · cart=max · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core
- [ ] CART-LINES-014 · 1440px · dark · hi · customer · world=empty · /cart · cart=below · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] CART-LINES-015 · 1920px · light · en · signed out · world=empty · /cart · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] CART-LINES-016 · 1920px · dark · hi · customer · world=empty · /cart · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-017 · 320px · light · en · signed out · world=empty · /cart · cart=many20 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core
- [ ] CART-LINES-018 · 320px · dark · hi · customer · world=empty · /cart · cart=below · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] CART-LINES-019 · 320px · light · en · signed out · world=empty · /cart · cart=max · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core
- [ ] CART-LINES-020 · 390px · dark · hi · customer · world=empty · /cart · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-021 · 390px · light · en · signed out · world=empty · /cart · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] CART-LINES-022 · 390px · dark · hi · customer · world=empty · /cart · cart=max · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-023 · 480px · light · en · signed out · world=empty · /cart · cart=mixed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] CART-LINES-024 · 480px · dark · hi · customer · world=empty · /cart · cart=many20 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-025 · 480px · light · en · signed out · world=empty · /cart · cart=below · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] CART-LINES-026 · 768px · dark · hi · customer · world=empty · /cart · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-027 · 768px · light · en · signed out · world=empty · /cart · cart=below · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] CART-LINES-028 · 768px · dark · hi · customer · world=empty · /cart · cart=max · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-029 · 1024px · light · en · signed out · world=empty · /cart · cart=c1 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] CART-LINES-030 · 1024px · dark · hi · customer · world=empty · /cart · cart=mixed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-031 · 1024px · light · en · signed out · world=empty · /cart · cart=many20 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] CART-LINES-032 · 1280px · dark · hi · customer · world=empty · /cart · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-033 · 1280px · light · en · signed out · world=empty · /cart · cart=below · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe
- [ ] CART-LINES-034 · 1280px · dark · hi · customer · world=empty · /cart · cart=max · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-035 · 1440px · light · en · signed out · world=empty · /cart · cart=c1 · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core
- [ ] CART-LINES-036 · 1440px · dark · hi · customer · world=empty · /cart · cart=mixed · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi axe · core
- [ ] CART-LINES-037 · 1440px · light · en · signed out · world=empty · /cart · cart=many20 · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync axe · core
- [ ] CART-LINES-038 · 1920px · dark · hi · customer · world=empty · /cart · cart=many20 · stress=long-price · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi
- [ ] CART-LINES-039 · 1920px · light · en · signed out · world=empty · /cart · cart=below · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console sync
- [ ] CART-LINES-040 · 1920px · dark · hi · customer · world=empty · /cart · cart=max · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console sync hindi

### CART-EMPTY — Empty cart (one next action, category shortcuts)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] CART-EMPTY-001 · 320px · light · en · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CART-EMPTY-002 · 320px · dark · hi · customer · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CART-EMPTY-003 · 390px · light · hi · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CART-EMPTY-004 · 390px · dark · en · customer · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CART-EMPTY-005 · 480px · light · en · customer · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CART-EMPTY-006 · 480px · dark · hi · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CART-EMPTY-007 · 768px · light · en · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CART-EMPTY-008 · 768px · dark · hi · customer · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CART-EMPTY-009 · 1024px · light · en · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CART-EMPTY-010 · 1024px · dark · hi · customer · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CART-EMPTY-011 · 1280px · light · en · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CART-EMPTY-012 · 1280px · dark · hi · customer · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CART-EMPTY-013 · 1440px · light · en · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CART-EMPTY-014 · 1440px · dark · hi · customer · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CART-EMPTY-015 · 1920px · light · en · signed out · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CART-EMPTY-016 · 1920px · dark · hi · customer · world=empty · /cart · cart=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Checkout (/checkout)

### CHK-FORM — Checkout form (contact, address, business GSTIN, payment) and summary

Pairwise (all pairs of values); 25 states; scope `main`.

- [ ] CHK-FORM-001 · 320px · light · en · signed out · world=empty · /checkout · cart=c1 · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHK-FORM-002 · 320px · dark · hi · customer · world=empty · /checkout · cart=mixed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-003 · 390px · light · hi · signed out · world=empty · /checkout · cart=max · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-004 · 390px · dark · en · customer · world=empty · /checkout · cart=c1 · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHK-FORM-005 · 480px · light · en · customer · world=empty · /checkout · cart=mixed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHK-FORM-006 · 480px · dark · hi · signed out · world=empty · /checkout · cart=max · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-007 · 768px · light · en · signed out · world=empty · /checkout · cart=mixed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHK-FORM-008 · 768px · dark · hi · customer · world=empty · /checkout · cart=c1 · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-009 · 1024px · light · en · signed out · world=empty · /checkout · cart=max · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHK-FORM-010 · 1024px · dark · hi · customer · world=empty · /checkout · cart=c1 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-011 · 1280px · light · en · signed out · world=empty · /checkout · cart=mixed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHK-FORM-012 · 1280px · dark · hi · customer · world=empty · /checkout · cart=max · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-013 · 1440px · light · en · signed out · world=empty · /checkout · cart=c1 · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHK-FORM-014 · 1440px · dark · hi · customer · world=empty · /checkout · cart=mixed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-015 · 1920px · light · en · signed out · world=empty · /checkout · cart=max · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHK-FORM-016 · 1920px · dark · hi · customer · world=empty · /checkout · cart=c1 · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-017 · 320px · light · en · signed out · world=empty · /checkout · cart=max · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHK-FORM-018 · 390px · dark · hi · customer · world=empty · /checkout · cart=mixed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] CHK-FORM-019 · 480px · light · en · signed out · world=empty · /checkout · cart=c1 · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHK-FORM-020 · 768px · dark · hi · customer · world=empty · /checkout · cart=max · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-021 · 1024px · light · en · signed out · world=empty · /checkout · cart=mixed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] CHK-FORM-022 · 1280px · dark · hi · customer · world=empty · /checkout · cart=c1 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-023 · 1440px · light · en · signed out · world=empty · /checkout · cart=max · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] CHK-FORM-024 · 1920px · dark · hi · customer · world=empty · /checkout · cart=mixed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] CHK-FORM-025 · 390px · light · en · signed out · world=empty · /checkout · cart=c1 · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe

## Order (/orders/[code])

### ORD-VIEW — Order status, timeline, lines, delivery code, cancel/rate/support

Pairwise (all pairs of values); 24 states; scope `main`.

- [ ] ORD-VIEW-001 · 320px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND001 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ORD-VIEW-002 · 320px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND002 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-003 · 390px · light · hi · customer · world=busy · /orders/MD-RPR-2026-HND003 · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] ORD-VIEW-004 · 390px · dark · en · customer · world=busy · /orders/MD-RPR-2026-HND001 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ORD-VIEW-005 · 480px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND002 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ORD-VIEW-006 · 480px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND003 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-007 · 768px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND003 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ORD-VIEW-008 · 768px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND001 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-009 · 1024px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND002 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ORD-VIEW-010 · 1024px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND001 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-011 · 1280px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND002 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ORD-VIEW-012 · 1280px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND003 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-013 · 1440px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND001 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ORD-VIEW-014 · 1440px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND002 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-015 · 1920px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND003 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ORD-VIEW-016 · 1920px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND001 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-017 · 320px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND003 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ORD-VIEW-018 · 390px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND002 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-019 · 480px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND001 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ORD-VIEW-020 · 768px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND002 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-021 · 1024px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND003 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ORD-VIEW-022 · 1280px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND001 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ORD-VIEW-023 · 1440px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND003 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ORD-VIEW-024 · 1920px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND002 · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Service request (/service/[code])

### SR-VIEW — Request status, proposal, itemised estimate (per-line approval), bill

Pairwise (all pairs of values); 40 states; scope `main`.

- [ ] SR-VIEW-001 · 320px · light · en · customer · world=busy · /service/SR-RPR-2026-HND101 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-002 · 320px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND102 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-003 · 390px · light · hi · customer · world=busy · /service/SR-RPR-2026-HND103 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-004 · 390px · dark · en · customer · world=busy · /service/SR-RPR-2026-HND104 · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] SR-VIEW-005 · 480px · light · en · customer · world=busy · /service/SR-RPR-2026-HND105 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-006 · 480px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND101 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-007 · 768px · light · en · customer · world=busy · /service/SR-RPR-2026-HND102 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-008 · 768px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND105 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-009 · 1024px · light · en · customer · world=busy · /service/SR-RPR-2026-HND103 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-010 · 1024px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND104 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-011 · 1280px · light · en · customer · world=busy · /service/SR-RPR-2026-HND104 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-012 · 1280px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND103 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-013 · 1440px · light · en · customer · world=busy · /service/SR-RPR-2026-HND101 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-014 · 1440px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND102 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-015 · 1920px · light · en · customer · world=busy · /service/SR-RPR-2026-HND105 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-016 · 1920px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND101 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-017 · 320px · light · en · customer · world=busy · /service/SR-RPR-2026-HND103 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-018 · 320px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND104 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-019 · 320px · light · en · customer · world=busy · /service/SR-RPR-2026-HND105 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-020 · 390px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND101 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-021 · 390px · light · en · customer · world=busy · /service/SR-RPR-2026-HND102 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-022 · 390px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND105 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-023 · 480px · light · en · customer · world=busy · /service/SR-RPR-2026-HND102 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-024 · 480px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND103 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-025 · 480px · light · en · customer · world=busy · /service/SR-RPR-2026-HND104 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-026 · 768px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND101 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-027 · 768px · light · en · customer · world=busy · /service/SR-RPR-2026-HND103 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-028 · 768px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND104 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-029 · 1024px · light · en · customer · world=busy · /service/SR-RPR-2026-HND101 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-030 · 1024px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND102 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-031 · 1024px · light · en · customer · world=busy · /service/SR-RPR-2026-HND105 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-032 · 1280px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND101 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-033 · 1280px · light · en · customer · world=busy · /service/SR-RPR-2026-HND102 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-034 · 1280px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND105 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-035 · 1440px · light · en · customer · world=busy · /service/SR-RPR-2026-HND103 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-036 · 1440px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND104 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-037 · 1440px · light · en · customer · world=busy · /service/SR-RPR-2026-HND105 · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SR-VIEW-038 · 1920px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND102 · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SR-VIEW-039 · 1920px · light · en · customer · world=busy · /service/SR-RPR-2026-HND103 · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SR-VIEW-040 · 1920px · dark · hi · customer · world=busy · /service/SR-RPR-2026-HND104 · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Bulk quotes (/quotes)

### QT-PAGES — Quote request form and quote thread

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] QT-PAGES-001 · 320px · light · en · customer · world=busy · /quotes/new · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] QT-PAGES-002 · 320px · dark · hi · customer · world=busy · /quotes/QT-RPR-2026-HND201 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] QT-PAGES-003 · 390px · light · hi · customer · world=busy · /quotes/new · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] QT-PAGES-004 · 390px · dark · en · customer · world=busy · /quotes/QT-RPR-2026-HND201 · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] QT-PAGES-005 · 480px · light · en · customer · world=busy · /quotes/QT-RPR-2026-HND201 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] QT-PAGES-006 · 480px · dark · hi · customer · world=busy · /quotes/new · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] QT-PAGES-007 · 768px · light · en · customer · world=busy · /quotes/new · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] QT-PAGES-008 · 768px · dark · hi · customer · world=busy · /quotes/QT-RPR-2026-HND201 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] QT-PAGES-009 · 1024px · light · en · customer · world=busy · /quotes/new · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] QT-PAGES-010 · 1024px · dark · hi · customer · world=busy · /quotes/QT-RPR-2026-HND201 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] QT-PAGES-011 · 1280px · light · en · customer · world=busy · /quotes/new · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] QT-PAGES-012 · 1280px · dark · hi · customer · world=busy · /quotes/QT-RPR-2026-HND201 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] QT-PAGES-013 · 1440px · light · en · customer · world=busy · /quotes/new · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] QT-PAGES-014 · 1440px · dark · hi · customer · world=busy · /quotes/QT-RPR-2026-HND201 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] QT-PAGES-015 · 1920px · light · en · customer · world=busy · /quotes/new · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] QT-PAGES-016 · 1920px · dark · hi · customer · world=busy · /quotes/QT-RPR-2026-HND201 · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Account (/account)

### ACC-OVERVIEW — Account section: overview (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-OVERVIEW-001 · 320px · light · en · customer · world=empty · /account · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-OVERVIEW-002 · 320px · dark · hi · customer · world=busy · /account · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-OVERVIEW-003 · 390px · light · hi · customer · world=empty · /account · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] ACC-OVERVIEW-004 · 390px · dark · en · customer · world=busy · /account · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] ACC-OVERVIEW-005 · 480px · light · en · customer · world=busy · /account · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-OVERVIEW-006 · 480px · dark · hi · customer · world=empty · /account · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-OVERVIEW-007 · 768px · light · en · customer · world=empty · /account · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-OVERVIEW-008 · 768px · dark · hi · customer · world=busy · /account · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-OVERVIEW-009 · 1024px · light · en · customer · world=empty · /account · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-OVERVIEW-010 · 1024px · dark · hi · customer · world=busy · /account · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-OVERVIEW-011 · 1280px · light · en · customer · world=empty · /account · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-OVERVIEW-012 · 1280px · dark · hi · customer · world=busy · /account · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-OVERVIEW-013 · 1440px · light · en · customer · world=empty · /account · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-OVERVIEW-014 · 1440px · dark · hi · customer · world=busy · /account · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-OVERVIEW-015 · 1920px · light · en · customer · world=empty · /account · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-OVERVIEW-016 · 1920px · dark · hi · customer · world=busy · /account · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-ORDERS — Account section: orders (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-ORDERS-001 · 320px · light · en · customer · world=empty · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ORDERS-002 · 320px · dark · hi · customer · world=busy · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ORDERS-003 · 390px · light · hi · customer · world=empty · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] ACC-ORDERS-004 · 390px · dark · en · customer · world=busy · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] ACC-ORDERS-005 · 480px · light · en · customer · world=busy · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ORDERS-006 · 480px · dark · hi · customer · world=empty · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ORDERS-007 · 768px · light · en · customer · world=empty · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ORDERS-008 · 768px · dark · hi · customer · world=busy · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ORDERS-009 · 1024px · light · en · customer · world=empty · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ORDERS-010 · 1024px · dark · hi · customer · world=busy · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ORDERS-011 · 1280px · light · en · customer · world=empty · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ORDERS-012 · 1280px · dark · hi · customer · world=busy · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ORDERS-013 · 1440px · light · en · customer · world=empty · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ORDERS-014 · 1440px · dark · hi · customer · world=busy · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ORDERS-015 · 1920px · light · en · customer · world=empty · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ORDERS-016 · 1920px · dark · hi · customer · world=busy · /account/orders · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-SERVICES — Account section: services (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-SERVICES-001 · 320px · light · en · customer · world=empty · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-SERVICES-002 · 320px · dark · hi · customer · world=busy · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SERVICES-003 · 390px · light · hi · customer · world=empty · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SERVICES-004 · 390px · dark · en · customer · world=busy · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-SERVICES-005 · 480px · light · en · customer · world=busy · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-SERVICES-006 · 480px · dark · hi · customer · world=empty · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SERVICES-007 · 768px · light · en · customer · world=empty · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-SERVICES-008 · 768px · dark · hi · customer · world=busy · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SERVICES-009 · 1024px · light · en · customer · world=empty · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-SERVICES-010 · 1024px · dark · hi · customer · world=busy · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SERVICES-011 · 1280px · light · en · customer · world=empty · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-SERVICES-012 · 1280px · dark · hi · customer · world=busy · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SERVICES-013 · 1440px · light · en · customer · world=empty · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-SERVICES-014 · 1440px · dark · hi · customer · world=busy · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SERVICES-015 · 1920px · light · en · customer · world=empty · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-SERVICES-016 · 1920px · dark · hi · customer · world=busy · /account/services · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-QUOTES — Account section: quotes (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-QUOTES-001 · 320px · light · en · customer · world=empty · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-QUOTES-002 · 320px · dark · hi · customer · world=busy · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-QUOTES-003 · 390px · light · hi · customer · world=empty · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-QUOTES-004 · 390px · dark · en · customer · world=busy · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-QUOTES-005 · 480px · light · en · customer · world=busy · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-QUOTES-006 · 480px · dark · hi · customer · world=empty · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-QUOTES-007 · 768px · light · en · customer · world=empty · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-QUOTES-008 · 768px · dark · hi · customer · world=busy · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-QUOTES-009 · 1024px · light · en · customer · world=empty · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-QUOTES-010 · 1024px · dark · hi · customer · world=busy · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-QUOTES-011 · 1280px · light · en · customer · world=empty · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-QUOTES-012 · 1280px · dark · hi · customer · world=busy · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-QUOTES-013 · 1440px · light · en · customer · world=empty · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-QUOTES-014 · 1440px · dark · hi · customer · world=busy · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-QUOTES-015 · 1920px · light · en · customer · world=empty · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-QUOTES-016 · 1920px · dark · hi · customer · world=busy · /account/quotes · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-SUPPORT — Account section: support (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-SUPPORT-001 · 320px · light · en · customer · world=empty · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-SUPPORT-002 · 320px · dark · hi · customer · world=busy · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SUPPORT-003 · 390px · light · hi · customer · world=empty · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SUPPORT-004 · 390px · dark · en · customer · world=busy · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-SUPPORT-005 · 480px · light · en · customer · world=busy · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-SUPPORT-006 · 480px · dark · hi · customer · world=empty · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SUPPORT-007 · 768px · light · en · customer · world=empty · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-SUPPORT-008 · 768px · dark · hi · customer · world=busy · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SUPPORT-009 · 1024px · light · en · customer · world=empty · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-SUPPORT-010 · 1024px · dark · hi · customer · world=busy · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SUPPORT-011 · 1280px · light · en · customer · world=empty · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-SUPPORT-012 · 1280px · dark · hi · customer · world=busy · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SUPPORT-013 · 1440px · light · en · customer · world=empty · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-SUPPORT-014 · 1440px · dark · hi · customer · world=busy · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-SUPPORT-015 · 1920px · light · en · customer · world=empty · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-SUPPORT-016 · 1920px · dark · hi · customer · world=busy · /account/support · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-COINS — Account section: coins (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-COINS-001 · 320px · light · en · customer · world=empty · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-COINS-002 · 320px · dark · hi · customer · world=busy · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-COINS-003 · 390px · light · hi · customer · world=empty · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-COINS-004 · 390px · dark · en · customer · world=busy · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-COINS-005 · 480px · light · en · customer · world=busy · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-COINS-006 · 480px · dark · hi · customer · world=empty · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-COINS-007 · 768px · light · en · customer · world=empty · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-COINS-008 · 768px · dark · hi · customer · world=busy · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-COINS-009 · 1024px · light · en · customer · world=empty · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-COINS-010 · 1024px · dark · hi · customer · world=busy · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-COINS-011 · 1280px · light · en · customer · world=empty · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-COINS-012 · 1280px · dark · hi · customer · world=busy · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-COINS-013 · 1440px · light · en · customer · world=empty · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-COINS-014 · 1440px · dark · hi · customer · world=busy · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-COINS-015 · 1920px · light · en · customer · world=empty · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-COINS-016 · 1920px · dark · hi · customer · world=busy · /account/coins · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-VEHICLES — Account section: vehicles (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-VEHICLES-001 · 320px · light · en · customer · world=empty · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-002 · 320px · dark · hi · customer · world=busy · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-003 · 390px · light · hi · customer · world=empty · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-004 · 390px · dark · en · customer · world=busy · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-005 · 480px · light · en · customer · world=busy · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-006 · 480px · dark · hi · customer · world=empty · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-007 · 768px · light · en · customer · world=empty · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-008 · 768px · dark · hi · customer · world=busy · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-009 · 1024px · light · en · customer · world=empty · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-010 · 1024px · dark · hi · customer · world=busy · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-011 · 1280px · light · en · customer · world=empty · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-012 · 1280px · dark · hi · customer · world=busy · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-013 · 1440px · light · en · customer · world=empty · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-014 · 1440px · dark · hi · customer · world=busy · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-015 · 1920px · light · en · customer · world=empty · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-016 · 1920px · dark · hi · customer · world=busy · /account/vehicles · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-ADDRESSES — Account section: addresses (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-ADDRESSES-001 · 320px · light · en · customer · world=empty · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-002 · 320px · dark · hi · customer · world=busy · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-003 · 390px · light · hi · customer · world=empty · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-004 · 390px · dark · en · customer · world=busy · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-005 · 480px · light · en · customer · world=busy · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-006 · 480px · dark · hi · customer · world=empty · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-007 · 768px · light · en · customer · world=empty · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-008 · 768px · dark · hi · customer · world=busy · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-009 · 1024px · light · en · customer · world=empty · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-010 · 1024px · dark · hi · customer · world=busy · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-011 · 1280px · light · en · customer · world=empty · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-012 · 1280px · dark · hi · customer · world=busy · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-013 · 1440px · light · en · customer · world=empty · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-014 · 1440px · dark · hi · customer · world=busy · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-015 · 1920px · light · en · customer · world=empty · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-016 · 1920px · dark · hi · customer · world=busy · /account/addresses · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-PROFILE — Account section: profile (section bar + content)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ACC-PROFILE-001 · 320px · light · en · customer · world=empty · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-PROFILE-002 · 320px · dark · hi · customer · world=busy · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-PROFILE-003 · 390px · light · hi · customer · world=empty · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-PROFILE-004 · 390px · dark · en · customer · world=busy · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-PROFILE-005 · 480px · light · en · customer · world=busy · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-PROFILE-006 · 480px · dark · hi · customer · world=empty · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-PROFILE-007 · 768px · light · en · customer · world=empty · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-PROFILE-008 · 768px · dark · hi · customer · world=busy · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-PROFILE-009 · 1024px · light · en · customer · world=empty · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-PROFILE-010 · 1024px · dark · hi · customer · world=busy · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-PROFILE-011 · 1280px · light · en · customer · world=empty · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-PROFILE-012 · 1280px · dark · hi · customer · world=busy · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-PROFILE-013 · 1440px · light · en · customer · world=empty · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-PROFILE-014 · 1440px · dark · hi · customer · world=busy · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-PROFILE-015 · 1920px · light · en · customer · world=empty · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-PROFILE-016 · 1920px · dark · hi · customer · world=busy · /account/profile · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-VEHICLES-DATA — Account vehicles: empty, one, at the limit of 10, long Hindi text

Pairwise (all pairs of values); 32 states; scope `main`.

- [ ] ACC-VEHICLES-DATA-001 · 320px · light · en · customer · world=empty · /account/vehicles · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-DATA-002 · 320px · dark · hi · customer · world=empty · /account/vehicles · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-003 · 390px · light · hi · customer · world=empty · /account/vehicles · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] ACC-VEHICLES-DATA-004 · 390px · dark · en · customer · world=empty · /account/vehicles · data=long · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] ACC-VEHICLES-DATA-005 · 480px · light · en · customer · world=empty · /account/vehicles · data=one · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-DATA-006 · 480px · dark · hi · customer · world=empty · /account/vehicles · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-007 · 768px · light · en · customer · world=empty · /account/vehicles · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-DATA-008 · 768px · dark · hi · customer · world=empty · /account/vehicles · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-009 · 1024px · light · en · customer · world=empty · /account/vehicles · data=long · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-DATA-010 · 1024px · dark · hi · customer · world=empty · /account/vehicles · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-011 · 1280px · light · en · customer · world=empty · /account/vehicles · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-DATA-012 · 1280px · dark · hi · customer · world=empty · /account/vehicles · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-013 · 1440px · light · en · customer · world=empty · /account/vehicles · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-DATA-014 · 1440px · dark · hi · customer · world=empty · /account/vehicles · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-015 · 1920px · light · en · customer · world=empty · /account/vehicles · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-DATA-016 · 1920px · dark · hi · customer · world=empty · /account/vehicles · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-017 · 320px · light · en · customer · world=empty · /account/vehicles · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-DATA-018 · 320px · dark · hi · customer · world=empty · /account/vehicles · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-019 · 390px · light · en · customer · world=empty · /account/vehicles · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-DATA-020 · 390px · dark · hi · customer · world=empty · /account/vehicles · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-021 · 480px · light · en · customer · world=empty · /account/vehicles · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-DATA-022 · 480px · dark · hi · customer · world=empty · /account/vehicles · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-023 · 768px · light · en · customer · world=empty · /account/vehicles · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-DATA-024 · 768px · dark · hi · customer · world=empty · /account/vehicles · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-025 · 1024px · light · en · customer · world=empty · /account/vehicles · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-DATA-026 · 1024px · dark · hi · customer · world=empty · /account/vehicles · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-027 · 1280px · light · en · customer · world=empty · /account/vehicles · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-DATA-028 · 1280px · dark · hi · customer · world=empty · /account/vehicles · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-029 · 1440px · light · en · customer · world=empty · /account/vehicles · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-VEHICLES-DATA-030 · 1440px · dark · hi · customer · world=empty · /account/vehicles · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-VEHICLES-DATA-031 · 1920px · light · en · customer · world=empty · /account/vehicles · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-VEHICLES-DATA-032 · 1920px · dark · hi · customer · world=empty · /account/vehicles · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi

### ACC-ADDRESSES-DATA — Account addresses: empty, one, at the limit of 10, long Hindi text

Pairwise (all pairs of values); 32 states; scope `main`.

- [ ] ACC-ADDRESSES-DATA-001 · 320px · light · en · customer · world=empty · /account/addresses · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-DATA-002 · 320px · dark · hi · customer · world=empty · /account/addresses · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-003 · 390px · light · hi · customer · world=empty · /account/addresses · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] ACC-ADDRESSES-DATA-004 · 390px · dark · en · customer · world=empty · /account/addresses · data=long · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] ACC-ADDRESSES-DATA-005 · 480px · light · en · customer · world=empty · /account/addresses · data=one · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-DATA-006 · 480px · dark · hi · customer · world=empty · /account/addresses · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-007 · 768px · light · en · customer · world=empty · /account/addresses · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-DATA-008 · 768px · dark · hi · customer · world=empty · /account/addresses · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-009 · 1024px · light · en · customer · world=empty · /account/addresses · data=long · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-DATA-010 · 1024px · dark · hi · customer · world=empty · /account/addresses · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-011 · 1280px · light · en · customer · world=empty · /account/addresses · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-DATA-012 · 1280px · dark · hi · customer · world=empty · /account/addresses · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-013 · 1440px · light · en · customer · world=empty · /account/addresses · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-DATA-014 · 1440px · dark · hi · customer · world=empty · /account/addresses · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-015 · 1920px · light · en · customer · world=empty · /account/addresses · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-DATA-016 · 1920px · dark · hi · customer · world=empty · /account/addresses · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-017 · 320px · light · en · customer · world=empty · /account/addresses · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-DATA-018 · 320px · dark · hi · customer · world=empty · /account/addresses · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-019 · 390px · light · en · customer · world=empty · /account/addresses · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-DATA-020 · 390px · dark · hi · customer · world=empty · /account/addresses · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-021 · 480px · light · en · customer · world=empty · /account/addresses · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-DATA-022 · 480px · dark · hi · customer · world=empty · /account/addresses · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-023 · 768px · light · en · customer · world=empty · /account/addresses · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-DATA-024 · 768px · dark · hi · customer · world=empty · /account/addresses · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-025 · 1024px · light · en · customer · world=empty · /account/addresses · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-DATA-026 · 1024px · dark · hi · customer · world=empty · /account/addresses · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-027 · 1280px · light · en · customer · world=empty · /account/addresses · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-DATA-028 · 1280px · dark · hi · customer · world=empty · /account/addresses · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-029 · 1440px · light · en · customer · world=empty · /account/addresses · data=limit · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] ACC-ADDRESSES-DATA-030 · 1440px · dark · hi · customer · world=empty · /account/addresses · data=long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] ACC-ADDRESSES-DATA-031 · 1920px · light · en · customer · world=empty · /account/addresses · data=empty · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] ACC-ADDRESSES-DATA-032 · 1920px · dark · hi · customer · world=empty · /account/addresses · data=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Workshops (/workshops)

### WS-FINDER — Finder: PIN, vehicle, use my location, list cards, map toggle (map canvas excluded)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] WS-FINDER-001 · 320px · light · en · signed out · world=empty · /workshops · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] WS-FINDER-002 · 320px · dark · hi · customer · world=empty · /workshops · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] WS-FINDER-003 · 390px · light · hi · signed out · world=empty · /workshops · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi axe · core
- [ ] WS-FINDER-004 · 390px · dark · en · customer · world=empty · /workshops · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe · core
- [ ] WS-FINDER-005 · 480px · light · en · customer · world=empty · /workshops · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] WS-FINDER-006 · 480px · dark · hi · signed out · world=empty · /workshops · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] WS-FINDER-007 · 768px · light · en · signed out · world=empty · /workshops · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] WS-FINDER-008 · 768px · dark · hi · customer · world=empty · /workshops · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] WS-FINDER-009 · 1024px · light · en · signed out · world=empty · /workshops · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] WS-FINDER-010 · 1024px · dark · hi · customer · world=empty · /workshops · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] WS-FINDER-011 · 1280px · light · en · signed out · world=empty · /workshops · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] WS-FINDER-012 · 1280px · dark · hi · customer · world=empty · /workshops · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] WS-FINDER-013 · 1440px · light · en · signed out · world=empty · /workshops · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] WS-FINDER-014 · 1440px · dark · hi · customer · world=empty · /workshops · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] WS-FINDER-015 · 1920px · light · en · signed out · world=empty · /workshops · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] WS-FINDER-016 · 1920px · dark · hi · customer · world=empty · /workshops · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

## Workshop page (/workshops/[slug])

### WS-PROFILE — Workshop profile: services menu, reviews, booking form

Pairwise (all pairs of values); 25 states; scope `main`.

- [ ] WS-PROFILE-001 · 320px · light · en · signed out · world=empty · /workshops/telibandha-car-clinic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] WS-PROFILE-002 · 320px · dark · hi · customer · world=empty · /workshops/mowa-ev-and-bike-point · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-003 · 390px · light · hi · signed out · world=empty · /workshops/pachpedi-naka-two-wheeler-care · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-004 · 390px · dark · en · customer · world=empty · /workshops/telibandha-car-clinic · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] WS-PROFILE-005 · 480px · light · en · customer · world=empty · /workshops/mowa-ev-and-bike-point · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] WS-PROFILE-006 · 480px · dark · hi · signed out · world=empty · /workshops/pachpedi-naka-two-wheeler-care · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-007 · 768px · light · en · signed out · world=empty · /workshops/mowa-ev-and-bike-point · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] WS-PROFILE-008 · 768px · dark · hi · customer · world=empty · /workshops/telibandha-car-clinic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-009 · 1024px · light · en · signed out · world=empty · /workshops/pachpedi-naka-two-wheeler-care · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] WS-PROFILE-010 · 1024px · dark · hi · customer · world=empty · /workshops/telibandha-car-clinic · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-011 · 1280px · light · en · signed out · world=empty · /workshops/mowa-ev-and-bike-point · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] WS-PROFILE-012 · 1280px · dark · hi · customer · world=empty · /workshops/pachpedi-naka-two-wheeler-care · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-013 · 1440px · light · en · signed out · world=empty · /workshops/telibandha-car-clinic · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] WS-PROFILE-014 · 1440px · dark · hi · customer · world=empty · /workshops/mowa-ev-and-bike-point · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-015 · 1920px · light · en · signed out · world=empty · /workshops/pachpedi-naka-two-wheeler-care · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] WS-PROFILE-016 · 1920px · dark · hi · customer · world=empty · /workshops/telibandha-car-clinic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-017 · 320px · light · en · signed out · world=empty · /workshops/pachpedi-naka-two-wheeler-care · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] WS-PROFILE-018 · 390px · dark · hi · customer · world=empty · /workshops/mowa-ev-and-bike-point · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi axe · core
- [ ] WS-PROFILE-019 · 480px · light · en · signed out · world=empty · /workshops/telibandha-car-clinic · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] WS-PROFILE-020 · 768px · dark · hi · customer · world=empty · /workshops/pachpedi-naka-two-wheeler-care · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-021 · 1024px · light · en · signed out · world=empty · /workshops/mowa-ev-and-bike-point · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] WS-PROFILE-022 · 1280px · dark · hi · customer · world=empty · /workshops/telibandha-car-clinic · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-023 · 1440px · light · en · signed out · world=empty · /workshops/pachpedi-naka-two-wheeler-care · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] WS-PROFILE-024 · 1920px · dark · hi · customer · world=empty · /workshops/mowa-ev-and-bike-point · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] WS-PROFILE-025 · 390px · light · en · signed out · world=empty · /workshops/telibandha-car-clinic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe

## Partners (/partners)

### PTN-LANDING — Partner landing (kinds, benefits, apply links)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] PTN-LANDING-001 · 320px · light · en · signed out · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-LANDING-002 · 320px · dark · hi · customer · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-LANDING-003 · 390px · light · hi · signed out · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-LANDING-004 · 390px · dark · en · customer · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-LANDING-005 · 480px · light · en · customer · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-LANDING-006 · 480px · dark · hi · signed out · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-LANDING-007 · 768px · light · en · signed out · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-LANDING-008 · 768px · dark · hi · customer · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-LANDING-009 · 1024px · light · en · signed out · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-LANDING-010 · 1024px · dark · hi · customer · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-LANDING-011 · 1280px · light · en · signed out · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-LANDING-012 · 1280px · dark · hi · customer · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-LANDING-013 · 1440px · light · en · signed out · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-LANDING-014 · 1440px · dark · hi · customer · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-LANDING-015 · 1920px · light · en · signed out · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-LANDING-016 · 1920px · dark · hi · customer · world=empty · /partners · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Partners (/partners/apply/[kind])

### PTN-APPLY — Application form (GSTIN, tick lists, location picker; map canvas excluded)

Pairwise (all pairs of values); 24 states; scope `main`.

- [ ] PTN-APPLY-001 · 320px · light · en · signed out · world=empty · /partners/apply/seller · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-APPLY-002 · 320px · dark · hi · signed out · world=empty · /partners/apply/garage · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-003 · 390px · light · hi · signed out · world=empty · /partners/apply/mechanic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-004 · 390px · dark · en · signed out · world=empty · /partners/apply/seller · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] PTN-APPLY-005 · 480px · light · en · signed out · world=empty · /partners/apply/garage · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-APPLY-006 · 480px · dark · hi · signed out · world=empty · /partners/apply/mechanic · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-007 · 768px · light · en · signed out · world=empty · /partners/apply/mechanic · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-APPLY-008 · 768px · dark · hi · signed out · world=empty · /partners/apply/seller · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-009 · 1024px · light · en · signed out · world=empty · /partners/apply/garage · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-APPLY-010 · 1024px · dark · hi · signed out · world=empty · /partners/apply/seller · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-011 · 1280px · light · en · signed out · world=empty · /partners/apply/garage · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-APPLY-012 · 1280px · dark · hi · signed out · world=empty · /partners/apply/mechanic · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-013 · 1440px · light · en · signed out · world=empty · /partners/apply/seller · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-APPLY-014 · 1440px · dark · hi · signed out · world=empty · /partners/apply/garage · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-015 · 1920px · light · en · signed out · world=empty · /partners/apply/mechanic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-APPLY-016 · 1920px · dark · hi · signed out · world=empty · /partners/apply/seller · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-017 · 320px · light · en · signed out · world=empty · /partners/apply/mechanic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-APPLY-018 · 390px · dark · hi · signed out · world=empty · /partners/apply/garage · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-019 · 480px · light · en · signed out · world=empty · /partners/apply/seller · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-APPLY-020 · 768px · dark · hi · signed out · world=empty · /partners/apply/garage · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-021 · 1024px · light · en · signed out · world=empty · /partners/apply/mechanic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PTN-APPLY-022 · 1280px · dark · hi · signed out · world=empty · /partners/apply/seller · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PTN-APPLY-023 · 1440px · light · en · signed out · world=empty · /partners/apply/mechanic · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PTN-APPLY-024 · 1920px · dark · hi · signed out · world=empty · /partners/apply/garage · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Support (/support)

### SUP-PAGE — Support page and request form

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] SUP-PAGE-001 · 320px · light · en · signed out · world=empty · /support · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SUP-PAGE-002 · 320px · dark · hi · customer · world=busy · /support · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SUP-PAGE-003 · 390px · light · hi · signed out · world=busy · /support · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SUP-PAGE-004 · 390px · dark · en · customer · world=empty · /support · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SUP-PAGE-005 · 480px · light · en · customer · world=busy · /support · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SUP-PAGE-006 · 480px · dark · hi · signed out · world=empty · /support · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SUP-PAGE-007 · 768px · light · en · signed out · world=empty · /support · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SUP-PAGE-008 · 768px · dark · hi · customer · world=busy · /support · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SUP-PAGE-009 · 1024px · light · en · signed out · world=empty · /support · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SUP-PAGE-010 · 1024px · dark · hi · customer · world=busy · /support · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SUP-PAGE-011 · 1280px · light · en · signed out · world=empty · /support · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SUP-PAGE-012 · 1280px · dark · hi · customer · world=busy · /support · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SUP-PAGE-013 · 1440px · light · en · signed out · world=empty · /support · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] SUP-PAGE-014 · 1440px · dark · hi · customer · world=busy · /support · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] SUP-PAGE-015 · 1920px · light · en · signed out · world=empty · /support · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] SUP-PAGE-016 · 1920px · dark · hi · customer · world=busy · /support · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Sign in (/login)

### LOGIN-FORM — Sign-in form (password, errors, show password)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] LOGIN-FORM-001 · 320px · light · en · signed out · world=empty · /login · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] LOGIN-FORM-002 · 320px · dark · hi · signed out · world=empty · /login · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] LOGIN-FORM-003 · 390px · light · hi · signed out · world=empty · /login · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] LOGIN-FORM-004 · 390px · dark · en · signed out · world=empty · /login · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] LOGIN-FORM-005 · 480px · light · en · signed out · world=empty · /login · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] LOGIN-FORM-006 · 480px · dark · hi · signed out · world=empty · /login · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] LOGIN-FORM-007 · 768px · light · en · signed out · world=empty · /login · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] LOGIN-FORM-008 · 768px · dark · hi · signed out · world=empty · /login · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] LOGIN-FORM-009 · 1024px · light · en · signed out · world=empty · /login · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] LOGIN-FORM-010 · 1024px · dark · hi · signed out · world=empty · /login · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] LOGIN-FORM-011 · 1280px · light · en · signed out · world=empty · /login · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] LOGIN-FORM-012 · 1280px · dark · hi · signed out · world=empty · /login · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] LOGIN-FORM-013 · 1440px · light · en · signed out · world=empty · /login · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] LOGIN-FORM-014 · 1440px · dark · hi · signed out · world=empty · /login · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi
- [ ] LOGIN-FORM-015 · 1920px · light · en · signed out · world=empty · /login · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] LOGIN-FORM-016 · 1920px · dark · hi · signed out · world=empty · /login · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe hindi

## Policies

### POL-PAGE — Policy pages (sections, anchors)

Pairwise (all pairs of values); 40 states; scope `main`.

- [ ] POL-PAGE-001 · 320px · light · en · signed out · world=empty · /policies/returns · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-002 · 320px · dark · hi · signed out · world=empty · /policies/privacy · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-003 · 390px · light · hi · signed out · world=empty · /policies/delivery · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-004 · 390px · dark · en · signed out · world=empty · /terms · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-005 · 480px · light · en · signed out · world=empty · /policies/company · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-006 · 480px · dark · hi · signed out · world=empty · /policies/returns · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-007 · 768px · light · en · signed out · world=empty · /policies/privacy · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-008 · 768px · dark · hi · signed out · world=empty · /policies/company · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-009 · 1024px · light · en · signed out · world=empty · /policies/delivery · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-010 · 1024px · dark · hi · signed out · world=empty · /terms · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-011 · 1280px · light · en · signed out · world=empty · /terms · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-012 · 1280px · dark · hi · signed out · world=empty · /policies/delivery · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-013 · 1440px · light · en · signed out · world=empty · /policies/returns · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-014 · 1440px · dark · hi · signed out · world=empty · /policies/privacy · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-015 · 1920px · light · en · signed out · world=empty · /policies/company · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-016 · 1920px · dark · hi · signed out · world=empty · /policies/returns · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-017 · 320px · light · en · signed out · world=empty · /policies/delivery · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-018 · 320px · dark · hi · signed out · world=empty · /terms · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-019 · 320px · light · en · signed out · world=empty · /policies/company · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-020 · 390px · dark · hi · signed out · world=empty · /policies/returns · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-021 · 390px · light · en · signed out · world=empty · /policies/privacy · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-022 · 390px · dark · hi · signed out · world=empty · /policies/company · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-023 · 480px · light · en · signed out · world=empty · /policies/privacy · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-024 · 480px · dark · hi · signed out · world=empty · /policies/delivery · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-025 · 480px · light · en · signed out · world=empty · /terms · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-026 · 768px · dark · hi · signed out · world=empty · /policies/returns · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-027 · 768px · light · en · signed out · world=empty · /policies/delivery · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-028 · 768px · dark · hi · signed out · world=empty · /terms · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-029 · 1024px · light · en · signed out · world=empty · /policies/returns · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-030 · 1024px · dark · hi · signed out · world=empty · /policies/privacy · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-031 · 1024px · light · en · signed out · world=empty · /policies/company · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-032 · 1280px · dark · hi · signed out · world=empty · /policies/returns · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-033 · 1280px · light · en · signed out · world=empty · /policies/privacy · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-034 · 1280px · dark · hi · signed out · world=empty · /policies/company · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-035 · 1440px · light · en · signed out · world=empty · /policies/delivery · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-036 · 1440px · dark · hi · signed out · world=empty · /terms · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-037 · 1440px · light · en · signed out · world=empty · /policies/company · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] POL-PAGE-038 · 1920px · dark · hi · signed out · world=empty · /policies/privacy · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] POL-PAGE-039 · 1920px · light · en · signed out · world=empty · /policies/delivery · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] POL-PAGE-040 · 1920px · dark · hi · signed out · world=empty · /terms · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Shop portal (/partner/shop)

### PRT-SHOP — Shop portal: offers with timer, accept/decline, orders, prices

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] PRT-SHOP-001 · 320px · light · en · shop partner · world=empty · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PRT-SHOP-002 · 320px · dark · hi · shop partner · world=busy · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-SHOP-003 · 390px · light · hi · shop partner · world=empty · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-SHOP-004 · 390px · dark · en · shop partner · world=busy · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console axe · core
- [ ] PRT-SHOP-005 · 480px · light · en · shop partner · world=busy · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PRT-SHOP-006 · 480px · dark · hi · shop partner · world=empty · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-SHOP-007 · 768px · light · en · shop partner · world=empty · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PRT-SHOP-008 · 768px · dark · hi · shop partner · world=busy · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-SHOP-009 · 1024px · light · en · shop partner · world=empty · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PRT-SHOP-010 · 1024px · dark · hi · shop partner · world=busy · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-SHOP-011 · 1280px · light · en · shop partner · world=empty · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PRT-SHOP-012 · 1280px · dark · hi · shop partner · world=busy · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-SHOP-013 · 1440px · light · en · shop partner · world=empty · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PRT-SHOP-014 · 1440px · dark · hi · shop partner · world=busy · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-SHOP-015 · 1920px · light · en · shop partner · world=empty · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PRT-SHOP-016 · 1920px · dark · hi · shop partner · world=busy · /partner/shop · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Workshop portal (/partner/workshop)

### PRT-WORKSHOP — Workshop portal: requests, proposal, estimate lines, bill

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] PRT-WORKSHOP-001 · 320px · light · en · workshop partner · world=empty · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PRT-WORKSHOP-002 · 320px · dark · hi · workshop partner · world=busy · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-WORKSHOP-003 · 390px · light · hi · workshop partner · world=empty · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-WORKSHOP-004 · 390px · dark · en · workshop partner · world=busy · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PRT-WORKSHOP-005 · 480px · light · en · workshop partner · world=busy · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PRT-WORKSHOP-006 · 480px · dark · hi · workshop partner · world=empty · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-WORKSHOP-007 · 768px · light · en · workshop partner · world=empty · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PRT-WORKSHOP-008 · 768px · dark · hi · workshop partner · world=busy · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-WORKSHOP-009 · 1024px · light · en · workshop partner · world=empty · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PRT-WORKSHOP-010 · 1024px · dark · hi · workshop partner · world=busy · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-WORKSHOP-011 · 1280px · light · en · workshop partner · world=empty · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PRT-WORKSHOP-012 · 1280px · dark · hi · workshop partner · world=busy · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-WORKSHOP-013 · 1440px · light · en · workshop partner · world=empty · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] PRT-WORKSHOP-014 · 1440px · dark · hi · workshop partner · world=busy · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] PRT-WORKSHOP-015 · 1920px · light · en · workshop partner · world=empty · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] PRT-WORKSHOP-016 · 1920px · dark · hi · workshop partner · world=busy · /partner/workshop · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Admin console (/admin)

### ADM-OVERVIEW — Admin section: overview (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-OVERVIEW-001 · 320px · light · en · admin · world=empty · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-OVERVIEW-002 · 320px · dark · hi · admin · world=busy · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-OVERVIEW-003 · 390px · light · hi · admin · world=empty · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-OVERVIEW-004 · 390px · dark · en · admin · world=busy · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-OVERVIEW-005 · 480px · light · en · admin · world=busy · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-OVERVIEW-006 · 480px · dark · hi · admin · world=empty · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-OVERVIEW-007 · 768px · light · en · admin · world=empty · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-OVERVIEW-008 · 768px · dark · hi · admin · world=busy · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-OVERVIEW-009 · 1024px · light · en · admin · world=empty · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-OVERVIEW-010 · 1024px · dark · hi · admin · world=busy · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-OVERVIEW-011 · 1280px · light · en · admin · world=empty · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-OVERVIEW-012 · 1280px · dark · hi · admin · world=busy · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-OVERVIEW-013 · 1440px · light · en · admin · world=empty · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-OVERVIEW-014 · 1440px · dark · hi · admin · world=busy · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-OVERVIEW-015 · 1920px · light · en · admin · world=empty · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-OVERVIEW-016 · 1920px · dark · hi · admin · world=busy · /admin · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-ORDERS — Admin section: orders (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-ORDERS-001 · 320px · light · en · admin · world=empty · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-ORDERS-002 · 320px · dark · hi · admin · world=busy · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-ORDERS-003 · 390px · light · hi · admin · world=empty · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-ORDERS-004 · 390px · dark · en · admin · world=busy · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-ORDERS-005 · 480px · light · en · admin · world=busy · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-ORDERS-006 · 480px · dark · hi · admin · world=empty · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-ORDERS-007 · 768px · light · en · admin · world=empty · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-ORDERS-008 · 768px · dark · hi · admin · world=busy · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-ORDERS-009 · 1024px · light · en · admin · world=empty · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-ORDERS-010 · 1024px · dark · hi · admin · world=busy · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-ORDERS-011 · 1280px · light · en · admin · world=empty · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-ORDERS-012 · 1280px · dark · hi · admin · world=busy · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-ORDERS-013 · 1440px · light · en · admin · world=empty · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-ORDERS-014 · 1440px · dark · hi · admin · world=busy · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi axe · core
- [ ] ADM-ORDERS-015 · 1920px · light · en · admin · world=empty · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-ORDERS-016 · 1920px · dark · hi · admin · world=busy · /admin/orders · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-SERVICES — Admin section: services (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-SERVICES-001 · 320px · light · en · admin · world=empty · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SERVICES-002 · 320px · dark · hi · admin · world=busy · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SERVICES-003 · 390px · light · hi · admin · world=empty · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SERVICES-004 · 390px · dark · en · admin · world=busy · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SERVICES-005 · 480px · light · en · admin · world=busy · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SERVICES-006 · 480px · dark · hi · admin · world=empty · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SERVICES-007 · 768px · light · en · admin · world=empty · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SERVICES-008 · 768px · dark · hi · admin · world=busy · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SERVICES-009 · 1024px · light · en · admin · world=empty · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SERVICES-010 · 1024px · dark · hi · admin · world=busy · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SERVICES-011 · 1280px · light · en · admin · world=empty · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SERVICES-012 · 1280px · dark · hi · admin · world=busy · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SERVICES-013 · 1440px · light · en · admin · world=empty · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SERVICES-014 · 1440px · dark · hi · admin · world=busy · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SERVICES-015 · 1920px · light · en · admin · world=empty · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SERVICES-016 · 1920px · dark · hi · admin · world=busy · /admin/services · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-QUOTES — Admin section: quotes (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-QUOTES-001 · 320px · light · en · admin · world=empty · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-QUOTES-002 · 320px · dark · hi · admin · world=busy · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-QUOTES-003 · 390px · light · hi · admin · world=empty · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-QUOTES-004 · 390px · dark · en · admin · world=busy · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-QUOTES-005 · 480px · light · en · admin · world=busy · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-QUOTES-006 · 480px · dark · hi · admin · world=empty · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-QUOTES-007 · 768px · light · en · admin · world=empty · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-QUOTES-008 · 768px · dark · hi · admin · world=busy · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-QUOTES-009 · 1024px · light · en · admin · world=empty · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-QUOTES-010 · 1024px · dark · hi · admin · world=busy · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-QUOTES-011 · 1280px · light · en · admin · world=empty · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-QUOTES-012 · 1280px · dark · hi · admin · world=busy · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-QUOTES-013 · 1440px · light · en · admin · world=empty · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-QUOTES-014 · 1440px · dark · hi · admin · world=busy · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-QUOTES-015 · 1920px · light · en · admin · world=empty · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-QUOTES-016 · 1920px · dark · hi · admin · world=busy · /admin/quotes · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-APPLICATIONS — Admin section: applications (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-APPLICATIONS-001 · 320px · light · en · admin · world=empty · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-APPLICATIONS-002 · 320px · dark · hi · admin · world=busy · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-APPLICATIONS-003 · 390px · light · hi · admin · world=empty · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-APPLICATIONS-004 · 390px · dark · en · admin · world=busy · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-APPLICATIONS-005 · 480px · light · en · admin · world=busy · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-APPLICATIONS-006 · 480px · dark · hi · admin · world=empty · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-APPLICATIONS-007 · 768px · light · en · admin · world=empty · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-APPLICATIONS-008 · 768px · dark · hi · admin · world=busy · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-APPLICATIONS-009 · 1024px · light · en · admin · world=empty · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-APPLICATIONS-010 · 1024px · dark · hi · admin · world=busy · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-APPLICATIONS-011 · 1280px · light · en · admin · world=empty · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-APPLICATIONS-012 · 1280px · dark · hi · admin · world=busy · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-APPLICATIONS-013 · 1440px · light · en · admin · world=empty · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-APPLICATIONS-014 · 1440px · dark · hi · admin · world=busy · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-APPLICATIONS-015 · 1920px · light · en · admin · world=empty · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-APPLICATIONS-016 · 1920px · dark · hi · admin · world=busy · /admin/applications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-PARTNERS — Admin section: partners (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-PARTNERS-001 · 320px · light · en · admin · world=empty · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-002 · 320px · dark · hi · admin · world=busy · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-003 · 390px · light · hi · admin · world=empty · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-004 · 390px · dark · en · admin · world=busy · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-005 · 480px · light · en · admin · world=busy · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-006 · 480px · dark · hi · admin · world=empty · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-007 · 768px · light · en · admin · world=empty · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-008 · 768px · dark · hi · admin · world=busy · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-009 · 1024px · light · en · admin · world=empty · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-010 · 1024px · dark · hi · admin · world=busy · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-011 · 1280px · light · en · admin · world=empty · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-012 · 1280px · dark · hi · admin · world=busy · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-013 · 1440px · light · en · admin · world=empty · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-014 · 1440px · dark · hi · admin · world=busy · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-015 · 1920px · light · en · admin · world=empty · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-016 · 1920px · dark · hi · admin · world=busy · /admin/partners · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-CATALOGUE — Admin section: catalogue (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-CATALOGUE-001 · 320px · light · en · admin · world=empty · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CATALOGUE-002 · 320px · dark · hi · admin · world=busy · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CATALOGUE-003 · 390px · light · hi · admin · world=empty · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CATALOGUE-004 · 390px · dark · en · admin · world=busy · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CATALOGUE-005 · 480px · light · en · admin · world=busy · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CATALOGUE-006 · 480px · dark · hi · admin · world=empty · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CATALOGUE-007 · 768px · light · en · admin · world=empty · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CATALOGUE-008 · 768px · dark · hi · admin · world=busy · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CATALOGUE-009 · 1024px · light · en · admin · world=empty · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CATALOGUE-010 · 1024px · dark · hi · admin · world=busy · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CATALOGUE-011 · 1280px · light · en · admin · world=empty · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CATALOGUE-012 · 1280px · dark · hi · admin · world=busy · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CATALOGUE-013 · 1440px · light · en · admin · world=empty · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CATALOGUE-014 · 1440px · dark · hi · admin · world=busy · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CATALOGUE-015 · 1920px · light · en · admin · world=empty · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CATALOGUE-016 · 1920px · dark · hi · admin · world=busy · /admin/catalogue · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-CUSTOMERS — Admin section: customers (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-CUSTOMERS-001 · 320px · light · en · admin · world=empty · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CUSTOMERS-002 · 320px · dark · hi · admin · world=busy · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CUSTOMERS-003 · 390px · light · hi · admin · world=empty · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CUSTOMERS-004 · 390px · dark · en · admin · world=busy · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CUSTOMERS-005 · 480px · light · en · admin · world=busy · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CUSTOMERS-006 · 480px · dark · hi · admin · world=empty · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CUSTOMERS-007 · 768px · light · en · admin · world=empty · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CUSTOMERS-008 · 768px · dark · hi · admin · world=busy · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CUSTOMERS-009 · 1024px · light · en · admin · world=empty · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CUSTOMERS-010 · 1024px · dark · hi · admin · world=busy · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CUSTOMERS-011 · 1280px · light · en · admin · world=empty · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CUSTOMERS-012 · 1280px · dark · hi · admin · world=busy · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CUSTOMERS-013 · 1440px · light · en · admin · world=empty · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CUSTOMERS-014 · 1440px · dark · hi · admin · world=busy · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CUSTOMERS-015 · 1920px · light · en · admin · world=empty · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CUSTOMERS-016 · 1920px · dark · hi · admin · world=busy · /admin/customers · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-REVIEWS — Admin section: reviews (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-REVIEWS-001 · 320px · light · en · admin · world=empty · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-REVIEWS-002 · 320px · dark · hi · admin · world=busy · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-REVIEWS-003 · 390px · light · hi · admin · world=empty · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-REVIEWS-004 · 390px · dark · en · admin · world=busy · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-REVIEWS-005 · 480px · light · en · admin · world=busy · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-REVIEWS-006 · 480px · dark · hi · admin · world=empty · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-REVIEWS-007 · 768px · light · en · admin · world=empty · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-REVIEWS-008 · 768px · dark · hi · admin · world=busy · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-REVIEWS-009 · 1024px · light · en · admin · world=empty · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-REVIEWS-010 · 1024px · dark · hi · admin · world=busy · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-REVIEWS-011 · 1280px · light · en · admin · world=empty · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-REVIEWS-012 · 1280px · dark · hi · admin · world=busy · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-REVIEWS-013 · 1440px · light · en · admin · world=empty · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-REVIEWS-014 · 1440px · dark · hi · admin · world=busy · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-REVIEWS-015 · 1920px · light · en · admin · world=empty · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-REVIEWS-016 · 1920px · dark · hi · admin · world=busy · /admin/reviews · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-SUPPORT — Admin section: support (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-SUPPORT-001 · 320px · light · en · admin · world=empty · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SUPPORT-002 · 320px · dark · hi · admin · world=busy · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SUPPORT-003 · 390px · light · hi · admin · world=empty · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SUPPORT-004 · 390px · dark · en · admin · world=busy · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SUPPORT-005 · 480px · light · en · admin · world=busy · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SUPPORT-006 · 480px · dark · hi · admin · world=empty · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SUPPORT-007 · 768px · light · en · admin · world=empty · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SUPPORT-008 · 768px · dark · hi · admin · world=busy · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SUPPORT-009 · 1024px · light · en · admin · world=empty · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SUPPORT-010 · 1024px · dark · hi · admin · world=busy · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SUPPORT-011 · 1280px · light · en · admin · world=empty · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SUPPORT-012 · 1280px · dark · hi · admin · world=busy · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SUPPORT-013 · 1440px · light · en · admin · world=empty · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SUPPORT-014 · 1440px · dark · hi · admin · world=busy · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SUPPORT-015 · 1920px · light · en · admin · world=empty · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SUPPORT-016 · 1920px · dark · hi · admin · world=busy · /admin/support · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-COINS — Admin section: coins (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-COINS-001 · 320px · light · en · admin · world=empty · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-COINS-002 · 320px · dark · hi · admin · world=busy · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-COINS-003 · 390px · light · hi · admin · world=empty · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-COINS-004 · 390px · dark · en · admin · world=busy · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-COINS-005 · 480px · light · en · admin · world=busy · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-COINS-006 · 480px · dark · hi · admin · world=empty · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-COINS-007 · 768px · light · en · admin · world=empty · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-COINS-008 · 768px · dark · hi · admin · world=busy · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-COINS-009 · 1024px · light · en · admin · world=empty · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-COINS-010 · 1024px · dark · hi · admin · world=busy · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-COINS-011 · 1280px · light · en · admin · world=empty · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-COINS-012 · 1280px · dark · hi · admin · world=busy · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-COINS-013 · 1440px · light · en · admin · world=empty · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-COINS-014 · 1440px · dark · hi · admin · world=busy · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-COINS-015 · 1920px · light · en · admin · world=empty · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-COINS-016 · 1920px · dark · hi · admin · world=busy · /admin/coins · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-CONTENT — Admin section: content (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-CONTENT-001 · 320px · light · en · admin · world=empty · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CONTENT-002 · 320px · dark · hi · admin · world=busy · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CONTENT-003 · 390px · light · hi · admin · world=empty · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CONTENT-004 · 390px · dark · en · admin · world=busy · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CONTENT-005 · 480px · light · en · admin · world=busy · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CONTENT-006 · 480px · dark · hi · admin · world=empty · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CONTENT-007 · 768px · light · en · admin · world=empty · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CONTENT-008 · 768px · dark · hi · admin · world=busy · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CONTENT-009 · 1024px · light · en · admin · world=empty · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CONTENT-010 · 1024px · dark · hi · admin · world=busy · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CONTENT-011 · 1280px · light · en · admin · world=empty · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CONTENT-012 · 1280px · dark · hi · admin · world=busy · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CONTENT-013 · 1440px · light · en · admin · world=empty · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-CONTENT-014 · 1440px · dark · hi · admin · world=busy · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-CONTENT-015 · 1920px · light · en · admin · world=empty · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-CONTENT-016 · 1920px · dark · hi · admin · world=busy · /admin/content · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-LAYOUT — Admin section: layout (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-LAYOUT-001 · 320px · light · en · admin · world=empty · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-LAYOUT-002 · 320px · dark · hi · admin · world=busy · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-LAYOUT-003 · 390px · light · hi · admin · world=empty · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-LAYOUT-004 · 390px · dark · en · admin · world=busy · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-LAYOUT-005 · 480px · light · en · admin · world=busy · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-LAYOUT-006 · 480px · dark · hi · admin · world=empty · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-LAYOUT-007 · 768px · light · en · admin · world=empty · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-LAYOUT-008 · 768px · dark · hi · admin · world=busy · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-LAYOUT-009 · 1024px · light · en · admin · world=empty · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-LAYOUT-010 · 1024px · dark · hi · admin · world=busy · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-LAYOUT-011 · 1280px · light · en · admin · world=empty · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-LAYOUT-012 · 1280px · dark · hi · admin · world=busy · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-LAYOUT-013 · 1440px · light · en · admin · world=empty · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-LAYOUT-014 · 1440px · dark · hi · admin · world=busy · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-LAYOUT-015 · 1920px · light · en · admin · world=empty · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-LAYOUT-016 · 1920px · dark · hi · admin · world=busy · /admin/layout · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-SETTINGS — Admin section: settings (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-SETTINGS-001 · 320px · light · en · admin · world=empty · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SETTINGS-002 · 320px · dark · hi · admin · world=busy · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SETTINGS-003 · 390px · light · hi · admin · world=empty · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SETTINGS-004 · 390px · dark · en · admin · world=busy · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SETTINGS-005 · 480px · light · en · admin · world=busy · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SETTINGS-006 · 480px · dark · hi · admin · world=empty · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SETTINGS-007 · 768px · light · en · admin · world=empty · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SETTINGS-008 · 768px · dark · hi · admin · world=busy · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SETTINGS-009 · 1024px · light · en · admin · world=empty · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SETTINGS-010 · 1024px · dark · hi · admin · world=busy · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SETTINGS-011 · 1280px · light · en · admin · world=empty · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SETTINGS-012 · 1280px · dark · hi · admin · world=busy · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SETTINGS-013 · 1440px · light · en · admin · world=empty · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-SETTINGS-014 · 1440px · dark · hi · admin · world=busy · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-SETTINGS-015 · 1920px · light · en · admin · world=empty · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-SETTINGS-016 · 1920px · dark · hi · admin · world=busy · /admin/settings · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

### ADM-NOTIFICATIONS — Admin section: notifications (section bar, tables, actions)

Pairwise (all pairs of values); 16 states; scope `main`.

- [ ] ADM-NOTIFICATIONS-001 · 320px · light · en · admin · world=empty · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-NOTIFICATIONS-002 · 320px · dark · hi · admin · world=busy · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-NOTIFICATIONS-003 · 390px · light · hi · admin · world=empty · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-NOTIFICATIONS-004 · 390px · dark · en · admin · world=busy · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-NOTIFICATIONS-005 · 480px · light · en · admin · world=busy · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-NOTIFICATIONS-006 · 480px · dark · hi · admin · world=empty · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-NOTIFICATIONS-007 · 768px · light · en · admin · world=empty · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-NOTIFICATIONS-008 · 768px · dark · hi · admin · world=busy · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-NOTIFICATIONS-009 · 1024px · light · en · admin · world=empty · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-NOTIFICATIONS-010 · 1024px · dark · hi · admin · world=busy · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-NOTIFICATIONS-011 · 1280px · light · en · admin · world=empty · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-NOTIFICATIONS-012 · 1280px · dark · hi · admin · world=busy · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-NOTIFICATIONS-013 · 1440px · light · en · admin · world=empty · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-NOTIFICATIONS-014 · 1440px · dark · hi · admin · world=busy · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-NOTIFICATIONS-015 · 1920px · light · en · admin · world=empty · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-NOTIFICATIONS-016 · 1920px · dark · hi · admin · world=busy · /admin/notifications · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

## Navigation

### NAV-HEADER — Header nav (1024 px and up): current item, hover, focus, every role and route

Full cross of the high-risk dimensions, the rest pairwise; 31 states; scope `header.sticky nav`.

- [ ] NAV-HEADER-001 · 1024px · light · en · signed out · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-HEADER-002 · 1024px · dark · hi · customer · world=empty · /shop · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe · core
- [ ] NAV-HEADER-003 · 1024px · light · hi · shop partner · world=empty · /workshops · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-004 · 1024px · dark · en · workshop partner · world=empty · /cart · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-HEADER-005 · 1024px · light · en · admin · world=empty · /policies/returns · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-HEADER-006 · 1280px · dark · hi · signed out · world=empty · /policies/returns · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-007 · 1280px · light · en · customer · world=empty · /shop · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-HEADER-008 · 1280px · dark · en · shop partner · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-HEADER-009 · 1280px · light · hi · workshop partner · world=empty · /cart · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe
- [ ] NAV-HEADER-010 · 1280px · dark · hi · admin · world=empty · /workshops · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-011 · 1440px · light · en · signed out · world=empty · /workshops · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-HEADER-012 · 1440px · dark · hi · customer · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-013 · 1440px · light · en · shop partner · world=empty · /shop · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-HEADER-014 · 1440px · dark · hi · workshop partner · world=empty · /policies/returns · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-015 · 1440px · light · en · admin · world=empty · /cart · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-HEADER-016 · 1920px · dark · hi · signed out · world=empty · /shop · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-017 · 1920px · light · en · customer · world=empty · /workshops · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-HEADER-018 · 1920px · dark · hi · shop partner · world=empty · /cart · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-019 · 1920px · light · en · workshop partner · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-HEADER-020 · 1920px · dark · hi · admin · world=empty · /admin · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-021 · 1920px · light · en · customer · world=empty · /policies/returns · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-HEADER-022 · 1024px · dark · hi · signed out · world=empty · /cart · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe · core
- [ ] NAV-HEADER-023 · 1280px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-HEADER-024 · 1440px · dark · hi · customer · world=empty · /cart · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-025 · 1024px · light · en · shop partner · world=empty · /policies/returns · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-HEADER-026 · 1280px · dark · hi · shop partner · world=empty · /partner/shop · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-027 · 1440px · light · en · workshop partner · world=empty · /shop · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-HEADER-028 · 1920px · dark · hi · workshop partner · world=empty · /workshops · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-029 · 1024px · light · en · workshop partner · world=empty · /partner/workshop · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-HEADER-030 · 1280px · dark · hi · admin · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-HEADER-031 · 1440px · light · en · admin · world=empty · /shop · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav

### NAV-TABBAR — Bottom tab bar (under 1024 px): current tab, long Hindi labels, every role, walk

Full cross of the high-risk dimensions, the rest pairwise; 26 states; scope `nav.fixed`.

- [ ] NAV-TABBAR-001 · 320px · light · en · signed out · world=empty · / · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-TABBAR-002 · 320px · dark · hi · customer · world=empty · /shop · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe · core
- [ ] NAV-TABBAR-003 · 390px · dark · en · signed out · world=empty · /workshops · cart=many20 · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-TABBAR-004 · 390px · light · hi · customer · world=empty · /cart · cart=none · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-005 · 480px · light · en · customer · world=empty · /policies/returns · cart=many20 · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-TABBAR-006 · 480px · dark · hi · signed out · world=empty · / · cart=none · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-007 · 768px · light · en · signed out · world=empty · /shop · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-TABBAR-008 · 768px · dark · hi · customer · world=empty · /workshops · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-009 · 1023px · light · en · signed out · world=empty · /cart · cart=many20 · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-TABBAR-010 · 1023px · dark · hi · customer · world=empty · /policies/returns · cart=none · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-011 · 320px · light · en · signed out · world=empty · /workshops · cart=none · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-TABBAR-012 · 320px · dark · hi · customer · world=empty · /cart · cart=many20 · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-013 · 320px · light · en · signed out · world=empty · /policies/returns · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-TABBAR-014 · 390px · dark · hi · customer · world=empty · / · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-015 · 390px · light · en · signed out · world=empty · /shop · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-TABBAR-016 · 390px · dark · hi · customer · world=empty · /policies/returns · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-017 · 480px · light · en · signed out · world=empty · /shop · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-TABBAR-018 · 480px · dark · hi · customer · world=empty · /workshops · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-019 · 480px · light · en · signed out · world=empty · /cart · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-TABBAR-020 · 768px · dark · hi · customer · world=empty · / · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-021 · 768px · light · en · signed out · world=empty · /cart · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-TABBAR-022 · 768px · dark · hi · customer · world=empty · /policies/returns · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-023 · 1023px · light · en · signed out · world=empty · / · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-TABBAR-024 · 1023px · dark · hi · customer · world=empty · /shop · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-TABBAR-025 · 1023px · light · en · signed out · world=empty · /workshops · cart=none · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-TABBAR-026 · 320px · dark · hi · customer · world=empty · /account/vehicles · cart=many20 · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe · core

### NAV-ACCOUNT — Account section bar: current section on each of the nine sections (scrolls on phones)

Full cross of the high-risk dimensions, the rest pairwise; 72 states; scope `main nav.overflow-x-auto`.

- [ ] NAV-ACCOUNT-001 · 320px · light · en · customer · world=empty · /account · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-002 · 320px · dark · hi · customer · world=busy · /account/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-003 · 320px · light · hi · customer · world=empty · /account/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-004 · 320px · dark · en · customer · world=busy · /account/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-005 · 320px · light · en · customer · world=busy · /account/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-006 · 320px · dark · hi · customer · world=empty · /account/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-007 · 320px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-008 · 320px · dark · hi · customer · world=busy · /account/addresses · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-009 · 320px · light · en · customer · world=empty · /account/profile · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-010 · 390px · dark · hi · customer · world=busy · /account · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-011 · 390px · light · en · customer · world=empty · /account/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-012 · 390px · dark · en · customer · world=busy · /account/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-013 · 390px · light · hi · customer · world=empty · /account/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe
- [ ] NAV-ACCOUNT-014 · 390px · dark · hi · customer · world=empty · /account/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-015 · 390px · light · en · customer · world=busy · /account/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-016 · 390px · dark · hi · customer · world=busy · /account/vehicles · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-017 · 390px · light · en · customer · world=empty · /account/addresses · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-018 · 390px · dark · hi · customer · world=busy · /account/profile · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-019 · 480px · light · en · customer · world=empty · /account · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-020 · 480px · dark · hi · customer · world=busy · /account/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-021 · 480px · light · en · customer · world=empty · /account/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-022 · 480px · dark · hi · customer · world=busy · /account/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-023 · 480px · light · en · customer · world=empty · /account/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-024 · 480px · dark · hi · customer · world=busy · /account/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-025 · 480px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-026 · 480px · dark · hi · customer · world=busy · /account/addresses · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-027 · 480px · light · en · customer · world=empty · /account/profile · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-028 · 768px · dark · hi · customer · world=busy · /account · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-029 · 768px · light · en · customer · world=empty · /account/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-030 · 768px · dark · hi · customer · world=busy · /account/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-031 · 768px · light · en · customer · world=empty · /account/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-032 · 768px · dark · hi · customer · world=busy · /account/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-033 · 768px · light · en · customer · world=empty · /account/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-034 · 768px · dark · hi · customer · world=busy · /account/vehicles · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-035 · 768px · light · en · customer · world=empty · /account/addresses · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-036 · 768px · dark · hi · customer · world=busy · /account/profile · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-037 · 1024px · light · en · customer · world=empty · /account · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-038 · 1024px · dark · hi · customer · world=busy · /account/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-039 · 1024px · light · en · customer · world=empty · /account/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-040 · 1024px · dark · hi · customer · world=busy · /account/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-041 · 1024px · light · en · customer · world=empty · /account/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-042 · 1024px · dark · hi · customer · world=busy · /account/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-043 · 1024px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-044 · 1024px · dark · hi · customer · world=busy · /account/addresses · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-045 · 1024px · light · en · customer · world=empty · /account/profile · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-046 · 1280px · dark · hi · customer · world=busy · /account · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-047 · 1280px · light · en · customer · world=empty · /account/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-048 · 1280px · dark · hi · customer · world=busy · /account/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-049 · 1280px · light · en · customer · world=empty · /account/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-050 · 1280px · dark · hi · customer · world=busy · /account/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-051 · 1280px · light · en · customer · world=empty · /account/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-052 · 1280px · dark · hi · customer · world=busy · /account/vehicles · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-053 · 1280px · light · en · customer · world=empty · /account/addresses · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-054 · 1280px · dark · hi · customer · world=busy · /account/profile · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-055 · 1440px · light · en · customer · world=empty · /account · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-056 · 1440px · dark · hi · customer · world=busy · /account/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-057 · 1440px · light · en · customer · world=empty · /account/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-058 · 1440px · dark · hi · customer · world=busy · /account/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-059 · 1440px · light · en · customer · world=empty · /account/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-060 · 1440px · dark · hi · customer · world=busy · /account/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-061 · 1440px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-062 · 1440px · dark · hi · customer · world=busy · /account/addresses · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-063 · 1440px · light · en · customer · world=empty · /account/profile · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-064 · 1920px · dark · hi · customer · world=busy · /account · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-065 · 1920px · light · en · customer · world=empty · /account/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-066 · 1920px · dark · hi · customer · world=busy · /account/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-067 · 1920px · light · en · customer · world=empty · /account/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-068 · 1920px · dark · hi · customer · world=busy · /account/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-069 · 1920px · light · en · customer · world=empty · /account/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ACCOUNT-070 · 1920px · dark · hi · customer · world=busy · /account/vehicles · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ACCOUNT-071 · 1920px · light · en · customer · world=empty · /account/addresses · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ACCOUNT-072 · 1920px · dark · hi · customer · world=busy · /account/profile · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi

### NAV-ADMIN — Admin section bar: current section on each demo section (scrolls on phones, column from 1024 px)

Full cross of the high-risk dimensions, the rest pairwise; 120 states; scope `main nav.overflow-x-auto`.

- [ ] NAV-ADMIN-001 · 320px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-002 · 320px · dark · hi · admin · world=busy · /admin/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-003 · 320px · light · hi · admin · world=empty · /admin/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-004 · 320px · dark · en · admin · world=busy · /admin/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-005 · 320px · light · en · admin · world=busy · /admin/applications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-006 · 320px · dark · hi · admin · world=empty · /admin/partners · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-007 · 320px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-008 · 320px · dark · hi · admin · world=busy · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-009 · 320px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-010 · 320px · dark · hi · admin · world=busy · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-011 · 320px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-012 · 320px · dark · hi · admin · world=busy · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-013 · 320px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-014 · 320px · dark · hi · admin · world=busy · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-015 · 320px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-016 · 390px · dark · hi · admin · world=busy · /admin · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-017 · 390px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-018 · 390px · dark · en · admin · world=busy · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-019 · 390px · light · hi · admin · world=empty · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-020 · 390px · dark · hi · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-021 · 390px · light · en · admin · world=busy · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-022 · 390px · dark · hi · admin · world=busy · /admin/catalogue · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-023 · 390px · light · en · admin · world=empty · /admin/customers · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-024 · 390px · dark · hi · admin · world=busy · /admin/reviews · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-025 · 390px · light · en · admin · world=empty · /admin/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-026 · 390px · dark · hi · admin · world=busy · /admin/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-027 · 390px · light · en · admin · world=empty · /admin/content · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-028 · 390px · dark · hi · admin · world=busy · /admin/layout · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-029 · 390px · light · en · admin · world=empty · /admin/settings · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-030 · 390px · dark · hi · admin · world=busy · /admin/notifications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-031 · 480px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-032 · 480px · dark · hi · admin · world=busy · /admin/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-033 · 480px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-034 · 480px · dark · hi · admin · world=busy · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-035 · 480px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-036 · 480px · dark · hi · admin · world=busy · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-037 · 480px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-038 · 480px · dark · hi · admin · world=busy · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-039 · 480px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-040 · 480px · dark · hi · admin · world=busy · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-041 · 480px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-042 · 480px · dark · hi · admin · world=busy · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-043 · 480px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-044 · 480px · dark · hi · admin · world=busy · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-045 · 480px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-046 · 768px · dark · hi · admin · world=busy · /admin · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-047 · 768px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-048 · 768px · dark · hi · admin · world=busy · /admin/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-049 · 768px · light · en · admin · world=empty · /admin/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-050 · 768px · dark · hi · admin · world=busy · /admin/applications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-051 · 768px · light · en · admin · world=empty · /admin/partners · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-052 · 768px · dark · hi · admin · world=busy · /admin/catalogue · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-053 · 768px · light · en · admin · world=empty · /admin/customers · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-054 · 768px · dark · hi · admin · world=busy · /admin/reviews · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-055 · 768px · light · en · admin · world=empty · /admin/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-056 · 768px · dark · hi · admin · world=busy · /admin/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-057 · 768px · light · en · admin · world=empty · /admin/content · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-058 · 768px · dark · hi · admin · world=busy · /admin/layout · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-059 · 768px · light · en · admin · world=empty · /admin/settings · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-060 · 768px · dark · hi · admin · world=busy · /admin/notifications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-061 · 1024px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-062 · 1024px · dark · hi · admin · world=busy · /admin/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-063 · 1024px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-064 · 1024px · dark · hi · admin · world=busy · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-065 · 1024px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-066 · 1024px · dark · hi · admin · world=busy · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-067 · 1024px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-068 · 1024px · dark · hi · admin · world=busy · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-069 · 1024px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-070 · 1024px · dark · hi · admin · world=busy · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-071 · 1024px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-072 · 1024px · dark · hi · admin · world=busy · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-073 · 1024px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-074 · 1024px · dark · hi · admin · world=busy · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-075 · 1024px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-076 · 1280px · dark · hi · admin · world=busy · /admin · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-077 · 1280px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-078 · 1280px · dark · hi · admin · world=busy · /admin/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-079 · 1280px · light · en · admin · world=empty · /admin/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-080 · 1280px · dark · hi · admin · world=busy · /admin/applications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-081 · 1280px · light · en · admin · world=empty · /admin/partners · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-082 · 1280px · dark · hi · admin · world=busy · /admin/catalogue · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-083 · 1280px · light · en · admin · world=empty · /admin/customers · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-084 · 1280px · dark · hi · admin · world=busy · /admin/reviews · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-085 · 1280px · light · en · admin · world=empty · /admin/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-086 · 1280px · dark · hi · admin · world=busy · /admin/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-087 · 1280px · light · en · admin · world=empty · /admin/content · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-088 · 1280px · dark · hi · admin · world=busy · /admin/layout · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-089 · 1280px · light · en · admin · world=empty · /admin/settings · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-090 · 1280px · dark · hi · admin · world=busy · /admin/notifications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-091 · 1440px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-092 · 1440px · dark · hi · admin · world=busy · /admin/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-093 · 1440px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-094 · 1440px · dark · hi · admin · world=busy · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-095 · 1440px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-096 · 1440px · dark · hi · admin · world=busy · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-097 · 1440px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-098 · 1440px · dark · hi · admin · world=busy · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-099 · 1440px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-100 · 1440px · dark · hi · admin · world=busy · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-101 · 1440px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-102 · 1440px · dark · hi · admin · world=busy · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-103 · 1440px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-104 · 1440px · dark · hi · admin · world=busy · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-105 · 1440px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-106 · 1920px · dark · hi · admin · world=busy · /admin · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-107 · 1920px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-108 · 1920px · dark · hi · admin · world=busy · /admin/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-109 · 1920px · light · en · admin · world=empty · /admin/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-110 · 1920px · dark · hi · admin · world=busy · /admin/applications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-111 · 1920px · light · en · admin · world=empty · /admin/partners · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-112 · 1920px · dark · hi · admin · world=busy · /admin/catalogue · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-113 · 1920px · light · en · admin · world=empty · /admin/customers · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-114 · 1920px · dark · hi · admin · world=busy · /admin/reviews · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-115 · 1920px · light · en · admin · world=empty · /admin/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-116 · 1920px · dark · hi · admin · world=busy · /admin/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-117 · 1920px · light · en · admin · world=empty · /admin/content · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-ADMIN-118 · 1920px · dark · hi · admin · world=busy · /admin/layout · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-ADMIN-119 · 1920px · light · en · admin · world=empty · /admin/settings · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-ADMIN-120 · 1920px · dark · hi · admin · world=busy · /admin/notifications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi

### NAV-CATEGORY — Shop category chips (scroll row): current chip, every chip applies its filter

Pairwise (all pairs of values); 24 states; scope `main nav.overflow-x-auto`.

- [ ] NAV-CATEGORY-001 · 320px · light · en · signed out · world=empty · /shop · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-CATEGORY-002 · 320px · dark · hi · customer · world=empty · /shop?category=batteries · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-003 · 390px · light · hi · signed out · world=empty · /shop?category=tyres · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-004 · 390px · dark · en · customer · world=empty · /shop · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-CATEGORY-005 · 480px · light · en · customer · world=empty · /shop?category=batteries · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-CATEGORY-006 · 480px · dark · hi · signed out · world=empty · /shop?category=tyres · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-007 · 768px · light · en · signed out · world=empty · /shop?category=batteries · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-CATEGORY-008 · 768px · dark · hi · customer · world=empty · /shop · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-009 · 1024px · light · en · signed out · world=empty · /shop?category=tyres · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-CATEGORY-010 · 1024px · dark · hi · customer · world=empty · /shop · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-011 · 1280px · light · en · signed out · world=empty · /shop?category=batteries · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-CATEGORY-012 · 1280px · dark · hi · customer · world=empty · /shop?category=tyres · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-013 · 1440px · light · en · signed out · world=empty · /shop · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-CATEGORY-014 · 1440px · dark · hi · customer · world=empty · /shop?category=batteries · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-015 · 1920px · light · en · signed out · world=empty · /shop?category=tyres · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-CATEGORY-016 · 1920px · dark · hi · customer · world=empty · /shop · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-017 · 320px · light · en · signed out · world=empty · /shop?category=tyres · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-CATEGORY-018 · 390px · dark · hi · customer · world=empty · /shop?category=batteries · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-019 · 480px · light · en · signed out · world=empty · /shop · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-CATEGORY-020 · 768px · dark · hi · customer · world=empty · /shop?category=tyres · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-021 · 1024px · light · en · signed out · world=empty · /shop?category=batteries · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-CATEGORY-022 · 1280px · dark · hi · customer · world=empty · /shop · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-CATEGORY-023 · 1440px · light · en · signed out · world=empty · /shop?category=tyres · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-CATEGORY-024 · 1920px · dark · hi · customer · world=empty · /shop?category=batteries · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi

### NAV-FOOTER — Footer links: every link opens its page (help, policies, partners, support)

Pairwise (all pairs of values); 16 states; scope `footer`.

- [ ] NAV-FOOTER-001 · 320px · light · en · signed out · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-FOOTER-002 · 320px · dark · hi · customer · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-FOOTER-003 · 390px · light · hi · signed out · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-FOOTER-004 · 390px · dark · en · customer · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-FOOTER-005 · 480px · light · en · customer · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-FOOTER-006 · 480px · dark · hi · signed out · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-FOOTER-007 · 768px · light · en · signed out · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-FOOTER-008 · 768px · dark · hi · customer · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-FOOTER-009 · 1024px · light · en · signed out · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-FOOTER-010 · 1024px · dark · hi · customer · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-FOOTER-011 · 1280px · light · en · signed out · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-FOOTER-012 · 1280px · dark · hi · customer · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-FOOTER-013 · 1440px · light · en · signed out · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] NAV-FOOTER-014 · 1440px · dark · hi · customer · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] NAV-FOOTER-015 · 1920px · light · en · signed out · world=empty · / · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] NAV-FOOTER-016 · 1920px · dark · hi · customer · world=empty · / · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi

## Admin console (/admin/partners)

### ADM-PARTNERS-TABS — Partners: invites, price requests, agreement card, shop / workshop / mechanic tabs, pause prompt

Pairwise (all pairs of values); 25 states; scope `main`.

- [ ] ADM-PARTNERS-TABS-001 · 320px · light · en · admin · world=empty · /admin/partners · tab=shop · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-TABS-002 · 320px · dark · hi · admin · world=busy · /admin/partners · tab=workshop · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-003 · 390px · light · hi · admin · world=empty · /admin/partners · tab=mechanic · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-004 · 390px · dark · en · admin · world=busy · /admin/partners · tab=shop · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-TABS-005 · 480px · light · en · admin · world=busy · /admin/partners · tab=workshop · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-TABS-006 · 480px · dark · hi · admin · world=empty · /admin/partners · tab=mechanic · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-007 · 768px · light · en · admin · world=empty · /admin/partners · tab=workshop · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-TABS-008 · 768px · dark · hi · admin · world=busy · /admin/partners · tab=shop · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-009 · 1024px · light · en · admin · world=empty · /admin/partners · tab=mechanic · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-TABS-010 · 1024px · dark · hi · admin · world=busy · /admin/partners · tab=shop · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-011 · 1280px · light · en · admin · world=empty · /admin/partners · tab=workshop · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-TABS-012 · 1280px · dark · hi · admin · world=busy · /admin/partners · tab=mechanic · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-013 · 1440px · light · en · admin · world=empty · /admin/partners · tab=shop · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-TABS-014 · 1440px · dark · hi · admin · world=busy · /admin/partners · tab=workshop · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-015 · 1920px · light · en · admin · world=empty · /admin/partners · tab=mechanic · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-TABS-016 · 1920px · dark · hi · admin · world=busy · /admin/partners · tab=shop · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-017 · 320px · light · en · admin · world=empty · /admin/partners · tab=mechanic · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-TABS-018 · 390px · dark · hi · admin · world=busy · /admin/partners · tab=workshop · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-019 · 480px · light · en · admin · world=empty · /admin/partners · tab=shop · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-TABS-020 · 768px · dark · hi · admin · world=busy · /admin/partners · tab=mechanic · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-021 · 1024px · light · en · admin · world=empty · /admin/partners · tab=workshop · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] ADM-PARTNERS-TABS-022 · 1280px · dark · hi · admin · world=busy · /admin/partners · tab=shop · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-023 · 1440px · light · en · admin · world=empty · /admin/partners · tab=mechanic · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] ADM-PARTNERS-TABS-024 · 1920px · dark · hi · admin · world=busy · /admin/partners · tab=workshop · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] ADM-PARTNERS-TABS-025 · 390px · light · en · admin · world=empty · /admin/partners · tab=shop · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe

## Workshop finder (/workshops), real sign-in

### API-SVC-HOMEFIND — Mode switch (at the workshop / at my home), saved-address picker, home listing with the visit fee: none, some, at the radius edge

Pairwise (all pairs of values); 8 states; scope `main`.

- [ ] API-SVC-HOMEFIND-001 · 320px · light · en · customer · world=empty · /workshops · mode=home · addresses=none · listing=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEFIND-002 · 390px · dark · hi · customer · world=empty · /workshops · mode=home · addresses=unpinned · listing=some · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEFIND-003 · 480px · light · en · customer · world=empty · /workshops · mode=home · addresses=pinned · listing=edge · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEFIND-004 · 768px · dark · hi · customer · world=empty · /workshops · mode=home · addresses=none · listing=error · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEFIND-005 · 1024px · light · en · customer · world=empty · /workshops · mode=home · addresses=unpinned · listing=none · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEFIND-006 · 1280px · dark · hi · customer · world=empty · /workshops · mode=home · addresses=pinned · listing=some · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEFIND-007 · 1440px · light · en · customer · world=empty · /workshops · mode=home · addresses=none · listing=edge · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEFIND-008 · 1920px · dark · hi · customer · world=empty · /workshops · mode=home · addresses=unpinned · listing=error · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Service request (/service/{code}), real sign-in

### API-SVC-HOMEREQ — Home visit panel: mechanic, rating, address, visit fee, arrival code (shown / locked / used), offer to move (waiting / accepted / declined), visit-fee line on the bill

Pairwise (all pairs of values); 72 states; scope `main`.

- [ ] API-SVC-HOMEREQ-001 · 320px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-code · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-002 · 320px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-locked · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-003 · 390px · light · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-004 · 390px · dark · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived-override · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-005 · 480px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-offer · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-006 · 480px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-007 · 768px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-declined · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-008 · 768px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=fee-waived · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-009 · 1024px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=billed-fee · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-010 · 1024px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-code · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-011 · 1280px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-locked · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-012 · 1280px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-offer · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-013 · 1440px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-accepted · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-014 · 1440px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-declined · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-015 · 1920px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=fee-waived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-016 · 1920px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=billed-fee · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-017 · 320px · dark · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-018 · 320px · light · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived-override · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-019 · 320px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-offer · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-020 · 320px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-accepted · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-021 · 320px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-022 · 320px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=fee-waived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-023 · 320px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=billed-fee · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-024 · 390px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-code · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-025 · 390px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-locked · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-026 · 390px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-offer · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-027 · 390px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-028 · 390px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-029 · 390px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=fee-waived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-030 · 390px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=billed-fee · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-031 · 480px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-code · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-032 · 480px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-locked · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-033 · 480px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-034 · 480px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived-override · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-035 · 480px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-declined · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-036 · 480px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=fee-waived · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-037 · 480px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=billed-fee · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-038 · 768px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-code · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-039 · 768px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-locked · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-040 · 768px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-041 · 768px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived-override · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-042 · 768px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-offer · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-043 · 768px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-044 · 768px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=billed-fee · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-045 · 1024px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-locked · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-046 · 1024px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-047 · 1024px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived-override · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-048 · 1024px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-offer · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-049 · 1024px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-050 · 1024px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-051 · 1024px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=fee-waived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-052 · 1280px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-code · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-053 · 1280px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-054 · 1280px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived-override · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-055 · 1280px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-056 · 1280px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-057 · 1280px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=fee-waived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-058 · 1280px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=billed-fee · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-059 · 1440px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-code · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-060 · 1440px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-locked · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-061 · 1440px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-062 · 1440px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived-override · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-063 · 1440px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-offer · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-064 · 1440px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=fee-waived · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-065 · 1440px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=billed-fee · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-066 · 1920px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-code · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-067 · 1920px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=confirmed-locked · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-068 · 1920px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-069 · 1920px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=arrived-override · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-SVC-HOMEREQ-070 · 1920px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-offer · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-SVC-HOMEREQ-071 · 1920px · light · en · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-SVC-HOMEREQ-072 · 1920px · dark · hi · customer · world=empty · /service/SR-RPR-2026-HND401 · home=move-declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Workshop portal (/partner/workshop), real sign-in

### API-WS-HOMEJOB — Home servicing settings card; new home request (mechanic name); arrival entry (code and odometer: right / wrong / locked); offer to move; fee due after a declined move

Pairwise (all pairs of values); 56 states; scope `main`.

- [ ] API-WS-HOMEJOB-001 · 320px · light · en · workshop partner · world=empty · /partner/workshop · job=propose · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-002 · 320px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-003 · 390px · light · hi · workshop partner · world=empty · /partner/workshop · job=arrival-wrong · settings=off · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-004 · 390px · dark · en · workshop partner · world=empty · /partner/workshop · job=arrival-locked · settings=on · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-005 · 480px · light · en · workshop partner · world=empty · /partner/workshop · job=offer-move · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-006 · 480px · dark · hi · workshop partner · world=empty · /partner/workshop · job=move-waiting · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-007 · 768px · light · en · workshop partner · world=empty · /partner/workshop · job=fee-due · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-008 · 768px · dark · hi · workshop partner · world=empty · /partner/workshop · job=propose · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-009 · 1024px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-010 · 1024px · dark · hi · workshop partner · world=empty · /partner/workshop · job=offer-move · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-011 · 1280px · light · en · workshop partner · world=empty · /partner/workshop · job=move-waiting · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-012 · 1280px · dark · hi · workshop partner · world=empty · /partner/workshop · job=fee-due · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-013 · 1440px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival-wrong · settings=on · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-014 · 1440px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival-locked · settings=off · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-015 · 1920px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival-locked · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-016 · 1920px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival-wrong · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-017 · 320px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival-wrong · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-018 · 320px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival-locked · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-019 · 320px · light · en · workshop partner · world=empty · /partner/workshop · job=offer-move · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-020 · 320px · dark · hi · workshop partner · world=empty · /partner/workshop · job=move-waiting · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-021 · 320px · light · en · workshop partner · world=empty · /partner/workshop · job=fee-due · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-022 · 390px · dark · hi · workshop partner · world=empty · /partner/workshop · job=propose · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-023 · 390px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-024 · 390px · dark · hi · workshop partner · world=empty · /partner/workshop · job=offer-move · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-025 · 390px · light · en · workshop partner · world=empty · /partner/workshop · job=move-waiting · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-026 · 390px · dark · hi · workshop partner · world=empty · /partner/workshop · job=fee-due · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-027 · 480px · light · en · workshop partner · world=empty · /partner/workshop · job=propose · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-028 · 480px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-029 · 480px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival-wrong · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-030 · 480px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival-locked · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-031 · 480px · light · en · workshop partner · world=empty · /partner/workshop · job=fee-due · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-032 · 768px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-033 · 768px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival-wrong · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-034 · 768px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival-locked · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-035 · 768px · light · en · workshop partner · world=empty · /partner/workshop · job=offer-move · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-036 · 768px · dark · hi · workshop partner · world=empty · /partner/workshop · job=move-waiting · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-037 · 1024px · light · en · workshop partner · world=empty · /partner/workshop · job=propose · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-038 · 1024px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival-wrong · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-039 · 1024px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival-locked · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-040 · 1024px · dark · hi · workshop partner · world=empty · /partner/workshop · job=move-waiting · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-041 · 1024px · light · en · workshop partner · world=empty · /partner/workshop · job=fee-due · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-042 · 1280px · dark · hi · workshop partner · world=empty · /partner/workshop · job=propose · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-043 · 1280px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-044 · 1280px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival-wrong · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-045 · 1280px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival-locked · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-046 · 1280px · dark · hi · workshop partner · world=empty · /partner/workshop · job=offer-move · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-047 · 1440px · light · en · workshop partner · world=empty · /partner/workshop · job=propose · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-048 · 1440px · dark · hi · workshop partner · world=empty · /partner/workshop · job=arrival · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-049 · 1440px · light · en · workshop partner · world=empty · /partner/workshop · job=offer-move · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-050 · 1440px · dark · hi · workshop partner · world=empty · /partner/workshop · job=move-waiting · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-051 · 1440px · light · en · workshop partner · world=empty · /partner/workshop · job=fee-due · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-052 · 1920px · dark · hi · workshop partner · world=empty · /partner/workshop · job=propose · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-053 · 1920px · light · en · workshop partner · world=empty · /partner/workshop · job=arrival · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-WS-HOMEJOB-054 · 1920px · dark · hi · workshop partner · world=empty · /partner/workshop · job=offer-move · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-WS-HOMEJOB-055 · 1920px · light · en · workshop partner · world=empty · /partner/workshop · job=move-waiting · settings=off · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-WS-HOMEJOB-056 · 1920px · dark · hi · workshop partner · world=empty · /partner/workshop · job=fee-due · settings=on · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Admin console (/admin/refunds)

### API-ADM-REFUNDQ — Refund queue: view buttons, list rows, detail (approve / decline with reason / pay by hand with UTR), alerts

Pairwise (all pairs of values); 65 states; scope `main`.

- [ ] API-ADM-REFUNDQ-001 · 320px · light · en · admin · world=empty · /admin/refunds · view=waiting · refund=requested · detail=closed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-002 · 320px · dark · hi · admin · world=busy · /admin/refunds · view=overdue · refund=requested-own · detail=open · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-003 · 390px · light · hi · admin · world=empty · /admin/refunds · view=in_progress · refund=overdue · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-004 · 390px · dark · en · admin · world=busy · /admin/refunds · view=attention · refund=approved-razorpay · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-005 · 480px · light · en · admin · world=busy · /admin/refunds · view=closed · refund=approved-cod · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-006 · 480px · dark · hi · admin · world=empty · /admin/refunds · view=waiting · refund=processed · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-007 · 768px · light · en · admin · world=empty · /admin/refunds · view=overdue · refund=failed · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-008 · 768px · dark · hi · admin · world=busy · /admin/refunds · view=in_progress · refund=needs-reconciliation · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-009 · 1024px · light · en · admin · world=empty · /admin/refunds · view=attention · refund=requested-own · detail=closed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-010 · 1024px · dark · hi · admin · world=busy · /admin/refunds · view=closed · refund=requested · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-011 · 1280px · light · en · admin · world=empty · /admin/refunds · view=in_progress · refund=approved-razorpay · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-012 · 1280px · dark · hi · admin · world=busy · /admin/refunds · view=waiting · refund=failed · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-013 · 1440px · light · en · admin · world=empty · /admin/refunds · view=closed · refund=needs-reconciliation · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-014 · 1440px · dark · hi · admin · world=busy · /admin/refunds · view=attention · refund=overdue · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-015 · 1920px · light · en · admin · world=empty · /admin/refunds · view=overdue · refund=processed · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-016 · 1920px · dark · hi · admin · world=busy · /admin/refunds · view=waiting · refund=approved-cod · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-017 · 320px · light · en · admin · world=empty · /admin/refunds · view=in_progress · refund=approved-cod · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-018 · 320px · dark · hi · admin · world=busy · /admin/refunds · view=attention · refund=processed · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-019 · 320px · light · en · admin · world=empty · /admin/refunds · view=closed · refund=overdue · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-020 · 390px · dark · hi · admin · world=busy · /admin/refunds · view=waiting · refund=requested-own · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-021 · 390px · light · en · admin · world=empty · /admin/refunds · view=overdue · refund=requested · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-022 · 390px · dark · hi · admin · world=busy · /admin/refunds · view=closed · refund=approved-razorpay · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-023 · 480px · light · en · admin · world=empty · /admin/refunds · view=overdue · refund=needs-reconciliation · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-024 · 480px · dark · hi · admin · world=busy · /admin/refunds · view=in_progress · refund=failed · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-025 · 480px · light · en · admin · world=empty · /admin/refunds · view=attention · refund=requested · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-026 · 768px · dark · hi · admin · world=busy · /admin/refunds · view=waiting · refund=overdue · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-027 · 768px · light · en · admin · world=empty · /admin/refunds · view=attention · refund=approved-cod · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-028 · 768px · dark · hi · admin · world=busy · /admin/refunds · view=closed · refund=requested-own · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-029 · 1024px · light · en · admin · world=empty · /admin/refunds · view=waiting · refund=approved-razorpay · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-030 · 1024px · dark · hi · admin · world=busy · /admin/refunds · view=overdue · refund=overdue · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-031 · 1024px · light · en · admin · world=empty · /admin/refunds · view=in_progress · refund=processed · detail=closed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-032 · 1280px · dark · hi · admin · world=busy · /admin/refunds · view=overdue · refund=approved-cod · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-033 · 1280px · light · en · admin · world=empty · /admin/refunds · view=attention · refund=needs-reconciliation · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-034 · 1280px · dark · hi · admin · world=busy · /admin/refunds · view=closed · refund=processed · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-035 · 1440px · light · en · admin · world=empty · /admin/refunds · view=waiting · refund=failed · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-036 · 1440px · dark · hi · admin · world=busy · /admin/refunds · view=overdue · refund=approved-razorpay · detail=open · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-037 · 1440px · light · en · admin · world=empty · /admin/refunds · view=in_progress · refund=requested · detail=closed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-038 · 1920px · dark · hi · admin · world=busy · /admin/refunds · view=in_progress · refund=requested-own · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-039 · 1920px · light · en · admin · world=empty · /admin/refunds · view=attention · refund=failed · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-040 · 1920px · dark · hi · admin · world=busy · /admin/refunds · view=closed · refund=needs-reconciliation · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-041 · 320px · light · en · admin · world=empty · /admin/refunds · view=waiting · refund=approved-razorpay · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-042 · 320px · dark · hi · admin · world=busy · /admin/refunds · view=closed · refund=failed · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-043 · 320px · light · en · admin · world=empty · /admin/refunds · view=waiting · refund=needs-reconciliation · detail=closed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-044 · 390px · dark · hi · admin · world=busy · /admin/refunds · view=overdue · refund=approved-cod · detail=open · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-045 · 390px · light · en · admin · world=empty · /admin/refunds · view=in_progress · refund=processed · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-046 · 390px · dark · hi · admin · world=busy · /admin/refunds · view=attention · refund=failed · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-047 · 390px · light · en · admin · world=empty · /admin/refunds · view=overdue · refund=needs-reconciliation · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-048 · 480px · dark · hi · admin · world=busy · /admin/refunds · view=in_progress · refund=requested-own · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-049 · 480px · light · en · admin · world=empty · /admin/refunds · view=attention · refund=overdue · detail=closed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-050 · 480px · dark · hi · admin · world=busy · /admin/refunds · view=closed · refund=approved-razorpay · detail=open · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-051 · 768px · light · en · admin · world=empty · /admin/refunds · view=waiting · refund=requested · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-052 · 768px · dark · hi · admin · world=busy · /admin/refunds · view=overdue · refund=approved-razorpay · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-053 · 768px · light · en · admin · world=empty · /admin/refunds · view=in_progress · refund=processed · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-054 · 1024px · dark · hi · admin · world=busy · /admin/refunds · view=attention · refund=approved-cod · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-055 · 1024px · light · en · admin · world=empty · /admin/refunds · view=closed · refund=failed · detail=closed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-056 · 1024px · dark · hi · admin · world=busy · /admin/refunds · view=waiting · refund=needs-reconciliation · detail=open · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-057 · 1280px · light · en · admin · world=empty · /admin/refunds · view=overdue · refund=requested · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-058 · 1280px · dark · hi · admin · world=busy · /admin/refunds · view=in_progress · refund=requested-own · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-059 · 1280px · light · en · admin · world=empty · /admin/refunds · view=attention · refund=overdue · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-060 · 1440px · dark · hi · admin · world=busy · /admin/refunds · view=closed · refund=requested-own · detail=open · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-061 · 1440px · light · en · admin · world=empty · /admin/refunds · view=waiting · refund=approved-cod · detail=closed · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-REFUNDQ-062 · 1440px · dark · hi · admin · world=busy · /admin/refunds · view=overdue · refund=processed · detail=open · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-063 · 1920px · light · en · admin · world=empty · /admin/refunds · view=in_progress · refund=requested · detail=closed · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-REFUNDQ-064 · 1920px · dark · hi · admin · world=busy · /admin/refunds · view=attention · refund=overdue · detail=open · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-REFUNDQ-065 · 1920px · light · en · admin · world=empty · /admin/refunds · view=closed · refund=approved-razorpay · detail=closed · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe

## Order page (/orders/{code})

### API-ORD-REFUNDLINE — Refund status line under a part: under review, processing, refunded, declined, failed (+ support link)

Pairwise (all pairs of values); 48 states; scope `main`.

- [ ] API-ORD-REFUNDLINE-001 · 320px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=under_review · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-002 · 320px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=processing · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-003 · 390px · light · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=refunded · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-004 · 390px · dark · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-005 · 480px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=failed · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-006 · 480px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=two-refunds · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-007 · 768px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=processing · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-008 · 768px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=under_review · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-009 · 1024px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=two-refunds · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-010 · 1024px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=failed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-011 · 1280px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=refunded · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-012 · 1280px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=declined · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-013 · 1440px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=declined · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-014 · 1440px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=refunded · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-015 · 1920px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=under_review · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-016 · 1920px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=processing · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-017 · 320px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=refunded · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-018 · 320px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-019 · 320px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=failed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-020 · 320px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=two-refunds · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-021 · 390px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=under_review · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-022 · 390px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=processing · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-023 · 390px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=failed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-024 · 390px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=two-refunds · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-025 · 480px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=under_review · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-026 · 480px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=processing · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-027 · 480px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=refunded · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-028 · 480px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-029 · 768px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=refunded · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-030 · 768px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-031 · 768px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=failed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-032 · 768px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=two-refunds · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-033 · 1024px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=under_review · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-034 · 1024px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=processing · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-035 · 1024px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=refunded · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-036 · 1024px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-037 · 1280px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=under_review · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-038 · 1280px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=processing · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-039 · 1280px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=failed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-040 · 1280px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=two-refunds · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-041 · 1440px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=under_review · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-042 · 1440px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=processing · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-043 · 1440px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=failed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-044 · 1440px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=two-refunds · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-045 · 1920px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=refunded · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ORD-REFUNDLINE-046 · 1920px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=declined · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ORD-REFUNDLINE-047 · 1920px · light · en · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=failed · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ORD-REFUNDLINE-048 · 1920px · dark · hi · customer · world=busy · /orders/MD-RPR-2026-HND301 · refund=two-refunds · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Shop portal (/partner/shop), real sign-in

### API-SHOP-PORTAL — Orders from the API with the give-up form, the shop's warnings, its hours and standing, its agreement

Pairwise (all pairs of values); 63 states; scope `main`.

- [ ] API-SHOP-PORTAL-001 · 320px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=none · warnings=none · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-002 · 320px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=offer · warnings=one · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-003 · 390px · light · hi · shop partner · world=empty · /partner/shop · shop=suspended · orders=confirmed · warnings=threshold · giveup=open · agreement=accepted · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-004 · 390px · dark · en · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=packed · warnings=withdrawn · giveup=closed · agreement=new-version · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-005 · 480px · light · en · shop partner · world=empty · /partner/shop · shop=paused · orders=given-up-history · warnings=long-note · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-006 · 480px · dark · hi · shop partner · world=empty · /partner/shop · shop=open · orders=many · warnings=error · giveup=empty-submit · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-007 · 768px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=offer · warnings=error · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-008 · 768px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=none · warnings=long-note · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-009 · 1024px · light · en · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=many · warnings=one · giveup=filled · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-010 · 1024px · dark · hi · shop partner · world=empty · /partner/shop · shop=suspended · orders=given-up-history · warnings=none · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-011 · 1280px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=confirmed · warnings=withdrawn · giveup=empty-submit · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-012 · 1280px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=packed · warnings=threshold · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-013 · 1440px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=packed · warnings=one · giveup=closed · agreement=accepted · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-014 · 1440px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=confirmed · warnings=none · giveup=filled · agreement=new-version · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-015 · 1920px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=none · warnings=threshold · giveup=closed · agreement=new-version · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-016 · 1920px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=offer · warnings=withdrawn · giveup=closed · agreement=accepted · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-017 · 320px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=many · warnings=long-note · giveup=open · agreement=new-version · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-018 · 320px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=given-up-history · warnings=error · giveup=closed · agreement=accepted · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-019 · 390px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=offer · warnings=long-note · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-020 · 390px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=none · warnings=error · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-021 · 480px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=packed · warnings=none · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-022 · 480px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=confirmed · warnings=one · giveup=open · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-023 · 768px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=given-up-history · warnings=threshold · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-024 · 768px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=many · warnings=withdrawn · giveup=open · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-025 · 1024px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=none · warnings=withdrawn · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-026 · 1024px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=offer · warnings=threshold · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-027 · 1280px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=given-up-history · warnings=one · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-028 · 1280px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=many · warnings=none · giveup=empty-submit · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-029 · 1440px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=none · warnings=withdrawn · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-030 · 1440px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=offer · warnings=threshold · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-031 · 1920px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=confirmed · warnings=long-note · giveup=filled · agreement=accepted · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-032 · 1920px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=packed · warnings=error · giveup=closed · agreement=new-version · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-033 · 320px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=confirmed · warnings=error · giveup=filled · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-034 · 320px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=packed · warnings=long-note · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-035 · 390px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=given-up-history · warnings=none · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-036 · 390px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=many · warnings=one · giveup=empty-submit · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-037 · 480px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=none · warnings=one · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-038 · 480px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=offer · warnings=none · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-039 · 768px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=confirmed · warnings=none · giveup=empty-submit · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-040 · 768px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=packed · warnings=one · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-041 · 1024px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=confirmed · warnings=long-note · giveup=open · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-042 · 1024px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=packed · warnings=error · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-043 · 1280px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=none · warnings=long-note · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-044 · 1280px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=offer · warnings=error · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-045 · 1440px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=given-up-history · warnings=withdrawn · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-046 · 1440px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=many · warnings=threshold · giveup=empty-submit · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-047 · 1920px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=given-up-history · warnings=none · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-048 · 1920px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=many · warnings=one · giveup=open · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-049 · 320px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=none · warnings=threshold · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-050 · 320px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=offer · warnings=withdrawn · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-051 · 480px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=confirmed · warnings=threshold · giveup=filled · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-052 · 480px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=packed · warnings=withdrawn · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-053 · 1440px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=given-up-history · warnings=long-note · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-054 · 1440px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=many · warnings=error · giveup=open · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-055 · 320px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=confirmed · warnings=long-note · giveup=empty-submit · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-056 · 390px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=many · warnings=withdrawn · giveup=filled · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-057 · 768px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=confirmed · warnings=none · giveup=filled · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-058 · 1024px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=many · warnings=one · giveup=empty-submit · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-059 · 1280px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=confirmed · warnings=none · giveup=open · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-SHOP-PORTAL-060 · 1280px · dark · hi · shop partner · world=empty · /partner/shop · shop=closed-hours · orders=many · warnings=threshold · giveup=filled · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-061 · 1920px · light · en · shop partner · world=empty · /partner/shop · shop=open · orders=confirmed · warnings=error · giveup=empty-submit · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-SHOP-PORTAL-062 · 390px · dark · hi · shop partner · world=empty · /partner/shop · shop=paused · orders=confirmed · warnings=one · giveup=closed · agreement=new-version · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-SHOP-PORTAL-063 · 768px · light · en · shop partner · world=empty · /partner/shop · shop=suspended · orders=many · warnings=threshold · giveup=closed · agreement=accepted · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned

## Admin → Partners → Shops, real sign-in

### API-ADM-SHOPS — Shop list with status filter and one shop open: profile (hours), PIN codes, products, standing, warnings (pause prompt), access

Pairwise (all pairs of values); 58 states; scope `main`.

- [ ] API-ADM-SHOPS-001 · 320px · light · en · admin · world=empty · /admin/partners · shops=none · panel=closed · warn=empty · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-002 · 320px · dark · hi · admin · world=empty · /admin/partners · shops=one · panel=profile · warn=issued · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-003 · 390px · light · hi · admin · world=empty · /admin/partners · shops=many · panel=coverage · warn=prompt · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-004 · 390px · dark · en · admin · world=empty · /admin/partners · shops=mixed-status · panel=products · warn=withdrawn · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-005 · 480px · light · en · admin · world=empty · /admin/partners · shops=error · panel=standing · warn=issued · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-006 · 480px · dark · hi · admin · world=empty · /admin/partners · shops=none · panel=warnings · warn=empty · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-007 · 768px · light · en · admin · world=empty · /admin/partners · shops=one · panel=members · warn=prompt · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-008 · 768px · dark · hi · admin · world=empty · /admin/partners · shops=error · panel=closed · warn=empty · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-009 · 1024px · light · en · admin · world=empty · /admin/partners · shops=many · panel=profile · warn=withdrawn · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-010 · 1024px · dark · hi · admin · world=empty · /admin/partners · shops=mixed-status · panel=standing · warn=prompt · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-011 · 1280px · light · en · admin · world=empty · /admin/partners · shops=mixed-status · panel=warnings · warn=issued · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-012 · 1280px · dark · hi · admin · world=empty · /admin/partners · shops=many · panel=members · warn=withdrawn · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-013 · 1440px · light · en · admin · world=empty · /admin/partners · shops=none · panel=coverage · warn=issued · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-014 · 1440px · dark · hi · admin · world=empty · /admin/partners · shops=one · panel=products · warn=empty · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-015 · 1920px · light · en · admin · world=empty · /admin/partners · shops=error · panel=products · warn=prompt · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-016 · 1920px · dark · hi · admin · world=empty · /admin/partners · shops=none · panel=profile · warn=withdrawn · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-017 · 320px · light · en · admin · world=empty · /admin/partners · shops=many · panel=standing · warn=empty · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-018 · 320px · dark · hi · admin · world=empty · /admin/partners · shops=mixed-status · panel=coverage · warn=withdrawn · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-019 · 320px · light · en · admin · world=empty · /admin/partners · shops=error · panel=warnings · warn=prompt · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-020 · 390px · dark · hi · admin · world=empty · /admin/partners · shops=none · panel=members · warn=issued · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-021 · 390px · light · en · admin · world=empty · /admin/partners · shops=one · panel=closed · warn=empty · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-022 · 390px · dark · hi · admin · world=empty · /admin/partners · shops=error · panel=profile · warn=prompt · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-023 · 480px · light · en · admin · world=empty · /admin/partners · shops=one · panel=coverage · warn=withdrawn · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-024 · 480px · dark · hi · admin · world=empty · /admin/partners · shops=many · panel=closed · warn=empty · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-025 · 480px · light · en · admin · world=empty · /admin/partners · shops=mixed-status · panel=members · warn=empty · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-026 · 768px · dark · hi · admin · world=empty · /admin/partners · shops=none · panel=products · warn=issued · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-027 · 768px · light · en · admin · world=empty · /admin/partners · shops=many · panel=warnings · warn=withdrawn · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-028 · 768px · dark · hi · admin · world=empty · /admin/partners · shops=mixed-status · panel=profile · warn=empty · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-029 · 1024px · light · en · admin · world=empty · /admin/partners · shops=none · panel=standing · warn=issued · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-030 · 1024px · dark · hi · admin · world=empty · /admin/partners · shops=one · panel=warnings · warn=empty · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-031 · 1024px · light · en · admin · world=empty · /admin/partners · shops=error · panel=coverage · warn=withdrawn · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-032 · 1280px · dark · hi · admin · world=empty · /admin/partners · shops=none · panel=closed · warn=empty · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-033 · 1280px · light · en · admin · world=empty · /admin/partners · shops=one · panel=standing · warn=prompt · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-034 · 1280px · dark · hi · admin · world=empty · /admin/partners · shops=error · panel=products · warn=issued · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-035 · 1440px · light · en · admin · world=empty · /admin/partners · shops=many · panel=members · warn=prompt · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-036 · 1440px · dark · hi · admin · world=empty · /admin/partners · shops=mixed-status · panel=closed · warn=empty · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-037 · 1440px · light · en · admin · world=empty · /admin/partners · shops=error · panel=profile · warn=withdrawn · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-038 · 1920px · dark · hi · admin · world=empty · /admin/partners · shops=one · panel=coverage · warn=empty · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-039 · 1920px · light · en · admin · world=empty · /admin/partners · shops=many · panel=products · warn=issued · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-040 · 1920px · dark · hi · admin · world=empty · /admin/partners · shops=mixed-status · panel=standing · warn=withdrawn · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-041 · 320px · light · en · admin · world=empty · /admin/partners · shops=none · panel=products · warn=prompt · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-042 · 320px · dark · hi · admin · world=empty · /admin/partners · shops=error · panel=members · warn=issued · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-043 · 390px · light · en · admin · world=empty · /admin/partners · shops=one · panel=standing · warn=prompt · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-044 · 390px · dark · hi · admin · world=empty · /admin/partners · shops=many · panel=warnings · warn=issued · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-045 · 480px · light · en · admin · world=empty · /admin/partners · shops=mixed-status · panel=profile · warn=prompt · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-046 · 480px · dark · hi · admin · world=empty · /admin/partners · shops=none · panel=products · warn=withdrawn · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-047 · 768px · light · en · admin · world=empty · /admin/partners · shops=one · panel=coverage · warn=issued · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-048 · 768px · dark · hi · admin · world=empty · /admin/partners · shops=many · panel=standing · warn=prompt · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-049 · 1024px · light · en · admin · world=empty · /admin/partners · shops=mixed-status · panel=closed · warn=empty · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-050 · 1024px · dark · hi · admin · world=empty · /admin/partners · shops=error · panel=products · warn=withdrawn · form=errors · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-051 · 1024px · light · en · admin · world=empty · /admin/partners · shops=none · panel=members · warn=issued · form=filled · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-052 · 1280px · dark · hi · admin · world=empty · /admin/partners · shops=one · panel=profile · warn=prompt · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-053 · 1280px · light · en · admin · world=empty · /admin/partners · shops=many · panel=coverage · warn=withdrawn · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-054 · 1440px · dark · hi · admin · world=empty · /admin/partners · shops=mixed-status · panel=standing · warn=issued · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-055 · 1440px · light · en · admin · world=empty · /admin/partners · shops=error · panel=warnings · warn=prompt · form=clean · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-SHOPS-056 · 1920px · dark · hi · admin · world=empty · /admin/partners · shops=none · panel=closed · warn=empty · form=clean · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-SHOPS-057 · 1920px · light · en · admin · world=empty · /admin/partners · shops=one · panel=warnings · warn=withdrawn · form=errors · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-SHOPS-058 · 1920px · dark · hi · admin · world=empty · /admin/partners · shops=many · panel=members · warn=issued · form=filled · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Admin → Orders (needs routing), real sign-in

### API-ADM-QUEUE — Reroute queue card with the shop's give-up reason and the "gave this order up before" tag

Pairwise (all pairs of values); 56 states; scope `main`.

- [ ] API-ADM-QUEUE-001 · 320px · light · en · admin · world=empty · /admin/orders · queue=empty · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-002 · 320px · dark · hi · admin · world=empty · /admin/orders · queue=reason-line · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-003 · 390px · light · hi · admin · world=empty · /admin/orders · queue=tag-on-suggestion · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-004 · 390px · dark · en · admin · world=empty · /admin/orders · queue=both · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-005 · 480px · light · en · admin · world=empty · /admin/orders · queue=neither · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-006 · 480px · dark · hi · admin · world=empty · /admin/orders · queue=many · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-007 · 768px · light · en · admin · world=empty · /admin/orders · queue=error · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-008 · 768px · dark · hi · admin · world=empty · /admin/orders · queue=empty · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-009 · 1024px · light · en · admin · world=empty · /admin/orders · queue=reason-line · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-010 · 1024px · dark · hi · admin · world=empty · /admin/orders · queue=neither · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-011 · 1280px · light · en · admin · world=empty · /admin/orders · queue=many · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-012 · 1280px · dark · hi · admin · world=empty · /admin/orders · queue=error · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-013 · 1440px · light · en · admin · world=empty · /admin/orders · queue=tag-on-suggestion · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-014 · 1440px · dark · hi · admin · world=empty · /admin/orders · queue=both · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-015 · 1920px · light · en · admin · world=empty · /admin/orders · queue=both · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-016 · 1920px · dark · hi · admin · world=empty · /admin/orders · queue=tag-on-suggestion · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-017 · 320px · light · en · admin · world=empty · /admin/orders · queue=tag-on-suggestion · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-018 · 320px · dark · hi · admin · world=empty · /admin/orders · queue=both · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-019 · 320px · light · en · admin · world=empty · /admin/orders · queue=neither · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-020 · 320px · dark · hi · admin · world=empty · /admin/orders · queue=many · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-021 · 320px · light · en · admin · world=empty · /admin/orders · queue=error · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-022 · 390px · dark · hi · admin · world=empty · /admin/orders · queue=empty · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-023 · 390px · light · en · admin · world=empty · /admin/orders · queue=reason-line · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-024 · 390px · dark · hi · admin · world=empty · /admin/orders · queue=neither · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-025 · 390px · light · en · admin · world=empty · /admin/orders · queue=many · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-026 · 390px · dark · hi · admin · world=empty · /admin/orders · queue=error · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-027 · 480px · light · en · admin · world=empty · /admin/orders · queue=empty · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-028 · 480px · dark · hi · admin · world=empty · /admin/orders · queue=reason-line · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-029 · 480px · light · en · admin · world=empty · /admin/orders · queue=tag-on-suggestion · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-030 · 480px · dark · hi · admin · world=empty · /admin/orders · queue=both · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-031 · 480px · light · en · admin · world=empty · /admin/orders · queue=error · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-032 · 768px · dark · hi · admin · world=empty · /admin/orders · queue=reason-line · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-033 · 768px · light · en · admin · world=empty · /admin/orders · queue=tag-on-suggestion · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-034 · 768px · dark · hi · admin · world=empty · /admin/orders · queue=both · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-035 · 768px · light · en · admin · world=empty · /admin/orders · queue=neither · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-036 · 768px · dark · hi · admin · world=empty · /admin/orders · queue=many · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-037 · 1024px · light · en · admin · world=empty · /admin/orders · queue=empty · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-038 · 1024px · dark · hi · admin · world=empty · /admin/orders · queue=tag-on-suggestion · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-039 · 1024px · light · en · admin · world=empty · /admin/orders · queue=both · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-040 · 1024px · dark · hi · admin · world=empty · /admin/orders · queue=many · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-041 · 1024px · light · en · admin · world=empty · /admin/orders · queue=error · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-042 · 1280px · dark · hi · admin · world=empty · /admin/orders · queue=empty · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-043 · 1280px · light · en · admin · world=empty · /admin/orders · queue=reason-line · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-044 · 1280px · dark · hi · admin · world=empty · /admin/orders · queue=tag-on-suggestion · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-045 · 1280px · light · en · admin · world=empty · /admin/orders · queue=both · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-046 · 1280px · dark · hi · admin · world=empty · /admin/orders · queue=neither · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-047 · 1440px · light · en · admin · world=empty · /admin/orders · queue=empty · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-048 · 1440px · dark · hi · admin · world=empty · /admin/orders · queue=reason-line · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-049 · 1440px · light · en · admin · world=empty · /admin/orders · queue=neither · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-050 · 1440px · dark · hi · admin · world=empty · /admin/orders · queue=many · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-051 · 1440px · light · en · admin · world=empty · /admin/orders · queue=error · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-052 · 1920px · dark · hi · admin · world=empty · /admin/orders · queue=empty · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-053 · 1920px · light · en · admin · world=empty · /admin/orders · queue=reason-line · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-QUEUE-054 · 1920px · dark · hi · admin · world=empty · /admin/orders · queue=neither · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-QUEUE-055 · 1920px · light · en · admin · world=empty · /admin/orders · queue=many · stress=none · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-QUEUE-056 · 1920px · dark · hi · admin · world=empty · /admin/orders · queue=error · stress=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

## Admin → Errors, real sign-in

### API-ADM-ERRORS — Sentry issues of the website and the API: not connected, none, many, one project down

Pairwise (all pairs of values); 48 states; scope `main`.

- [ ] API-ADM-ERRORS-001 · 320px · light · en · admin · world=empty · /admin/errors · errors=not-connected · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-002 · 320px · dark · hi · admin · world=empty · /admin/errors · errors=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-003 · 390px · light · hi · admin · world=empty · /admin/errors · errors=issues · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-004 · 390px · dark · en · admin · world=empty · /admin/errors · errors=one-down · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-005 · 480px · light · en · admin · world=empty · /admin/errors · errors=many-long · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-006 · 480px · dark · hi · admin · world=empty · /admin/errors · errors=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-007 · 768px · light · en · admin · world=empty · /admin/errors · errors=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-008 · 768px · dark · hi · admin · world=empty · /admin/errors · errors=not-connected · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-009 · 1024px · light · en · admin · world=empty · /admin/errors · errors=error · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-010 · 1024px · dark · hi · admin · world=empty · /admin/errors · errors=many-long · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-011 · 1280px · light · en · admin · world=empty · /admin/errors · errors=issues · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-012 · 1280px · dark · hi · admin · world=empty · /admin/errors · errors=one-down · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-013 · 1440px · light · en · admin · world=empty · /admin/errors · errors=one-down · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-014 · 1440px · dark · hi · admin · world=empty · /admin/errors · errors=issues · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-015 · 1920px · light · en · admin · world=empty · /admin/errors · errors=not-connected · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-016 · 1920px · dark · hi · admin · world=empty · /admin/errors · errors=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-017 · 320px · light · en · admin · world=empty · /admin/errors · errors=issues · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-018 · 320px · dark · hi · admin · world=empty · /admin/errors · errors=one-down · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-019 · 320px · light · en · admin · world=empty · /admin/errors · errors=many-long · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-020 · 320px · dark · hi · admin · world=empty · /admin/errors · errors=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-021 · 390px · light · en · admin · world=empty · /admin/errors · errors=not-connected · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-022 · 390px · dark · hi · admin · world=empty · /admin/errors · errors=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-023 · 390px · light · en · admin · world=empty · /admin/errors · errors=many-long · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-024 · 390px · dark · hi · admin · world=empty · /admin/errors · errors=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-025 · 480px · light · en · admin · world=empty · /admin/errors · errors=not-connected · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-026 · 480px · dark · hi · admin · world=empty · /admin/errors · errors=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-027 · 480px · light · en · admin · world=empty · /admin/errors · errors=issues · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-028 · 480px · dark · hi · admin · world=empty · /admin/errors · errors=one-down · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-029 · 768px · light · en · admin · world=empty · /admin/errors · errors=issues · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-030 · 768px · dark · hi · admin · world=empty · /admin/errors · errors=one-down · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-031 · 768px · light · en · admin · world=empty · /admin/errors · errors=many-long · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-032 · 768px · dark · hi · admin · world=empty · /admin/errors · errors=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-033 · 1024px · light · en · admin · world=empty · /admin/errors · errors=not-connected · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-034 · 1024px · dark · hi · admin · world=empty · /admin/errors · errors=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-035 · 1024px · light · en · admin · world=empty · /admin/errors · errors=issues · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-036 · 1024px · dark · hi · admin · world=empty · /admin/errors · errors=one-down · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-037 · 1280px · light · en · admin · world=empty · /admin/errors · errors=not-connected · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-038 · 1280px · dark · hi · admin · world=empty · /admin/errors · errors=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-039 · 1280px · light · en · admin · world=empty · /admin/errors · errors=many-long · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-040 · 1280px · dark · hi · admin · world=empty · /admin/errors · errors=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-041 · 1440px · light · en · admin · world=empty · /admin/errors · errors=not-connected · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-042 · 1440px · dark · hi · admin · world=empty · /admin/errors · errors=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-043 · 1440px · light · en · admin · world=empty · /admin/errors · errors=many-long · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-044 · 1440px · dark · hi · admin · world=empty · /admin/errors · errors=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-045 · 1920px · light · en · admin · world=empty · /admin/errors · errors=issues · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-ERRORS-046 · 1920px · dark · hi · admin · world=empty · /admin/errors · errors=one-down · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-ERRORS-047 · 1920px · light · en · admin · world=empty · /admin/errors · errors=many-long · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-ERRORS-048 · 1920px · dark · hi · admin · world=empty · /admin/errors · errors=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Admin → Analytics, real sign-in

### API-ADM-ANALYTICS — Dashboard: KPI tiles, daily chart, funnel, top lists, areas, shop and workshop tables, range and city

Pairwise (all pairs of values); 40 states; scope `main`.

- [ ] API-ADM-ANALYTICS-001 · 320px · light · en · admin · world=empty · /admin/analytics · analytics=empty · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-002 · 320px · dark · hi · admin · world=empty · /admin/analytics · analytics=full · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-003 · 390px · light · hi · admin · world=empty · /admin/analytics · analytics=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-004 · 390px · dark · en · admin · world=empty · /admin/analytics · analytics=city-scoped · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-005 · 480px · light · en · admin · world=empty · /admin/analytics · analytics=error · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-006 · 480px · dark · hi · admin · world=empty · /admin/analytics · analytics=empty · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-007 · 768px · light · en · admin · world=empty · /admin/analytics · analytics=full · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-008 · 768px · dark · hi · admin · world=empty · /admin/analytics · analytics=error · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-009 · 1024px · light · en · admin · world=empty · /admin/analytics · analytics=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-010 · 1024px · dark · hi · admin · world=empty · /admin/analytics · analytics=city-scoped · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-011 · 1280px · light · en · admin · world=empty · /admin/analytics · analytics=city-scoped · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-012 · 1280px · dark · hi · admin · world=empty · /admin/analytics · analytics=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-013 · 1440px · light · en · admin · world=empty · /admin/analytics · analytics=empty · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-014 · 1440px · dark · hi · admin · world=empty · /admin/analytics · analytics=full · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-015 · 1920px · light · en · admin · world=empty · /admin/analytics · analytics=error · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-016 · 1920px · dark · hi · admin · world=empty · /admin/analytics · analytics=empty · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-017 · 320px · light · en · admin · world=empty · /admin/analytics · analytics=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-018 · 320px · dark · hi · admin · world=empty · /admin/analytics · analytics=city-scoped · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-019 · 320px · light · en · admin · world=empty · /admin/analytics · analytics=error · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-020 · 390px · dark · hi · admin · world=empty · /admin/analytics · analytics=empty · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-021 · 390px · light · en · admin · world=empty · /admin/analytics · analytics=full · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-022 · 390px · dark · hi · admin · world=empty · /admin/analytics · analytics=error · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-023 · 480px · light · en · admin · world=empty · /admin/analytics · analytics=full · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-024 · 480px · dark · hi · admin · world=empty · /admin/analytics · analytics=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-025 · 480px · light · en · admin · world=empty · /admin/analytics · analytics=city-scoped · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-026 · 768px · dark · hi · admin · world=empty · /admin/analytics · analytics=empty · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-027 · 768px · light · en · admin · world=empty · /admin/analytics · analytics=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-028 · 768px · dark · hi · admin · world=empty · /admin/analytics · analytics=city-scoped · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-029 · 1024px · light · en · admin · world=empty · /admin/analytics · analytics=empty · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-030 · 1024px · dark · hi · admin · world=empty · /admin/analytics · analytics=full · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-031 · 1024px · light · en · admin · world=empty · /admin/analytics · analytics=error · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-032 · 1280px · dark · hi · admin · world=empty · /admin/analytics · analytics=empty · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-033 · 1280px · light · en · admin · world=empty · /admin/analytics · analytics=full · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-034 · 1280px · dark · hi · admin · world=empty · /admin/analytics · analytics=error · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-035 · 1440px · light · en · admin · world=empty · /admin/analytics · analytics=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-036 · 1440px · dark · hi · admin · world=empty · /admin/analytics · analytics=city-scoped · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-037 · 1440px · light · en · admin · world=empty · /admin/analytics · analytics=error · asserts: present inside overlap covered clipped tap hscroll focus console aligned axe
- [ ] API-ADM-ANALYTICS-038 · 1920px · dark · hi · admin · world=empty · /admin/analytics · analytics=full · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi
- [ ] API-ADM-ANALYTICS-039 · 1920px · light · en · admin · world=empty · /admin/analytics · analytics=long-text · asserts: present inside overlap covered clipped tap hscroll focus console aligned
- [ ] API-ADM-ANALYTICS-040 · 1920px · dark · hi · admin · world=empty · /admin/analytics · analytics=city-scoped · asserts: present inside overlap covered clipped tap hscroll focus console aligned hindi

## Admin → Coins, real sign-in

### API-ADM-COINS — Coin activity list (earn, redeem, adjust, expire, restore), account look-up and adjust form

Pairwise (all pairs of values); 40 states; scope `main`.

- [ ] API-ADM-COINS-001 · 320px · light · en · admin · world=empty · /admin/coins · coins=none · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-002 · 320px · dark · hi · admin · world=empty · /admin/coins · coins=few · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-003 · 390px · light · hi · admin · world=empty · /admin/coins · coins=many · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-004 · 390px · dark · en · admin · world=empty · /admin/coins · coins=long-text · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-005 · 480px · light · en · admin · world=empty · /admin/coins · coins=error · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-006 · 480px · dark · hi · admin · world=empty · /admin/coins · coins=none · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-007 · 768px · light · en · admin · world=empty · /admin/coins · coins=few · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-008 · 768px · dark · hi · admin · world=empty · /admin/coins · coins=error · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-009 · 1024px · light · en · admin · world=empty · /admin/coins · coins=many · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-010 · 1024px · dark · hi · admin · world=empty · /admin/coins · coins=long-text · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-011 · 1280px · light · en · admin · world=empty · /admin/coins · coins=long-text · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-012 · 1280px · dark · hi · admin · world=empty · /admin/coins · coins=many · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-013 · 1440px · light · en · admin · world=empty · /admin/coins · coins=none · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-014 · 1440px · dark · hi · admin · world=empty · /admin/coins · coins=few · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-015 · 1920px · light · en · admin · world=empty · /admin/coins · coins=error · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-016 · 1920px · dark · hi · admin · world=empty · /admin/coins · coins=none · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-017 · 320px · light · en · admin · world=empty · /admin/coins · coins=many · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-018 · 320px · dark · hi · admin · world=empty · /admin/coins · coins=long-text · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-019 · 320px · light · en · admin · world=empty · /admin/coins · coins=error · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-020 · 390px · dark · hi · admin · world=empty · /admin/coins · coins=none · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-021 · 390px · light · en · admin · world=empty · /admin/coins · coins=few · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-022 · 390px · dark · hi · admin · world=empty · /admin/coins · coins=error · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-023 · 480px · light · en · admin · world=empty · /admin/coins · coins=few · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-024 · 480px · dark · hi · admin · world=empty · /admin/coins · coins=many · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-025 · 480px · light · en · admin · world=empty · /admin/coins · coins=long-text · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-026 · 768px · dark · hi · admin · world=empty · /admin/coins · coins=none · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-027 · 768px · light · en · admin · world=empty · /admin/coins · coins=many · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-028 · 768px · dark · hi · admin · world=empty · /admin/coins · coins=long-text · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-029 · 1024px · light · en · admin · world=empty · /admin/coins · coins=none · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-030 · 1024px · dark · hi · admin · world=empty · /admin/coins · coins=few · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-031 · 1024px · light · en · admin · world=empty · /admin/coins · coins=error · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-032 · 1280px · dark · hi · admin · world=empty · /admin/coins · coins=none · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-033 · 1280px · light · en · admin · world=empty · /admin/coins · coins=few · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-034 · 1280px · dark · hi · admin · world=empty · /admin/coins · coins=error · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-035 · 1440px · light · en · admin · world=empty · /admin/coins · coins=many · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-036 · 1440px · dark · hi · admin · world=empty · /admin/coins · coins=long-text · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-037 · 1440px · light · en · admin · world=empty · /admin/coins · coins=error · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-COINS-038 · 1920px · dark · hi · admin · world=empty · /admin/coins · coins=few · form=errors · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-COINS-039 · 1920px · light · en · admin · world=empty · /admin/coins · coins=many · form=filled · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-COINS-040 · 1920px · dark · hi · admin · world=empty · /admin/coins · coins=long-text · form=clean · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Admin → Reviews, real sign-in

### API-ADM-REVIEWS — Review moderation queue: pending / approved / hidden, long text, hide reasons

Pairwise (all pairs of values); 40 states; scope `main`.

- [ ] API-ADM-REVIEWS-001 · 320px · light · en · admin · world=empty · /admin/reviews · reviews=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-002 · 320px · dark · hi · admin · world=empty · /admin/reviews · reviews=pending · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-003 · 390px · light · hi · admin · world=empty · /admin/reviews · reviews=many · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-004 · 390px · dark · en · admin · world=empty · /admin/reviews · reviews=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-005 · 480px · light · en · admin · world=empty · /admin/reviews · reviews=error · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-006 · 480px · dark · hi · admin · world=empty · /admin/reviews · reviews=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-007 · 768px · light · en · admin · world=empty · /admin/reviews · reviews=pending · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-008 · 768px · dark · hi · admin · world=empty · /admin/reviews · reviews=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-009 · 1024px · light · en · admin · world=empty · /admin/reviews · reviews=many · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-010 · 1024px · dark · hi · admin · world=empty · /admin/reviews · reviews=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-011 · 1280px · light · en · admin · world=empty · /admin/reviews · reviews=long-text · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-012 · 1280px · dark · hi · admin · world=empty · /admin/reviews · reviews=many · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-013 · 1440px · light · en · admin · world=empty · /admin/reviews · reviews=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-014 · 1440px · dark · hi · admin · world=empty · /admin/reviews · reviews=pending · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-015 · 1920px · light · en · admin · world=empty · /admin/reviews · reviews=error · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-016 · 1920px · dark · hi · admin · world=empty · /admin/reviews · reviews=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-017 · 320px · light · en · admin · world=empty · /admin/reviews · reviews=many · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-018 · 320px · dark · hi · admin · world=empty · /admin/reviews · reviews=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-019 · 320px · light · en · admin · world=empty · /admin/reviews · reviews=error · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-020 · 390px · dark · hi · admin · world=empty · /admin/reviews · reviews=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-021 · 390px · light · en · admin · world=empty · /admin/reviews · reviews=pending · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-022 · 390px · dark · hi · admin · world=empty · /admin/reviews · reviews=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-023 · 480px · light · en · admin · world=empty · /admin/reviews · reviews=pending · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-024 · 480px · dark · hi · admin · world=empty · /admin/reviews · reviews=many · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-025 · 480px · light · en · admin · world=empty · /admin/reviews · reviews=long-text · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-026 · 768px · dark · hi · admin · world=empty · /admin/reviews · reviews=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-027 · 768px · light · en · admin · world=empty · /admin/reviews · reviews=many · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-028 · 768px · dark · hi · admin · world=empty · /admin/reviews · reviews=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-029 · 1024px · light · en · admin · world=empty · /admin/reviews · reviews=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-030 · 1024px · dark · hi · admin · world=empty · /admin/reviews · reviews=pending · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-031 · 1024px · light · en · admin · world=empty · /admin/reviews · reviews=error · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-032 · 1280px · dark · hi · admin · world=empty · /admin/reviews · reviews=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-033 · 1280px · light · en · admin · world=empty · /admin/reviews · reviews=pending · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-034 · 1280px · dark · hi · admin · world=empty · /admin/reviews · reviews=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-035 · 1440px · light · en · admin · world=empty · /admin/reviews · reviews=many · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-036 · 1440px · dark · hi · admin · world=empty · /admin/reviews · reviews=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-037 · 1440px · light · en · admin · world=empty · /admin/reviews · reviews=error · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-REVIEWS-038 · 1920px · dark · hi · admin · world=empty · /admin/reviews · reviews=pending · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-REVIEWS-039 · 1920px · light · en · admin · world=empty · /admin/reviews · reviews=many · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-REVIEWS-040 · 1920px · dark · hi · admin · world=empty · /admin/reviews · reviews=long-text · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Admin → Bulk quotes, real sign-in

### API-ADM-QUOTES — Quote desk: queue views, every quote status, offer and order chips

Pairwise (all pairs of values); 32 states; scope `main`.

- [ ] API-ADM-QUOTES-001 · 320px · light · en · admin · world=empty · /admin/quotes · quotes=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-QUOTES-002 · 320px · dark · hi · admin · world=empty · /admin/quotes · quotes=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-003 · 390px · light · hi · admin · world=empty · /admin/quotes · quotes=mixed · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-004 · 390px · dark · en · admin · world=empty · /admin/quotes · quotes=error · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-QUOTES-005 · 480px · light · en · admin · world=empty · /admin/quotes · quotes=one · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-QUOTES-006 · 480px · dark · hi · admin · world=empty · /admin/quotes · quotes=none · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-007 · 768px · light · en · admin · world=empty · /admin/quotes · quotes=mixed · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-QUOTES-008 · 768px · dark · hi · admin · world=empty · /admin/quotes · quotes=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-009 · 1024px · light · en · admin · world=empty · /admin/quotes · quotes=error · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-QUOTES-010 · 1024px · dark · hi · admin · world=empty · /admin/quotes · quotes=mixed · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-011 · 1280px · light · en · admin · world=empty · /admin/quotes · quotes=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-QUOTES-012 · 1280px · dark · hi · admin · world=empty · /admin/quotes · quotes=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-013 · 1440px · light · en · admin · world=empty · /admin/quotes · quotes=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-QUOTES-014 · 1440px · dark · hi · admin · world=empty · /admin/quotes · quotes=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-015 · 1920px · light · en · admin · world=empty · /admin/quotes · quotes=mixed · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-QUOTES-016 · 1920px · dark · hi · admin · world=empty · /admin/quotes · quotes=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-017 · 320px · light · en · admin · world=empty · /admin/quotes · quotes=mixed · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-QUOTES-018 · 320px · dark · hi · admin · world=empty · /admin/quotes · quotes=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-019 · 390px · light · en · admin · world=empty · /admin/quotes · quotes=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-QUOTES-020 · 390px · dark · hi · admin · world=empty · /admin/quotes · quotes=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-021 · 480px · light · en · admin · world=empty · /admin/quotes · quotes=mixed · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-QUOTES-022 · 480px · dark · hi · admin · world=empty · /admin/quotes · quotes=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-023 · 768px · light · en · admin · world=empty · /admin/quotes · quotes=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-QUOTES-024 · 768px · dark · hi · admin · world=empty · /admin/quotes · quotes=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-025 · 1024px · light · en · admin · world=empty · /admin/quotes · quotes=none · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-QUOTES-026 · 1024px · dark · hi · admin · world=empty · /admin/quotes · quotes=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-027 · 1280px · light · en · admin · world=empty · /admin/quotes · quotes=mixed · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-QUOTES-028 · 1280px · dark · hi · admin · world=empty · /admin/quotes · quotes=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-029 · 1440px · light · en · admin · world=empty · /admin/quotes · quotes=mixed · asserts: present inside overlap covered clipped tap hscroll focus console axe
- [ ] API-ADM-QUOTES-030 · 1440px · dark · hi · admin · world=empty · /admin/quotes · quotes=error · asserts: present inside overlap covered clipped tap hscroll focus console hindi
- [ ] API-ADM-QUOTES-031 · 1920px · light · en · admin · world=empty · /admin/quotes · quotes=none · asserts: present inside overlap covered clipped tap hscroll focus console
- [ ] API-ADM-QUOTES-032 · 1920px · dark · hi · admin · world=empty · /admin/quotes · quotes=one · asserts: present inside overlap covered clipped tap hscroll focus console hindi

## Navigation, real sign-in

### API-NAV-ADMIN — Admin section bar with every real-mode section (Analytics, Refunds, Errors included): current item, scroll, walk

Full cross of the high-risk dimensions, the rest pairwise; 144 states; scope `main nav.overflow-x-auto`.

- [ ] API-NAV-ADMIN-001 · 320px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-002 · 320px · dark · hi · admin · world=empty · /admin/analytics · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-003 · 320px · light · hi · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-004 · 320px · dark · en · admin · world=empty · /admin/refunds · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-005 · 320px · light · en · admin · world=empty · /admin/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-006 · 320px · dark · hi · admin · world=empty · /admin/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-007 · 320px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-008 · 320px · dark · hi · admin · world=empty · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-009 · 320px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-010 · 320px · dark · hi · admin · world=empty · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-011 · 320px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-012 · 320px · dark · hi · admin · world=empty · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-013 · 320px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-014 · 320px · dark · hi · admin · world=empty · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-015 · 320px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-016 · 320px · dark · hi · admin · world=empty · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-017 · 320px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-018 · 320px · dark · hi · admin · world=empty · /admin/errors · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-019 · 390px · dark · hi · admin · world=empty · /admin · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-020 · 390px · light · en · admin · world=empty · /admin/analytics · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-021 · 390px · dark · en · admin · world=empty · /admin/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-022 · 390px · light · hi · admin · world=empty · /admin/refunds · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-023 · 390px · dark · hi · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-024 · 390px · light · en · admin · world=empty · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-025 · 390px · dark · hi · admin · world=empty · /admin/applications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe
- [ ] API-NAV-ADMIN-026 · 390px · light · en · admin · world=empty · /admin/partners · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-027 · 390px · dark · hi · admin · world=empty · /admin/catalogue · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-028 · 390px · light · en · admin · world=empty · /admin/customers · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-029 · 390px · dark · hi · admin · world=empty · /admin/reviews · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe
- [ ] API-NAV-ADMIN-030 · 390px · light · en · admin · world=empty · /admin/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-031 · 390px · dark · hi · admin · world=empty · /admin/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-032 · 390px · light · en · admin · world=empty · /admin/content · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-033 · 390px · dark · hi · admin · world=empty · /admin/layout · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe
- [ ] API-NAV-ADMIN-034 · 390px · light · en · admin · world=empty · /admin/settings · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-035 · 390px · dark · hi · admin · world=empty · /admin/notifications · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-036 · 390px · light · en · admin · world=empty · /admin/errors · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-037 · 480px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-038 · 480px · dark · hi · admin · world=empty · /admin/analytics · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-039 · 480px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-040 · 480px · dark · hi · admin · world=empty · /admin/refunds · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-041 · 480px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-042 · 480px · dark · hi · admin · world=empty · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-043 · 480px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-044 · 480px · dark · hi · admin · world=empty · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-045 · 480px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-046 · 480px · dark · hi · admin · world=empty · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-047 · 480px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-048 · 480px · dark · hi · admin · world=empty · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-049 · 480px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-050 · 480px · dark · hi · admin · world=empty · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-051 · 480px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-052 · 480px · dark · hi · admin · world=empty · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-053 · 480px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-054 · 480px · dark · hi · admin · world=empty · /admin/errors · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-055 · 768px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-056 · 768px · dark · hi · admin · world=empty · /admin/analytics · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-057 · 768px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-058 · 768px · dark · hi · admin · world=empty · /admin/refunds · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-059 · 768px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-060 · 768px · dark · hi · admin · world=empty · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-061 · 768px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-062 · 768px · dark · hi · admin · world=empty · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-063 · 768px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-064 · 768px · dark · hi · admin · world=empty · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-065 · 768px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-066 · 768px · dark · hi · admin · world=empty · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-067 · 768px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-068 · 768px · dark · hi · admin · world=empty · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-069 · 768px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-070 · 768px · dark · hi · admin · world=empty · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-071 · 768px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-072 · 768px · dark · hi · admin · world=empty · /admin/errors · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-073 · 1024px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-074 · 1024px · dark · hi · admin · world=empty · /admin/analytics · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-075 · 1024px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-076 · 1024px · dark · hi · admin · world=empty · /admin/refunds · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-077 · 1024px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-078 · 1024px · dark · hi · admin · world=empty · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-079 · 1024px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-080 · 1024px · dark · hi · admin · world=empty · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-081 · 1024px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-082 · 1024px · dark · hi · admin · world=empty · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-083 · 1024px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-084 · 1024px · dark · hi · admin · world=empty · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-085 · 1024px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-086 · 1024px · dark · hi · admin · world=empty · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-087 · 1024px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-088 · 1024px · dark · hi · admin · world=empty · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-089 · 1024px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-090 · 1024px · dark · hi · admin · world=empty · /admin/errors · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-091 · 1280px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-092 · 1280px · dark · hi · admin · world=empty · /admin/analytics · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-093 · 1280px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-094 · 1280px · dark · hi · admin · world=empty · /admin/refunds · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-095 · 1280px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-096 · 1280px · dark · hi · admin · world=empty · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-097 · 1280px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-098 · 1280px · dark · hi · admin · world=empty · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-099 · 1280px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-100 · 1280px · dark · hi · admin · world=empty · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-101 · 1280px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-102 · 1280px · dark · hi · admin · world=empty · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-103 · 1280px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-104 · 1280px · dark · hi · admin · world=empty · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-105 · 1280px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-106 · 1280px · dark · hi · admin · world=empty · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-107 · 1280px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-108 · 1280px · dark · hi · admin · world=empty · /admin/errors · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-109 · 1440px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-110 · 1440px · dark · hi · admin · world=empty · /admin/analytics · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-111 · 1440px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-112 · 1440px · dark · hi · admin · world=empty · /admin/refunds · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-113 · 1440px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-114 · 1440px · dark · hi · admin · world=empty · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-115 · 1440px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-116 · 1440px · dark · hi · admin · world=empty · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-117 · 1440px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-118 · 1440px · dark · hi · admin · world=empty · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-119 · 1440px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-120 · 1440px · dark · hi · admin · world=empty · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-121 · 1440px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-122 · 1440px · dark · hi · admin · world=empty · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-123 · 1440px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-124 · 1440px · dark · hi · admin · world=empty · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-125 · 1440px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-126 · 1440px · dark · hi · admin · world=empty · /admin/errors · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-127 · 1920px · light · en · admin · world=empty · /admin · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-128 · 1920px · dark · hi · admin · world=empty · /admin/analytics · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-129 · 1920px · light · en · admin · world=empty · /admin/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-130 · 1920px · dark · hi · admin · world=empty · /admin/refunds · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-131 · 1920px · light · en · admin · world=empty · /admin/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-132 · 1920px · dark · hi · admin · world=empty · /admin/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-133 · 1920px · light · en · admin · world=empty · /admin/applications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-134 · 1920px · dark · hi · admin · world=empty · /admin/partners · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-135 · 1920px · light · en · admin · world=empty · /admin/catalogue · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-136 · 1920px · dark · hi · admin · world=empty · /admin/customers · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-137 · 1920px · light · en · admin · world=empty · /admin/reviews · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-138 · 1920px · dark · hi · admin · world=empty · /admin/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-139 · 1920px · light · en · admin · world=empty · /admin/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-140 · 1920px · dark · hi · admin · world=empty · /admin/content · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-141 · 1920px · light · en · admin · world=empty · /admin/layout · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ADMIN-142 · 1920px · dark · hi · admin · world=empty · /admin/settings · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ADMIN-143 · 1920px · light · en · admin · world=empty · /admin/notifications · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ADMIN-144 · 1920px · dark · hi · admin · world=empty · /admin/errors · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi

### API-NAV-ACCOUNT — Account section bar in a real-sign-in build: current item, scroll, walk

Full cross of the high-risk dimensions, the rest pairwise; 72 states; scope `main nav.overflow-x-auto`.

- [ ] API-NAV-ACCOUNT-001 · 320px · light · en · customer · world=empty · /account · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-002 · 320px · dark · hi · customer · world=empty · /account/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-003 · 320px · light · hi · customer · world=empty · /account/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-004 · 320px · dark · en · customer · world=empty · /account/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-005 · 320px · light · en · customer · world=empty · /account/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-006 · 320px · dark · hi · customer · world=empty · /account/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-007 · 320px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-008 · 320px · dark · hi · customer · world=empty · /account/addresses · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-009 · 320px · light · en · customer · world=empty · /account/profile · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-010 · 390px · dark · hi · customer · world=empty · /account · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-011 · 390px · light · en · customer · world=empty · /account/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-012 · 390px · dark · en · customer · world=empty · /account/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-013 · 390px · light · hi · customer · world=empty · /account/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi axe
- [ ] API-NAV-ACCOUNT-014 · 390px · dark · hi · customer · world=empty · /account/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-015 · 390px · light · en · customer · world=empty · /account/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-016 · 390px · dark · hi · customer · world=empty · /account/vehicles · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-017 · 390px · light · en · customer · world=empty · /account/addresses · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-018 · 390px · dark · hi · customer · world=empty · /account/profile · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-019 · 480px · light · en · customer · world=empty · /account · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-020 · 480px · dark · hi · customer · world=empty · /account/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-021 · 480px · light · en · customer · world=empty · /account/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-022 · 480px · dark · hi · customer · world=empty · /account/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-023 · 480px · light · en · customer · world=empty · /account/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-024 · 480px · dark · hi · customer · world=empty · /account/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-025 · 480px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-026 · 480px · dark · hi · customer · world=empty · /account/addresses · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-027 · 480px · light · en · customer · world=empty · /account/profile · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-028 · 768px · dark · hi · customer · world=empty · /account · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-029 · 768px · light · en · customer · world=empty · /account/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-030 · 768px · dark · hi · customer · world=empty · /account/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-031 · 768px · light · en · customer · world=empty · /account/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-032 · 768px · dark · hi · customer · world=empty · /account/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-033 · 768px · light · en · customer · world=empty · /account/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-034 · 768px · dark · hi · customer · world=empty · /account/vehicles · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-035 · 768px · light · en · customer · world=empty · /account/addresses · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-036 · 768px · dark · hi · customer · world=empty · /account/profile · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-037 · 1024px · light · en · customer · world=empty · /account · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-038 · 1024px · dark · hi · customer · world=empty · /account/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-039 · 1024px · light · en · customer · world=empty · /account/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-040 · 1024px · dark · hi · customer · world=empty · /account/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-041 · 1024px · light · en · customer · world=empty · /account/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-042 · 1024px · dark · hi · customer · world=empty · /account/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-043 · 1024px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-044 · 1024px · dark · hi · customer · world=empty · /account/addresses · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-045 · 1024px · light · en · customer · world=empty · /account/profile · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-046 · 1280px · dark · hi · customer · world=empty · /account · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-047 · 1280px · light · en · customer · world=empty · /account/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-048 · 1280px · dark · hi · customer · world=empty · /account/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-049 · 1280px · light · en · customer · world=empty · /account/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-050 · 1280px · dark · hi · customer · world=empty · /account/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-051 · 1280px · light · en · customer · world=empty · /account/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-052 · 1280px · dark · hi · customer · world=empty · /account/vehicles · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-053 · 1280px · light · en · customer · world=empty · /account/addresses · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-054 · 1280px · dark · hi · customer · world=empty · /account/profile · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-055 · 1440px · light · en · customer · world=empty · /account · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-056 · 1440px · dark · hi · customer · world=empty · /account/orders · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-057 · 1440px · light · en · customer · world=empty · /account/services · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-058 · 1440px · dark · hi · customer · world=empty · /account/quotes · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-059 · 1440px · light · en · customer · world=empty · /account/support · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-060 · 1440px · dark · hi · customer · world=empty · /account/coins · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-061 · 1440px · light · en · customer · world=empty · /account/vehicles · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-062 · 1440px · dark · hi · customer · world=empty · /account/addresses · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-063 · 1440px · light · en · customer · world=empty · /account/profile · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-064 · 1920px · dark · hi · customer · world=empty · /account · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-065 · 1920px · light · en · customer · world=empty · /account/orders · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-066 · 1920px · dark · hi · customer · world=empty · /account/services · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-067 · 1920px · light · en · customer · world=empty · /account/quotes · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-068 · 1920px · dark · hi · customer · world=empty · /account/support · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-069 · 1920px · light · en · customer · world=empty · /account/coins · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav axe
- [ ] API-NAV-ACCOUNT-070 · 1920px · dark · hi · customer · world=empty · /account/vehicles · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi
- [ ] API-NAV-ACCOUNT-071 · 1920px · light · en · customer · world=empty · /account/addresses · walk=no · asserts: present inside overlap covered clipped tap hscroll focus console nav
- [ ] API-NAV-ACCOUNT-072 · 1920px · dark · hi · customer · world=empty · /account/profile · walk=yes · asserts: present inside overlap covered clipped tap hscroll focus console nav hindi

## Found bugs

Triaged from the run results; one row per bug, linked to every checklist id that shows it.

| Bug | Checklist ids                                                | Severity | Page / component    | What fails                                                                                                                                   | Screenshot | Status                                                                                                           |
| --- | ------------------------------------------------------------ | -------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| U1  | SHOP-CARD (compare=bat-2/lub-*), SHOP-ACTION (compare-other) | P1       | Shop / product card | With the compare list holding category A, category-B cards show inline error text and "Add to cart" overflows the card (user 2026-11-14)     | —          | fixed on branch `worktree-agent-a165b7b3f223fe1d3` (spec 21 § Redesign 2026-11-14); confirm in the overnight run |
| U2  | SHOP-ACTION (start-new)                                      | P0       | Shop / product card | "Start a new comparison" updates only the clicked card; other cards keep stale pressed state (user 2026-11-14)                               | —          | fixed on branch `worktree-agent-a165b7b3f223fe1d3` (spec 21 § Redesign 2026-11-14); confirm in the overnight run |
| U3  | STEP (hover-inc)                                             | P0       | Stepper             | The "+" hover background covers the count (user 2026-11-14)                                                                                  | —          | fixed on branch `worktree-agent-a165b7b3f223fe1d3` (spec 21 § Redesign 2026-11-14); confirm in the overnight run |
| U4  | CMP-TABLE (bat-*, tyr-2, cart=c1/mixed)                      | P1       | Compare             | Columns misaligned when only one product has a "Save" badge or is in the cart; images too tall, touching the header border (user 2026-11-14) | —          | fixed on branch `worktree-agent-a165b7b3f223fe1d3` (spec 21 § Redesign 2026-11-14); confirm in the overnight run |

## Run results

<!-- run-results:start -->

Not run yet.
<!-- run-results:end -->
