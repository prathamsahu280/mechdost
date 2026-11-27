/**
 * SIM-P2/G16 + SIM-P16/G18 (live QA 2026-11-27): the network launched with no curated hashtags and empty Banned words,
 * Personal details to hide and Blocked link sites lists, so a common Hindi slur posted straight through. The starter
 * seed adds them, is idempotent, and never overwrites what an admin already set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { screenTextSignals } from '@mechdost/shared/ustaad/moderation';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedUstaadStarterLists, USTAAD_STARTER } from '../src/ustaad/starter-lists';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  // An admin already made #battery their own way and switched one starter word off.
  await db
    .insert(s.ustaadTags)
    .values({ slug: 'battery', nameEn: 'Battery (admin)', nameHi: 'बैटरी', group: 'part' });
  await db
    .insert(s.ustaadWordLists)
    .values({ list: 'banned', phrase: 'kamina', phraseNorm: 'kamina', lang: 'hinglish', active: false });
});

afterAll(async () => {
  await client.close();
});

describe('Ustaad starter lists', () => {
  it('adds ~10 curated work tags with Hindi names and the three moderation lists; twice is a no-op', async () => {
    const first = await seedUstaadStarterLists(db);
    expect(first.tags).toBeGreaterThanOrEqual(9);
    const again = await seedUstaadStarterLists(db);
    expect(again).toEqual({ tags: 0, words: 0 });

    const tags = await db.select().from(s.ustaadTags);
    expect(tags.length).toBeGreaterThanOrEqual(10);
    for (const t of tags) expect(t.nameHi).toMatch(/[ऀ-ॿ]/);

    for (const list of ['banned', 'pii_pattern', 'link_domain'] as const) {
      const rows = await db.select().from(s.ustaadWordLists).where(eq(s.ustaadWordLists.list, list));
      expect(rows.length, list).toBeGreaterThan(3);
    }
  });

  it('never overwrites an admin row', async () => {
    const [battery] = await db.select().from(s.ustaadTags).where(eq(s.ustaadTags.slug, 'battery'));
    expect(battery?.nameEn).toBe('Battery (admin)');
    const [k] = await db
      .select()
      .from(s.ustaadWordLists)
      .where(and(eq(s.ustaadWordLists.list, 'banned'), eq(s.ustaadWordLists.phraseNorm, 'kamina')));
    expect(k?.active).toBe(false);
  });

  it('the banned list catches Devanagari and Latin spellings of a common slur (SIM-P16)', () => {
    const banned = USTAAD_STARTER.banned.map((w) => w.phrase);
    const lists = { banned, scamPhrases: [], linkDomains: [] };
    expect(screenTextSignals('ye aadmi chutiya hai', lists)).toContain('banned_word');
    expect(screenTextSignals('ये आदमी चूतिया है', lists)).toContain('banned_word');
    expect(screenTextSignals('Clutch plate badla, sab theek hai', lists)).not.toContain('banned_word');
  });
});
