/**
 * Block and mute (spec 23 § 4 flow 7, § 6.2, § 7.9, SR-35; workstream D2). A block is mutual invisibility: after it,
 * each member gets 404 on the other's profile, posts, media, messages and lists. In the same transaction it removes
 * the follows both ways (counters from `DELETE … RETURNING` only), moves the connection to `removed`, the message
 * thread to `blocked` (remembering its earlier status in `blocked_from`) and ends open mentorships with reason
 * `blocked`. Unblock restores the thread only when neither member still blocks the other, and only to its earlier
 * status, so a request never becomes an open thread without being accepted. A mute only hides the other member's
 * content from the muter's feed (D1/D2 feed reads `ustaad_mutes`); nothing is sent to the muted member.
 * A restricted member may still block and mute (safety tools are never taken away).
 */
import { and, desc, eq, or, sql } from 'drizzle-orm';
import {
  ustaadMentorshipMachine,
  ustaadThreadMachine,
  type UstaadThreadStatus,
} from '@mechdost/shared/state';
import type { MemberCard } from '@mechdost/shared/ustaad/dto/social';
import { orderedPair } from '@mechdost/shared/ustaad/social-rules';
import { ustaadBlocks, ustaadMembers, ustaadMentorships, ustaadMutes, ustaadThreads } from '../../schema';
import { NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { removeUstaadConnectionForBlock } from './connections';
import { recordUstaadEvent } from './events';
import { dropUstaadFollow } from './follows';
import { ustaadActingMember, ustaadBlockedEitherWay, ustaadMemberCard } from './graph-common';
import type { UstaadActor } from './qa';

async function existingMember(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: ustaadMembers.id })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, id))
    .limit(1);
  if (!row) throw new NotFoundError('Member not found');
  return row;
}

async function threadOfPair(tx: Tx, a: string, b: string) {
  const pair = orderedPair(a, b);
  const [row] = await tx
    .select()
    .from(ustaadThreads)
    .where(and(eq(ustaadThreads.lowId, pair.lowId), eq(ustaadThreads.highId, pair.highId)))
    .for('update');
  return row;
}

/** Block a member (idempotent). Refuses `USTAAD_SELF_BLOCK` (422) and an unknown member (404). */
export async function blockUstaadMember(
  db: Tx,
  actor: UstaadActor,
  targetId: string,
): Promise<{ blocked: true }> {
  if (targetId === actor.memberId) throw new ValidationError('That is you', 'USTAAD_SELF_BLOCK');
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    await existingMember(tx, targetId);
    const inserted = await tx
      .insert(ustaadBlocks)
      .values({ memberId: me.id, targetId })
      .onConflictDoNothing()
      .returning({ at: ustaadBlocks.createdAt });
    if (inserted.length === 0) return { blocked: true };
    const ctx = { actorUserId: actor.userId, reason: 'blocked' as const };
    await dropUstaadFollow(tx, me.id, targetId, ctx);
    await dropUstaadFollow(tx, targetId, me.id, ctx);
    await removeUstaadConnectionForBlock(tx, me.id, targetId, actor.userId);
    const thread = await threadOfPair(tx, me.id, targetId);
    if (thread && thread.status !== 'blocked') {
      const from = thread.status as UstaadThreadStatus;
      ustaadThreadMachine.assert(from, 'blocked', 'system');
      await tx
        .update(ustaadThreads)
        .set({ status: 'blocked', blockedFrom: from })
        .where(and(eq(ustaadThreads.id, thread.id), eq(ustaadThreads.version, thread.version)));
      await recordUstaadEvent(tx, {
        entityType: 'message_thread',
        entityId: thread.id,
        kind: 'blocked',
        fromStatus: from,
        toStatus: 'blocked',
        reasonCode: 'blocked',
        actorId: actor.userId,
        actorRole: 'system',
      });
    }
    const open = await tx
      .select()
      .from(ustaadMentorships)
      .where(
        and(
          sql`${ustaadMentorships.status} in ('requested', 'active')`,
          or(
            and(eq(ustaadMentorships.ustaadId, me.id), eq(ustaadMentorships.shagirdId, targetId)),
            and(eq(ustaadMentorships.ustaadId, targetId), eq(ustaadMentorships.shagirdId, me.id)),
          ),
        ),
      );
    for (const m of open) {
      ustaadMentorshipMachine.assert(m.status as 'requested' | 'active', 'ended', 'system');
      await tx
        .update(ustaadMentorships)
        .set({ status: 'ended', endedReasonCode: 'blocked' })
        .where(
          and(
            eq(ustaadMentorships.id, m.id),
            eq(ustaadMentorships.status, m.status),
            eq(ustaadMentorships.version, m.version),
          ),
        );
      await recordUstaadEvent(tx, {
        entityType: 'mentorship',
        entityId: m.id,
        kind: 'ended',
        fromStatus: m.status,
        toStatus: 'ended',
        reasonCode: 'blocked',
        actorId: actor.userId,
        actorRole: 'system',
      });
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: me.id,
        kind: 'blocked_member',
        actorId: actor.userId,
        actorRole: 'member',
        props: { targetId },
      },
      {
        name: 'ustaad_member_blocked',
        memberId: me.id,
        userId: actor.userId,
        props: { memberId: me.id, on: true },
      },
    );
    return { blocked: true };
  });
}

/** Unblock (idempotent). The thread goes back to its earlier status only when no block is left either way. */
export async function unblockUstaadMember(
  db: Tx,
  actor: UstaadActor,
  targetId: string,
): Promise<{ blocked: false }> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    const gone = await tx
      .delete(ustaadBlocks)
      .where(and(eq(ustaadBlocks.memberId, me.id), eq(ustaadBlocks.targetId, targetId)))
      .returning({ at: ustaadBlocks.createdAt });
    if (gone.length === 0) return { blocked: false };
    if (!(await ustaadBlockedEitherWay(tx, me.id, targetId))) {
      const thread = await threadOfPair(tx, me.id, targetId);
      if (thread?.status === 'blocked' && thread.blockedFrom) {
        const back = thread.blockedFrom as UstaadThreadStatus;
        ustaadThreadMachine.assert('blocked', back, 'member');
        await tx
          .update(ustaadThreads)
          .set({ status: back, blockedFrom: null })
          .where(and(eq(ustaadThreads.id, thread.id), eq(ustaadThreads.version, thread.version)));
        await recordUstaadEvent(tx, {
          entityType: 'message_thread',
          entityId: thread.id,
          kind: 'unblocked',
          fromStatus: 'blocked',
          toStatus: back,
          actorId: actor.userId,
          actorRole: 'member',
        });
      }
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: me.id,
        kind: 'unblocked_member',
        actorId: actor.userId,
        actorRole: 'member',
        props: { targetId },
      },
      {
        name: 'ustaad_member_blocked',
        memberId: me.id,
        userId: actor.userId,
        props: { memberId: me.id, on: false },
      },
    );
    return { blocked: false };
  });
}

/** Mute or unmute (idempotent). Refuses `USTAAD_SELF_MUTE` (422) and an unknown member (404). */
export async function muteUstaadMember(
  db: Tx,
  actor: UstaadActor,
  targetId: string,
  on: boolean,
): Promise<{ muted: boolean }> {
  if (targetId === actor.memberId) throw new ValidationError('That is you', 'USTAAD_SELF_MUTE');
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    await existingMember(tx, targetId);
    const changed = on
      ? await tx
          .insert(ustaadMutes)
          .values({ memberId: me.id, targetId })
          .onConflictDoNothing()
          .returning({ at: ustaadMutes.createdAt })
      : await tx
          .delete(ustaadMutes)
          .where(and(eq(ustaadMutes.memberId, me.id), eq(ustaadMutes.targetId, targetId)))
          .returning({ at: ustaadMutes.createdAt });
    if (changed.length > 0)
      await recordUstaadEvent(
        tx,
        {
          entityType: 'member',
          entityId: me.id,
          kind: on ? 'muted_member' : 'unmuted_member',
          actorId: actor.userId,
          actorRole: 'member',
          props: { targetId },
        },
        {
          name: 'ustaad_member_muted',
          memberId: me.id,
          userId: actor.userId,
          props: { memberId: me.id, on },
        },
      );
    return { muted: on };
  });
}

/** The caller's own block and mute lists (never who blocked the caller). */
export async function listUstaadBlocks(
  db: Tx,
  actor: UstaadActor,
): Promise<{ blocked: MemberCard[]; muted: MemberCard[] }> {
  const me = await ustaadActingMember(db, actor.memberId);
  const blocked = await db
    .select({ m: ustaadMembers })
    .from(ustaadBlocks)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadBlocks.targetId))
    .where(eq(ustaadBlocks.memberId, me.id))
    .orderBy(desc(ustaadBlocks.createdAt))
    .limit(500);
  const muted = await db
    .select({ m: ustaadMembers })
    .from(ustaadMutes)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadMutes.targetId))
    .where(eq(ustaadMutes.memberId, me.id))
    .orderBy(desc(ustaadMutes.createdAt))
    .limit(500);
  return {
    blocked: blocked.map((r) => ustaadMemberCard(r.m)),
    muted: muted.map((r) => ustaadMemberCard(r.m)),
  };
}
