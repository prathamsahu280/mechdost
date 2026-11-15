# Firebase project config (kept in the repo, reviewed like code)

- `database.rules.json` — Realtime Database rules for live updates (decision 2026-11-01,
  `docs/research/realtime-alternatives.md`). Each signed-in user can read **only** `/inbox/{their uid}`;
  nobody can write from a client. The worker writes thin pings `{e,k,id,v,at}` with the Admin SDK, which bypasses
  rules. Deploy with `firebase deploy --only database` once the project exists (inbox Q3/Q30).
- Region: the Realtime Database has no India region; use `asia-southeast1` (Singapore).
- Tests: `apps/api/test/live.test.ts` checks these rules stay read-own-inbox, write-nothing; add emulator rule
  tests (`@firebase/rules-unit-testing`) when the Firebase project and emulator suite are set up.

Browser listener (2026-11-15): `apps/web/src/lib/live/` reads `inbox/<uid>` only, after sign-in, with `NEXT_PUBLIC_FIREBASE_DATABASE_URL`. The read rule also refuses anonymous sign-ins. **Rules are deployed by hand, never by CI or the builder:** `firebase deploy --only database` after reviewing the diff. Rule tests against the emulator are queued (Q160); until then `apps/api/test/live.test.ts` checks the rule structure and evaluates each clause.
