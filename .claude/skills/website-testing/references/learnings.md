# Testing learnings (append-only; newest last)

Format: `T<n> · <date> · <area> · <bug> · <root cause> · <test that now guards it>` · status `active` | `automated`

- T1 · 2026-10-31 · db · Generated migration had `"geography(Point,4326)"` (quoted type) which Postgres rejects · drizzle-kit quotes custom types with parentheses · `scripts/fix-migrations.mjs` + integrity suite applies all migrations on a fresh PGlite DB · automated
- T2 · 2026-10-31 · db · Supabase extension types need `search_path` incl. `extensions` · extensions moved out of `public` · `createTestDb()` sets `search_path public, extensions`; migrations run on PGlite in every test run · automated
- T3 · 2026-10-31 · lint · 26 strict lint findings (non-null assertions, unnecessary casts, void-returning arrows, deprecated matchers) · code written before lint existed · `pnpm check` with `--max-warnings=0` · automated
- T4 · 2026-10-31 · config · DB URL broke because the password contained `@` · unencoded URL credentials · validate URLs by parsing (`new URL`) in env schema checks (add to API env tests) · active
- T5 · 2026-10-31 · api · Gate tests can pass vacuously. → After writing auth/permission tests, mutation-check once: disable the check, confirm the suite fails, restore (done for `requirePermission`). · active
- T6 · 2026-10-31 · api · Tests must not reach into tables directly (hard rule 14) — a test needing state (e.g. a deactivated user) is a signal a repository function is missing (`deactivateUser`). · active
- T7 · 2026-11-01 · a11y · axe reported contrast failures on elements mid scroll-reveal animation. → Run axe with `emulateMedia({ reducedMotion: 'reduce' })` so it scans the final state. · active
- T8 · 2026-11-01 · responsive · 390/1440 tests passed while 320–360 and 760–1023 overflowed. → Keep the 13-width sweep (overflow + 24px targets) in e2e for every page list change. · active
- T9 · 2026-11-01 · visual · Tests were green but screenshots showed a blurry tablet hero and a missing nav highlight. → After UI work, screenshot 320/768/1024/1920 + dark + Hindi and look before claiming done. · active
- T10 · 2026-11-01 · e2e · `waitUntil: 'networkidle'` hung on the map page and the "every button" audit clicked map pins that were outside the map's clipped area, plus a full-screen control that covered the page. → Wait for `load` + a short settle on map pages; exclude map pins from generic click audits (dedicated map test covers them); exit full screen after each click; run click audits with reduced motion so animations/transitions settle instantly. · active
- T11 · 2026-11-01 · links · The link crawler caught a product-page link to a route that did not exist yet (`/quotes/new`). → Keep the crawler in every run; never link to a planned route before the page exists. · active
- T12 · 2026-11-01 · locators · Decorative `aria-hidden` emoji change `textContent` but not the accessible name. → Assert labels with `toHaveAccessibleName`, not `toHaveText`, on controls that carry icons/emoji. · active
