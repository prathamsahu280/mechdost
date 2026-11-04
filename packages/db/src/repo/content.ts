import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  cleanContentText,
  CONTENT_KEYS,
  CONTENT_LOCALES,
  type ContentKey,
  type ContentLocale,
} from '@mechdost/shared/content';
import { auditLog, contentBlocks } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Site content (hard rule 8; spec 08 "Content"; registry `@mechdost/shared/content`). Per key and locale, a
 * global value optionally overridden per city (the city wins), each with at most one `draft` and one
 * `published` row (unique index). Staff save drafts (`content:write`), publishing copies the draft live and
 * removes it (`content:publish`); unpublishing returns the text to the locale-file default. Every change is
 * compare-and-set on `version` and audited in the same transaction.
 */
const scope = (
  key: ContentKey,
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

export interface ContentEntry {
  key: ContentKey;
  locale: ContentLocale;
  draft: { value: string; version: number } | null;
  published: { value: string; version: number; publishedAt: Date | null } | null;
}

/** Admin view for one scope (global when `cityId` is null): every key × locale with its draft and live text. */
export async function listContentForAdmin(db: Tx, cityId: string | null): Promise<ContentEntry[]> {
  const rows = await db
    .select()
    .from(contentBlocks)
    .where(cityId ? eq(contentBlocks.cityId, cityId) : isNull(contentBlocks.cityId));
  return CONTENT_KEYS.flatMap((key) =>
    CONTENT_LOCALES.map((locale) => {
      const of = (status: string) =>
        rows.find((r) => r.key === key && r.locale === locale && r.status === status);
      const d = of('draft');
      const p = of('published');
      return {
        key,
        locale,
        draft: d ? { value: textOf(d.value), version: d.version } : null,
        published: p ? { value: textOf(p.value), version: p.version, publishedAt: p.publishedAt } : null,
      };
    }),
  );
}

const STALE = () =>
  new ConflictError('Someone else changed this text; reload and try again', 'STALE_CONTENT');

/** Create (`expectedVersion` null) or change a draft. The text is cleaned to plain text within the key's limit. */
export async function saveContentDraft(
  db: Tx,
  input: {
    key: ContentKey;
    locale: ContentLocale;
    cityId: string | null;
    value: string;
    expectedVersion: number | null;
    staffUserId: string;
  },
): Promise<{ version: number; value: string }> {
  const value = cleanContentText(input.key, input.value);
  if (!value) throw new ValidationError('Write the text, or unpublish to use the default', 'CONTENT_EMPTY');
  return db.transaction(async (tx) => {
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(contentBlocks)
        .values({
          key: input.key,
          locale: input.locale,
          cityId: input.cityId,
          value,
          status: 'draft',
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
      entityId: `${input.key}:${input.locale}${input.cityId ? `@${input.cityId}` : ''}`,
      after: { value, version: saved.version },
    });
    return { version: saved.version, value };
  });
}

/** Publish the draft (compare-and-set on its version): it replaces the live text and the draft is removed. */
export async function publishContent(
  db: Tx,
  input: {
    key: ContentKey;
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
    const [before] = await tx
      .select({ value: contentBlocks.value, version: contentBlocks.version })
      .from(contentBlocks)
      .where(scope(input.key, input.locale, input.cityId, 'published'))
      .for('update');
    let live: { version: number } | undefined;
    if (before) {
      [live] = await tx
        .update(contentBlocks)
        .set({ value: draft.value, publishedAt: sql`now()`, updatedBy: input.staffUserId })
        .where(scope(input.key, input.locale, input.cityId, 'published'))
        .returning({ version: contentBlocks.version });
    } else {
      [live] = await tx
        .insert(contentBlocks)
        .values({
          key: input.key,
          locale: input.locale,
          cityId: input.cityId,
          value: draft.value,
          status: 'published',
          publishedAt: sql`now()`,
          updatedBy: input.staffUserId,
        })
        .returning({ version: contentBlocks.version });
    }
    if (!live) throw new Error('publish wrote no row');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'content.published',
      entity: 'content',
      entityId: `${input.key}:${input.locale}${input.cityId ? `@${input.cityId}` : ''}`,
      before: before ? { value: before.value, version: before.version } : null,
      after: { value: draft.value, version: live.version },
    });
    await recordServerEvent(tx, 'admin_content_published', {
      userId: input.staffUserId,
      cityId: input.cityId,
      props: { key: input.key, locale: input.locale, action: 'published' },
    });
    return { version: live.version };
  });
}

/** Take the live text down (compare-and-set): the storefront shows the locale-file default again. */
export async function unpublishContent(
  db: Tx,
  input: {
    key: ContentKey;
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
      entityId: `${input.key}:${input.locale}${input.cityId ? `@${input.cityId}` : ''}`,
      before: { value: gone.value, version: gone.version },
      after: null,
    });
    await recordServerEvent(tx, 'admin_content_published', {
      userId: input.staffUserId,
      cityId: input.cityId,
      props: { key: input.key, locale: input.locale, action: 'unpublished' },
    });
  });
}
