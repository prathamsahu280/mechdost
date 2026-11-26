/**
 * One view over every reportable thing (spec 23 § 6.7 `target_type`): who wrote it, which city it belongs to, its
 * status and version, its text and media. Used by reports and moderation only (workstream F2); the content tables'
 * own writers stay in C, D and E. Moves here are the moderation edges of the § 7 machines (admin actor).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  ustaadContentMachine,
  ustaadJobMachine,
  ustaadQuestionMachine,
  type UstaadContentStatus,
  type UstaadJobStatus,
  type UstaadQuestionStatus,
} from '@mechdost/shared/state';
import type { UstaadReportTarget } from '@mechdost/shared/ustaad/codes';
import {
  ustaadAnswers,
  ustaadComments,
  ustaadJobs,
  ustaadMembers,
  ustaadMessages,
  ustaadPostMedia,
  ustaadPosts,
  ustaadQuestions,
  ustaadThreads,
} from '../../schema';
import { ConflictError } from '../errors';
import type { Tx } from '../orders';

export interface UstaadTarget {
  type: UstaadReportTarget;
  id: string;
  authorMemberId: string;
  cityId: string | null;
  status: string;
  version: number;
  text: string | null;
  mediaIds: string[];
  /** For messages: the two members of the thread. */
  participants?: [string, string];
}

const joinText = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join('\n') || null;

export async function loadUstaadTarget(
  tx: Tx,
  type: UstaadReportTarget,
  id: string,
): Promise<UstaadTarget | null> {
  switch (type) {
    case 'post':
    case 'story': {
      const [p] = await tx.select().from(ustaadPosts).where(eq(ustaadPosts.id, id)).limit(1);
      if (!p || (type === 'story') !== (p.kind === 'story')) return null;
      const media = await tx
        .select({ id: ustaadPostMedia.mediaId })
        .from(ustaadPostMedia)
        .where(eq(ustaadPostMedia.postId, id));
      return {
        type,
        id,
        authorMemberId: p.authorId,
        cityId: p.cityId,
        status: p.status,
        version: p.version,
        text: joinText(p.body, p.fixSymptom, p.fixCause, p.fixFix, p.linkUrl, p.bodyOriginal),
        mediaIds: media.map((m) => m.id),
      };
    }
    case 'comment': {
      const [c] = await tx
        .select({ row: ustaadComments, cityId: ustaadMembers.cityId })
        .from(ustaadComments)
        .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadComments.authorId))
        .where(eq(ustaadComments.id, id))
        .limit(1);
      if (!c) return null;
      return {
        type,
        id,
        authorMemberId: c.row.authorId,
        cityId: c.cityId,
        status: c.row.status,
        version: c.row.version,
        text: joinText(c.row.body, c.row.bodyOriginal),
        mediaIds: c.row.mediaId ? [c.row.mediaId] : [],
      };
    }
    case 'question': {
      const [q] = await tx.select().from(ustaadQuestions).where(eq(ustaadQuestions.id, id)).limit(1);
      if (!q) return null;
      return {
        type,
        id,
        authorMemberId: q.askerId,
        cityId: q.cityId,
        status: q.status,
        version: q.version,
        text: joinText(q.title, q.body, q.bodyOriginal),
        mediaIds: q.voiceMediaId ? [q.voiceMediaId] : [],
      };
    }
    case 'answer': {
      const [a] = await tx
        .select({ row: ustaadAnswers, cityId: ustaadQuestions.cityId })
        .from(ustaadAnswers)
        .innerJoin(ustaadQuestions, eq(ustaadQuestions.id, ustaadAnswers.questionId))
        .where(eq(ustaadAnswers.id, id))
        .limit(1);
      if (!a) return null;
      return {
        type,
        id,
        authorMemberId: a.row.authorId,
        cityId: a.cityId,
        status: a.row.status,
        version: a.row.version,
        text: joinText(a.row.body, a.row.bodyOriginal),
        mediaIds: a.row.voiceMediaId ? [a.row.voiceMediaId] : [],
      };
    }
    case 'member': {
      const [m] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, id)).limit(1);
      if (!m) return null;
      return {
        type,
        id,
        authorMemberId: m.id,
        cityId: m.cityId,
        status: m.status,
        version: m.version,
        text: joinText(m.displayName, m.displayNameHi),
        mediaIds: m.photoMediaId ? [m.photoMediaId] : [],
      };
    }
    case 'job': {
      const [j] = await tx.select().from(ustaadJobs).where(eq(ustaadJobs.id, id)).limit(1);
      if (!j) return null;
      return {
        type,
        id,
        authorMemberId: j.employerMemberId,
        cityId: j.cityId,
        status: j.status,
        version: j.version,
        text: joinText(j.title, j.description),
        mediaIds: [],
      };
    }
    case 'message': {
      const [m] = await tx
        .select({ row: ustaadMessages, t: ustaadThreads, cityId: ustaadMembers.cityId })
        .from(ustaadMessages)
        .innerJoin(ustaadThreads, eq(ustaadThreads.id, ustaadMessages.threadId))
        .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadMessages.senderId))
        .where(eq(ustaadMessages.id, id))
        .limit(1);
      if (!m) return null;
      return {
        type,
        id,
        authorMemberId: m.row.senderId,
        cityId: m.cityId,
        // A message the first pass held is `held` until a community manager keeps (releases) or removes it (G2).
        status: m.row.deletedAt ? 'removed' : m.row.heldReasonCode ? 'held' : 'visible',
        version: 1,
        text: m.row.body,
        mediaIds: m.row.mediaId ? [m.row.mediaId] : [],
        participants: [m.t.lowId, m.t.highId],
      };
    }
  }
}

/** Status moves for moderation (admin actor), conditional on (id, status, version). Throws `STALE_REPORT` on a race. */
export async function moveUstaadTarget(tx: Tx, t: UstaadTarget, to: string): Promise<void> {
  const stale = () => new ConflictError('This item changed meanwhile', 'STALE_REPORT');
  switch (t.type) {
    case 'post':
    case 'story':
    case 'comment':
    case 'answer': {
      ustaadContentMachine.assert(t.status as UstaadContentStatus, to as UstaadContentStatus, 'admin');
      const table = t.type === 'comment' ? ustaadComments : t.type === 'answer' ? ustaadAnswers : ustaadPosts;
      const rows = await tx
        .update(table)
        .set({ status: to })
        .where(and(eq(table.id, t.id), eq(table.status, t.status), eq(table.version, t.version)))
        .returning({ id: table.id });
      if (rows.length === 0) throw stale();
      return;
    }
    case 'question': {
      ustaadQuestionMachine.assert(t.status as UstaadQuestionStatus, to as UstaadQuestionStatus, 'admin');
      const rows = await tx
        .update(ustaadQuestions)
        .set({ status: to })
        .where(
          and(
            eq(ustaadQuestions.id, t.id),
            eq(ustaadQuestions.status, t.status),
            eq(ustaadQuestions.version, t.version),
          ),
        )
        .returning({ id: ustaadQuestions.id });
      if (rows.length === 0) throw stale();
      return;
    }
    case 'job': {
      ustaadJobMachine.assert(t.status as UstaadJobStatus, to as UstaadJobStatus, 'admin');
      const rows = await tx
        .update(ustaadJobs)
        .set({ status: to, ...(to === 'open' ? { heldReasonCode: null } : {}) })
        .where(
          and(eq(ustaadJobs.id, t.id), eq(ustaadJobs.status, t.status), eq(ustaadJobs.version, t.version)),
        )
        .returning({ id: ustaadJobs.id });
      if (rows.length === 0) throw stale();
      return;
    }
    case 'message': {
      // Messages have no status machine: removal hides the message for both members (deleted_at), restore clears it;
      // keeping a held message releases it (held_reason_code cleared; G2 publish side effects follow).
      if (t.status === 'held' && to === 'visible') {
        // Only into a thread that is still open or a request: a declined or blocked thread gets nothing (the report
        // is dismissed, the message stays held and nobody is told).
        const [thread] = await tx
          .select({ status: ustaadThreads.status })
          .from(ustaadThreads)
          .innerJoin(ustaadMessages, eq(ustaadMessages.threadId, ustaadThreads.id))
          .where(eq(ustaadMessages.id, t.id))
          .limit(1);
        if (thread?.status !== 'open' && thread?.status !== 'requested') return;
        const released = await tx
          .update(ustaadMessages)
          .set({ heldReasonCode: null })
          .where(
            and(
              eq(ustaadMessages.id, t.id),
              isNull(ustaadMessages.deletedAt),
              sql`${ustaadMessages.heldReasonCode} is not null`,
            ),
          )
          .returning({ id: ustaadMessages.id });
        if (released.length === 0) throw stale();
        return;
      }
      const rows = await tx
        .update(ustaadMessages)
        .set({ deletedAt: to === 'removed' ? sql`now()` : null })
        .where(
          and(
            eq(ustaadMessages.id, t.id),
            to === 'removed'
              ? isNull(ustaadMessages.deletedAt)
              : sql`${ustaadMessages.deletedAt} is not null`,
          ),
        )
        .returning({ id: ustaadMessages.id });
      if (rows.length === 0) throw stale();
      return;
    }
    case 'member':
      throw new ConflictError('A member is banned or restricted, not removed', 'USTAAD_ACTION_INVALID');
  }
}

/** The status a "remove" moves to, or null when the target cannot be removed (members are banned instead). */
export function removedStatusOf(t: UstaadTarget): string | null {
  if (t.type === 'member') return null;
  return 'removed';
}

/** The status a "keep" moves a held item to (held content → visible, a held job → open), or null for no move. */
export function keptStatusOf(t: UstaadTarget): string | null {
  if (t.status === 'held') return 'visible';
  if (t.type === 'job' && t.status === 'pending_review') return 'open';
  return null;
}
