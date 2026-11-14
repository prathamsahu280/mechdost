# Why the state matrix missed four layout bugs (2026-11-14)

On 2026-11-13 the user asked for the site to be rendered and tested "under every condition and state … desktop
and mobile". `apps/web/e2e/state-matrix.spec.ts` was the answer. On 2026-11-14 the user still found four bugs in
one session:

1. While the compare list holds category A, category-B product cards show inline error text and their "Add to
   cart" button overflows the card.
2. "Start a new comparison" updates only the clicked card. The other cards keep a stale pressed state.
3. The quantity stepper's "+" hover background covers the count.
4. On `/compare`, columns are out of line when only one product has a "Save" badge or is in the cart. Images are
   too tall and touch the header border.

Another branch is fixing these four. This note explains why the tests missed them. It also describes what
replaces the matrix: the UI state audit (`apps/web/e2e/state-audit/`, checklist `docs/qa/ui-state-checklist.md`,
runbook `docs/runbooks/ui-test-catalogue.md` § 9).

## What the matrix varied and what it asserted

| Dimension        | Values in the matrix                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| Page             | 11 public, 4 account, 8 "busy" pages, 7 portal pages                         |
| Auth             | signed out, customer (plus one session per portal role)                      |
| Theme × language | light/dark × en/hi                                                           |
| World            | empty; cart + compare (2 lubricants); busy (orders, requests, quote, ticket) |
| Viewport         | 390 and 1440 (two projects); 11-width sweep, light, English, signed out      |
| Interaction      | none, except the language switch                                             |

Assertions per page: no sideways scroll, theme and language kept, fixed elements on screen, the tray count, no
page errors, and a must-show marker in the busy world.

## Why each bug got through

| Bug | Was the state rendered?                                                                                                                               | What was missing                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Partly. The "cart" world put two lubricants in the compare list and opened `/shop`, which lists every category. But no card control was ever pressed. | An **action** dimension (press Compare on another category's card). A **containment** assertion: a button outside its card does not scroll the page, so "no sideways scroll" passed. |
| 2   | No. It needs a click on "Start a new comparison".                                                                                                     | A **cross-entity sync** assertion: after any action, every card's pressed state must equal the stored list, not just the card that was clicked.                                      |
| 3   | The stepper was on screen: Castrol × 2 was in the cart. Nothing hovered it.                                                                           | An **interaction-state** dimension (hover, focus, pressed, disabled) and a **painted-over** assertion (`elementFromPoint` at the count's centre).                                    |
| 4   | Yes. `/compare` with Castrol and Motul, and only Castrol in the cart, is the "cart" world. It rendered at 390 and 1440 in every theme and language.   | An **alignment** assertion (n-th control of each column at the same height) and an **edge** check. The page was rendered, but nothing measured it.                                   |

Bug 4 is the clearest: the exact state was rendered at least 16 times (2 projects × auth × theme × language) and passed each time. The matrix rendered states
but did not measure them.

## The dimension classes it lacked

1. **Interaction states.** Hover, `:focus-visible`, pressed (`:active`), disabled. Hover backgrounds,
   pseudo-elements, `press` transforms and focus rings change geometry only while the state holds. A render-only
   test cannot see them.
2. **Cross-entity relations.** Mixed categories (compare list holds A, page shows B). Quantity 1 / 2 / 99. Partial
   in-cart: one card shows the stepper, its neighbour "Add to cart". One compare column with a badge, the others
   without. These are relations between stored lists and what is on screen. The worlds stored the lists but never
   arranged the mismatch.
3. **Data-shape variants.** Badges present or absent. Long and short names in English and Hindi. MRP or no MRP.
   Every stock state: in stock, low stock, "confirmed on request" (out of stock exists only in API mode). Ratings
   none or half. Prices from ₹99 to ₹1,00,000. The demo catalogue has 23 fixed products: no long names, no price
   over ₹12,500, every product rated. Grids and tables break on the outliers.
4. **Intermediate widths.** Grid column counts change at the `tab` (760), `nav` (1024) and `sm` (640)
   breakpoints and with `auto-fill` tracks. Two projects at 390 and 1440 test the two easy layouts. The sweep had
   the other widths, but only signed out, light, English, with no cart or compare state.
5. **Assertion weakness.** Every check was presence ("is visible", "has count") or page-level ("no sideways
   scroll"). Overflow inside a card, overlap, a hover background over text, clipping and misalignment never make
   the page wider, so all of them pass. Playwright's actionability also hides problems: it scrolls the element
   into view before acting, and a click succeeds on a button that hangs outside its card.

Contributing causes:

- **Screenshots were optional** (`MATRIX_SHOTS`), and two widths of full-page captures are too much to check by eye.
- **A test per page, not per component.** One test opened 11 to 30 pages. The report said "state matrix: out-light-en-cart
  failed" or passed, never "the product card in this state".
- **No written list of states.** Coverage was implicit in nested loops. Nobody could tick off "stepper at
  qty 99, hovered, at 320 px" because no such line existed.

## What replaces it

The UI state audit, built 2026-11-14:

- **Component state model** (`apps/web/e2e/state-audit/model.ts`). 65 components: chrome, home sections, shop
  listing, cards, filters, quick-details popover, compare tray, stepper, product page, compare table, cart,
  checkout, order, service request, quotes, 9 account sections, workshop finder and profile with booking,
  partners, support, sign-in, policies, shop and workshop portals, and 15 admin sections. Each has its own
  dimensions and values.
- **Deterministic pairwise generator** (`pairwise.ts`, no dependency). All-pairs rows for most components. A full
  cross of the high-risk dimensions for:
  - card × compare × cart × width;
  - card actions × width;
  - stepper surface × quantity × interaction × width;
  - compare table columns × cart × width;
  - header width × auth;
  - floating stack width × consent.
    Theme, language and data shape are then paired against the cross.
- **Geometry assertions** (`geometry.ts`), in every state and again while each control is hovered and while each
  is focused by Tab:
  - inside its card or container;
  - no overlap, and nothing painted over a control;
  - not clipped (ellipsis allowed only where designed, never on prices or button labels);
  - cards in a row equal height with their action rows aligned; table columns aligned;
  - targets at least 24 px (44 px noted);
  - no sideways scroll;
  - a visible, unclipped focus ring;
  - store sync;
  - console errors;
  - axe on a sample;
  - the Hindi allowlist on `/hi`.
- **Data-shape stress** applied to the rendered page: 70+ character names in English and Hindi, ₹1,00,000
  prices, and every other card without rating, MRP, saving and badge.
- **A written checklist** (`docs/qa/ui-state-checklist.md`), 1,731 items. Each item is one Playwright test with
  the same id. A script ticks the checklist from the JSON report: pass → `[x]`, fail → `[!]` with the findings and
  a screenshot that outlines the offending boxes.
- **CI**: 84 `core` items on every push (report-only until the first overnight run is triaged, Q97). All items
  run nightly (`.github/workflows/ui-state-audit.yml`).

Limits:

- Out-of-stock and unrated products cannot be rendered in demo mode. The stress layer shows how the layout copes,
  but the real empty states need API mode.
- The map canvas is excluded; the map tests cover it.
- The harness has only been type-checked, linted and unit-tested. Its first real run is the overnight run
  (coordinator, 2026-11-14: "dont do the tests just yet"). Expect a first round of harness fixes: wrong scope
  selectors show up as `present` failures, and noisy rules show up as many identical findings.
