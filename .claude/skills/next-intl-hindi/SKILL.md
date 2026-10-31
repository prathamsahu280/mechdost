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
  translation; keep brand, part numbers, units and product names in Latin script. Maintain a glossary
  (`packages/shared/i18n/glossary.md`) for recurring terms (order = ऑर्डर, workshop = वर्कशॉप, estimate = अनुमान…).
- Admin-editable copy (CMS `content_blocks`) has `en` and `hi` side by side; missing `hi` falls back to `en` and is
  flagged in admin.

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
