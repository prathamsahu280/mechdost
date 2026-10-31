---
name: serwist-pwa
description: Use for MechDost PWA work — service worker, offline support, caching strategy, install prompt, web app manifest, icons, update flow and (later) web push for partners. Based on Serwist for Next.js; verify the integration against the installed Next.js 16 / Turbopack version before implementing.
---

# PWA with Serwist (MechDost)

Goal: fast repeat visits and a usable offline shell for customers; partner portals installable on phones with
new-order alerts (push in P1). Performance budgets in spec 16 still apply.

## Before implementing (mandatory)

Serwist has a dedicated Turbopack integration (`@serwist/turbopack`, with `esbuild-wasm`, `createSerwistRoute`, a
worker importing from `@serwist/turbopack/worker`, and a React provider). Sources disagree on dev-mode behaviour with
Next.js 16. **Verify with Context7 / serwist.pages.dev for the installed versions**, check release age and
advisories, record the chosen setup as a ruling in `docs/progress.md`. If dev mode is unreliable, disable the SW in
development and test it against `next build && next start`.

## Caching strategy

| Resource                                                        | Strategy                                            |
| --------------------------------------------------------------- | --------------------------------------------------- |
| App shell, hashed JS/CSS, fonts                                 | Precache / CacheFirst (immutable)                   |
| Product & category images (CDN)                                 | CacheFirst with expiration (max entries, 30 days)   |
| Public catalogue pages / API GETs (no auth)                     | StaleWhileRevalidate, short max-age                 |
| Authenticated API, cart, checkout, account, admin, partner data | **NetworkOnly — never cache**                       |
| Navigation fallback                                             | `/offline` page (localised, one next action: retry) |

Never cache responses with `Authorization`, cookies, or personal data. Bump cache names on breaking changes.

## Manifest

`app/manifest.ts`: name "MechDost", short_name "MechDost", theme `#101f34`, background `#f7f8fa`, start_url `/`,
display `standalone`, icons 192/512 + maskable; separate partner manifest scope later (`/partner`).

## Update flow

Skip waiting only after user consent ("New version available — Refresh"); never reload mid-checkout.

## Push (P1)

Web Push with VAPID keys for partner order alerts (sound + badge); permission asked contextually after first
assignment, never on first visit.

## Tests

Playwright: offline navigation shows `/offline`; authenticated routes never served from cache; SW update prompt;
Lighthouse PWA checks; no CLS from install banners.
