/**
 * Ustaad media bookkeeping (spec 23 § 10; SR-12, SR-20, SR-21, SR-35). The object store work (presign, HEAD, magic
 * bytes, copy) is in `apps/api/src/ustaad/media`; this file is the database side: declare with quota and budget as
 * conditional increments (never read-then-write), the owner-only complete, the verified/rejected moves through the
 * media machine, and the read check (member, not blocked by the owner, content visible, story not expired).
 */
import { and, eq, inArray, isNotNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { ustaadMediaMachine } from '@mechdost/shared/state';
import {
  MEDIA_BUCKET_PREFIX,
  type UstaadMediaBucket,
  type UstaadMediaHostId,
  type UstaadMediaKind,
} from '@mechdost/shared/ustaad/codes';
import { istDateString } from '@mechdost/shared/time';
import { buildWebVtt, type CaptionLang } from '@mechdost/shared/ustaad/media-text';
import {
  ustaadBlocks,
  ustaadMedia,
  ustaadMediaTotals,
  ustaadMediaUsage,
  ustaadMediaVariants,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { rowsOf } from '../sql-rows';
import { recordUstaadEvent } from './events';
import { ustaadConsentGranted } from './profile';
import { readUstaadSettingValues } from './settings';

export type UstaadMediaRow = typeof ustaadMedia.$inferSelect;

/** Lifetime totals per member live in the usage table under this date (one row, conditional increments). */
export const USTAAD_LIFETIME_DAY = '1970-01-01';
const MB = 1024 * 1024;
const GB = 1024 * MB;

const EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
};

/** A random, unguessable key: `{prefix}/{memberId}/{uuid}.{ext}` (CHECK `ustaad_media_object_key_format`). */
export function ustaadObjectKey(bucket: UstaadMediaBucket, memberId: string, mime: string): string {
  const ext = EXT[mime];
  if (!ext) throw new ValidationError('This file type is not allowed', 'MEDIA_TYPE');
  return `${MEDIA_BUCKET_PREFIX[bucket]}/${memberId}/${crypto.randomUUID()}.${ext}`;
}

export interface DeclareMediaInput {
  memberId: string;
  userId: string;
  host: UstaadMediaHostId;
  kind: UstaadMediaKind;
  mime: string;
  bytes: number;
  sha256: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Upload URL lifetime (10 minutes). */
  uploadExpiresAt: Date;
  /** The host's own per-file ceiling in bytes (Supabase plan limit); the smaller of it and the setting applies. */
  hostMaxBytes: number;
  /** Author's typed summary (voice or video, ≤ 200 chars) and video captions; fixed once declared (spec 23 § 10a). */
  summary?: string | null;
  captions?: { lang: CaptionLang; text: string } | null;
  now?: Date;
}

/** Caps from the settings for one kind (bytes and, for timed media, milliseconds). */
export async function ustaadMediaCaps(tx: Tx, kind: UstaadMediaKind) {
  const s = await readUstaadSettingValues(tx, [
    'ustaad.media.image_max_mb',
    'ustaad.media.video_max_mb',
    'ustaad.media.voice_max_s',
    'ustaad.media.doc_max_mb',
    'ustaad.posts.video_max_s',
    'ustaad.media.member_quota_mb',
    'ustaad.media.network_budget_gb',
    'ustaad.media.uploads_per_day',
    'ustaad.media.videos_per_day',
  ]);
  const n = (k: keyof typeof s) => Number(s[k]);
  const maxBytes =
    kind === 'image'
      ? n('ustaad.media.image_max_mb') * MB
      : kind === 'video'
        ? Math.min(n('ustaad.media.video_max_mb'), 150) * MB
        : kind === 'document'
          ? n('ustaad.media.doc_max_mb') * MB
          : 10 * MB;
  const maxMs =
    kind === 'video'
      ? n('ustaad.posts.video_max_s') * 1000
      : kind === 'audio'
        ? n('ustaad.media.voice_max_s') * 1000
        : null;
  return {
    maxBytes,
    maxMs,
    memberQuotaBytes: n('ustaad.media.member_quota_mb') * MB,
    budgetBytes: n('ustaad.media.network_budget_gb') * GB,
    uploadsPerDay: n('ustaad.media.uploads_per_day'),
    videosPerDay: n('ustaad.media.videos_per_day'),
  };
}

/**
 * Record a declared upload (status `pending_upload`, quarantine bucket) after the checks that need no file: size and
 * duration caps (`MEDIA_TOO_LARGE`, `MEDIA_TOO_LONG`, before any processing, AT-UP-4), the member's daily uploads and
 * videos and lifetime bytes (`MEDIA_QUOTA`), and the network budget for video (`MEDIA_BUDGET_FULL`, fail closed;
 * photos and voice still work). Quota and budget are conditional increments in this transaction.
 */
export async function declareUstaadMedia(db: Tx, input: DeclareMediaInput): Promise<UstaadMediaRow> {
  // SIM-P10 (spec 23 § 13, DPDP purpose consent): no voice note is stored before the member allowed `ustaad_voice`.
  if (input.kind === 'audio' && !(await ustaadConsentGranted(db, input.userId, 'ustaad_voice')))
    throw new ForbiddenError('Allow voice notes first', 'USTAAD_VOICE_CONSENT');
  const caps = await ustaadMediaCaps(db, input.kind);
  if (input.bytes > Math.min(caps.maxBytes, input.hostMaxBytes))
    throw new ValidationError('This file is too large', 'MEDIA_TOO_LARGE', {
      maxBytes: Math.min(caps.maxBytes, input.hostMaxBytes),
    });
  if (caps.maxMs !== null && (input.durationMs ?? 0) > caps.maxMs + 1000)
    throw new ValidationError('This recording is too long', 'MEDIA_TOO_LONG', {
      maxSeconds: caps.maxMs / 1000,
    });
  const now = input.now ?? new Date();
  const day = istDateString(now);
  const budgetFull = new ValidationError('Videos are paused for a short while', 'MEDIA_BUDGET_FULL');
  try {
    return await declareInTx(db, input, caps, now, day, budgetFull);
  } catch (err) {
    // Recorded outside the refused transaction (it rolled back the quota counts).
    if (err === budgetFull)
      await recordUstaadEvent(
        db,
        {
          entityType: 'media',
          entityId: input.memberId,
          kind: 'budget_full',
          actorId: input.userId,
          actorRole: 'member',
        },
        {
          name: 'ustaad_media_budget_full',
          memberId: input.memberId,
          userId: input.userId,
          props: { kind: input.kind },
        },
      );
    throw err;
  }
}

async function declareInTx(
  db: Tx,
  input: DeclareMediaInput,
  caps: Awaited<ReturnType<typeof ustaadMediaCaps>>,
  now: Date,
  day: string,
  budgetFull: ValidationError,
): Promise<UstaadMediaRow> {
  const isVideo = input.kind === 'video' ? 1 : 0;
  return db.transaction(async (tx) => {
    await tx
      .insert(ustaadMediaUsage)
      .values([
        { memberId: input.memberId, day },
        { memberId: input.memberId, day: USTAAD_LIFETIME_DAY },
      ])
      .onConflictDoNothing();
    const [daily] = await tx
      .update(ustaadMediaUsage)
      .set({
        uploads: sql`${ustaadMediaUsage.uploads} + 1`,
        videos: sql`${ustaadMediaUsage.videos} + ${isVideo}`,
        bytes: sql`${ustaadMediaUsage.bytes} + ${input.bytes}`,
      })
      .where(
        and(
          eq(ustaadMediaUsage.memberId, input.memberId),
          eq(ustaadMediaUsage.day, day),
          sql`${ustaadMediaUsage.uploads} + 1 <= ${caps.uploadsPerDay}`,
          sql`${ustaadMediaUsage.videos} + ${isVideo} <= ${caps.videosPerDay}`,
        ),
      )
      .returning({ uploads: ustaadMediaUsage.uploads });
    if (!daily) throw new ValidationError('Daily upload limit reached', 'MEDIA_QUOTA', { scope: 'day' });
    const [lifetime] = await tx
      .update(ustaadMediaUsage)
      .set({
        bytes: sql`${ustaadMediaUsage.bytes} + ${input.bytes}`,
        uploads: sql`${ustaadMediaUsage.uploads} + 1`,
      })
      .where(
        and(
          eq(ustaadMediaUsage.memberId, input.memberId),
          eq(ustaadMediaUsage.day, USTAAD_LIFETIME_DAY),
          sql`${ustaadMediaUsage.bytes} + ${input.bytes} <= ${caps.memberQuotaBytes}`,
        ),
      )
      .returning({ bytes: ustaadMediaUsage.bytes });
    if (!lifetime) throw new ValidationError('Your storage is full', 'MEDIA_QUOTA', { scope: 'total' });
    // Network budget: video fails closed when the total would pass it; other kinds always count.
    const total = sql`(select coalesce(sum(t.bytes), 0) from ustaad_media_totals t)`;
    const [budget] = await tx
      .update(ustaadMediaTotals)
      .set({ bytes: sql`${ustaadMediaTotals.bytes} + ${input.bytes}` })
      .where(
        and(
          eq(ustaadMediaTotals.kind, input.kind),
          input.kind === 'video' ? sql`${total} + ${input.bytes} <= ${caps.budgetBytes}` : sql`true`,
        ),
      )
      .returning({ bytes: ustaadMediaTotals.bytes });
    if (!budget) throw budgetFull;
    const [row] = await tx
      .insert(ustaadMedia)
      .values({
        ownerMemberId: input.memberId,
        host: input.host,
        bucket: 'quarantine',
        kind: input.kind,
        declaredBytes: input.bytes,
        declaredMime: input.mime,
        sha256: input.sha256,
        durationMs: input.durationMs,
        width: input.width,
        height: input.height,
        objectKey: ustaadObjectKey('quarantine', input.memberId, input.mime),
        summary: input.summary ?? null,
        captions: input.captions?.text ?? null,
        captionsLang: input.captions?.lang ?? null,
        uploadExpiresAt: input.uploadExpiresAt,
        // Never completed within an hour → the purge job removes it with its object.
        purgeAfter: new Date(now.getTime() + 3_600_000),
      })
      .returning();
    if (!row) throw new ConflictError('Could not record the upload', 'RETRY');
    return row;
  });
}

/** Save the multipart upload id once the host created it. */
export async function setUstaadMediaUploadId(tx: Tx, mediaId: string, uploadId: string): Promise<void> {
  await tx.update(ustaadMedia).set({ uploadId }).where(eq(ustaadMedia.id, mediaId));
}

/**
 * The pending upload owned by this member, or 404 (another member's id, an unknown id: AT-UP-10). An expired upload
 * URL is refused with `MEDIA_MISMATCH` and the row rejected.
 */
export async function pendingUstaadMediaOf(
  tx: Tx,
  input: { mediaId: string; memberId: string; now?: Date },
): Promise<UstaadMediaRow> {
  const [row] = await tx
    .select()
    .from(ustaadMedia)
    .where(and(eq(ustaadMedia.id, input.mediaId), eq(ustaadMedia.ownerMemberId, input.memberId)))
    .limit(1);
  if (row?.status !== 'pending_upload') throw new NotFoundError();
  // The phone has 10 minutes to start and a short grace to finish (resumable parts ask for new URLs).
  if ((input.now ?? new Date()).getTime() > row.uploadExpiresAt.getTime() + 50 * 60_000) {
    await rejectUstaadMedia(tx, row, 'expired_upload');
    throw new ValidationError('This upload link has expired', 'MEDIA_MISMATCH');
  }
  return row;
}

async function move(
  tx: Tx,
  row: UstaadMediaRow,
  to: UstaadMediaRow['status'],
  actor: 'member' | 'system' | 'admin',
  set: Partial<typeof ustaadMedia.$inferInsert>,
): Promise<UstaadMediaRow> {
  ustaadMediaMachine.assert(row.status as never, to as never, actor);
  const [next] = await tx
    .update(ustaadMedia)
    .set({ ...set, status: to })
    .where(
      and(
        eq(ustaadMedia.id, row.id),
        eq(ustaadMedia.status, row.status),
        eq(ustaadMedia.version, row.version),
      ),
    )
    .returning();
  if (!next) throw new ConflictError('This file changed meanwhile', 'STALE_MEDIA');
  return next;
}

export async function markUstaadMediaUploaded(tx: Tx, row: UstaadMediaRow): Promise<UstaadMediaRow> {
  return move(tx, row, 'uploaded', 'member', { uploadedAt: new Date() });
}

/** Verified: the object now lives in `bucket` under `objectKey` (the quarantine copy is gone). */
export async function markUstaadMediaVerified(
  tx: Tx,
  row: UstaadMediaRow,
  live: {
    bucket: UstaadMediaBucket;
    objectKey: string;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    lqip: string | null;
  },
): Promise<UstaadMediaRow> {
  return move(tx, row, 'verified', 'system', { ...live, verifiedAt: new Date(), purgeAfter: null });
}

/** Rejected: counts come back (quota and budget), the event is recorded, the object is deleted by the caller. */
export async function rejectUstaadMedia(
  tx: Tx,
  row: UstaadMediaRow,
  reason: NonNullable<UstaadMediaRow['rejectReasonCode']>,
): Promise<void> {
  const from = row.status === 'pending_upload' ? await move(tx, row, 'uploaded', 'member', {}) : row;
  await move(tx, from, 'rejected', 'system', { rejectReasonCode: reason, purgeAfter: new Date() });
  await tx
    .update(ustaadMediaTotals)
    .set({ bytes: sql`greatest(${ustaadMediaTotals.bytes} - ${row.declaredBytes}, 0)` })
    .where(eq(ustaadMediaTotals.kind, row.kind));
  await tx
    .update(ustaadMediaUsage)
    .set({ bytes: sql`greatest(${ustaadMediaUsage.bytes} - ${row.declaredBytes}, 0)` })
    .where(
      and(eq(ustaadMediaUsage.memberId, row.ownerMemberId), eq(ustaadMediaUsage.day, USTAAD_LIFETIME_DAY)),
    );
  await recordUstaadEvent(
    tx,
    {
      entityType: 'media',
      entityId: row.id,
      kind: 'rejected',
      fromStatus: row.status,
      toStatus: 'rejected',
      reasonCode: reason,
      actorId: null,
      actorRole: 'system',
    },
    {
      name: 'ustaad_media_rejected',
      memberId: row.ownerMemberId,
      userId: null,
      props: { mediaId: row.id, kind: row.kind as UstaadMediaKind, reason: reason as never },
    },
  );
}

/**
 * The media a viewer may read (SR-21, SR-35), or null (the API answers 404). **Deny by default** (security review
 * 2026-11-26): verified, in a live bucket (never quarantine or evidence, AT-UP-8), nobody blocked by the other, and
 * either the viewer owns it or it is attached to at least one host the viewer can see:
 *  - a visible post (a story only before it expires, review focus 2);
 *  - a visible comment whose post, or answer and its question, is still live;
 *  - a question that is not removed, a visible answer whose question is not removed (voice notes);
 *  - for every post, question and answer host: nobody blocked between its author and the viewer;
 *  - a message in a thread the viewer is part of (not deleted);
 *  - the profile photo of a member who has not left and is not banned;
 *  - a job application voice intro: the applicant and the job's employer only;
 *  - an active learning resource or tutorial card, a link-preview image.
 * Unlinked media (a signboard photo, an upload not yet posted) is the owner's alone. Staff reads go through the
 * audited moderation path of workstream F, never through this function. A new host type must be added here.
 */
export async function readableUstaadMedia(
  tx: Tx,
  input: { mediaId: string; viewerMemberId: string; now?: Date },
): Promise<UstaadMediaRow | null> {
  const now = input.now ?? new Date();
  const [row] = await tx
    .select()
    .from(ustaadMedia)
    .where(
      and(
        eq(ustaadMedia.id, input.mediaId),
        eq(ustaadMedia.status, 'verified'),
        notInArray(ustaadMedia.bucket, ['quarantine', 'evidence']),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.ownerMemberId === input.viewerMemberId) return row;
  const [blocked] = await tx
    .select({ x: sql`1` })
    .from(ustaadBlocks)
    .where(
      or(
        and(eq(ustaadBlocks.memberId, row.ownerMemberId), eq(ustaadBlocks.targetId, input.viewerMemberId)),
        and(eq(ustaadBlocks.memberId, input.viewerMemberId), eq(ustaadBlocks.targetId, row.ownerMemberId)),
      ),
    )
    .limit(1);
  if (blocked) return null;
  const m = row.id;
  const v = input.viewerMemberId;
  // Nobody blocked between the viewer and a host's author (post author, question asker, answer author).
  const open = (author: SQL) => sql`not exists (select 1 from ustaad_blocks bl
      where (bl.member_id = ${author} and bl.target_id = ${v}) or (bl.member_id = ${v} and bl.target_id = ${author}))`;
  const livePost = (p: SQL) =>
    sql`(${p}.status = 'visible' and (${p}.kind <> 'story' or ${p}.expires_at > ${now.toISOString()}::timestamptz) and ${open(sql`${p}.author_id`)})`;
  const liveQuestion = sql`(q.status <> 'removed' and ${open(sql`q.asker_id`)})`;
  const liveAnswer = sql`(a.status = 'visible' and ${open(sql`a.author_id`)} and ${liveQuestion})`;
  const res = await tx.execute(sql`
    select (
      exists (select 1 from ustaad_post_media pm join ustaad_posts p on p.id = pm.post_id
              where pm.media_id = ${m} and ${livePost(sql`p`)})
      or exists (select 1 from ustaad_comments c join ustaad_posts p on p.id = c.post_id
              where c.media_id = ${m} and c.status = 'visible' and ${livePost(sql`p`)})
      or exists (select 1 from ustaad_comments c join ustaad_answers a on a.id = c.answer_id
              join ustaad_questions q on q.id = a.question_id
              where c.media_id = ${m} and c.status = 'visible' and ${liveAnswer})
      or exists (select 1 from ustaad_questions q where q.voice_media_id = ${m} and ${liveQuestion})
      or exists (select 1 from ustaad_answers a join ustaad_questions q on q.id = a.question_id
              where a.voice_media_id = ${m} and ${liveAnswer})
      or exists (select 1 from ustaad_messages msg join ustaad_threads t on t.id = msg.thread_id
              where msg.media_id = ${m} and msg.deleted_at is null and msg.held_reason_code is null
                and t.status = 'open'
                and ${v} in (t.low_id, t.high_id))
      or exists (select 1 from ustaad_members mb where mb.photo_media_id = ${m} and mb.status in ('active', 'restricted'))
      or exists (select 1 from ustaad_job_applications ja join ustaad_jobs j on j.id = ja.job_id
              where ja.voice_intro_media_id = ${m} and ${v} in (ja.member_id, j.employer_member_id))
      or exists (select 1 from ustaad_learning_resources lr where lr.media_id = ${m} and lr.active)
      or exists (select 1 from ustaad_tutorial_cards tc
              where tc.active and ${m} in (tc.image_media_id, tc.audio_en_media_id, tc.audio_hi_media_id))
      or exists (select 1 from ustaad_link_previews lp where lp.image_media_id = ${m} and lp.status = 'ok')
    ) as ok`);
  const ok = rowsOf<{ ok: unknown }>(res)[0]?.ok;
  return ok === true || ok === 't' ? row : null;
}

/** Rows whose object the purge job deletes now (pending > 1 h, rejected, expired stories after the grace). */
export async function dueUstaadMediaPurges(
  tx: Tx,
  limit: number,
  now = new Date(),
): Promise<UstaadMediaRow[]> {
  return tx
    .select()
    .from(ustaadMedia)
    .where(
      and(
        isNotNull(ustaadMedia.purgeAfter),
        lte(ustaadMedia.purgeAfter, now),
        ne(ustaadMedia.status, 'purged'),
        sql`${ustaadMedia.legalHold} is null`,
      ),
    )
    .orderBy(ustaadMedia.purgeAfter)
    .limit(limit);
}

/** After the object is gone: rejected stays rejected (terminal); others move to `purged`. */
export async function markUstaadMediaPurged(tx: Tx, row: UstaadMediaRow): Promise<void> {
  if (row.status === 'rejected') {
    await tx.update(ustaadMedia).set({ purgeAfter: null }).where(eq(ustaadMedia.id, row.id));
    return;
  }
  await move(tx, row, 'purged', 'system', { purgeAfter: null });
}

/** Server-written image variants of a verified image (re-encoded, metadata stripped). */
export async function saveUstaadMediaVariants(
  tx: Tx,
  mediaId: string,
  variants: readonly {
    variant: (typeof ustaadMediaVariants.$inferInsert)['variant'];
    objectKey: string;
    bytes: number;
    width: number;
    height: number;
  }[],
): Promise<void> {
  if (variants.length === 0) return;
  await tx
    .insert(ustaadMediaVariants)
    .values(variants.map((v) => ({ ...v, mediaId })))
    .onConflictDoNothing();
}

/** The stored key of one variant (or null when the image has no such variant). */
export async function ustaadMediaVariantKey(
  tx: Tx,
  mediaId: string,
  variant: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ key: ustaadMediaVariants.objectKey })
    .from(ustaadMediaVariants)
    .where(and(eq(ustaadMediaVariants.mediaId, mediaId), eq(ustaadMediaVariants.variant, variant)))
    .limit(1);
  return row?.key ?? null;
}

export async function ustaadMediaById(tx: Tx, mediaId: string): Promise<UstaadMediaRow | null> {
  const [row] = await tx.select().from(ustaadMedia).where(eq(ustaadMedia.id, mediaId)).limit(1);
  return row ?? null;
}

export interface UstaadMediaTextInfo {
  durationMs: number | null;
  bytes: number;
  summary: string | null;
  captionsLang: CaptionLang | null;
  /** Built from the typed captions (video only); the player turns it into a `<track kind="captions">`. */
  captionsVtt: string | null;
}

/**
 * Duration, size, typed summary and captions for the media on a page, in one query (no N+1). Callers pass only ids
 * they already show (the read check happens when the file itself is fetched); unknown ids are left out.
 */
export async function ustaadMediaTextInfo(
  tx: Tx,
  ids: readonly string[],
): Promise<Map<string, UstaadMediaTextInfo>> {
  const out = new Map<string, UstaadMediaTextInfo>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const rows = await tx
    .select({
      id: ustaadMedia.id,
      durationMs: ustaadMedia.durationMs,
      bytes: ustaadMedia.declaredBytes,
      summary: ustaadMedia.summary,
      captions: ustaadMedia.captions,
      captionsLang: ustaadMedia.captionsLang,
    })
    .from(ustaadMedia)
    .where(inArray(ustaadMedia.id, unique));
  for (const r of rows)
    out.set(r.id, {
      durationMs: r.durationMs,
      bytes: r.bytes,
      summary: r.summary,
      captionsLang: r.captionsLang === 'hi' || r.captionsLang === 'en' ? r.captionsLang : null,
      captionsVtt: r.captions ? buildWebVtt(r.captions, r.durationMs ?? 1000) : null,
    });
  return out;
}
