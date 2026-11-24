# Standard checklist for every builder agent (paste into each brief)

User, 2026-11-24: "all the agents need to do it so why do i have to remind it to u everytime?" Every agent brief
includes this block, and the lead rejects a branch whose report does not show each item.

1. **Start:** read `CLAUDE.md` → `docs/progress.md` → `docs/decisions.md` → the feature's spec(s) and
   `docs/design-system.md`. Run `mechdost-advisor`; quote its brief in the report.
2. **Skill chain for the task type** (CLAUDE.md "Skill usage protocol"):
   - new feature: `brainstorming` → `writing-plans` (the lead may have done these; say so);
   - implementing: `test-driven-development`; `hono` (API), `vercel-react-best-practices` (React/Next), `turborepo`
     (workspace);
   - UI: `accessibility-lead` before editing TSX/CSS, `ui-ux-pro-max` → `shadcn-component-discovery` → `shadcn` →
     `frontend-design` → `shadcn-component-review` + `web-design-guidelines`;
   - page change / performance: `core-web-vitals`, `performance` (measure the JS budget);
   - schema / payments / auth: `drizzle-postgis-supabase`, `supabase-postgres-best-practices`, `razorpay-payments`,
     `firebase-phone-auth-rbac`;
   - bug: `systematic-debugging`; Hindi or messaging: `next-intl-hindi`, `notifications-messaging`.
3. **Hard rules 1–16:** English + Hindi for every string and content field; analytics events in spec 12; admin can
   control anything configurable; data integrity (conditional updates with version, paise, outbox, append-only
   events); security (API permissions, Zod, rate limits); no AI attribution in commits or comments.
4. **Docs in the same change:** every affected `docs/specs/NN-*.md`, a dated `docs/decisions.md` entry,
   `docs/progress.md`, runbooks, `docs/README.md` index for new docs, CLAUDE.md commands for new scripts,
   `docs/questions-for-user.md` for opened or closed questions, the state-audit model + regenerated checklist for new
   UI.
5. **Before "done":** `website-testing` then `verification-before-completion`. Gates on exit codes: prettier check,
   tsc (shared, db, api, web), `pnpm lint` in each touched package, vitest per package one at a time. Include the
   TEST REPORT block.
6. **Learn:** append to `.claude/skills/mechdost-advisor/references/learnings.md` and, for bugs,
   `.claude/skills/website-testing/references/learnings.md`.
7. **Report:** list each item above with file paths; name any skill skipped and why. Commit on the branch; never push,
   never touch the real database or send real messages unless the lead's brief says so.
