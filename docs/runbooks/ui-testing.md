# UI testing runbook — states, permutations, render checks (2026-11-14)

Full catalogue of every state, status code, world, route × role × control and cross-role flow:
[`ui-test-catalogue.md`](ui-test-catalogue.md) (written by the test-design review, 2026-11-14).

How to test the website the way people use it: every page in every meaningful state, on phones and desktops, in
both languages and themes, as every role. Started after a UI review (user, 2026-11-13: "check each and everything
under every condition and state … every permutation") found bugs no suite had caught. Screenshots and raw findings
of each review go to the git-ignored `reports/` folder (local only); this runbook and the tests are what we keep.

## 1. The state dimensions

| Dimension | Values                                                                                   | How it is set (demo mode)                                  |
| --------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Role      | guest · customer · shop · workshop · admin (staff code `123456`)                         | sign in through `/login` (`docs/runbooks/demo.md`)         |
| Theme     | light · dark — always against the **opposite** system preference, so a lost choice shows | `mechdost-theme` + `colorScheme`                           |
| Language  | en · hi                                                                                  | the URL (`/hi/…`); the `NEXT_LOCALE` cookie after a switch |
| Viewport  | 320 · 360 · 375 · 390 · 414 · 430 · 480 · 540 · 600 · 768 · 1024 · 1280 · 1440           | Playwright projects (390, 1440) + the responsive sweep     |
| World     | **empty** · **cart** (cart + compare list) · **busy** (below)                            | `localStorage`, seeded before load (`page.addInitScript`)  |
| Consent   | decided · undecided (banner open)                                                        | `mechdost-consent`                                         |

**Busy world** (`apps/web/e2e/fixtures/demo-world.ts`): cart and compare list, plus orders waiting for routing,
offered to a shop (timer running) and shipped; an open support ticket about the shipped order; service requests new,
proposed and declined; a bulk quote; a partner application; reviews. The same records feed the Hindi gate.

Storage keys: `mechdost-cart`, `mechdost-compare`, `mechdost-demo-orders`, `-requests`, `-quotes`,
`-applications`, `-reviews`, `-support`, `-coins`, `-session`, `-accounts`, `-invites`, `-price-requests`,
`-shop-listings`, `-partner-status`, `-customer-blocks`, `-order-rules`, `-site`, `-notifications`,
`-agreements`. Shapes: the types in `apps/web/src/demo/*.ts`.

## 2. The automated matrix — `apps/web/e2e/state-matrix.spec.ts`

- **Customer side:** {guest, customer} × {light, dark} × {en, hi} × {empty, cart, busy} on 11 public pages, plus
  4 account pages when signed in, plus the busy-only pages (`/orders/…`, `/service/…`, `/quotes/…`, account
  support/services/quotes). Each state also switches language on `/`, a filtered shop and a compare link, and back.
- **Portals:** {shop, workshop, admin} × {light, dark} × {en, hi} × {empty, busy}.
- **Responsive sweep:** 11 widths from 320 to 1280, busy world, en + hi on the key pages.
- Both Playwright projects (desktop 1440, mobile 390).

Checks on every page: nothing scrolls sideways; `data-theme` and `lang` kept; every visible `position: fixed`
element on screen after scrolling (tab bar, compare tray, assistant, banners); compare tray present exactly when
the list has something; no page errors and no failed requests to our server; language switch keeps the page, the
query string and the hash, and the theme.

Run (against a production build; the config reuses a server on :3100):

```
pnpm --filter @mechdost/web build
cd apps/web && pnpm exec next start --port 3100   # in another terminal
npx playwright test e2e/state-matrix.spec.ts --workers=2                   # checks only (~15 min)
MATRIX_SHOTS=../../reports/<date>/render-matrix npx playwright test e2e/state-matrix.spec.ts --workers=2  # + screenshots
MATRIX_TIMEOUT=60000 npx playwright test e2e/state-matrix.spec.ts -g "<state label>"   # find where one state hangs
```

Labels read `<role>-<theme>-<lang>-<world>` (e.g. `customer-dark-hi-busy`) and `w<width>` for the sweep.

## 3. Manual / agent review on top of the matrix

The matrix proves pages do not break; it does not judge whether they look right. After it runs:

1. Look at the screenshots (or give batches to review agents): hierarchy, spacing, contrast in dark mode, Hindi
   wrapping, overlapping floating elements, empty states with one next action, one primary action per screen.
2. Walk the **cross-role flows** in one browser (demo data is per browser), switching roles: order happy path and
   decline → reroute → timeout → reject (automated per stage and role: `e2e/order-lifecycle-navigation.spec.ts`);
   service request through odometer, estimate (approve/decline per line, revision), work, bill and payment at the
   workshop (`e2e/service-estimate.spec.ts`); seller application → approval → invite
   → agreement → price approval/rejection; support ticket reply; bulk quote → offer → order; coins.
3. Click every control on each page in each world (the crawler under `reports/<date>/crawler/scripts/` is reusable).
4. Record findings with severity (bug / UX / polish), state label, viewport, screenshot path and likely cause.

## 4. Bug classes found so far — and the check that catches each

| Bug class                                                                                        | Caught by                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| A `position: fixed` element inside an ancestor with `transform`/`filter` (animation fill `both`) | fixed-elements-on-screen check; `compare.spec` tray-in-view test |
| React clears `<html>` attributes when the per-locale root layout changes on the client           | theme check after language switch; `demo-flows` theme tests      |
| Language cookie only synced on document requests (client-side switch bounced back)               | `demo-flows` "Hindi → English works after a Hindi visit"         |
| Query string / hash lost on language switch                                                      | matrix "same page" check                                         |
| Header row too wide at in-between widths (400–520 px)                                            | responsive sweep (11 widths)                                     |
| Scroll box inside the page cutting content off                                                   | `compare.spec` "two products use the full width"                 |
| Restyled third-party widget keeps its own text colour (contrast)                                 | axe in dark mode, run several times (async widgets)              |
| A shared constant import dragging a big module into every page                                   | `measure-js` (all routes < 180 KB gz)                            |
| A test that changes a remembered preference must change it back (cookie)                         | the matrix switches language back after each check               |

## 5. Results log

| Date       | Run                                                            | Result                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-14 | Render matrix v1 (2 worlds, 6 widths)                          | 45 passed; 16 false alarms (`%2C` in the redirected compare link — test now decodes); 1 real: 414 px overflow (header) → fixed for 320–700 px                                                                               |
| 2026-11-14 | Three Fable review agents (shop/compare, state/theme, portals) | ~35 findings; fixed tonight: tray position, theme loss, Hindi→English, query loss, compare layout, header widths, dark checkboxes/map controls, Hindi map labels, workshop card wrap; the rest queued in `docs/progress.md` |
| 2026-11-14 | Live multi-role QA (6 scenarios, 431 screens)                  | 7 bugs, 17 UX, 5 polish — most fixed; see `reports/ui-review-2026-11-14/qa-flows/FINDINGS.md`                                                                                                                               |
| 2026-11-14 | Click crawler (18 states, 669 loads, 1,741 clicks)             | no crashes/errors/overflow; 404 theme, COD block late, copy, blocked session, empty Send — fixed                                                                                                                            |
| 2026-11-14 | New-seller lifecycle (phases A–E)                              | **P0: an approved seller cannot sign in to their shop (demo + API)** — open, Q89; suspended-shop offer, delivered lists — fixed                                                                                             |
| 2026-11-14 | Full e2e suite (610 tests, 01:42 build)                        | 540 passed / 10 failed (4 infra, 6 caused by tonight's changes or stale tests) — all fixed and re-run green                                                                                                                 |
| 2026-11-14 | Bisect of a phone-only support e2e failure                     | a badge's `sr-only` text widened the page (needs a `relative` parent) — fixed, overflow check added                                                                                                                         |
| 2026-11-14 | Final checks (after the Opus code review fixes)                | full suite 558 passed / 7 failed (2 real, fixed; 5 memory crashes — run stopped for low memory); targeted re-runs green; desktop state matrix 59/59                                                                         |

## 6. Visual review capture, demo and real mode (2026-11-16)

Screenshots for a person to look at (no assertions): GitHub → Actions → "Visual review capture (manual)" → Run workflow
on `main`, input `mode`:

- `demo` (default): demo-data build, `e2e/visual-review.spec.ts`, 5 shards, artifacts `visual-review-N`, files
  `<role>/<page>__<width>-<theme>-<locale>.png`.
- `api`: the real-sign-in build of the chunk-G audit (`node apps/web/scripts/state-audit-api-build.mjs`, fake public
  `NEXT_PUBLIC_*` values, no secrets) with the mocked API and signed-in sessions per role,
  `e2e/state-audit/visual-review-api.shots.ts` via `playwright.visual-review-api.config.ts`, 8 shards (2584 shots over
  390/1440 × light/dark × en/hi), artifacts `visual-review-api-N`. Two parts: `pages/<role>/…` (every plain page per
  role on the quiet baseline mocks, `/login` empty and with errors, the "already signed in" banner for a customer) and
  `scenes/<API-CODE>/…` (each distinct state of the real-sign-in cases with its own fixtures and set-up: order/service/
  quote pages, portals, admin queues, cancel help, rejected-order totals, job card per-line status). Components with
  many states keep an evenly spaced sample (`VISUAL_SCENES_PER_CODE`, default 10); navigation walks are left out.
- Locally (needs ~3 GB free RAM, low-memory PC: prefer GitHub): build as above, then
  `VISUAL_SHOTS=test-results/visual-review pnpm exec playwright test -c playwright.visual-review-api.config.ts`.
