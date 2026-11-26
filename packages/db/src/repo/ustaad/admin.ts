/**
 * Admin → Ustaad settings and tables (spec 23 § 6.8, § 15; SR-8, SR-40, SR-41; task G1).
 *
 * Settings: one save is a batch. Locked items and unknown keys are refused first; then, inside one transaction under
 * one advisory lock (two saves can never break a weight sum together), the invariants run once on the merged set
 * (`changedKeys` so an earlier video raise does not block later saves), then the ranges, then a compare-and-set per
 * key: any stale version rolls the whole batch back. One `setting.saved` audit row per key (the reason code on the
 * video row) and one `admin_ustaad_settings_saved` event.
 *
 * Tables (levels, badges, tags, words, reasons, reach cities, promotions, tutorial cards, coach-marks): create and
 * compare-and-set edits, each with an `audit_log` row (`ustaad.<entity>.<action>`, before and after) and an
 * `admin_ustaad_table_saved` event in the same transaction. What a CHECK or unique index would refuse is refused
 * here first with a typed error (422 SETTING_INVARIANT, 409 DUPLICATE / STALE), never a database error.
 */
import { and, asc, eq, inArray, isNull, like, ne, sql } from 'drizzle-orm';
import type { UstaadAccessMode } from '@mechdost/shared/ustaad/codes';
// Runtime helpers from the Zod-free module (L101); the DTO module is imported for types only.
import {
  isUstaadLockedItem,
  normaliseUstaadPhrase,
  promotionMoveAllowed,
} from '@mechdost/shared/ustaad/admin-rules';
import type {
  BadgeWrite,
  CoachmarkWrite,
  LevelRuleWrite,
  PromotionMove,
  PromotionWrite,
  ReachCityWrite,
  ReasonUpdate,
  ReasonWrite,
  TagMerge,
  TagWrite,
  TutorialCardWrite,
  WordUpdate,
  WordWrite,
} from '@mechdost/shared/ustaad/dto/admin';
import {
  USTAAD_SETTINGS,
  isUstaadSettingKey,
  ustaadSettingInvariant,
  ustaadSettingProblem,
  ustaadValuesFrom,
  type UstaadSettingKey,
  type UstaadSettingValue,
} from '@mechdost/shared/ustaad/settings';
import {
  auditLog,
  cities,
  settings,
  ustaadBadges,
  ustaadCoachmarks,
  ustaadLevelRules,
  ustaadPostTags,
  ustaadPromotions,
  ustaadReachCities,
  ustaadReportReasons,
  ustaadTagFollows,
  ustaadTags,
  ustaadTutorialCards,
  ustaadWordLists,
} from '../../schema';
import { ConflictError, NotFoundError, ValidationError, pgCode } from '../errors';
import { recordServerEvent } from '../events';
import type { Tx } from '../orders';

const SETTINGS_LOCK = sql`select pg_advisory_xact_lock(hashtextextended('ustaad:settings', 0))`;

const invariant = (key: string) =>
  new ValidationError(`${key} breaks a network rule`, 'SETTING_INVARIANT', { key });
const stale = () => new ConflictError('Someone else changed this; reload and try again', 'STALE');
const duplicate = () => new ConflictError('That already exists', 'DUPLICATE');

async function unique<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (pgCode(err) === '23505') throw duplicate();
    throw err;
  }
}

async function activeProtectedWords(tx: Tx, exceptId?: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(ustaadWordLists)
    .where(
      and(
        eq(ustaadWordLists.list, 'protected'),
        eq(ustaadWordLists.active, true),
        exceptId ? ne(ustaadWordLists.id, exceptId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface SaveUstaadSettingsInput {
  changes: readonly { key: string; value: unknown; version: number | null }[];
  staffUserId: string;
  /** `super_admin` may raise the video length above 180 s (with `reasonCode`). */
  actorRole: string;
  reasonCode?: string;
}

/** Thrown inside the transaction so it rolls back; the refusal event is written afterwards. */
class Refused extends Error {
  constructor(
    readonly key: UstaadSettingKey,
    readonly code: 'SETTING_INVARIANT' | 'SETTING_RELATION',
  ) {
    super(code);
  }
}

export async function saveUstaadSettings(
  db: Tx,
  input: SaveUstaadSettingsInput,
): Promise<{ versions: Record<string, number> }> {
  const changes: { key: UstaadSettingKey; value: UstaadSettingValue; version: number | null }[] = [];
  for (const c of input.changes) {
    if (isUstaadLockedItem(c.key)) throw invariant(c.key);
    if (!isUstaadSettingKey(c.key)) throw new ValidationError(`Unknown setting ${c.key}`, 'SETTING_UNKNOWN');
    if (ustaadSettingProblem(c.key, c.value) === 'type')
      throw new ValidationError(`Invalid value for ${c.key}`, 'SETTING_TYPE', { key: c.key });
    changes.push({ key: c.key, value: c.value as UstaadSettingValue, version: c.version });
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(SETTINGS_LOCK);
      const rows = await tx
        .select({ key: settings.key, value: settings.value, version: settings.version })
        .from(settings)
        .where(and(isNull(settings.cityId), like(settings.key, 'ustaad.%')));
      const stored: Record<string, unknown> = {};
      const before = new Map<string, { value: unknown; version: number }>();
      for (const r of rows) {
        stored[r.key] = r.value;
        before.set(r.key, { value: r.value, version: r.version });
      }
      const next = { ...ustaadValuesFrom(stored) };
      for (const c of changes) next[c.key] = c.value;
      const problem = ustaadSettingInvariant(next, input.actorRole, {
        ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
        protectedWords: await activeProtectedWords(tx),
        changedKeys: changes.map((c) => c.key),
      });
      if (problem) throw new Refused(problem.key, problem.code);
      const outOfRange = changes.find((c) => ustaadSettingProblem(c.key, c.value) === 'range');
      if (outOfRange)
        throw new ValidationError(`Invalid value for ${outOfRange.key}`, 'SETTING_RANGE', {
          key: outOfRange.key,
        });

      const versions: Record<string, number> = {};
      for (const c of changes) {
        const where = and(eq(settings.key, c.key), isNull(settings.cityId));
        const [saved] =
          c.version === null
            ? await tx
                .insert(settings)
                .values({ key: c.key, cityId: null, value: c.value, updatedBy: input.staffUserId })
                .onConflictDoNothing()
                .returning({ version: settings.version })
            : await tx
                .update(settings)
                .set({ value: c.value, updatedBy: input.staffUserId })
                .where(and(where, eq(settings.version, c.version)))
                .returning({ version: settings.version });
        if (!saved)
          throw new ConflictError('Someone else changed this setting; reload and try again', 'STALE_SETTING');
        versions[c.key] = saved.version;
        const old = before.get(c.key);
        await tx.insert(auditLog).values({
          actorUserId: input.staffUserId,
          actorRole: 'staff',
          action: 'setting.saved',
          entity: 'setting',
          entityId: c.key,
          before: old ? { value: old.value, version: old.version } : null,
          after: { value: c.value, version: saved.version },
          reason: c.key === 'ustaad.posts.video_max_s' ? (input.reasonCode ?? null) : null,
        });
        if (c.key === 'ustaad.access')
          await recordServerEvent(tx, 'admin_ustaad_access_changed', {
            userId: input.staffUserId,
            props: {
              from: (old?.value ?? USTAAD_SETTINGS['ustaad.access'].default) as UstaadAccessMode,
              to: c.value as UstaadAccessMode,
            },
          });
      }
      await recordServerEvent(tx, 'admin_ustaad_settings_saved', {
        userId: input.staffUserId,
        props: { keys: changes.map((c) => c.key) },
      });
      return { versions };
    });
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    await recordServerEvent(db, 'admin_ustaad_invariant_refused', {
      userId: input.staffUserId,
      props: { key: err.key },
    });
    throw new ValidationError(`${err.key} breaks a network rule`, err.code, { key: err.key });
  }
}

// ── Table helpers ────────────────────────────────────────────────────────────────────────────────────────────

type Table =
  | 'levels'
  | 'badges'
  | 'tags'
  | 'words'
  | 'reasons'
  | 'reach_cities'
  | 'promotions'
  | 'tutorial_cards'
  | 'coachmarks';
type Action = 'create' | 'update' | 'merge' | 'move';
const ENTITY: Record<Table, string> = {
  levels: 'level_rule',
  badges: 'badge',
  tags: 'tag',
  words: 'word',
  reasons: 'report_reason',
  reach_cities: 'reach_city',
  promotions: 'promotion',
  tutorial_cards: 'tutorial_card',
  coachmarks: 'coachmark',
};
const PAST: Record<Action, string> = { create: 'created', update: 'updated', merge: 'merged', move: 'moved' };

async function record(
  tx: Tx,
  staffUserId: string,
  table: Table,
  action: Action,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: staffUserId,
    actorRole: 'staff',
    action: `ustaad.${ENTITY[table]}.${PAST[action]}`,
    entity: `ustaad_${ENTITY[table]}`,
    entityId,
    before: before ?? null,
    after: after ?? null,
  });
  await recordServerEvent(tx, 'admin_ustaad_table_saved', {
    userId: staffUserId,
    props: { table, action },
  });
}

/** Fetch for a CAS edit: 404 when missing, STALE when the version moved. */
function checkVersion<R extends { version: number }>(row: R | undefined, version: number): R {
  if (!row) throw new NotFoundError();
  if (row.version !== version) throw stale();
  return row;
}

// ── Levels ───────────────────────────────────────────────────────────────────────────────────────────────────

const staffReviewLocked = (r: LevelRuleWrite) => {
  if ((r.level === 'bada' || r.level === 'master') && !r.needsStaffReview)
    throw invariant('needsStaffReview');
};

export async function listUstaadLevelRules(db: Tx) {
  return db
    .select()
    .from(ustaadLevelRules)
    .orderBy(asc(ustaadLevelRules.position), asc(ustaadLevelRules.ruleGroup));
}

export async function createUstaadLevelRule(db: Tx, staffUserId: string, input: LevelRuleWrite) {
  staffReviewLocked(input);
  return db.transaction(async (tx) => {
    const [row] = await unique(() =>
      tx
        .insert(ustaadLevelRules)
        .values({ ...input, updatedBy: staffUserId })
        .returning(),
    );
    if (!row) throw new Error('level rule not created');
    await record(tx, staffUserId, 'levels', 'create', row.id, null, input);
    return row;
  });
}

export async function updateUstaadLevelRule(
  db: Tx,
  staffUserId: string,
  id: string,
  input: LevelRuleWrite & { version: number },
) {
  staffReviewLocked(input);
  const { version, ...fields } = input;
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(ustaadLevelRules).where(eq(ustaadLevelRules.id, id));
    const before = checkVersion(cur, version);
    const [row] = await unique(() =>
      tx
        .update(ustaadLevelRules)
        .set({ ...fields, updatedBy: staffUserId })
        .where(and(eq(ustaadLevelRules.id, id), eq(ustaadLevelRules.version, version)))
        .returning(),
    );
    if (!row) throw stale();
    await record(tx, staffUserId, 'levels', 'update', id, before, fields);
    return row;
  });
}

// ── Badges ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function listUstaadBadges(db: Tx) {
  return db.select().from(ustaadBadges).orderBy(asc(ustaadBadges.code));
}

export async function createUstaadBadge(db: Tx, staffUserId: string, input: BadgeWrite) {
  return db.transaction(async (tx) => {
    const [row] = await unique(() =>
      tx
        .insert(ustaadBadges)
        .values({ ...input, updatedBy: staffUserId })
        .returning(),
    );
    if (!row) throw new Error('badge not created');
    await record(tx, staffUserId, 'badges', 'create', row.id, null, input);
    return row;
  });
}

export async function updateUstaadBadge(
  db: Tx,
  staffUserId: string,
  id: string,
  input: BadgeWrite & { version: number },
) {
  const { version, ...fields } = input;
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(ustaadBadges).where(eq(ustaadBadges.id, id));
    const before = checkVersion(cur, version);
    const [row] = await unique(() =>
      tx
        .update(ustaadBadges)
        .set({ ...fields, updatedBy: staffUserId })
        .where(and(eq(ustaadBadges.id, id), eq(ustaadBadges.version, version)))
        .returning(),
    );
    if (!row) throw stale();
    await record(tx, staffUserId, 'badges', 'update', id, before, fields);
    return row;
  });
}

// ── Tags ─────────────────────────────────────────────────────────────────────────────────────────────────────

const uniqueAliases = (aliases: readonly string[], slug: string) =>
  [...new Set(aliases)].filter((a) => a !== slug).slice(0, 20);

export async function listUstaadTags(db: Tx) {
  const uses = db
    .select({ tagId: ustaadPostTags.tagId, n: sql<number>`count(*)::int`.as('n') })
    .from(ustaadPostTags)
    .groupBy(ustaadPostTags.tagId)
    .as('uses');
  const rows = await db
    .select({
      id: ustaadTags.id,
      slug: ustaadTags.slug,
      nameEn: ustaadTags.nameEn,
      nameHi: ustaadTags.nameHi,
      group: ustaadTags.group,
      aliases: ustaadTags.aliases,
      active: ustaadTags.active,
      mergedIntoId: ustaadTags.mergedIntoId,
      posts: sql<number>`coalesce(${uses.n}, 0)::int`,
      version: ustaadTags.version,
    })
    .from(ustaadTags)
    .leftJoin(uses, eq(uses.tagId, ustaadTags.id))
    .orderBy(asc(ustaadTags.slug));
  return rows;
}

export async function createUstaadTag(db: Tx, staffUserId: string, input: TagWrite) {
  const values = { ...input, aliases: uniqueAliases(input.aliases, input.slug) };
  return db.transaction(async (tx) => {
    const [row] = await unique(() =>
      tx
        .insert(ustaadTags)
        .values({ ...values, updatedBy: staffUserId })
        .returning(),
    );
    if (!row) throw new Error('tag not created');
    await record(tx, staffUserId, 'tags', 'create', row.id, null, values);
    return row;
  });
}

export async function updateUstaadTag(
  db: Tx,
  staffUserId: string,
  id: string,
  input: TagWrite & { version: number },
) {
  const { version, ...rest } = input;
  const fields = { ...rest, aliases: uniqueAliases(rest.aliases, rest.slug) };
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(ustaadTags).where(eq(ustaadTags.id, id));
    const before = checkVersion(cur, version);
    // A merged tag stays retired: it is reached through its target.
    if (before.mergedIntoId !== null && fields.active) throw new ValidationError('Merged tag', 'TAG_MERGE');
    const [row] = await unique(() =>
      tx
        .update(ustaadTags)
        .set({ ...fields, updatedBy: staffUserId })
        .where(and(eq(ustaadTags.id, id), eq(ustaadTags.version, version)))
        .returning(),
    );
    if (!row) throw stale();
    await record(tx, staffUserId, 'tags', 'update', id, before, fields);
    return row;
  });
}

/**
 * Merge `id` into `intoId`: the source's posts, questions and followers move to the target (rows the target already
 * has are dropped, never doubled), its slug and aliases become the target's aliases, and it is retired with
 * `merged_into_id` set. Refused (TAG_MERGE) for itself, a merged or inactive target, or an already merged source.
 */
export async function mergeUstaadTag(db: Tx, staffUserId: string, id: string, input: TagMerge) {
  if (id === input.intoId) throw new ValidationError('A tag cannot merge into itself', 'TAG_MERGE');
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(ustaadTags)
      .where(inArray(ustaadTags.id, [id, input.intoId]))
      .for('update');
    const from = checkVersion(
      found.find((x) => x.id === id),
      input.version,
    );
    const into = found.find((x) => x.id === input.intoId);
    if (!into) throw new NotFoundError();
    if (from.mergedIntoId !== null || into.mergedIntoId !== null || !into.active)
      throw new ValidationError('Choose an active tag to merge into', 'TAG_MERGE');

    await tx.execute(sql`
      delete from ${ustaadPostTags} a using ${ustaadPostTags} b
      where a.tag_id = ${id} and b.tag_id = ${into.id}
        and ((a.post_id is not null and a.post_id = b.post_id) or (a.question_id is not null and a.question_id = b.question_id))`);
    await tx.update(ustaadPostTags).set({ tagId: into.id }).where(eq(ustaadPostTags.tagId, id));
    await tx.execute(sql`
      delete from ${ustaadTagFollows} a using ${ustaadTagFollows} b
      where a.tag_id = ${id} and b.tag_id = ${into.id} and a.member_id = b.member_id`);
    await tx.update(ustaadTagFollows).set({ tagId: into.id }).where(eq(ustaadTagFollows.tagId, id));

    const aliases = uniqueAliases([...into.aliases, from.slug, ...from.aliases], into.slug);
    await tx.update(ustaadTags).set({ aliases, updatedBy: staffUserId }).where(eq(ustaadTags.id, into.id));
    const [row] = await tx
      .update(ustaadTags)
      .set({ active: false, mergedIntoId: into.id, aliases: [], updatedBy: staffUserId })
      .where(and(eq(ustaadTags.id, id), eq(ustaadTags.version, input.version)))
      .returning();
    if (!row) throw stale();
    await record(tx, staffUserId, 'tags', 'merge', id, { slug: from.slug }, { intoId: into.id, aliases });
    return row;
  });
}

// ── Word lists ───────────────────────────────────────────────────────────────────────────────────────────────

export async function listUstaadWords(db: Tx) {
  return db
    .select()
    .from(ustaadWordLists)
    .orderBy(asc(ustaadWordLists.list), asc(ustaadWordLists.phraseNorm));
}

export async function createUstaadWord(db: Tx, staffUserId: string, input: WordWrite) {
  const values = {
    list: input.list,
    phrase: input.phrase,
    phraseNorm: normaliseUstaadPhrase(input.phrase),
    replacement: input.replacement ?? null,
    lang: input.lang,
    active: input.active,
  };
  return db.transaction(async (tx) => {
    const [row] = await unique(() =>
      tx
        .insert(ustaadWordLists)
        .values({ ...values, updatedBy: staffUserId })
        .returning(),
    );
    if (!row) throw new Error('word not created');
    await record(tx, staffUserId, 'words', 'create', row.id, null, { list: values.list });
    return row;
  });
}

export async function updateUstaadWord(db: Tx, staffUserId: string, id: string, input: WordUpdate) {
  return db.transaction(async (tx) => {
    await tx.execute(SETTINGS_LOCK);
    const [cur] = await tx.select().from(ustaadWordLists).where(eq(ustaadWordLists.id, id));
    const before = checkVersion(cur, input.version);
    if ((before.list === 'correction') !== (input.replacement !== undefined))
      throw new ValidationError('A replacement belongs to the correction list only', 'VALIDATION');
    // SR-40: auto correction needs at least one active protected word.
    if (before.list === 'protected' && before.active && !input.active) {
      const [mode] = await tx
        .select({ value: settings.value })
        .from(settings)
        .where(and(eq(settings.key, 'ustaad.correction.default_mode'), isNull(settings.cityId)));
      if (mode?.value === 'auto' && (await activeProtectedWords(tx, id)) === 0)
        throw invariant('ustaad.correction.default_mode');
    }
    const fields = {
      phrase: input.phrase,
      phraseNorm: normaliseUstaadPhrase(input.phrase),
      replacement: input.replacement ?? null,
      lang: input.lang,
      active: input.active,
    };
    const [row] = await unique(() =>
      tx
        .update(ustaadWordLists)
        .set({ ...fields, updatedBy: staffUserId })
        .where(and(eq(ustaadWordLists.id, id), eq(ustaadWordLists.version, input.version)))
        .returning(),
    );
    if (!row) throw stale();
    await record(
      tx,
      staffUserId,
      'words',
      'update',
      id,
      { active: before.active },
      { active: fields.active },
    );
    return row;
  });
}

// ── Report reasons ───────────────────────────────────────────────────────────────────────────────────────────

export async function listUstaadReasons(db: Tx) {
  return db.select().from(ustaadReportReasons).orderBy(asc(ustaadReportReasons.code));
}

export async function createUstaadReason(db: Tx, staffUserId: string, input: ReasonWrite) {
  if (input.code === 'other' && !input.active) throw invariant('other');
  return db.transaction(async (tx) => {
    const [row] = await unique(() =>
      tx
        .insert(ustaadReportReasons)
        .values({ ...input, updatedBy: staffUserId })
        .returning(),
    );
    if (!row) throw new Error('reason not created');
    await record(tx, staffUserId, 'reasons', 'create', row.code, null, input);
    return row;
  });
}

export async function updateUstaadReason(db: Tx, staffUserId: string, code: string, input: ReasonUpdate) {
  // `other` always stays on (spec 23 § 6.7; CHECK ustaad_report_reasons_other_on).
  if (code === 'other' && !input.active) throw invariant('other');
  const { version, ...fields } = input;
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(ustaadReportReasons).where(eq(ustaadReportReasons.code, code));
    const before = checkVersion(cur, version);
    const [row] = await tx
      .update(ustaadReportReasons)
      .set({ ...fields, updatedBy: staffUserId })
      .where(and(eq(ustaadReportReasons.code, code), eq(ustaadReportReasons.version, version)))
      .returning();
    if (!row) throw stale();
    await record(tx, staffUserId, 'reasons', 'update', code, before, fields);
    return row;
  });
}

// ── Reach cities ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every city of the platform with whether the network is open there (no row = off). */
export async function listUstaadReachCities(db: Tx) {
  return db
    .select({
      cityId: cities.id,
      code: cities.code,
      name: cities.name,
      nameHi: cities.nameHi,
      enabled: sql<boolean>`coalesce(${ustaadReachCities.enabled}, false)`,
      version: ustaadReachCities.version,
    })
    .from(cities)
    .leftJoin(ustaadReachCities, eq(ustaadReachCities.cityId, cities.id))
    .orderBy(asc(cities.name));
}

export async function setUstaadReachCity(db: Tx, staffUserId: string, cityId: string, input: ReachCityWrite) {
  return db.transaction(async (tx) => {
    const [city] = await tx.select({ id: cities.id }).from(cities).where(eq(cities.id, cityId));
    if (!city) throw new NotFoundError();
    const [cur] = await tx.select().from(ustaadReachCities).where(eq(ustaadReachCities.cityId, cityId));
    let row;
    if (input.version === null) {
      if (cur) throw stale();
      [row] = await tx
        .insert(ustaadReachCities)
        .values({ cityId, enabled: input.enabled, updatedBy: staffUserId })
        .onConflictDoNothing()
        .returning();
    } else {
      checkVersion(cur, input.version);
      [row] = await tx
        .update(ustaadReachCities)
        .set({ enabled: input.enabled, updatedBy: staffUserId })
        .where(and(eq(ustaadReachCities.cityId, cityId), eq(ustaadReachCities.version, input.version)))
        .returning();
    }
    if (!row) throw stale();
    await record(tx, staffUserId, 'reach_cities', 'update', cityId, cur ? { enabled: cur.enabled } : null, {
      enabled: row.enabled,
    });
    return row;
  });
}

// ── Promotions ───────────────────────────────────────────────────────────────────────────────────────────────

const promoValues = (p: PromotionWrite) => ({
  slot: p.slot,
  titleEn: p.titleEn,
  titleHi: p.titleHi,
  bodyEn: p.bodyEn,
  bodyHi: p.bodyHi,
  target: p.target,
  targetId: p.targetId,
  cityIds: p.cityIds,
  segmentCodes: p.segmentCodes,
  startsAt: new Date(p.startsAt),
  endsAt: new Date(p.endsAt),
});

export async function listUstaadPromotions(db: Tx) {
  return db.select().from(ustaadPromotions).orderBy(asc(ustaadPromotions.startsAt));
}

export async function createUstaadPromotion(db: Tx, staffUserId: string, input: PromotionWrite) {
  const values = promoValues(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(ustaadPromotions)
      .values({ ...values, status: 'draft', createdBy: staffUserId })
      .returning();
    if (!row) throw new Error('promotion not created');
    await record(tx, staffUserId, 'promotions', 'create', row.id, null, { slot: values.slot });
    return row;
  });
}

/** Content edits only while the promotion is a draft or scheduled (a live one is ended, not rewritten). */
export async function updateUstaadPromotion(
  db: Tx,
  staffUserId: string,
  id: string,
  input: PromotionWrite & { version: number },
) {
  const values = promoValues(input);
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(ustaadPromotions).where(eq(ustaadPromotions.id, id));
    const before = checkVersion(cur, input.version);
    if (before.status !== 'draft' && before.status !== 'scheduled')
      throw new ConflictError('Only a draft or scheduled promotion can be edited', 'BAD_MOVE');
    const [row] = await tx
      .update(ustaadPromotions)
      .set(values)
      .where(and(eq(ustaadPromotions.id, id), eq(ustaadPromotions.version, input.version)))
      .returning();
    if (!row) throw stale();
    await record(
      tx,
      staffUserId,
      'promotions',
      'update',
      id,
      { status: before.status },
      { slot: values.slot },
    );
    return row;
  });
}

export async function moveUstaadPromotion(db: Tx, staffUserId: string, id: string, input: PromotionMove) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(ustaadPromotions).where(eq(ustaadPromotions.id, id));
    const before = checkVersion(cur, input.version);
    const from = before.status as Parameters<typeof promotionMoveAllowed>[0];
    if (!promotionMoveAllowed(from, input.to))
      throw new ConflictError(`A ${from} promotion cannot become ${input.to}`, 'BAD_MOVE');
    const [row] = await tx
      .update(ustaadPromotions)
      .set({ status: input.to })
      .where(
        and(
          eq(ustaadPromotions.id, id),
          eq(ustaadPromotions.version, input.version),
          eq(ustaadPromotions.status, from),
        ),
      )
      .returning();
    if (!row) throw stale();
    await record(tx, staffUserId, 'promotions', 'move', id, { status: from }, { status: input.to });
    return row;
  });
}

// ── Tutorial cards and coach-marks ───────────────────────────────────────────────────────────────────────────

export async function listUstaadTutorialCards(db: Tx) {
  return db.select().from(ustaadTutorialCards).orderBy(asc(ustaadTutorialCards.position));
}

export async function createUstaadTutorialCard(db: Tx, staffUserId: string, input: TutorialCardWrite) {
  return db.transaction(async (tx) => {
    const [row] = await unique(() =>
      tx
        .insert(ustaadTutorialCards)
        .values({ ...input, updatedBy: staffUserId })
        .returning(),
    );
    if (!row) throw new Error('card not created');
    await record(tx, staffUserId, 'tutorial_cards', 'create', row.id, null, { code: input.code });
    return row;
  });
}

export async function updateUstaadTutorialCard(
  db: Tx,
  staffUserId: string,
  id: string,
  input: TutorialCardWrite & { version: number },
) {
  const { version, ...fields } = input;
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(ustaadTutorialCards).where(eq(ustaadTutorialCards.id, id));
    const before = checkVersion(cur, version);
    const [row] = await unique(() =>
      tx
        .update(ustaadTutorialCards)
        .set({ ...fields, updatedBy: staffUserId })
        .where(and(eq(ustaadTutorialCards.id, id), eq(ustaadTutorialCards.version, version)))
        .returning(),
    );
    if (!row) throw stale();
    await record(
      tx,
      staffUserId,
      'tutorial_cards',
      'update',
      id,
      { code: before.code },
      { code: fields.code },
    );
    return row;
  });
}

export async function listUstaadCoachmarks(db: Tx) {
  return db.select().from(ustaadCoachmarks).orderBy(asc(ustaadCoachmarks.position));
}

export async function createUstaadCoachmark(db: Tx, staffUserId: string, input: CoachmarkWrite) {
  return db.transaction(async (tx) => {
    const [row] = await unique(() =>
      tx
        .insert(ustaadCoachmarks)
        .values({ ...input, updatedBy: staffUserId })
        .returning(),
    );
    if (!row) throw new Error('coach-mark not created');
    await record(tx, staffUserId, 'coachmarks', 'create', row.id, null, { target: input.target });
    return row;
  });
}

export async function updateUstaadCoachmark(
  db: Tx,
  staffUserId: string,
  id: string,
  input: CoachmarkWrite & { version: number },
) {
  const { version, ...fields } = input;
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(ustaadCoachmarks).where(eq(ustaadCoachmarks.id, id));
    checkVersion(cur, version);
    const [row] = await unique(() =>
      tx
        .update(ustaadCoachmarks)
        .set({ ...fields, updatedBy: staffUserId })
        .where(and(eq(ustaadCoachmarks.id, id), eq(ustaadCoachmarks.version, version)))
        .returning(),
    );
    if (!row) throw stale();
    await record(tx, staffUserId, 'coachmarks', 'update', id, null, { target: fields.target });
    return row;
  });
}
