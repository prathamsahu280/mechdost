import { and, desc, eq, inArray, isNull, like, max, sql } from 'drizzle-orm';
import { ustaadValuesFrom, type UstaadSettingValues } from '@mechdost/shared/ustaad/settings';
import { consents, settings, ustaadMembers, ustaadWordLists } from '../schema';
import type { Tx } from './orders';

/**
 * Reads for smart correction (spec 23 § 11). Read-only: the route never writes here (the post/answer/comment writes
 * that store `body_original` and `correction` belong to the content workstreams).
 */

/** Every `ustaad.*` global setting, stored values over defaults (invalid stored values fall back). */
export async function ustaadSettingValues(db: Tx): Promise<UstaadSettingValues> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(isNull(settings.cityId), like(settings.key, 'ustaad.%')));
  return ustaadValuesFrom(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

export interface CorrectionMember {
  memberId: string;
  status: string;
  /** The member's own choice (null = network default). */
  correctionMode: string | null;
  /** Latest `ustaad_correction` consent row says granted (masked text may go to the LLM processor). */
  llmConsent: boolean;
}

/** The caller's network membership for correction, or null when they are not a member. */
export async function correctionMember(db: Tx, userId: string): Promise<CorrectionMember | null> {
  const [m] = await db
    .select({
      memberId: ustaadMembers.id,
      status: ustaadMembers.status,
      correctionMode: ustaadMembers.correctionMode,
    })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.userId, userId))
    .limit(1);
  if (!m) return null;
  const [c] = await db
    .select({ granted: consents.granted })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.purpose, 'ustaad_correction')))
    .orderBy(desc(consents.createdAt), desc(consents.id))
    .limit(1);
  return { ...m, llmConsent: c?.granted ?? false };
}

export interface CorrectionWords {
  /** Active protected words and phrases (never changed by any engine). */
  protected: string[];
  /** Active admin corrections (phrase → replacement). */
  corrections: { phrase: string; replacement: string }[];
  /** Changes whenever either list is edited (cache key part). */
  version: string;
}

/** The admin's protected-word and correction lists (index `ustaad_word_lists (list, active)`). */
export async function correctionWords(db: Tx): Promise<CorrectionWords> {
  const rows = await db
    .select({
      list: ustaadWordLists.list,
      phrase: ustaadWordLists.phrase,
      replacement: ustaadWordLists.replacement,
    })
    .from(ustaadWordLists)
    .where(and(inArray(ustaadWordLists.list, ['protected', 'correction']), eq(ustaadWordLists.active, true)));
  const [stamp] = await db
    .select({ at: max(ustaadWordLists.updatedAt), n: sql<number>`count(*)::int` })
    .from(ustaadWordLists)
    .where(inArray(ustaadWordLists.list, ['protected', 'correction']));
  return {
    protected: rows.filter((r) => r.list === 'protected').map((r) => r.phrase),
    corrections: rows
      .filter((r) => r.list === 'correction' && r.replacement !== null)
      .map((r) => ({ phrase: r.phrase, replacement: r.replacement ?? '' })),
    version: `${stamp?.at?.toISOString() ?? '0'}:${String(stamp?.n ?? 0)}`,
  };
}
