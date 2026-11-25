/**
 * Badge rules (spec 23 § 9.3; plan task B5). Rules are typed jsonb (`ustaad_badges.rule`, `schema_version` + `kind`);
 * the level job evaluates them with facts counted in SQL and inserts awards (the partial unique index keeps one per
 * member while not revoked). An unknown or malformed rule awards nothing.
 */
import { z } from 'zod';

const min = z.number().int().min(1).max(100_000);
const v1 = z.literal(1);

export const BadgeRuleDto = z.discriminatedUnion('kind', [
  z.object({
    schema_version: v1,
    kind: z.literal('best_answers_with_tag'),
    tag: z.string().min(1).max(60),
    min,
  }),
  z.object({
    schema_version: v1,
    kind: z.literal('helpful_answers_in_segment'),
    segment: z.string().min(1).max(40),
    min,
  }),
  z.object({ schema_version: v1, kind: z.literal('apprentice_answers_in_week'), min }),
  z.object({ schema_version: v1, kind: z.literal('first_post') }),
  z.object({ schema_version: v1, kind: z.literal('first_question') }),
  z.object({ schema_version: v1, kind: z.literal('first_answer') }),
  z.object({ schema_version: v1, kind: z.literal('founding') }),
]);
export type BadgeRule = z.infer<typeof BadgeRuleDto>;

export interface BadgeFacts {
  posts: number;
  questions: number;
  answers: number;
  founding: boolean;
  bestAnswersByTag: Readonly<Record<string, number>>;
  helpfulBySegment: Readonly<Record<string, number>>;
  apprenticeAnswersThisWeek: number;
}

function met(r: BadgeRule, f: BadgeFacts): boolean {
  switch (r.kind) {
    case 'first_post':
      return f.posts >= 1;
    case 'first_question':
      return f.questions >= 1;
    case 'first_answer':
      return f.answers >= 1;
    case 'founding':
      return f.founding;
    case 'best_answers_with_tag':
      return (f.bestAnswersByTag[r.tag] ?? 0) >= r.min;
    case 'helpful_answers_in_segment':
      return (f.helpfulBySegment[r.segment] ?? 0) >= r.min;
    case 'apprentice_answers_in_week':
      return f.apprenticeAnswersThisWeek >= r.min;
  }
}

/** Codes of badges whose rule is met and that the member does not hold yet. */
export function badgesToAward(
  badges: readonly { code: string; rule: unknown }[],
  facts: BadgeFacts,
  held: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const b of badges) {
    if (held.has(b.code)) continue;
    const parsed = BadgeRuleDto.safeParse(b.rule);
    if (parsed.success && met(parsed.data, facts)) out.push(b.code);
  }
  return out;
}
