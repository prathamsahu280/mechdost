/**
 * Removed-content archive (spec 23 § 13 "Removal = archive, not delete"; IT Rules 3(1)(g), security review L5; plan
 * task F2). A removal copies what the legal duty needs (text, media ids, author id) into `ustaad_removed_archive`
 * with `retain_until = removed_at + mod.retention_days`; the daily purge deletes rows past that date unless a legal
 * hold is set, and marks their archived media for the media purge. The evidence vault (CSAM, legal holds) is never
 * purged by this job.
 */
import { and, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { auditLog, ustaadMedia, ustaadRemovedArchive } from '../../schema';
import { NotFoundError } from '../errors';
import type { Tx } from '../orders';

export type ArchiveTargetType = (typeof ustaadRemovedArchive.$inferInsert)['targetType'];

export interface ArchiveSnapshot {
  text: string | null;
  mediaIds: readonly string[];
  authorMemberId: string | null;
  status: string | null;
  reasonCode: string;
}

export async function archiveUstaadContent(
  tx: Tx,
  input: {
    targetType: ArchiveTargetType;
    targetId: string;
    snapshot: ArchiveSnapshot;
    retentionDays: number;
    legalHold?: string | null;
    now?: Date;
  },
): Promise<string> {
  const now = input.now ?? new Date();
  const [row] = await tx
    .insert(ustaadRemovedArchive)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      snapshot: { schema_version: 1, ...input.snapshot, mediaIds: [...input.snapshot.mediaIds] },
      removedAt: now,
      retainUntil: new Date(now.getTime() + input.retentionDays * 86_400_000),
      legalHold: input.legalHold ?? null,
    })
    .returning({ id: ustaadRemovedArchive.id });
  if (!row) throw new Error('archive insert returned nothing');
  return row.id;
}

/** A legal hold (court order, POCSO evidence, open dispute) stops the purge until it is lifted. */
export async function setUstaadArchiveHold(
  tx: Tx,
  input: { targetType: ArchiveTargetType; targetId: string; hold: string | null },
): Promise<number> {
  const rows = await tx
    .update(ustaadRemovedArchive)
    .set({ legalHold: input.hold })
    .where(
      and(
        eq(ustaadRemovedArchive.targetType, input.targetType),
        eq(ustaadRemovedArchive.targetId, input.targetId),
      ),
    )
    .returning({ id: ustaadRemovedArchive.id });
  if (rows.length === 0) throw new NotFoundError('Nothing archived for this item');
  return rows.length;
}

/**
 * `ustaad_removed_archive_purge` (daily): rows past `retain_until` with no legal hold are deleted; their archived
 * media (status `removed_archived`, no hold) get `purge_after = now`, so the media purge deletes the objects.
 * Returns how many archive rows were purged. Idempotent and safe to overlap (delete … returning).
 */
export async function purgeUstaadRemovedArchive(tx: Tx, now = new Date(), limit = 500): Promise<number> {
  return tx.transaction(async (t) => {
    const due = await t
      .select({ id: ustaadRemovedArchive.id, snapshot: ustaadRemovedArchive.snapshot })
      .from(ustaadRemovedArchive)
      .where(and(lte(ustaadRemovedArchive.retainUntil, now), isNull(ustaadRemovedArchive.legalHold)))
      .orderBy(ustaadRemovedArchive.retainUntil)
      .limit(limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return 0;
    const idsOf = (snapshot: unknown): string[] => {
      const ids = (snapshot as { mediaIds?: unknown }).mediaIds;
      return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
    };
    // Security review fix 4: a file that any held archive row still references is never marked for the purge.
    const held = await t
      .select({ snapshot: ustaadRemovedArchive.snapshot })
      .from(ustaadRemovedArchive)
      .where(isNotNull(ustaadRemovedArchive.legalHold));
    const heldIds = new Set(held.flatMap((r) => idsOf(r.snapshot)));
    const mediaIds = due.flatMap((r) => idsOf(r.snapshot)).filter((id) => !heldIds.has(id));
    if (mediaIds.length > 0)
      await t
        .update(ustaadMedia)
        .set({ purgeAfter: now })
        .where(
          and(
            inArray(ustaadMedia.id, mediaIds),
            eq(ustaadMedia.status, 'removed_archived'),
            sql`${ustaadMedia.legalHold} is null`,
          ),
        );
    const gone = await t
      .delete(ustaadRemovedArchive)
      .where(
        inArray(
          ustaadRemovedArchive.id,
          due.map((r) => r.id),
        ),
      )
      .returning({ id: ustaadRemovedArchive.id });
    // One audit row per run (the worker logs the count too); the archive rows themselves are gone by design.
    await t.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: 'ustaad.archive_purged',
      entity: 'ustaad_removed_archive',
      entityId: null,
      before: null,
      after: { count: gone.length, media: mediaIds.length },
      reason: 'retention_elapsed',
    });
    return gone.length;
  });
}
