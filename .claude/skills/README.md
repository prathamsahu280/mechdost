# MechDost project skills

These skills were written for this project and live in the repo, so **everyone who opens the repo in Claude Code gets them automatically** (Claude Code loads `.claude/skills/*/SKILL.md` from the project). Nothing to install. Public skills and plugins we also use are listed in [`docs/runbooks/collaborator-setup.md`](../../docs/runbooks/collaborator-setup.md).

How they are used is a hard rule (CLAUDE.md rule 11, "Skill usage protocol"): the two core skills run on every task, the others at their trigger.

## Core (every task)

| Skill                                           | When it runs                                                                  | What it does                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`mechdost-advisor`](mechdost-advisor/SKILL.md) | Start of every task and before any decision                                   | Loads `CLAUDE.md`, `docs/progress.md`, `docs/decisions.md`, the task's spec and the design system; checks the plan against the hard rules (1–16); flags conflicts and risks; researches when needed; writes an "Advisor brief". After the task it records what it learned. |
| [`website-testing`](website-testing/SKILL.md)   | Before saying anything is done, after every feature or fix, when a test fails | Picks the right suites (unit, DB integrity, API, e2e, concurrency, role-leak, webhook chaos, accessibility, visual, Lighthouse, i18n), runs them, triages failures and adds tests for new bug classes.                                                                     |

## Domain skills (at their trigger)

| Skill                                                           | Use it for                                                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`drizzle-postgis-supabase`](drizzle-postgis-supabase/SKILL.md) | Any database change: tables, migrations, RLS, PostGIS queries, indexes, repositories, seeds (run `supabase-postgres-best-practices` alongside). |
| [`firebase-phone-auth-rbac`](firebase-phone-auth-rbac/SKILL.md) | Sign-in, phone OTP, email verification, sessions, ID-token checks, roles and permissions.                                                       |
| [`razorpay-payments`](razorpay-payments/SKILL.md)               | Payments, webhooks, refunds, COD, reconciliation, money maths.                                                                                  |
| [`notifications-messaging`](notifications-messaging/SKILL.md)   | Notifications: in-app, email, SMS and WhatsApp templates, the outbox, DLT, delivery webhooks.                                                   |
| [`next-intl-hindi`](next-intl-hindi/SKILL.md)                   | Any user-facing text, translation, locale routing, number/date formatting, Devanagari typography.                                               |
| [`serwist-pwa`](serwist-pwa/SKILL.md)                           | Service worker, offline support, install prompt, manifest, web push.                                                                            |

## Self-improving skills

`mechdost-advisor` and `website-testing` keep `references/learnings.md`: after each task, anything that went wrong, cost a retry or was corrected is appended as one line (`L<n>` / `T<n>` · date · area · what happened → rule for next time). A lesson that shows up twice is promoted into `references/checklist.md` (advisor) or the test recipes, and logged in `references/changelog.md`. `evals/evals.json` holds the prompts used to check a skill still behaves after edits.

**Collaborators:** commit learnings with the change that produced them, keep entries to one line, and never delete another person's entry; mark it `retired` with a reason instead.

## Adding or changing a skill

1. One folder per skill with a `SKILL.md` whose front matter has `name` and a `description` that says **when** to use it (that is what Claude matches on).
2. Keep `SKILL.md` short; put depth in `references/`.
3. Add it to the tables above and to the protocol table in `CLAUDE.md`.
4. Use the `writing-skills` skill (superpowers) to write and test it.
