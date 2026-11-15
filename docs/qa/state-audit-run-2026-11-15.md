# UI state audit run — 2026-11-15

The full UI state audit (`node apps/web/scripts/state-audit-run.mjs all --api`) ran on the office PC against the
production build of `main` at `717f2c8` (the build that is live on mechdost.com). Raw results: JSON reports, logs and one
failure screenshot per failing item under `apps/web/test-results/state-audit-2026-11-15/<chunk>/` (git-ignored, on this
PC). Representative screenshots are copied to `docs/qa/screenshots/2026-11-15/`.

## What ran

| Chunk | Pages                                                                                          | Items | Passed | Failed | Notes                                                                               |
| ----- | ---------------------------------------------------------------------------------------------- | ----- | ------ | ------ | ----------------------------------------------------------------------------------- |
| A     | Header, footer, floating UI, home                                                              | 365   | 271    | 94     |                                                                                     |
| B     | Shop listing, filters, compare tray, cart steps                                                | 444   | 76     | 368    | Most failures are one card bug (below)                                              |
| C     | Product page, compare, cart, checkout                                                          | 320   | 100    | 220    |                                                                                     |
| D     | Orders, service requests, quotes, account, workshops, partners, support, login                 | 464   | 277    | 187    |                                                                                     |
| E     | Partner portals, admin console                                                                 | 297   | 157    | 140    |                                                                                     |
| F     | Navigation (every link, both themes and languages)                                             | —     | —      | —      | **Not finished**: the PC ran out of memory during F and Claude Code stopped the run |
| G     | Real-sign-in screens against the mocked API (support, coupons, workshops, exports, catalogue…) | —     | —      | —      | **Not run** (comes after F)                                                         |

1,890 of the 4,229 checklist items ran (A–E). F and G need a re-run (see "Next").

A failing item usually carries several findings, and one bug repeats across many items and states (hover, focus,
both themes, both languages), so the counts below are findings, not separate bugs. The findings reduce to the bugs in
the next section.

## Real bugs (fix tomorrow), most important first

1. **P1 · Product card: the badges cover the product code on the picture.** The "Bestseller", vehicle type ("2W",
   "4W", Hindi "वाहन का प्रकार") and "Fitment not listed" badges sit over the SKU printed at the bottom of the product
   picture when the card is narrow (4 columns at 1024 px, phone widths), worse in Hindi. Home, shop, product page buy
   box, related products, compare tray. This one bug is about 11,000 of the "covered" findings (HOME-RANGE,
   HOME-PRODUCTS, SHOP-CARD, SHOP-ACTION, SHOP-FILTERS, PDP-BUYBOX, PDP-RELATED, CHR-FLOAT).
   Screenshot: `screenshots/2026-11-15/01-home-badges-over-sku-1024.png` (red boxes: the "2W" badge over
   "CAS-ACT4T-0900"). Likely fix: badges and SKU on separate rows of the picture, or the SKU moves out of the badge row.
2. **P1 · The header is too wide at exactly 1024 px.** With a two-digit cart count (and signed in, where the header
   has more items) the cart button sticks out of the header and the page scrolls sideways (CHR-HEADER-009,
   ACC-PROFILE-009, ACC-VEHICLES-DATA-009, SHOP-CARD at 1024 with a mixed cart, checkout and cart hscroll). Also red
   in CI's report-only audit. Likely fix: the 1024 px header drops a label (as below 1024) or the cart label hides
   earlier.
3. **P1 · Compare table: long product names are cut with "…"** (two-line clamp in the column header, 224 findings
   in CMP-TABLE at 320–1920 px with long names). Product names must not be truncated (same rule as the cards).
   Screenshot: `screenshots/2026-11-15/04-compare-320-names-cut.png`.
4. **P1 · Workshop finder at 320 px: the service list under each workshop is cut with "…"** ("Inspection & diagnosis
   · General service…", WS-FINDER). Check whether the list may wrap or should say "+2 more".
5. **P1 · Demo login account picker at 320 px: names and roles overflow their buttons** (LOGIN-FORM, 578 "inside" +
   208 overlap findings; demo builds only). Screenshot: `screenshots/2026-11-15/07-login-demo-picker-320.png`.
6. **P1 · Workshop portal (320 px, dark, Hindi, busy): a form field shows no visible focus ring** (PRT-WORKSHOP-002).
7. **P1 · Compare: ticking the first product shows nothing visible** (the tray waits for 2, as decided). Add a short
   visible confirmation next to the control ("added, pick one more", en + hi) and change the audit rule to match.
8. **P0 · Privacy banner covers buttons on phones** (cart "Proceed to checkout", bulk quote, last compare rows, the
   workshop booking form, the Ask MechDost launcher). Reserve bottom space equal to the open banner (plus tab bar /
   compare tray) so every control scrolls clear, and lift fixed launchers above it.

## Decisions (Q170)

Answered 2026-11-15 (user): the compare tray appears only from 2 products, but the first tick must give visible
feedback ("added, pick one more"); the privacy banner must not cover the checkout button or any other button on phones.
Both are now bugs to fix tomorrow (items 7 and 8 below); the footer link (third point) is still open.

### As raised

- **Compare tray with one product.** "Compare list holds 1 but no tray is shown" (P0, about 120 findings in B and C;
  also before today's changes). Either the tray appears from 2 products (then the audit rule changes) or it should
  show from 1 ("pick one more to compare").
- **Consent banner over primary actions on phones.** While the privacy banner is open it sits over the cart's
  "Proceed to checkout" / "Continue shopping" / bulk quote, the last compare rows, the workshop booking form and the
  "Ask MechDost" launcher at 320 px (CART-LINES 51 × P0, CMP-TABLE 159 × P0, WS-PROFILE 482 × P0, CHR-ASSIST). The
  banner is meant to be answered first; decide whether the pages get bottom space so their last controls can scroll
  clear of the banner and tab bar, and whether the launcher sits above the banner.
- **Footer "Privacy choices" link covered by the open banner** (CHR-FOOTER P0). The link reopens that same banner, so
  this is probably acceptable.

## To verify tomorrow (could be a real bug or the checker)

- **Sticky header over side menus when a link is scrolled into view** (admin side menu 268 × P0 in E, account side
  menu in D, the cart's bulk-quote link). The page sets `scroll-padding-top: 96px`, and screenshots show the menus
  laid out correctly (`screenshots/2026-11-15/05-admin-sidenav-under-header-check-1280-hi.png`). Check with a real
  keyboard (Tab through the admin side menu at 1024 and 1280 px, Hindi): if a focused link hides under the header,
  the header is taller than 96 px there (fix the padding); if not, the checker scrolls with Playwright's own method,
  which ignores scroll padding (fix the checker to scroll with `element.focus()`).

## Checker fixes (false findings — the site is right)

- **Inline links that wrap over two lines** are measured as one rectangle covering both lines, so a wrapped link
  "overlaps" the text beside it (checkout, Hindi, 768 px: `screenshots/2026-11-15/03-checkout-hi-768-policy-overlap.png`
  shows nothing overlapping). Measure each line box (`getClientRects()`).
- **Controls behind an open modal**: with the product details sheet open the checker tries to hover the page behind
  it ("subtree intercepts pointer events", SHOP-POPOVER). Skip controls under an open modal.
  `screenshots/2026-11-15/02-shop-product-sheet-ok-320.png` shows the sheet is fine.
- **Hindi gate and search echo**: the search words a visitor typed ("zzzz", "battery") shown back on `/hi` are user
  text (allowed by hard rule 10); the gate should ignore the echoed query.
- **"Covered" for elements with `pointer-events: none`**: part of the badge findings come from asking the browser
  what is under a point (it skips elements that ignore the pointer). The badge-over-SKU overlap above is still real;
  the checker should test paint overlap, not hit-testing, for decorative overlays.
- **Rows that must answer the privacy banner first**: CHR-ASSIST (and the cart and compare rows above) should choose
  "Essential only" before measuring, unless the row is about the banner.

## Environment (not code)

- `/workshops` map tiles from `tiles.openfreemap.org` failed to load from this PC (console "Failed to fetch",
  WS-FINDER, WS-PROFILE, CHR-TABBAR): network on the PC, the map itself is fine in production.

## Next

1. Fix bugs 1–6, each with a failing audit row or unit test first (the rows above already fail).
2. Apply the checker fixes, then re-run A–E to see the remaining real findings drop.
3. Re-run F and G when the PC can run a long job alone (close other apps; or start Claude Code with
   `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` so a long audit is not stopped while the session is idle):
   `node apps/web/scripts/state-audit-run.mjs F G --api --date 2026-11-16`.
4. Answer Q170 (the three decisions above).
