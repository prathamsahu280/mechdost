---
name: next-intl-hindi
description: Use for any MechDost user-facing text, translation, locale routing, number/currency/date formatting, Devanagari typography, Hindi search synonyms or i18n testing. English + Hindi ship at launch (decision 2026-10-31); every string lives in locale files, never inline (hard rule 10).
---

# English + Hindi with next-intl (MechDost)

## Setup (verify exact v4 APIs with Context7 before coding)

- Messages: `packages/shared/i18n/en.json` and `hi.json` (same keys; nested by feature: `home.hero.title`).
  Shared by web, emails/notifications and later the mobile app.
- Routing: `localePrefix: 'as-needed'` — English at `/…`, Hindi at `/hi/…` (SEO-friendly, hreflang pairs).
  Locale detection from cookie `NEXT_LOCALE` then `Accept-Language`; the header language switcher sets the cookie and
  the user's profile `language`. Admin/partner portals may use `'never'` prefix (no SEO) with cookie/profile locale.
- `i18n/request.ts` loads messages for the resolved locale; Server Components use `getTranslations`, client components
  receive only the namespaces they need (keep bundles small).
- Next.js 16 uses `proxy.ts` (formerly middleware) for the locale handler — confirm with next-intl docs for v4.

## Content rules

- No inline strings in components, API error messages shown to users, emails or notifications. Errors carry a `code`;
  the client maps codes to translated messages.
- ICU messages for plurals and variables: `"{count, plural, one {# item} other {# items}}"`.
- Copy comes from `docs/concept/*.md` (English). Hindi: natural, simple Hindi as spoken in Raipur — not literal
  translation; keep brand, part numbers, units and model names in Latin script (generic product words are Hindi). Maintain a glossary
  (`packages/shared/i18n/glossary.md`) for recurring terms (order = ऑर्डर, workshop = वर्कशॉप, estimate = अनुमान…).
- Admin-editable copy (CMS `content_blocks`) has `en` and `hi` side by side; missing `hi` falls back to `en` and is
  flagged in admin.

## Content data and map labels (2026-11-02 — "nothing English on /hi", hard rule 10)

UI keys are not enough: product, workshop, service, shop, locality and company text comes from **data**, and map
labels come from **tiles**. All of it must be Hindi on `/hi` (rules and allowlist: `docs/design-system.md` § Hindi
content).

- **Demo data:** overlays next to the data in `apps/web/src/demo/i18n/hi.ts` (`PRODUCT_HI`, `SERVICE_HI`,
  `WORKSHOP_HI`, `SHOP_HI`, `AREA_HI`, `DAY_HI`, keyed by slug/key) and helpers in `localize.ts`. Localise once at
  the top of the component: `const p = localizeProduct(product, locale)` (Server Components: `params.locale` /
  `getLocale()`; client and shared components: `useLocale()`). Snapshots (orders, requests, quotes) keep English:
  render `productNameFor(slug, snapshot, locale)`, `workshopNameFor`, `serviceNameFor`, `shopNameFor`.
  Adding a product/workshop/service/shop/area without a Hindi entry fails `test/content-i18n.test.ts`.
- **What stays Latin:** brands and models, units/technical tokens, codes, MechDost, user-typed text. Business and
  locality names are **transliterated** ("शंकर नगर ऑटो हब"). Product names: translate the generic words only
  ("फ़ुली सिंथेटिक इंजन ऑयल 5W-30 3.5 L"); keep the brand separate. Durations "30–60 मिनट", weekdays "सोम–शनि".
- **Real DB:** per-locale column pairs (`name_hi`, `description_hi`, `title_hi`, `address_hi`, `highlights_hi`…;
  decision 2026-11-02 "Localised content columns"); search indexes both columns.
- **Search:** `searchProducts` matches English and Hindi text in both locales and the shown category label.
- **User-typed text** (reviews, chat, names, addresses, notes, staff reasons): render as typed inside an element
  with `data-user-content`. Text deliberately in English (language switcher, admin English copy field) gets
  `lang="en"`. Nothing else is exempt.
- **Company facts:** `companyFacts(locale)` in `lib/site.ts` (operator name and registered office).
- **Third-party UI strings** go through locale files too: MapLibre's `locale` option (zoom, full screen, popup
  close, marker, attribution…) is fed from the `map` namespace.
- **Map labels:** `localizeLabels(style, locale)` (`lib/map-styles.ts`) rewrites name `text-field`s to
  `coalesce(name:hi, name)` / `coalesce(name:en, name_en, name)`, keeps refs (NH30); applied via `transformStyle`
  to light, dark and hybrid (`localizeLabels(toHybrid(next))`). Pass `locale` to every `WorkshopMap`. Devanagari is
  shaped by the browser (MapLibre ≥ 6.15), no glyph work needed.
- **The gate:** `apps/web/e2e/hindi-coverage.spec.ts` visits every `/hi` page (public + signed-in customer, shop,
  workshop, admin) with seeded records, collects visible text + `aria-label`/`placeholder`/`title`/`alt`/options
  - `document.title`, and fails listing page → English words. Allowlist: `apps/web/test/hindi-allowlist.ts`
    (never add generic words). Map pixels: `test/map-styles.test.ts`. New pages go into its page lists; new seeded
    record types go into `seedData` and `MUST_SHOW`.

## Formatting

- Money: `formatINR` from `@mechdost/shared/money` (₹, lakh grouping) in both locales; digits stay Latin (decision
  default; revisit if users prefer Devanagari numerals).
- Dates: `Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kolkata' })`; relative times via next-intl.

## Typography

- Hindi font: Noto Sans Devanagari (or Mukta) via `next/font` with `display: swap`, subset `devanagari`, loaded only on
  `hi` pages; line-height ≥ 1.6 for Devanagari; avoid letter-spacing on Hindi text (the concept's tracked eyebrows apply
  to Latin only).
- Expect 20–40 % longer strings: no fixed-width buttons, allow wrapping, test at 390 px.

## Search

- Hinglish/Hindi synonyms table (`search_synonyms`): "brake pad / ब्रेक पैड / break pad", "tyre / टायर / tire", etc.

## Tests (website-testing §G3, G4)

Key parity test (en/hi have identical keys, no empty values); lint/check for inline JSX strings; Playwright `hi` runs at
390/1440 with visual snapshots; formatter unit tests; hreflang/canonical tags present.
