/**
 * Learn (Seekho; spec 23 § 4 flow 12, § 9.2 "Training videos"; plan task C2). Members read active courses and
 * resources with their own progress; progress writes are upserts that never lower `watched_seconds`. A hosted video
 * completes at ≥ 80 % of its duration; an external link is self-marked "watched", at most
 * `learn.self_mark_daily_cap` a day (IST). A first completion bumps `videos_watched` (Naya group B), records
 * `video_completed` Izzat (idempotent) and recomputes the level, once.
 */
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { LearnProgress, LearnResourceView, LearnView } from '@mechdost/shared/ustaad/dto/qa';
import {
  ustaadCourses,
  ustaadLearningProgress,
  ustaadLearningResources,
  ustaadMemberCounters,
} from '../../schema';
import { NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordIzzat } from './izzat';
import { recomputeUstaadLevel } from './levels';
import { ustaadMediaTextInfo } from './media';
import { savedIdSet } from './saved-flags';
import type { UstaadActor } from './qa';
import { readUstaadSettingValues } from './settings';

const COMPLETE_PCT = 80;
/** Seconds credited once per member and resource, on the first heartbeat (time watched before it). */
const HEARTBEAT_SLACK_S = 30;
const istDayStart = sql`(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;

export async function ustaadLearnView(db: Tx, actor: UstaadActor): Promise<LearnView> {
  const courses = await db
    .select()
    .from(ustaadCourses)
    .where(eq(ustaadCourses.active, true))
    .orderBy(asc(ustaadCourses.position), asc(ustaadCourses.titleEn))
    .limit(50);
  const resources = await db
    .select({ r: ustaadLearningResources, p: ustaadLearningProgress })
    .from(ustaadLearningResources)
    .leftJoin(
      ustaadLearningProgress,
      and(
        eq(ustaadLearningProgress.resourceId, ustaadLearningResources.id),
        eq(ustaadLearningProgress.memberId, actor.memberId),
      ),
    )
    .where(eq(ustaadLearningResources.active, true))
    .orderBy(asc(ustaadLearningResources.position), asc(ustaadLearningResources.createdAt))
    .limit(500);
  const saved = await savedIdSet(
    db,
    actor.memberId,
    'lesson',
    resources.map((r) => r.r.id),
  );
  const sizes = await ustaadMediaTextInfo(
    db,
    resources.flatMap((r) => (r.r.mediaId ? [r.r.mediaId] : [])),
  );
  const view = (row: (typeof resources)[number]): LearnResourceView => ({
    savedByMe: saved.has(row.r.id),
    sizeBytes: row.r.mediaId ? (sizes.get(row.r.mediaId)?.bytes ?? null) : null,
    lastWatchedAt: row.p ? row.p.updatedAt.toISOString() : null,
    id: row.r.id,
    kind: row.r.kind,
    titleEn: row.r.titleEn,
    titleHi: row.r.titleHi,
    segmentCode: row.r.segmentCode,
    workCode: row.r.workCode,
    durationS: row.r.durationS,
    mediaId: row.r.mediaId,
    url: row.r.url,
    label: row.r.label,
    watchedSeconds: row.p?.watchedSeconds ?? 0,
    completed: Boolean(row.p?.completedAt),
  });
  const active = new Set(courses.map((c) => c.id));
  return {
    courses: courses.map((c) => ({
      id: c.id,
      code: c.code,
      titleEn: c.titleEn,
      titleHi: c.titleHi,
      resources: resources.filter((r) => r.r.courseId === c.id).map(view),
    })),
    loose: resources.filter((r) => r.r.courseId === null || !active.has(r.r.courseId)).map(view),
  };
}

/**
 * Write progress. Refuses 404 for an unknown or inactive resource, `USTAAD_LEARN_KIND` for a self mark on a hosted
 * video (or seconds on a link), `USTAAD_DAILY_CAP` when a first completion would pass the daily completion cap
 * (`learn.self_mark_daily_cap`, counting hosted videos and self marks together, IST day).
 *
 * A hosted video takes `deltaSeconds` (a heartbeat). The server never trusts a position: it adds at most the
 * time since its last write for this member and resource, measured on the DB clock at both ends (`now() -
 * updated_at`, touched on every write). Only the first heartbeat gets a fixed slack, so the total credited can never
 * exceed the time since the first write + that slack, however many heartbeats are sent (the gaps telescope). Clients
 * send a heartbeat every 10–30 s; a write that adds nothing still restarts the clock.
 */
export async function writeUstaadLearnProgress(
  db: Tx,
  actor: UstaadActor,
  resourceId: string,
  input: LearnProgress,
): Promise<{ watchedSeconds: number; completed: boolean }> {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(ustaadLearningResources)
      .where(and(eq(ustaadLearningResources.id, resourceId), eq(ustaadLearningResources.active, true)))
      .limit(1);
    if (!r) throw new NotFoundError('Resource not found');
    const hosted = r.kind === 'hosted_video';
    if (hosted !== (input.deltaSeconds !== undefined))
      throw new ValidationError('Wrong progress for this resource', 'USTAAD_LEARN_KIND');
    // The row is locked so two heartbeats at once cannot both claim the same elapsed time.
    const [before] = await tx
      .select({
        c: ustaadLearningProgress.completedAt,
        watched: ustaadLearningProgress.watchedSeconds,
        // Elapsed on the DB clock (both ends), whole seconds, never negative.
        elapsedS: sql<number>`greatest(0, floor(extract(epoch from (now() - ${ustaadLearningProgress.updatedAt}))))::int`,
      })
      .from(ustaadLearningProgress)
      .where(
        and(eq(ustaadLearningProgress.memberId, actor.memberId), eq(ustaadLearningProgress.resourceId, r.id)),
      )
      .for('update')
      .limit(1);
    const allowance = before ? before.elapsedS : HEARTBEAT_SLACK_S;
    const credited = Math.min(input.deltaSeconds ?? 0, allowance);
    const watched = Math.min((before?.watched ?? 0) + credited, r.durationS ?? 86_400);
    const done = hosted ? r.durationS !== null && watched * 100 >= r.durationS * COMPLETE_PCT : true;
    if (done && !before?.c) {
      const s = await readUstaadSettingValues(tx, ['ustaad.learn.self_mark_daily_cap']);
      const [today] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ustaadLearningProgress)
        .where(
          and(
            eq(ustaadLearningProgress.memberId, actor.memberId),
            isNotNull(ustaadLearningProgress.completedAt),
            sql`${ustaadLearningProgress.completedAt} >= ${istDayStart}`,
          ),
        );
      if ((today?.n ?? 0) >= Number(s['ustaad.learn.self_mark_daily_cap']))
        throw new ValidationError('Daily limit reached', 'USTAAD_DAILY_CAP');
    }
    const [row] = await tx
      .insert(ustaadLearningProgress)
      .values({
        memberId: actor.memberId,
        resourceId: r.id,
        watchedSeconds: watched,
        completedAt: done ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [ustaadLearningProgress.memberId, ustaadLearningProgress.resourceId],
        set: {
          watchedSeconds: sql`greatest(${ustaadLearningProgress.watchedSeconds}, excluded.watched_seconds)`,
          completedAt: sql`coalesce(${ustaadLearningProgress.completedAt}, excluded.completed_at)`,
        },
      })
      .returning();
    if (!row) throw new NotFoundError('Resource not found');
    const newlyCompleted = row.completedAt !== null && !before?.c;
    if (newlyCompleted) {
      await tx
        .update(ustaadMemberCounters)
        .set({ videosWatched: sql`${ustaadMemberCounters.videosWatched} + 1` })
        .where(eq(ustaadMemberCounters.memberId, actor.memberId));
      await recordIzzat(
        tx,
        { userId: actor.userId },
        {
          memberId: actor.memberId,
          reason: 'video_completed',
          source: { type: 'learning_resource', id: r.id },
          idemKey: `learn:${actor.memberId}:${r.id}`,
        },
      );
      await recomputeUstaadLevel(tx, actor.memberId);
    }
    return { watchedSeconds: row.watchedSeconds, completed: row.completedAt !== null };
  });
}
