# Testing learnings (append-only; newest last)

Format: `T<n> · <date> · <area> · <bug> · <root cause> · <test that now guards it>` · status `active` | `automated`

- T1 · 2026-10-31 · db · Generated migration had `"geography(Point,4326)"` (quoted type) which Postgres rejects · drizzle-kit quotes custom types with parentheses · `scripts/fix-migrations.mjs` + integrity suite applies all migrations on a fresh PGlite DB · automated
- T2 · 2026-10-31 · db · Supabase extension types need `search_path` incl. `extensions` · extensions moved out of `public` · `createTestDb()` sets `search_path public, extensions`; migrations run on PGlite in every test run · automated
- T3 · 2026-10-31 · lint · 26 strict lint findings (non-null assertions, unnecessary casts, void-returning arrows, deprecated matchers) · code written before lint existed · `pnpm check` with `--max-warnings=0` · automated
- T4 · 2026-10-31 · config · DB URL broke because the password contained `@` · unencoded URL credentials · validate URLs by parsing (`new URL`) in env schema checks (add to API env tests) · active
