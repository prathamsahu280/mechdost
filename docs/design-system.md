# MechDost design system (extracted from the concept site)

> **2026-11-01 updates** (decisions.md "Web shell, design direction and demo"): the concept defines the theme; layouts may improve. Source of truth for values is `packages/ui/src/tokens.css` (Tailwind v4 `@theme`), contrast-tested in light and dark by `apps/web/test/tokens.test.ts`.
>
> - Text colour token is `ink`; `navy` is the brand dark surface (hero, announcement bar). Accessible adjustments: button `#d2461a`, muted `#5a6a7d`, link text `#bf3c12`, form borders `#7f8ea0`.
> - Dark theme: bg `#0a1424`, surface `#101d31`, ink `#e8eef5`, muted `#a3b3c7`, accent-soft `#3a1f14`/`#ffb38f`, focus `#ff8b59`; system preference by default, toggle in header (≥400px) and footer.
> - Breakpoints: `tab` 760px (grids), `nav` 1024px (full nav vs bottom tab bar).
> - Motion tokens: `--ease-out-soft`, `--duration-fast` 150ms, `--duration-base` 220ms, `--duration-slow` 420ms; utilities `animate-page-in`, `reveal`, `skeleton`, `press`; all disabled under reduced motion.
> - Product artwork: category illustration tiles until catalogue photos exist; floating assistant button bottom-right.

Source: `style.css`, `premium.css`, `simple.css`, `service-hub.css`, `service-workshop.css`, `launch.css`, `launch-refinements.css`, `admin.css`, `member.css` (copies in `concept/source/`). Screenshots in `screenshots/concept/` (desktop 1440, mobile 390).

## Fonts

- Headings: **Manrope** 600–800 (h1 800, letter-spacing −2.8px desktop; h2 800, −1.2px).
- Body/UI: **DM Sans** 400–700. Base 13–15px; helper text 10–12px; eyebrows 9–10px uppercase, letter-spacing 1.5–2px, bold.
- Admin/account pages in the concept used Arial; the rebuild uses Manrope + DM Sans everywhere.
- Load with `next/font` (swap). Add Devanagari subset when Hindi is enabled.

## Colour tokens

| Token            | Value                                                                   | Use                                                                            |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `--navy`         | `#101f34` (admin `#14263e`, member `#14243c`)                           | Headings, hero/discovery panels, primary dark surfaces, mobile tab active text |
| `--accent`       | `#ea5728` (buttons `#e65325`, logo `#e65a2b`)                           | Primary buttons, links, active tab underline, logo mark                        |
| `--accent-light` | `#ff8b59` / `#ffb99c` / `#ffad87`                                       | Hero `em`, eyebrows on dark, dots                                              |
| `--accent-soft`  | `#fff0e9` bg + `#bf3c12` text                                           | Current nav item, active booking step                                          |
| `--line`         | `#e4e8ee` (cards `#e1e5ec`, inputs `#cad6e3`)                           | Borders                                                                        |
| `--muted`        | `#657487` (also `#607185`, `#62738a`)                                   | Secondary text                                                                 |
| `--bg`           | `#f7f8fa` (admin `#f4f6f9`, member `#f5f7fa`)                           | Page background                                                                |
| `--surface`      | `#ffffff`                                                               | Cards, header, footer                                                          |
| `--surface-alt`  | `#eaf0f4` / `#eef3f7` / `#f1f5f8`                                       | Service intro band, tiles, callouts                                            |
| `--success`      | bg `#e8f5ed` text `#14683c` (tags `#eaf3ed`/`#285b3c`)                  | Status badges                                                                  |
| `--warning`      | bg `#fff3df` border `#efdbb5` text `#674e2d`                            | Hub notice                                                                     |
| `--private`      | bg `#fff5e9` text `#785128`                                             | Admin "private note" callouts                                                  |
| `--banner`       | bg `#fff1e8` border `#ffd9c2`                                           | Account banners                                                                |
| `--error`        | `#b42318` / `#a73419` / `#9a2d20`                                       | Form errors                                                                    |
| `--whatsapp`     | `#167b42` on `#eff8f2`                                                  | WhatsApp block                                                                 |
| Sidebar          | bg `#14263e`, text `#c2cede`, active `#263d58` + 3px accent left border | Admin/partner sidebar                                                          |

## Shape, depth, motion

- Radii: hero 24px (18 mobile); cards 14–16px; tiles 12–15px; buttons 9px; dialogs 18px; inputs 7–8px; pills 20–25px.
- Shadows: cards `0 4px 16px #101f3405`; hover `translateY(-4px/-5px)` + `0 16px 28px #101f3410`; dialog `0 20px 80px #102a4150`; header `0 2px 16px #101f3407`.
- Transitions 0.2s; respect `prefers-reduced-motion` (concept disables all transitions).
- Focus ring: `3px solid #e65325`, offset 3–4px.
- Focus never gets lost or hidden (2026-11-03, web-design-guidelines review): an inline disclosure whose trigger is replaced (cancel order/booking, block/lift a customer) uses `useDisclosureFocus` (`apps/web/src/lib/use-disclosure-focus.ts`): focus moves to its first field on open and back to the trigger on close; when the form closes the whole flow, focus moves to the outcome panel (`tabIndex=-1`, `role="status"`). Fixed bottom UI reserves `scroll-padding-bottom` (tab bar 76px, plus 13rem while the privacy banner is open), so a focused element is never fully hidden (WCAG 2.4.11). A reopened privacy banner returns focus to "Privacy choices".

## Layout and chrome

- `main` max 1600px, 5% side gutters (hero 3%). Section padding 55–65px desktop, 35–40px mobile.
- **Announcement bar** (navy, 9–10px letter-spaced): "MECHDOST · Product orders by confirmation · Workshop requests in Raipur" → becomes city-aware.
- **Header** sticky white: brand (`m↗` 42px accent + "MechDost" Manrope 800 25px + small "YOUR AUTOMOTIVE CONNECTION"), nav links 13px/700 with 8px radius and `--accent-soft` current state: Home · Shop Products · Find Workshops · My Vehicles; "Account" text button; Cart pill (`#edf2f7`, count in accent).
- **Mobile (<760px)**: nav hidden; fixed bottom tab bar (Home ⌂ / Shop ▦ / Find Workshops ⚙ / My Vehicles ◉), 21px icons, 9px labels, active `--accent-soft`; body padding-bottom 76px; `env(safe-area-inset-bottom)`.
- **Hero**: navy rounded panel, two columns (copy / imagery), eyebrow in `--accent-light`, h1 clamp(40px,4.8vw,70px) with `em` in `#ff8b59`, white search box with accent icon button, image label chip, rotated bike inset card with 6px white border.
- **Category tiles**: 6-up (3 tablet, 2 mobile), white 15px radius, 35px accent icon, label.
- **Product card**: white, 16px radius, 170–190px `object-fit: contain` image, `CATEGORY · BRAND` small caps, name 17–19px, spec, "From ₹x" 22–23px, `<details>` "Specification & fitment", "View product details", full-width accent "Add to Cart".
- **Service hub**: two-column heading with 230px rounded photo; tabs with 3px accent underline; mode toggle (navy active); amber notice; 4-field search card; results list + sticky map card (`#e9f0f5`, 16px radius, 350px map); promise strip (3 columns).
- **Steps/progress**: `.booking-progress` pills (active `--accent-soft`); `.care-progress` chips (done `#d6f1df/#145733`); `.sd-progress` chips (done navy).
- **Dialog**: `min(600px,94vw)` (member 800px), 18px radius, head with 33px round close button; body forms grid gap 13px; `.help` 10px muted.
- **Toast**: fixed bottom centre, navy, 6px radius, 3.5 s.
- **Admin/partner shell**: 80px white header; 240px navy sidebar; main padding 40px 5%; h1 38px −1.3px; stat cards 3-up (34px numbers); white 14px panels 24px padding; tables 12px with `#edf2f7` headers; badges 6px radius; buttons 8px radius.

## Copy to preserve (examples; full lists in `concept/*.md`)

- Home: "FOR EVERY DRIVE. EVERY RIDE." / "Automotive essentials. _Local vehicle care._" / "SHOP AUTOMOTIVE ESSENTIALS — What does your vehicle need?" / "CARS, BIKES & SCOOTERS — Know the work. Approve the cost." / steps "01 Tell us what you need · 02 Review the estimate · 03 Confirm the next step".
- Shop: "SHOP AUTOMOTIVE PRODUCTS · INDIA — Explore products. Across India." / "Check price & delivery for your area" / "CAN'T FIND YOUR PRODUCT? — Let us help you source it."
- Workshops: "MECHDOST VEHICLE CARE — A nearby workshop. A clear estimate." / promise strip "See the scope · Approve the expense · Keep your history".
- Partners: "FOR PARTNERS — Build your business with MechDost." / "Apply as a seller · Apply as a workshop · Apply as a mechanic".
- Service desk: "DIGITAL SERVICE DESK — Your requests. Your estimates & bills." / "Your service. Your approval."
- Discovery: "Your next vehicle. _Explore every possibility._" / "Explore. Compare. Find your next drive."
- Account: "YOUR MECHDOST ACCOUNT — Welcome back." / "A home for your vehicle care."
- Admin: "RESTRICTED ACCESS — Your catalogue. Your control." / "MECHDOST OPERATIONS".

## UX rules (from ui-ux-pro-max + concept)

- Contrast ≥ 4.5:1; visible labels (no placeholder-only); errors next to fields; 44×44px touch targets; step indicators on multi-step flows; loading → success/error feedback on every submit; stable skeletons (no flashing spinners); bottom nav ≤ 5 items; predictable back; deep links for every order/request.
- Images: AVIF/WebP with srcset and exact `sizes`; width/height always; lazy below the fold; `priority` only on the hero; reserve space (CLS < 0.1).
- Charts (admin): bullet/KPI tiles for targets; label every range with text, never colour alone; legends + tooltips; keyboard focus reveals the same detail as hover.
- Product-type guidance: booking apps → trust blue/available green/booked grey states; marketplaces → category colours + success green; keep motion subtle (micro-interactions only).

## Additions 2026-11-01 (see decisions)

- **Surfaces (light):** page `#edf1f5`, alt surface `#e2e8ef`, card border `#d3dbe5`, layered card shadow; cards are always white on the tinted page.
- **Rating stars:** `--color-star` for the glyph only; the number beside it uses `ink`.
- **Product artwork (superseded 2026-11-01 by real photos, see below):** blueprint plate (`.blueprint` utility) — navy, accent glow, 18px grid; brand chip top-left, SKU bottom-right.
- **Icons (2026-11-01, replaces emoji):** `lucide-react` only — no emoji anywhere in the UI. Shared sets live in `apps/web/src/lib/icons.ts` (`NAV_ICONS`, `CATEGORY_ICONS`, `UI_ICONS`); feature lists (account/admin sections, policy points, steps) may declare their own Lucide icons next to the list. Always decorative: `aria-hidden="true"` beside a real text label. Sizes: nav and tab bar 16–20px, chips and meta 14–16px, tinted tiles 20–28px; stroke 2–2.25 (1.75 on large tiles). Colour: `currentColor`; inside `accent-soft` tiles use `text-accent-soft-text`, on navy `text-accent-light`. Desktop nav/account/language icons appear from 1280px so the header never overflows. Map pins draw the Lucide wrench as inline SVG.
- **Map pins:** 32px teardrop in `accent-button` with a white 2.5px ring and 🔧; selected = navy + accent halo + 1.22 scale; name tooltip in navy. Popups use surface/ink tokens and the accent "View & book" button.
- **Empty states (2026-11-01):** emoji in an `accent-soft` circle (account lists 48px tile, cart 80px), one sentence in `muted`, one next action (`accent-soft-text` link or the primary button). Secondary shortcuts use quiet pill links. Account list empty cards use a dashed `line-card` border to read as "nothing here yet" rather than content.
- **Footer (2026-11-01):** help card + 4 link columns (2-up on phones, 4-up from 760px); column titles `ink` 14px extra-bold; links `muted` → `ink` on hover, 44px rows; legal row under a `line` rule with operator, GSTIN and registered office. **Policy row (2026-11-04):** the five policy pages (company & contact, privacy, delivery & payment, returns, workshop bookings) as a `nav` list under the legal block, `muted` → `ink` on hover, 44px targets; policy pages share `PolicySections` (one card per section with an `accent-soft` emoji tile).
- **Coins (2026-11-01):** balance hero on the `.blueprint` plate (🪙, 44px Manrope number); coin lines in summaries use `success` with a minus sign; "no cash value" always stated near the balance.
- **Delivery code (2026-11-01):** customer card with a 2px `accent-button` border on `accent-soft`, 40px Manrope digits with wide tracking, safety line in `muted`; shop entry is a 4-digit numeric field beside the primary "Confirm delivery" button.
- **Partner status pills (2026-11-01):** Active `success-bg/success`, Paused `warning-bg/warning`, Suspended `pill/error`; paused banners use `warning-bg`, the suspended portal lock uses a card with an `error` border and the reason.
- **Policy notes (2026-11-01):** "No returns or exchanges" notes use `warning-bg/warning` with a bold lead and a link to `/policies/returns`.

## Hindi content (2026-11-02, CLAUDE.md hard rule 10)

User (2026-11-02, on `/hi/workshops`): "its in hindi but i still see quite some stuff in english … it shouldnt happen anywhere". On `/hi` **nothing user-visible is English** — UI copy, content data (products, workshops, services, shops, localities, company facts) and map labels.

- **Stays in Latin script:** brand and model names (Castrol, Exide, Shell Helix, "Activ 4T 20W40", XLTZ4A; vehicle makes/models such as Honda Activa, Maruti Suzuki Swift VXi); units and technical tokens (ml, km, kg, cc, psi, 20W40, 2W/4W, EV, AC, GST, GSTIN, PIN, OTP, UPI, MRP, SKU, SMS, SUV, OEM, API, JASO, SAE, ISI, VRLA, AGM, TPE); codes (MD-…, SR-…, REQ-…, QT-…, PA-…, SKUs, phone numbers, delivery codes); the brand **MechDost** (and WhatsApp); text people typed (reviews, chat messages, names, addresses, notes, staff reasons).
- **Transliterated:** business names (workshops, shops, the operator: "शंकर नगर ऑटो हब", "शौर्य इंटीग्रेटेड सर्विसेज़ प्राइवेट लिमिटेड") and localities ("शंकर नगर", "रायपुर"). Invoices and filings keep the registered English form.
- **Tone:** natural, simple Hindi as Indian shopping apps write it; common loanwords in Devanagari are preferred over textbook Hindi ("सर्विस", "इंजन ऑयल", "बैटरी", "पिकअप", "फ़िटिंग"). Durations in Hindi units ("30–60 मिनट", "2–3 घंटे"); weekdays short ("सोम–शनि").
- **Markup:** user-typed text carries `data-user-content`; text deliberately in another language carries `lang="en"` (language switcher, the English column of admin bilingual editors). Nothing else is exempt.
- **Allowlist:** `apps/web/test/hindi-allowlist.ts` is the single list (brands from the catalogue, product/vehicle models, technical tokens, photo-credit and map-data proper names, seeded people's names). Tokens with a digit and UPPER-CASE hyphenated codes are ignored by construction. Never add a generic English word to it — translate instead.
- **Map labels:** place/road/POI labels prefer `name:hi`, then the local OSM `name` (road refs such as NH30 are codes). Devanagari is drawn by the browser (MapLibre ≥ 6.15), no extra glyphs.
- **Gate:** `apps/web/e2e/hindi-coverage.spec.ts` renders every `/hi` page (public, customer, shop, workshop, admin) with seeded data and fails listing page + English words; `test/content-i18n.test.ts` and `test/map-styles.test.ts` cover the data overlays and map labels.

### Switch (2026-11-03)

On/off settings (admin Notifications) use a native checkbox with `role="switch"` and a visible text label. The track is 48×28 px, using `--color-line` when off and `--color-accent-button` when on. The thumb is white with a shadow. Focus uses the `--color-focus` outline on the visible track. A short "On / Off" text sits next to it, so state is never shown by colour alone. The whole label is the tap target (≥ 44 px).

### Privacy choice banner (2026-11-03)

Card (`rounded-card`, `border-line`, `bg-surface`, `shadow-dialog`) fixed above the mobile tab bar (full width with a 12 px inset) or bottom-left on desktop (max 28 rem). Heading 15 px Manrope extra-bold, body `text-sm text-muted`, then **two equal buttons** side by side (`border-ink`, `text-ink`, same size; never one filled and one quiet). Not a modal and never auto-dismissed. While it is open the floating assistant button is hidden (`html[data-consent-open]`). Reopened from "Privacy choices" in the footer's legal area. Copy in `consent.*` (en/hi).

- **Empty states (2026-11-01):** a Lucide icon in an `accent-soft` circle (account lists 48px tile, cart 80px), one sentence in `muted`, one next action (`accent-soft-text` link or the primary button). Secondary shortcuts use quiet pill links. Account list empty cards use a dashed `line-card` border to read as "nothing here yet" rather than content.
- **Footer (2026-11-01):** help card + 4 link columns (2-up on phones, 4-up from 760px); column titles `ink` 14px extra-bold; links `muted` → `ink` on hover, 44px rows; legal row under a `line` rule with operator, GSTIN and registered office.

## Refresh 2026-11-01 (decisions: "Modern storefront refresh with real photos")

- **Photography first.** Products, categories, workshops and the hero use real photos (`apps/web/src/lib/media.ts`; credits at `/credits`). Photo boxes have a fixed ratio (products/categories 4:3, workshops 16:9) with `fill` + `object-cover` and a `pill` background while loading; product photos carry a white brand chip top-left. Never place text on a photo without a navy veil.
- **Hero.** Full-bleed photo inside the 24px panel; <1024px a top-to-bottom navy veil, ≥1024px the photo occupies the right 58% with navy fading in from the copy. Headline clamp(38px, 5vw, 72px), weight 800, −0.045em; second line in `accent-light`. Search console: white 18px card, `pill` segmented control (44px segments, active = surface + small shadow), 48px fields, popular-search pills.
- **Cards.** Photo edge-to-edge at the top, body padding 16px, `category · fit` meta line, name clamped to 2 lines, price block pinned to the bottom (`mt-auto`) so rows align; prices use `tabular-nums`.
- **Motion (updated 2026-11-02).** Scroll-driven, CSS only: `.reveal` (rise + fade + de-blur, row cascade via `stagger(i)`), `.reveal-panel` (scale-in for big cards), hero photo parallax, header shadow on scroll, rotating hero badge. Never animate hero copy (LCP); everything off under reduced motion. Plus page entrance, press scale, hover image zoom (≤1.04), popovers.
- **Surfaces & finish (later the same day).** Page `#f7f9fc` with a faint top light; cards white → `#f9fbfd` (top-to-bottom), hairline `line-card` border and a three-layer shadow; primary buttons `#d2461a` → `#c03e16`; navy panels carry two soft radial glows (cool top-left, warm bottom-right). All gradients are tokens + `surfaces.css` — components keep using `bg-surface` / `bg-accent-button` / `bg-navy`; never hand-write gradients in components.
- **No announcement bar.** The header is the top of every page.
- **Select (2026-11-02).** Field like an input (44px, `input-border`, chevron that turns when open, optional leading icon); open list = surface card, 10px radius, hairline border, hover shadow, 44px options with icon, check on the selected option, `pill` highlight for the active one; 150 ms drop-in. Never use a native `<select>` in filters.
- **Search field.** Leading search icon, clear (×) button when filled; live results (300 ms debounce) — no separate Search button.
- **Primary button finish.** Glossy opaque-glass orange: sheen on the top third, label band at `accent-button`, glow below (tokens `--gradient-accent*`, `--shadow-accent*`, applied by `surfaces.css`).
- **Workshop list rows.** 64px thumbnail, name (truncate), area · distance/PIN, "From ₹…", rating chip, chevron; open row: accent border + photo, badges, services, "Show on map" + "View & book". Map sticky right ≥1024px.
- **Theme 2026-11-02 — blue + green (branch `theme-blue-green`).** Orange is retired: blue `#2563eb` for logo/icons/links, glass-blue buttons (`#1d47c4` fill, blur, thin bright edge, soft shadow), green `#4ade80` for highlights on deep-blue panels (`#0b2350`), pale blue `#eaf1ff` for active states, focus ring `#3574f0`. Shadows soft and diffused only. Full table in decisions.md.
- **Theme 2026-11-02 (later) — green brand.** Supersedes blue: green `#15803d` logo/icons, green glass buttons (`#166534`), deep green panels `#053d2f` with mint `#86efac` highlights, pale green `#e9f8ef` active states, focus `#1f9d55`, faintly green-grey neutrals. Blue only for the map's "you are here" dot. Full table in decisions.md.
- **Hero height rule.** The home hero must fit inside the first screen at 1280×720 and on 360×640 phones (above the tab bar): headline `clamp(30px, min(4.6vw, 6.2vh), 60px)`, vh-based padding, single-row chips on phones. Re-measure when changing hero content.
- **List cards (2026-11-02).** Sequences and Q&A are one card with hairline-divided rows (`divide-y divide-line`), not a stack of cards. Steps use a numbered circle + a 1px rail between rows; FAQ rows have a round chevron button that turns pale green when open.
- **Footer (2026-11-02).** Deep green (`bg-navy`) with `.footer-green` token scope: white headings, mint-grey links/body, frosted help card, white WhatsApp pill.
- **Redesign 2026-11-02 (branch `redesign-commerce`).** Header = brand · centred pill search (48px, pill bg, inline green "Search") · controls; category bar below with quiet pills (muted → ink on hover). Hero = banner carousel, 22–24px panels in three tones (accent-soft / hero green / surface-alt), headline `clamp(30px, min(4.2vw, 6.4vh), 56px)`, illustration right; dots (8px, active 24px accent) + pause button. Illustrations: flat duotone, token colours only, 2–2.5px rounded strokes, soft ground shadow; category spots 84–96px; motion = float 5px/7s, wheel spin 10s, twinkle — never on text. Rails: 270px cards, 16px gap, snap, "View all" in accent-soft-text.
