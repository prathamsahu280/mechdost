import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import {
  cleanContentText,
  CONTENT_KEYS,
  CONTENT_LOCALES,
  trustPlacementOf,
  type ContentKey,
  type ContentLocale,
} from '@mechdost/shared/content';
import {
  cleanPolicy,
  isPolicyKey,
  POLICY_KEYS,
  type PolicyDoc,
  type PolicyKey,
} from '@mechdost/shared/policy';
import { auditLog, contentBlocks, contentVersions, users } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Site content (hard rule 8; spec 08 "Content"; registry `@mechdost/shared/content`). Per key and locale, a
 * global value optionally overridden per city (the city wins), each with at most one `draft` and one
 * `published` row (unique index). Staff save drafts (`content:write`), publishing copies the draft live and
 * removes it (`content:publish`); unpublishing returns the text to the locale-file default. Every change is
 * compare-and-set on `version` and audited in the same transaction. Policy pages (`@mechdost/shared/policy`)
 * are structured documents on the same rows and follow the same rules.
 */
/** Everything editable: short texts and policy documents. */
export type EditableKey = ContentKey | PolicyKey;
export type EditableValue = string | PolicyDoc;

const scope = (
  key: EditableKey,
  locale: ContentLocale,
  cityId: string | null,
  status: 'draft' | 'published',
) =>
  and(
    eq(contentBlocks.key, key),
    eq(contentBlocks.locale, locale),
    cityId ? eq(contentBlocks.cityId, cityId) : isNull(contentBlocks.cityId),
    eq(contentBlocks.status, status),
  );

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
/** Stored values were cleaned on save; re-check on read so a hand-edited row can never reach a page. */
const policyOf = (value: unknown): PolicyDoc | null => {
  const r = cleanPolicy(value);
  return r.ok ? r.doc : null;
};
const valueOf = (key: EditableKey, value: unknown): EditableValue =>
  isPolicyKey(key) ? (policyOf(value) ?? '') : textOf(value);

/** What the storefront shows: published text per key (city override first); missing keys use the default. */
export async function getPublishedContent(
  db: Tx,
  input: { locale: ContentLocale; cityId: string | null },
): Promise<Partial<Record<ContentKey, string>>> {
  const rows = await db
    .select({ key: contentBlocks.key, cityId: contentBlocks.cityId, value: contentBlocks.value })
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.locale, input.locale),
        eq(contentBlocks.status, 'published'),
        input.cityId
          ? or(isNull(contentBlocks.cityId), eq(contentBlocks.cityId, input.cityId))
          : isNull(contentBlocks.cityId),
      ),
    );
  const out: Partial<Record<ContentKey, string>> = {};
  for (const key of CONTENT_KEYS) {
    const city = input.cityId ? rows.find((r) => r.key === key && r.cityId === input.cityId) : undefined;
    const global = rows.find((r) => r.key === key && r.cityId === null);
    const text = textOf((city ?? global)?.value);
    if (text) out[key] = text;
  }
  return out;
}

/** One published policy (city override first), or null: the page then shows its locale-file default. */
export async function getPublishedPolicy(
  db: Tx,
  input: { key: PolicyKey; locale: ContentLocale; cityId: string | null },
): Promise<PolicyDoc | null> {
  const rows = await db
    .select({ cityId: contentBlocks.cityId, value: contentBlocks.value })
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.key, input.key),
        eq(contentBlocks.locale, input.locale),
        eq(contentBlocks.status, 'published'),
        input.cityId
          ? or(isNull(contentBlocks.cityId), eq(contentBlocks.cityId, input.cityId))
          : isNull(contentBlocks.cityId),
      ),
    );
  const city = input.cityId ? rows.find((r) => r.cityId === input.cityId) : undefined;
  const global = rows.find((r) => r.cityId === null);
  return policyOf((city ?? global)?.value);
}

export interface ContentEntry {
  key: EditableKey;
  locale: ContentLocale;
  draft: { value: EditableValue; version: number } | null;
  published: { value: EditableValue; version: number; publishedAt: Date | null } | null;
}

/** Admin view for one scope (global when `cityId` is null): every key × locale with its draft and live text. */
export async function listContentForAdmin(db: Tx, cityId: string | null): Promise<ContentEntry[]> {
  const rows = await db
    .select()
    .from(contentBlocks)
    .where(cityId ? eq(contentBlocks.cityId, cityId) : isNull(contentBlocks.cityId));
  return [...CONTENT_KEYS, ...POLICY_KEYS].flatMap((key) =>
    CONTENT_LOCALES.map((locale) => {
      const of = (status: string) =>
        rows.find((r) => r.key === key && r.locale === locale && r.status === status);
      const d = of('draft');
      const p = of('published');
      return {
        key,
        locale,
        draft: d ? { value: valueOf(key, d.value), version: d.version } : null,
        published: p
          ? { value: valueOf(key, p.value), version: p.version, publishedAt: p.publishedAt }
          : null,
      };
    }),
  );
}

const STALE = () =>
  new ConflictError('Someone else changed this text; reload and try again', 'STALE_CONTENT');

/** A short text cleaned to its limit, or a policy document cleaned and checked (`@mechdost/shared/policy`). */
function cleanEditable(key: EditableKey, raw: unknown): EditableValue {
  if (isPolicyKey(key)) {
    const r = cleanPolicy(raw);
    if (!r.ok)
      throw new ValidationError('This policy cannot be saved as written', 'POLICY_INVALID', {
        problem: r.problem,
      });
    return r.doc;
  }
  const text = typeof raw === 'string' ? cleanContentText(key, raw) : '';
  if (!text) throw new ValidationError('Write the text, or unpublish to use the default', 'CONTENT_EMPTY');
  return text;
}

/** A trust line ('genuine parts' wording) changed: one extra server event with its placement (spec 12). */
async function recordTrustEdit(
  tx: Tx,
  input: { key: EditableKey; locale: ContentLocale; cityId: string | null; staffUserId: string },
  action: 'published' | 'unpublished',
): Promise<void> {
  const placement = trustPlacementOf(input.key);
  if (!placement) return;
  await recordServerEvent(tx, 'trust_line_edited', {
    userId: input.staffUserId,
    cityId: input.cityId,
    props: { placement, locale: input.locale, action },
  });
}

/** Audit entity id of one content entry (key, locale, optional city). */
function entityKey(key: string, locale: string, cityId: string | null): string {
  return `${key}:${locale}${cityId ? `@${cityId}` : ''}`;
}

/** Create (`expectedVersion` null) or change a draft, cleaned and validated for its key. */
export async function saveContentDraft(
  db: Tx,
  input: {
    key: EditableKey;
    locale: ContentLocale;
    cityId: string | null;
    value: unknown;
    expectedVersion: number | null;
    staffUserId: string;
  },
): Promise<{ version: number; value: EditableValue }> {
  const value = cleanEditable(input.key, input.value);
  return db.transaction(async (tx) => {
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      // A new draft continues this entry's version count (one audited save = one version), so a stale
      // "publish version N" from an earlier, already published draft can never match it (review low: ABA).
      const saves = await tx.$count(
        auditLog,
        and(
          eq(auditLog.entity, 'content'),
          eq(auditLog.entityId, entityKey(input.key, input.locale, input.cityId)),
          eq(auditLog.action, 'content.draft_saved'),
        ),
      );
      [saved] = await tx
        .insert(contentBlocks)
        .values({
          key: input.key,
          locale: input.locale,
          cityId: input.cityId,
          value,
          status: 'draft',
          version: saves + 1,
          updatedBy: input.staffUserId,
        })
        .onConflictDoNothing()
        .returning({ version: contentBlocks.version });
    } else {
      [saved] = await tx
        .update(contentBlocks)
        .set({ value, updatedBy: input.staffUserId })
        .where(
          and(
            scope(input.key, input.locale, input.cityId, 'draft'),
            eq(contentBlocks.version, input.expectedVersion),
          ),
        )
        .returning({ version: contentBlocks.version });
    }
    if (!saved) throw STALE();
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'content.draft_saved',
      entity: 'content',
      entityId: entityKey(input.key, input.locale, input.cityId),
      after: { value, version: saved.version },
    });
    return { version: saved.version, value };
  });
}

interface EntryRef {
  key: EditableKey;
  locale: ContentLocale;
  cityId: string | null;
  staffUserId: string;
}

/** Put `value` live for the entry (update the published row or create it); returns what was live before. */
async function writeLive(
  tx: Tx,
  input: EntryRef,
  value: unknown,
): Promise<{ before: { value: unknown; version: number } | undefined; live: { version: number } }> {
  const [before] = await tx
    .select({ value: contentBlocks.value, version: contentBlocks.version })
    .from(contentBlocks)
    .where(scope(input.key, input.locale, input.cityId, 'published'))
    .for('update');
  let live: { version: number } | undefined;
  if (before) {
    [live] = await tx
      .update(contentBlocks)
      .set({ value, publishedAt: sql`now()`, updatedBy: input.staffUserId })
      .where(scope(input.key, input.locale, input.cityId, 'published'))
      .returning({ version: contentBlocks.version });
  } else {
    [live] = await tx
      .insert(contentBlocks)
      .values({
        key: input.key,
        locale: input.locale,
        cityId: input.cityId,
        value,
        status: 'published',
        publishedAt: sql`now()`,
        updatedBy: input.staffUserId,
      })
      .returning({ version: contentBlocks.version });
  }
  if (!live) throw new Error('publish wrote no row');
  return { before, live };
}

/**
 * Append one row to the entry's history (what went live; `content_versions` is append-only) and return its number.
 * An advisory lock per entry numbers concurrent publishes and restores one after the other; the unique index backs it.
 */
async function appendVersion(
  tx: Tx,
  input: EntryRef,
  value: unknown,
  how: { action: 'published' } | { action: 'restored'; restoredFrom: number },
): Promise<number> {
  const entry = entityKey(input.key, input.locale, input.cityId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`content_versions:${entry}`}, 0))`);
  const [top] = await tx
    .select({ n: sql<number>`coalesce(max(${contentVersions.versionNo}), 0)::int` })
    .from(contentVersions)
    .where(
      and(
        eq(contentVersions.key, input.key),
        eq(contentVersions.locale, input.locale),
        input.cityId ? eq(contentVersions.cityId, input.cityId) : isNull(contentVersions.cityId),
      ),
    );
  const versionNo = (top?.n ?? 0) + 1;
  await tx.insert(contentVersions).values({
    key: input.key,
    locale: input.locale,
    cityId: input.cityId,
    versionNo,
    value,
    action: how.action,
    restoredFrom: how.action === 'restored' ? how.restoredFrom : null,
    createdBy: input.staffUserId,
  });
  return versionNo;
}

export interface ContentVersion {
  versionNo: number;
  action: 'published' | 'restored';
  restoredFrom: number | null;
  value: EditableValue;
  createdAt: Date;
  /** The staff member's name when the account has one. */
  by: string | null;
}

/** What went live for one entry, newest first (the history of a policy page; at most `limit`, default 50). */
export async function listContentVersions(
  db: Tx,
  input: { key: EditableKey; locale: ContentLocale; cityId: string | null; limit?: number },
): Promise<ContentVersion[]> {
  const rows = await db
    .select({
      versionNo: contentVersions.versionNo,
      action: contentVersions.action,
      restoredFrom: contentVersions.restoredFrom,
      value: contentVersions.value,
      createdAt: contentVersions.createdAt,
      by: users.name,
    })
    .from(contentVersions)
    .leftJoin(users, eq(users.id, contentVersions.createdBy))
    .where(
      and(
        eq(contentVersions.key, input.key),
        eq(contentVersions.locale, input.locale),
        input.cityId ? eq(contentVersions.cityId, input.cityId) : isNull(contentVersions.cityId),
      ),
    )
    .orderBy(desc(contentVersions.versionNo))
    .limit(Math.min(input.limit ?? 50, 100));
  return rows.map((r) => ({
    versionNo: r.versionNo,
    action: r.action === 'restored' ? 'restored' : 'published',
    restoredFrom: r.restoredFrom,
    value: valueOf(input.key, r.value),
    createdAt: r.createdAt,
    by: r.by,
  }));
}

/**
 * Put an earlier version live again as a NEW version (the old row stays; design 2026-11-15 item 5). The text is
 * checked again with today's rules, so a version that no longer passes (a placeholder since removed) is refused.
 */
export async function restoreContentVersion(
  db: Tx,
  input: EntryRef & { versionNo: number },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select({ value: contentVersions.value })
      .from(contentVersions)
      .where(
        and(
          eq(contentVersions.key, input.key),
          eq(contentVersions.locale, input.locale),
          input.cityId ? eq(contentVersions.cityId, input.cityId) : isNull(contentVersions.cityId),
          eq(contentVersions.versionNo, input.versionNo),
        ),
      );
    if (!old) throw new NotFoundError('That version does not exist');
    const value = cleanEditable(input.key, old.value);
    const { before, live } = await writeLive(tx, input, value);
    const version = await appendVersion(tx, input, value, {
      action: 'restored',
      restoredFrom: input.versionNo,
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'content.restored',
      entity: 'content',
      entityId: entityKey(input.key, input.locale, input.cityId),
      before: before ? { value: before.value, version: before.version } : null,
      after: { value, version: live.version, historyVersion: version, restoredFrom: input.versionNo },
    });
    await recordServerEvent(tx, 'admin_policy_restored', {
      userId: input.staffUserId,
      cityId: input.cityId,
      props: { key: input.key, locale: input.locale, fromVersion: input.versionNo, version },
    });
    return { version };
  });
}

/** Publish the draft (compare-and-set on its version): it replaces the live text and the draft is removed. */
export async function publishContent(
  db: Tx,
  input: {
    key: EditableKey;
    locale: ContentLocale;
    cityId: string | null;
    expectedDraftVersion: number;
    staffUserId: string;
  },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .delete(contentBlocks)
      .where(
        and(
          scope(input.key, input.locale, input.cityId, 'draft'),
          eq(contentBlocks.version, input.expectedDraftVersion),
        ),
      )
      .returning({ value: contentBlocks.value });
    if (!draft) throw STALE();
    const { before, live } = await writeLive(tx, input, draft.value);
    const historyVersion = await appendVersion(tx, input, draft.value, { action: 'published' });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'content.published',
      entity: 'content',
      entityId: entityKey(input.key, input.locale, input.cityId),
      before: before ? { value: before.value, version: before.version } : null,
      after: { value: draft.value, version: live.version, historyVersion },
    });
    await recordServerEvent(tx, 'admin_content_published', {
      userId: input.staffUserId,
      cityId: input.cityId,
      props: { key: input.key, locale: input.locale, action: 'published' },
    });
    await recordTrustEdit(tx, input, 'published');
    return { version: live.version };
  });
}

/** Take the live text down (compare-and-set): the storefront shows the locale-file default again. */
export async function unpublishContent(
  db: Tx,
  input: {
    key: EditableKey;
    locale: ContentLocale;
    cityId: string | null;
    expectedVersion: number;
    staffUserId: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(contentBlocks)
      .where(
        and(
          scope(input.key, input.locale, input.cityId, 'published'),
          eq(contentBlocks.version, input.expectedVersion),
        ),
      )
      .returning({ value: contentBlocks.value, version: contentBlocks.version });
    if (!gone) {
      const [exists] = await tx
        .select({ id: contentBlocks.id })
        .from(contentBlocks)
        .where(scope(input.key, input.locale, input.cityId, 'published'));
      throw exists ? STALE() : new NotFoundError('Nothing published for this text');
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'content.unpublished',
      entity: 'content',
      entityId: entityKey(input.key, input.locale, input.cityId),
      before: { value: gone.value, version: gone.version },
      after: null,
    });
    await recordServerEvent(tx, 'admin_content_published', {
      userId: input.staffUserId,
      cityId: input.cityId,
      props: { key: input.key, locale: input.locale, action: 'unpublished' },
    });
    await recordTrustEdit(tx, input, 'unpublished');
  });
}
