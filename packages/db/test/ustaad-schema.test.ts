/**
 * Ustaad Network schema (spec 23 § 6; plan task A2): every table exists with RLS and its triggers, the partial uniques
 * and CHECKs hold, append-only tables refuse UPDATE/DELETE and consents accept the network purposes. The generic
 * invariants (version/updated_at triggers, RLS everywhere, no client grants) are in `schema-invariants.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { USTAAD_CONSENT_PURPOSES } from '@mechdost/shared/ustaad/codes';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { RLS_INVENTORY } from './rls-inventory';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;

/** Every table of spec 23 § 6.1–6.10 plus the media totals row set. */
const SPEC_TABLES = [
  // 6.1 identity and trust
  'ustaad_members',
  'ustaad_member_specialities',
  'ustaad_verifications',
  'ustaad_attestations',
  'ustaad_vouches',
  'ustaad_level_rules',
  'ustaad_izzat_ledger',
  'ustaad_member_counters',
  'ustaad_badges',
  'ustaad_badge_awards',
  'ustaad_events',
  // 6.2 graph and messages
  'ustaad_follows',
  'ustaad_connections',
  'ustaad_mentorships',
  'ustaad_blocks',
  'ustaad_mutes',
  'ustaad_threads',
  'ustaad_messages',
  'ustaad_tag_follows',
  // 6.3 content
  'ustaad_posts',
  'ustaad_post_media',
  'ustaad_polls',
  'ustaad_poll_options',
  'ustaad_poll_votes',
  'ustaad_post_tags',
  'ustaad_tags',
  'ustaad_tag_suggestions',
  'ustaad_reactions',
  'ustaad_saves',
  'ustaad_comments',
  'ustaad_story_views',
  'ustaad_post_counters',
  'ustaad_questions',
  'ustaad_answers',
  'ustaad_answer_votes',
  'ustaad_answer_parts',
  'ustaad_promotions',
  'ustaad_courses',
  'ustaad_learning_resources',
  'ustaad_learning_progress',
  // 6.4 media
  'ustaad_media',
  'ustaad_media_variants',
  'ustaad_media_usage',
  'ustaad_media_totals',
  // 6.5 location and zones
  'ustaad_locations',
  'ustaad_zone_counts',
  // 6.6 jobs
  'ustaad_jobs',
  'ustaad_job_applications',
  // 6.7 moderation
  'ustaad_reports',
  'ustaad_moderation_actions',
  'ustaad_strikes',
  'ustaad_word_lists',
  'ustaad_report_reasons',
  'ustaad_removed_archive',
  // 6.8 settings storage + 6.10 extras
  'ustaad_reach_cities',
  'ustaad_application_links',
  'ustaad_tutorial_cards',
  'ustaad_coachmarks',
  'ustaad_member_onboarding',
  'ustaad_link_previews',
  'ustaad_pin_changes',
  'ustaad_reserved_names',
];

async function rejects(p: Promise<unknown>, code?: string): Promise<void> {
  let caught: unknown = null;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(caught, 'expected the statement to fail').not.toBeNull();
  if (code) {
    const err = caught as { code?: string; cause?: { code?: string } };
    expect(err.code ?? err.cause?.code).toBe(code);
  }
}

let memberA: string;
let memberB: string;
let userC: string;
let n = 0;

async function addMember(
  userId: string,
  over: Partial<typeof s.ustaadMembers.$inferInsert> = {},
): Promise<string> {
  n += 1;
  const [row] = await db
    .insert(s.ustaadMembers)
    .values({
      userId,
      handle: `mistri_${String(n)}`,
      displayName: `Mistri ${String(n)}`,
      track: 'ustaad',
      level: 'ustaad_pending',
      cityId: f.raipur,
      areaLabel: 'Pandri',
      pincode: '492001',
      workPlace: 'shop',
      ...over,
    })
    .returning({ id: s.ustaadMembers.id });
  if (!row) throw new Error('member');
  return row.id;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  memberA = await addMember(f.customer);
  memberB = await addMember(f.other);
  userC = f.staff;
});

afterAll(async () => {
  await client.close();
});

describe('Ustaad tables (spec 23 § 6)', () => {
  it('every spec table exists, has RLS on and is in the RLS inventory as deny-all', async () => {
    const res = await db.execute(sql`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ustaad\\_%' order by 1`);
    const rows = res.rows as { relname: string; relrowsecurity: boolean }[];
    expect(rows.map((r) => r.relname).sort()).toEqual([...SPEC_TABLES].sort());
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
    for (const t of SPEC_TABLES) expect(RLS_INVENTORY[t], t).toBe('none');
  });

  it('the media budget has one row per kind and the report reasons are seeded with other on', async () => {
    const kinds = await db.select().from(s.ustaadMediaTotals);
    expect(kinds.map((k) => k.kind).sort()).toEqual(['audio', 'document', 'image', 'video']);
    const reasons = await db.select().from(s.ustaadReportReasons);
    expect(reasons).toHaveLength(11);
    await rejects(
      db.execute(sql`update ustaad_report_reasons set active = false where code = 'other'`),
      '23514',
    );
  });

  it('consents accept every Ustaad purpose (and still refuse an unknown one)', async () => {
    for (const purpose of USTAAD_CONSENT_PURPOSES)
      await db.insert(s.consents).values({
        userId: f.customer,
        purpose,
        granted: true,
        noticeVersion: 'ustaad-2026-11-26',
        source: 'test',
      });
    await rejects(
      db.insert(s.consents).values({
        userId: f.customer,
        purpose: 'ustaad_age',
        granted: true,
        noticeVersion: 'x',
        source: 'test',
      }),
      '23514',
    );
  });
});

describe('members', () => {
  it('one member per user, unique case-insensitive handle, handle format', async () => {
    await rejects(addMember(f.customer), '23505');
    await rejects(addMember(userC, { handle: 'MISTRI_1' }), '23505');
    await rejects(addMember(userC, { handle: 'a b' }), '23514');
  });

  it('the junior track stays apprentice; the expert track never is', async () => {
    await rejects(addMember(userC, { track: 'apprentice', level: 'naya' }), '23514');
    await rejects(addMember(userC, { track: 'ustaad', level: 'apprentice' }), '23514');
  });

  it('status left needs left_at and the other way round', async () => {
    await rejects(db.execute(sql`update ustaad_members set status = 'left' where id = ${memberA}`), '23514');
  });
});

describe('append-only tables refuse UPDATE and DELETE', () => {
  it('ustaad_events, ustaad_izzat_ledger, ustaad_moderation_actions', async () => {
    await db.insert(s.ustaadEvents).values({
      entityType: 'member',
      entityId: memberA,
      kind: 'joined',
      actorRole: 'member',
    });
    await db.insert(s.ustaadIzzatLedger).values({
      memberId: memberA,
      delta: 2,
      reasonCode: 'answer_posted',
      sourceType: 'answer',
      idemKey: `answer:${randomUUID()}`,
    });
    await db.insert(s.ustaadModerationActions).values({
      targetType: 'member',
      targetId: memberA,
      action: 'warn',
      reasonCode: 'abuse',
      actorId: f.staff,
    });
    for (const table of ['ustaad_events', 'ustaad_izzat_ledger', 'ustaad_moderation_actions']) {
      await rejects(db.execute(sql.raw(`update ${table} set id = id`)));
      await rejects(db.execute(sql.raw(`delete from ${table}`)));
    }
  });

  it('the Izzat ledger refuses a duplicate idempotency key and a zero delta', async () => {
    const idem = `best:${randomUUID()}`;
    const row = {
      memberId: memberA,
      delta: 10,
      reasonCode: 'best_answer',
      sourceType: 'answer',
      idemKey: idem,
    };
    await db.insert(s.ustaadIzzatLedger).values(row);
    await rejects(db.insert(s.ustaadIzzatLedger).values(row), '23505');
    await rejects(db.insert(s.ustaadIzzatLedger).values({ ...row, idemKey: `${idem}x`, delta: 0 }), '23514');
  });
});

describe('partial uniques (one open X)', () => {
  it('one open verification per member; a decision names the staff member', async () => {
    const [v] = await db.insert(s.ustaadVerifications).values({ memberId: memberA }).returning();
    await rejects(db.insert(s.ustaadVerifications).values({ memberId: memberA }), '23505');
    if (!v) throw new Error('v');
    await rejects(
      db.execute(
        sql`update ustaad_verifications set status = 'approved', granted_level = 'naya' where id = ${v.id}`,
      ),
      '23514',
    );
    // One open attestation per verification.
    const att = {
      verificationId: v.id,
      memberId: memberA,
      ownerPhoneHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await db.insert(s.ustaadAttestations).values(att);
    await rejects(db.insert(s.ustaadAttestations).values(att), '23505');
  });

  it('active vouch pair is unique and nobody vouches for themselves', async () => {
    const vouch = {
      voucherId: memberA,
      voucheeId: memberB,
      relation: 'known_work',
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await db.insert(s.ustaadVouches).values(vouch);
    await rejects(db.insert(s.ustaadVouches).values(vouch), '23505');
    await rejects(db.insert(s.ustaadVouches).values({ ...vouch, voucheeId: memberA }), '23514');
  });

  it('follow pair is a primary key and never self; connections are ordered pairs', async () => {
    await db.insert(s.ustaadFollows).values({ followerId: memberA, followeeId: memberB });
    await rejects(db.insert(s.ustaadFollows).values({ followerId: memberA, followeeId: memberB }), '23505');
    await rejects(db.insert(s.ustaadFollows).values({ followerId: memberA, followeeId: memberA }), '23514');
    const [low, high] = [memberA, memberB].sort();
    if (!low || !high) throw new Error('pair');
    await db.insert(s.ustaadConnections).values({ lowId: low, highId: high, requestedBy: low });
    await rejects(
      db.insert(s.ustaadConnections).values({ lowId: high, highId: low, requestedBy: low }),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadConnections).values({ lowId: low, highId: high, requestedBy: high }),
      '23505',
    );
    await rejects(db.insert(s.ustaadMentorships).values({ ustaadId: memberA, shagirdId: memberA }), '23514');
  });

  it('one vote per member and answer, never on your own answer; the best answer belongs to its question', async () => {
    const [q] = await db
      .insert(s.ustaadQuestions)
      .values({
        code: 'UQ-RPR-2026-ABCDEF',
        askerId: memberB,
        cityId: f.raipur,
        title: 'Self nahi chal raha',
      })
      .returning();
    const [q2] = await db
      .insert(s.ustaadQuestions)
      .values({ code: 'UQ-RPR-2026-ABCDEG', askerId: memberB, cityId: f.raipur, title: 'Doosra sawaal' })
      .returning();
    if (!q || !q2) throw new Error('q');
    const [a] = await db
      .insert(s.ustaadAnswers)
      .values({ questionId: q.id, authorId: memberA, body: 'Carbon brush check karo' })
      .returning();
    if (!a) throw new Error('a');
    await db.insert(s.ustaadAnswerVotes).values({ answerId: a.id, voterId: memberB });
    await rejects(db.insert(s.ustaadAnswerVotes).values({ answerId: a.id, voterId: memberB }), '23505');
    await rejects(db.insert(s.ustaadAnswerVotes).values({ answerId: a.id, voterId: memberA }), '23514');
    await db.execute(
      sql`update ustaad_questions set best_answer_id = ${a.id}, status = 'solved' where id = ${q.id}`,
    );
    await rejects(
      db.execute(sql`update ustaad_questions set best_answer_id = ${a.id} where id = ${q2.id}`),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadQuestions).values({ code: 'bad', askerId: memberB, cityId: f.raipur, title: 'x' }),
      '23514',
    );
  });

  it('one link row per old application', async () => {
    const [app] = await db
      .insert(s.partnerApplications)
      .values({
        code: 'APP-RPR-2026-MECH01',
        kind: 'mechanic',
        name: 'Ramesh',
        phone: '+919811100009',
        pincode: '492001',
        details: 'Two-wheeler mechanic, 8 years',
        consentAt: new Date(),
      })
      .returning();
    if (!app) throw new Error('app');
    const link = { applicationId: app.id, phoneHash: 'b'.repeat(64) };
    await db.insert(s.ustaadApplicationLinks).values(link);
    await rejects(db.insert(s.ustaadApplicationLinks).values(link), '23505');
    await rejects(
      db.insert(s.ustaadApplicationLinks).values({ ...link, applicationId: randomUUID(), status: 'joined' }),
    );
  });
});

describe('CHECKs', () => {
  const key = (prefix: string) => `${prefix}/${memberA}/${randomUUID()}.webp`;
  const media = () => ({
    ownerMemberId: memberA,
    host: 'supabase',
    kind: 'image',
    declaredBytes: 100_000,
    declaredMime: 'image/webp',
    sha256: 'c'.repeat(64),
    objectKey: key('q'),
    uploadExpiresAt: new Date(Date.now() + 600_000),
  });

  it('media: MIME per kind, byte caps, random object key format', async () => {
    await db.insert(s.ustaadMedia).values(media());
    await rejects(db.insert(s.ustaadMedia).values({ ...media(), declaredMime: 'image/svg+xml' }), '23514');
    await rejects(db.insert(s.ustaadMedia).values({ ...media(), declaredMime: 'video/mp4' }), '23514');
    await rejects(
      db.insert(s.ustaadMedia).values({ ...media(), declaredBytes: 3 * 1024 * 1024 + 1 }),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadMedia).values({
        ...media(),
        kind: 'video',
        declaredMime: 'video/mp4',
        declaredBytes: 150 * 1024 * 1024 + 1,
        objectKey: `q/${memberA}/${randomUUID()}.mp4`,
      }),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadMedia).values({ ...media(), objectKey: 'q/../../etc/passwd.webp' }),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadMedia).values({ ...media(), objectKey: `x/${memberA}/${randomUUID()}.webp` }),
      '23514',
    );
    await rejects(db.insert(s.ustaadMedia).values({ ...media(), status: 'rejected' }), '23514');
  });

  it('jobs: pay min ≤ max and both > 0; the adult attestation is required; exactly one employer', async () => {
    const ws = await addWorkshop(db, f);
    const job = {
      code: 'UJ-RPR-2026-ABCDEF',
      employerMemberId: memberA,
      tradeAccountId: null,
      workshopId: ws.id as string | null,
      cityId: f.raipur,
      areaLabel: 'Pandri',
      roleCode: 'mechanic_2w',
      title: 'Two-wheeler mechanic',
      description: 'Splendor and Activa work, full day.',
      payMinPaiseMonth: 1_200_000,
      payMaxPaiseMonth: 1_800_000,
      timing: '9 to 7',
      adultAttestedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    };
    await db.insert(s.ustaadJobs).values(job);
    await rejects(
      db.insert(s.ustaadJobs).values({ ...job, code: 'UJ-RPR-2026-ABCDEG', payMinPaiseMonth: 2_000_000 }),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadJobs).values({ ...job, code: 'UJ-RPR-2026-ABCDEH', payMinPaiseMonth: 0 }),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadJobs).values({ ...job, code: 'UJ-RPR-2026-ABCDEJ', workshopId: null }),
      '23514',
    );
    await rejects(
      db.execute(sql`insert into ustaad_jobs (code, employer_member_id, city_id, area_label, role_code, title, description,
        pay_min_paise_month, pay_max_paise_month, timing, expires_at)
        values ('UJ-RPR-2026-ZZZZZZ', ${memberA}, ${f.raipur}, 'Pandri', 'helper', 'Helper wanted', 'Helper for the garage',
        100000, 200000, '9 to 7', now())`),
      '23502',
    );
  });

  it('Bada and Master always need a staff review in the level rules (SR-8)', async () => {
    await rejects(
      db.insert(s.ustaadLevelRules).values({
        level: 'bada',
        nameEn: 'Bada Ustaad',
        nameHi: 'बड़ा उस्ताद',
        position: 4,
        needsStaffReview: false,
      }),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadLevelRules).values({
        level: 'pakka',
        nameEn: 'Pakka Ustaad',
        nameHi: 'पक्का उस्ताद',
        position: 3,
        coinMultiplierBp: 9000,
      }),
      '23514',
    );
  });

  it('a post tag points at exactly one of post or question; a story has an expiry and nothing else does', async () => {
    const [tag] = await db
      .insert(s.ustaadTags)
      .values({ slug: 'battery', nameEn: 'Battery', nameHi: 'बैटरी', group: 'part', aliases: ['battri'] })
      .returning();
    if (!tag) throw new Error('tag');
    await rejects(db.insert(s.ustaadPostTags).values({ tagId: tag.id }), '23514');
    await rejects(
      db
        .insert(s.ustaadPosts)
        .values({ authorId: memberA, cityId: f.raipur, kind: 'story', body: 'Aaj ka kaam' }),
      '23514',
    );
    await rejects(
      db.insert(s.ustaadPosts).values({
        authorId: memberA,
        cityId: f.raipur,
        kind: 'text',
        body: 'x',
        expiresAt: new Date(),
      }),
      '23514',
    );
  });

  it('report: a member report names the reporter; codes are formatted', async () => {
    await rejects(
      db.insert(s.ustaadReports).values({
        code: 'UR-RPR-2026-ABCDEF',
        targetType: 'post',
        targetId: randomUUID(),
        reasonCode: 'spam',
        dueAt: new Date(),
      }),
      '23514',
    );
  });
});
