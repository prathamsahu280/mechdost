/**
 * Request-only messages (spec 23 § 4 flow 7, § 6.2, § 7.9, SR-33–35, SR-38; workstream D2).
 *
 * - Starting a thread: members only, account on the network for `limits.dm_min_account_days` (403
 *   `USTAAD_DM_TOO_NEW`), at most `limits.new_threads_per_day` new threads a day (429), the receiver's `dm_mode`
 *   (`nobody` → 403 `USTAAD_DM_NOT_ALLOWED`; `everyone`, or an accepted connection, opens the thread at once;
 *   `request`, the default, makes it a request). The first message is text only.
 * - While a thread is `requested`: exactly one message (the request), no link (422 `USTAAD_DM_LINK`), phone numbers,
 *   emails and UPI ids masked to "#", no media; the receiver accepts or declines.
 * - Every message passes `screenUstaadContent` (F2's real filter replaces the stub) and the scam signals (fee phrase,
 *   UPI id, pay-app ask, admin `scam_phrase` list): a hold stores `held_reason_code`, the receiver never sees it, no
 *   notice goes out and the thread's `last_message_at` does not move; the sender sees it as pending without a reason.
 * - Media: the sender's own verified audio (voice) or image (photo) in the `media` bucket; a shared post must be
 *   visible to both. Read receipts and per-thread mute live in `ustaad_thread_members`.
 * - Blocked either way: the thread is 404 for both (SR-35). Staff read a thread only through an open report on one of
 *   its messages, city scoped, with a reason code, and every read writes `audit_log` (`ustaad.dm_read`).
 */
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { ustaadThreadMachine, type UstaadThreadStatus } from '@mechdost/shared/state';
import type {
  MessageView,
  SendMessage,
  StaffThreadReadQuery,
  StaffThreadView,
  StartThread,
  ThreadListQuery,
  ThreadView,
} from '@mechdost/shared/ustaad/dto/messages';
import { dmTextCheck, orderedPair } from '@mechdost/shared/ustaad/social-rules';
import { ustaadMediaTextInfo, voiceInfoOf } from './media';
import {
  auditLog,
  ustaadConnections,
  ustaadMedia,
  ustaadMembers,
  ustaadMessages,
  ustaadPosts,
  ustaadReports,
  ustaadThreadMembers,
  ustaadThreads,
  ustaadWordLists,
} from '../../schema';
import { ConflictError, DailyCapError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { rowsOf } from '../sql-rows';
import { recordUstaadEvent } from './events';
import {
  bumpUstaadDailyCounter,
  decodeUstaadCursor,
  encodeUstaadCursor,
  ustaadActingMember,
  ustaadBlockedEitherWay,
  ustaadMemberCards,
  ustaadVisibleMember,
  type UstaadMemberRow,
} from './graph-common';
import { openUstaadAutoHoldReport, screenUstaadContent } from './moderation';
import { publishUstaadMessage } from './publish';
import { assertUstaadMemberCanWrite, type UstaadActor } from './qa';
import { readUstaadSettingValues } from './settings';

type ThreadRow = typeof ustaadThreads.$inferSelect;
const PAGE = 30;
const DAY_MS = 86_400_000;

async function scamPhrases(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ phrase: ustaadWordLists.phrase })
    .from(ustaadWordLists)
    .where(and(eq(ustaadWordLists.list, 'scam_phrase'), eq(ustaadWordLists.active, true)));
  return rows.map((r) => r.phrase);
}

const otherOf = (t: ThreadRow, me: string) => (t.lowId === me ? t.highId : t.lowId);

/**
 * SIM-P34: a ban closes the banned member's conversations. Derived, not stored (a ban ends by the clock, an unban or an
 * overturned appeal, and the thread then works again with nothing to restore): while the other member is banned or
 * has left, nothing more is sent in either direction and a request from them cannot be accepted.
 */
async function assertCounterpartReachable(tx: Tx, thread: ThreadRow, me: string): Promise<void> {
  const [other] = await tx
    .select({ status: ustaadMembers.status })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, otherOf(thread, me)))
    .limit(1);
  if (!other || other.status === 'banned' || other.status === 'left')
    throw new ForbiddenError('This conversation is closed', 'USTAAD_DM_NOT_ALLOWED');
}

/**
 * The receiver (the member who did not start the request) may see the thread only on content, never on a proxy
 * column (security review 2026-11-26): while `requested`, the requester's latest message (the request; only one is
 * allowed per request) must be unheld and not deleted; in any other state at least one unheld, undeleted message
 * must exist. A held request therefore never shows up, after a decline and a re-request either.
 */
const receiverCanSee = (threadId: SQL) =>
  sql`exists (select 1 from ustaad_threads t2 where t2.id = ${threadId} and (case when t2.status = 'requested' then
    coalesce((select m.held_reason_code is null and m.deleted_at is null from ustaad_messages m
      where m.thread_id = t2.id and m.sender_id = t2.requested_by order by m.created_at desc, m.id desc limit 1), false)
  else exists (select 1 from ustaad_messages m where m.thread_id = t2.id and m.held_reason_code is null
      and m.deleted_at is null) end))`;

/** A thread the caller is part of and that is not blocked (404 otherwise). */
async function myThread(tx: Tx, me: string, threadId: string, lock = false): Promise<ThreadRow> {
  const q = tx
    .select()
    .from(ustaadThreads)
    .where(and(eq(ustaadThreads.id, threadId), or(eq(ustaadThreads.lowId, me), eq(ustaadThreads.highId, me))))
    .limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row || row.status === 'blocked') throw new NotFoundError('Conversation not found');
  if (await ustaadBlockedEitherWay(tx, row.lowId, row.highId))
    throw new NotFoundError('Conversation not found');
  // A thread whose request is held does not exist for the receiver (no card, no accept, no notice).
  if (row.requestedBy !== me) {
    const res = await tx.execute(sql`select ${receiverCanSee(sql`${row.id}::uuid`)} as ok`);
    const ok = rowsOf<{ ok: unknown }>(res)[0]?.ok;
    if (!(ok === true || ok === 't')) throw new NotFoundError('Conversation not found');
  }
  return row;
}

async function moveThread(
  tx: Tx,
  row: ThreadRow,
  to: UstaadThreadStatus,
  actorUserId: string,
  actorMemberId: string,
): Promise<ThreadRow> {
  const from = row.status as UstaadThreadStatus;
  ustaadThreadMachine.assert(from, to, 'member');
  const [moved] = await tx
    .update(ustaadThreads)
    .set({ status: to })
    .where(
      and(
        eq(ustaadThreads.id, row.id),
        eq(ustaadThreads.status, from),
        eq(ustaadThreads.version, row.version),
      ),
    )
    .returning();
  if (!moved) throw new ConflictError('This conversation changed, refresh and try again', 'STALE');
  await recordUstaadEvent(
    tx,
    {
      entityType: 'message_thread',
      entityId: row.id,
      kind: to,
      fromStatus: from,
      toStatus: to,
      actorId: actorUserId,
      actorRole: 'member',
    },
    {
      name: 'ustaad_message_thread_changed',
      memberId: actorMemberId,
      userId: actorUserId,
      props: { threadId: row.id, to },
    },
  );
  return moved;
}

interface Content {
  kind: SendMessage['kind'];
  body: string | null;
  mediaId: string | null;
  postId: string | null;
}

/** Media and shared posts checks for an open thread. */
async function assertAttachable(tx: Tx, me: string, other: string, c: Content): Promise<void> {
  if (c.mediaId) {
    const [m] = await tx
      .select({
        owner: ustaadMedia.ownerMemberId,
        kind: ustaadMedia.kind,
        status: ustaadMedia.status,
        bucket: ustaadMedia.bucket,
      })
      .from(ustaadMedia)
      .where(eq(ustaadMedia.id, c.mediaId))
      .limit(1);
    const want = c.kind === 'voice' ? 'audio' : 'image';
    if (!(m?.owner === me && m.kind === want && m.status === 'verified' && m.bucket === 'media'))
      throw new ValidationError('That file cannot be sent', 'USTAAD_MEDIA_INVALID');
  }
  if (c.postId) {
    const [p] = await tx
      .select({ author: ustaadPosts.authorId, status: ustaadPosts.status })
      .from(ustaadPosts)
      .where(eq(ustaadPosts.id, c.postId))
      .limit(1);
    if (
      p?.status !== 'visible' ||
      (await ustaadBlockedEitherWay(tx, me, p.author)) ||
      (await ustaadBlockedEitherWay(tx, other, p.author))
    )
      throw new ValidationError('That post cannot be shared', 'USTAAD_POST_INVALID');
  }
}

/** Insert one message after screening; returns its id and whether it is held. */
async function writeMessage(
  tx: Tx,
  thread: ThreadRow,
  me: UstaadMemberRow,
  actorUserId: string,
  c: Content,
  requested: boolean,
): Promise<{ messageId: string; pending: boolean }> {
  let body = c.body;
  let held: 'screened' | 'scam_phrase' | null = null;
  if (body !== null) {
    const check = dmTextCheck(body, { requested, scamPhrases: await scamPhrases(tx) });
    if (check.link) throw new ValidationError('Links can be sent after they accept', 'USTAAD_DM_LINK');
    body = check.text;
    if (check.hold) held = 'scam_phrase';
  }
  const screen = await screenUstaadContent(tx, {
    kind: 'message',
    text: body,
    mediaIds: c.mediaId ? [c.mediaId] : [],
    authorId: me.id,
  });
  if (screen === 'block') throw new ValidationError('This message cannot be sent', 'USTAAD_CONTENT_BLOCKED');
  if (screen === 'hold' && held === null) held = 'screened';
  const [row] = await tx
    .insert(ustaadMessages)
    .values({
      threadId: thread.id,
      senderId: me.id,
      kind: c.kind,
      body,
      mediaId: c.mediaId,
      postId: c.postId,
      heldReasonCode: held,
    })
    .returning({ id: ustaadMessages.id, at: ustaadMessages.createdAt });
  if (!row) throw new ConflictError('Could not send');
  // The sender has read everything up to their own message.
  await tx
    .update(ustaadThreadMembers)
    .set({ lastReadAt: row.at })
    .where(and(eq(ustaadThreadMembers.threadId, thread.id), eq(ustaadThreadMembers.memberId, me.id)));
  await recordUstaadEvent(
    tx,
    {
      entityType: 'message_thread',
      entityId: thread.id,
      kind: 'message',
      reasonCode: held,
      actorId: actorUserId,
      actorRole: 'member',
      props: { messageId: row.id, kind: c.kind },
    },
    {
      name: 'ustaad_message_sent',
      memberId: me.id,
      userId: actorUserId,
      props: { threadId: thread.id, kind: c.kind, held: held !== null },
    },
  );
  // A held message reaches the moderation queue (G2); one that goes out now moves the thread and tells the other
  // member (the same path a community manager's keep runs later).
  if (held === null) await publishUstaadMessage(tx, row.id);
  else
    await openUstaadAutoHoldReport(tx, {
      targetType: 'message',
      targetId: row.id,
      authorId: me.id,
      kind: 'message',
      scam: held === 'scam_phrase',
    });
  return { messageId: row.id, pending: held !== null };
}

/**
 * Start a conversation with a text message (or send into the existing one). Returns the thread, its status and the
 * message. See the file header for every refusal.
 */
export async function startUstaadThread(
  db: Tx,
  actor: UstaadActor,
  input: StartThread,
): Promise<{ threadId: string; status: UstaadThreadStatus; messageId: string; pending: boolean }> {
  if (input.memberId === actor.memberId) throw new ValidationError('That is you', 'USTAAD_SELF_MESSAGE');
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    assertUstaadMemberCanWrite(me);
    const target = await ustaadVisibleMember(tx, me.id, input.memberId);
    const pair = orderedPair(me.id, target.id);
    const [existing] = await tx
      .select()
      .from(ustaadThreads)
      .where(and(eq(ustaadThreads.lowId, pair.lowId), eq(ustaadThreads.highId, pair.highId)))
      .for('update');
    if (existing?.status === 'blocked') throw new NotFoundError('Member not found');
    if (existing?.status === 'open') {
      const sent = await writeMessage(
        tx,
        existing,
        me,
        actor.userId,
        { kind: 'text', body: input.text, mediaId: null, postId: null },
        false,
      );
      return { threadId: existing.id, status: 'open', ...sent };
    }
    if (existing?.status === 'requested')
      throw new ConflictError('Wait for them to accept your message', 'USTAAD_DM_PENDING');
    if (existing?.status === 'declined' && existing.requestedBy === me.id)
      throw new ConflictError('This member did not accept your message', 'USTAAD_DM_NOT_ALLOWED');

    // A new request (or the member who declined now writes first).
    const s = await readUstaadSettingValues(tx, [
      'ustaad.limits.dm_min_account_days',
      'ustaad.limits.new_threads_per_day',
    ]);
    const minDays = Number(s['ustaad.limits.dm_min_account_days']);
    if (Date.now() - me.joinedAt.getTime() < minDays * DAY_MS)
      throw new ForbiddenError('New accounts can send messages after a few days', 'USTAAD_DM_TOO_NEW');
    if (target.dmMode === 'nobody')
      throw new ForbiddenError('This member does not take messages', 'USTAAD_DM_NOT_ALLOWED');
    // Atomic daily cap (security review 2026-11-26): one conditional upsert; a refusal rolls everything back.
    if (
      !(await bumpUstaadDailyCounter(
        tx,
        me.id,
        'new_threads',
        1,
        Number(s['ustaad.limits.new_threads_per_day']),
      ))
    )
      throw new DailyCapError('You have started enough conversations for today', 'USTAAD_DAILY_CAP');
    const [conn] = await tx
      .select({ status: ustaadConnections.status })
      .from(ustaadConnections)
      .where(and(eq(ustaadConnections.lowId, pair.lowId), eq(ustaadConnections.highId, pair.highId)));
    const opensNow = target.dmMode === 'everyone' || conn?.status === 'accepted';
    const status: UstaadThreadStatus = opensNow ? 'open' : 'requested';

    let thread: ThreadRow;
    if (existing) {
      // declined → requested by the member who declined; straight to open is not a machine move, so open via request.
      ustaadThreadMachine.assert('declined', 'requested', 'member');
      const [moved] = await tx
        .update(ustaadThreads)
        .set({ status: 'requested', requestedBy: me.id, lastMessageAt: null })
        .where(and(eq(ustaadThreads.id, existing.id), eq(ustaadThreads.version, existing.version)))
        .returning();
      if (!moved) throw new ConflictError('Try again', 'STALE');
      thread = moved;
    } else {
      const [created] = await tx
        .insert(ustaadThreads)
        .values({ ...pair, requestedBy: me.id, status })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError('Try again', 'STALE');
      thread = created;
      await tx
        .insert(ustaadThreadMembers)
        .values([
          { threadId: thread.id, memberId: me.id },
          { threadId: thread.id, memberId: target.id },
        ])
        .onConflictDoNothing();
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'message_thread',
        entityId: thread.id,
        kind: 'started',
        toStatus: thread.status,
        actorId: actor.userId,
        actorRole: 'member',
      },
      {
        name: 'ustaad_message_thread_started',
        memberId: me.id,
        userId: actor.userId,
        props: { threadId: thread.id },
      },
    );
    const sent = await writeMessage(
      tx,
      thread,
      me,
      actor.userId,
      { kind: 'text', body: input.text, mediaId: null, postId: null },
      thread.status === 'requested',
    );
    return { threadId: thread.id, status: thread.status as UstaadThreadStatus, ...sent };
  });
}

/** Send into an open thread (text, voice, photo or a shared post). */
export async function sendUstaadMessage(
  db: Tx,
  actor: UstaadActor,
  threadId: string,
  input: SendMessage,
): Promise<{ messageId: string; pending: boolean }> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    assertUstaadMemberCanWrite(me);
    const thread = await myThread(tx, me.id, threadId);
    if (thread.status === 'requested')
      throw new ConflictError('Wait until the request is accepted', 'USTAAD_DM_PENDING');
    if (thread.status !== 'open')
      throw new ForbiddenError('This conversation is closed', 'USTAAD_DM_NOT_ALLOWED');
    await assertCounterpartReachable(tx, thread, me.id);
    const c: Content = {
      kind: input.kind,
      body: 'text' in input && input.text !== undefined ? input.text : null,
      mediaId: 'mediaId' in input ? input.mediaId : null,
      postId: 'postId' in input ? input.postId : null,
    };
    await assertAttachable(tx, me.id, otherOf(thread, me.id), c);
    return writeMessage(tx, thread, me, actor.userId, c, false);
  });
}

/** Accept or decline a request (the receiver only; anyone else 404; a second accept 409 / 404). */
export async function moveUstaadThread(
  db: Tx,
  actor: UstaadActor,
  threadId: string,
  action: 'accept' | 'decline',
): Promise<{ status: UstaadThreadStatus }> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    const thread = await myThread(tx, me.id, threadId);
    if (thread.status !== 'requested' || thread.requestedBy === me.id)
      throw new NotFoundError('Conversation not found');
    if (action === 'accept') await assertCounterpartReachable(tx, thread, me.id);
    const moved = await moveThread(
      tx,
      thread,
      action === 'accept' ? 'open' : 'declined',
      actor.userId,
      me.id,
    );
    if (action === 'accept')
      await tx
        .update(ustaadThreadMembers)
        .set({ lastReadAt: sql`now()` })
        .where(and(eq(ustaadThreadMembers.threadId, thread.id), eq(ustaadThreadMembers.memberId, me.id)));
    return { status: moved.status as UstaadThreadStatus };
  });
}

/** Read receipt: everything up to now is read by the caller. */
export async function markUstaadThreadRead(
  db: Tx,
  actor: UstaadActor,
  threadId: string,
): Promise<{ ok: true }> {
  const me = await ustaadActingMember(db, actor.memberId);
  await myThread(db, me.id, threadId);
  await db
    .insert(ustaadThreadMembers)
    .values({ threadId, memberId: me.id, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [ustaadThreadMembers.threadId, ustaadThreadMembers.memberId],
      set: { lastReadAt: sql`now()` },
    });
  return { ok: true };
}

/** Per-thread mute (no notices from this thread). */
export async function muteUstaadThread(
  db: Tx,
  actor: UstaadActor,
  threadId: string,
  muted: boolean,
): Promise<{ muted: boolean }> {
  const me = await ustaadActingMember(db, actor.memberId);
  await myThread(db, me.id, threadId);
  await db
    .insert(ustaadThreadMembers)
    .values({ threadId, memberId: me.id, muted })
    .onConflictDoUpdate({
      target: [ustaadThreadMembers.threadId, ustaadThreadMembers.memberId],
      set: { muted },
    });
  return { muted };
}

async function threadViews(tx: Tx, me: string, rows: ThreadRow[]): Promise<ThreadView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const sides = await tx
    .select()
    .from(ustaadThreadMembers)
    .where(and(inArray(ustaadThreadMembers.threadId, ids), eq(ustaadThreadMembers.memberId, me)));
  const side = new Map(sides.map((x) => [x.threadId, x]));
  const cards = await ustaadMemberCards(
    tx,
    rows.map((r) => otherOf(r, me)),
  );
  // The last message the caller may see per thread (one indexed pass on thread_id + created_at; held ones only for
  // their sender, deleted never), for the inbox row's preview.
  const lastRows = await tx
    .selectDistinctOn([ustaadMessages.threadId], {
      threadId: ustaadMessages.threadId,
      kind: ustaadMessages.kind,
      body: ustaadMessages.body,
      mediaId: ustaadMessages.mediaId,
      senderId: ustaadMessages.senderId,
    })
    .from(ustaadMessages)
    .where(
      and(
        inArray(ustaadMessages.threadId, ids),
        isNull(ustaadMessages.deletedAt),
        or(isNull(ustaadMessages.heldReasonCode), eq(ustaadMessages.senderId, me)),
      ),
    )
    .orderBy(ustaadMessages.threadId, desc(ustaadMessages.createdAt), desc(ustaadMessages.id));
  const lastVoices = await ustaadMediaTextInfo(
    tx,
    lastRows.flatMap((m) => (m.kind === 'voice' && m.mediaId ? [m.mediaId] : [])),
  );
  const lastOf = new Map(lastRows.map((m) => [m.threadId, m]));
  const out: ThreadView[] = [];
  for (const r of rows) {
    const other = cards.get(otherOf(r, me));
    if (!other) continue;
    const lm = lastOf.get(r.id);
    const mine = side.get(r.id);
    const unread =
      r.lastMessageAt !== null &&
      (mine?.lastReadAt === null || mine?.lastReadAt === undefined || r.lastMessageAt > mine.lastReadAt);
    out.push({
      id: r.id,
      status: r.status as UstaadThreadStatus,
      mine: r.requestedBy === me,
      other,
      muted: mine?.muted ?? false,
      unread,
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
      last: lm
        ? {
            kind: lm.kind as MessageView['kind'],
            text: lm.kind === 'text' && lm.body ? Array.from(lm.body).slice(0, 80).join('') : null,
            durationMs: lm.mediaId ? (lastVoices.get(lm.mediaId)?.durationMs ?? null) : null,
            mine: lm.senderId === me,
          }
        : null,
    });
  }
  return out;
}

/** Inbox (open), requests to me, or my requests waiting; newest activity first; blocked pairs never listed. */
export async function listUstaadThreads(
  db: Tx,
  actor: UstaadActor,
  q: ThreadListQuery,
): Promise<{ items: ThreadView[]; nextCursor: string | null }> {
  const me = await ustaadActingMember(db, actor.memberId);
  const box =
    q.box === 'inbox'
      ? eq(ustaadThreads.status, 'open')
      : q.box === 'requests'
        ? and(eq(ustaadThreads.status, 'requested'), sql`${ustaadThreads.requestedBy} <> ${me.id}`)
        : and(eq(ustaadThreads.status, 'requested'), eq(ustaadThreads.requestedBy, me.id));
  const at = sql`coalesce(${ustaadThreads.lastMessageAt}, ${ustaadThreads.createdAt})`;
  const cur = decodeUstaadCursor(q.cursor);
  const rows = await db
    .select()
    .from(ustaadThreads)
    .where(
      and(
        or(eq(ustaadThreads.lowId, me.id), eq(ustaadThreads.highId, me.id)),
        box,
        or(eq(ustaadThreads.requestedBy, me.id), receiverCanSee(sql`${ustaadThreads.id}`)),
        sql`not exists (select 1 from ustaad_blocks bl where (bl.member_id = ${ustaadThreads.lowId} and bl.target_id = ${ustaadThreads.highId}) or (bl.member_id = ${ustaadThreads.highId} and bl.target_id = ${ustaadThreads.lowId}))`,
        cur
          ? sql`(${at}, ${ustaadThreads.id}) < (${cur.at.toISOString()}::timestamptz, ${cur.id})`
          : undefined,
      ),
    )
    .orderBy(desc(at), desc(ustaadThreads.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return {
    items: await threadViews(db, me.id, page),
    nextCursor:
      rows.length > PAGE && last ? encodeUstaadCursor(last.lastMessageAt ?? last.createdAt, last.id) : null,
  };
}

/** One thread with its messages, newest first (30 a page). Held messages show only to their sender, as pending. */
export async function ustaadThreadMessages(
  db: Tx,
  actor: UstaadActor,
  threadId: string,
  q: { cursor?: string | undefined },
): Promise<{ thread: ThreadView; items: MessageView[]; nextCursor: string | null }> {
  const me = await ustaadActingMember(db, actor.memberId);
  const thread = await myThread(db, me.id, threadId);
  if (thread.status === 'declined' && thread.requestedBy === me.id)
    throw new NotFoundError('Conversation not found');
  const [view] = await threadViews(db, me.id, [thread]);
  if (!view) throw new NotFoundError('Conversation not found');
  const [otherSide] = await db
    .select({ lastReadAt: ustaadThreadMembers.lastReadAt })
    .from(ustaadThreadMembers)
    .where(
      and(
        eq(ustaadThreadMembers.threadId, thread.id),
        eq(ustaadThreadMembers.memberId, otherOf(thread, me.id)),
      ),
    );
  const cur = decodeUstaadCursor(q.cursor);
  const rows = await db
    .select()
    .from(ustaadMessages)
    .where(
      and(
        eq(ustaadMessages.threadId, thread.id),
        isNull(ustaadMessages.deletedAt),
        or(isNull(ustaadMessages.heldReasonCode), eq(ustaadMessages.senderId, me.id)),
        cur
          ? or(
              lt(ustaadMessages.createdAt, cur.at),
              and(eq(ustaadMessages.createdAt, cur.at), lt(ustaadMessages.id, cur.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(ustaadMessages.createdAt), desc(ustaadMessages.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const readUntil = otherSide?.lastReadAt ?? null;
  const voices = await ustaadMediaTextInfo(
    db,
    page.flatMap((m) => (m.kind === 'voice' && m.mediaId ? [m.mediaId] : [])),
  );
  const items: MessageView[] = page.map((m) => ({
    id: m.id,
    mine: m.senderId === me.id,
    kind: m.kind as MessageView['kind'],
    text: m.body,
    mediaId: m.mediaId,
    voice: voiceInfoOf(m.mediaId ? voices.get(m.mediaId) : undefined),
    postId: m.postId,
    pending: m.heldReasonCode !== null,
    read: m.senderId === me.id && readUntil !== null && m.createdAt <= readUntil,
    createdAt: m.createdAt.toISOString(),
  }));
  const last = page[page.length - 1];
  return {
    thread: view,
    items,
    nextCursor: rows.length > PAGE && last ? encodeUstaadCursor(last.createdAt, last.id) : null,
  };
}

/**
 * Report hook for workstream F2: the message a member reports must be in a thread they are part of (404 otherwise).
 * F2 creates the `ustaad_reports` row (`target_type = 'message'`, `target_id` = the message id) with this answer.
 */
export async function ustaadMessageReportTarget(
  tx: Tx,
  reporterMemberId: string,
  messageId: string,
): Promise<{ threadId: string; senderId: string }> {
  const [row] = await tx
    .select({ threadId: ustaadMessages.threadId, senderId: ustaadMessages.senderId })
    .from(ustaadMessages)
    .innerJoin(ustaadThreads, eq(ustaadThreads.id, ustaadMessages.threadId))
    .where(
      and(
        eq(ustaadMessages.id, messageId),
        or(eq(ustaadThreads.lowId, reporterMemberId), eq(ustaadThreads.highId, reporterMemberId)),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Message not found');
  return row;
}

/**
 * The only staff path to message content (SR-38): an open or in-review report on a message of the thread, in a city
 * the staff member covers (`cityIds` null = all cities), with a reason code. Every read writes `audit_log`
 * (`ustaad.dm_read`) and a pseudonymous event. Anything else is 404.
 */
export async function staffReadUstaadThread(
  db: Tx,
  staff: { userId: string; cityIds: readonly string[] | null },
  q: StaffThreadReadQuery,
): Promise<StaffThreadView> {
  return db.transaction(async (tx) => {
    const [report] = await tx
      .select()
      .from(ustaadReports)
      .where(
        and(
          eq(ustaadReports.code, q.reportCode),
          eq(ustaadReports.targetType, 'message'),
          inArray(ustaadReports.status, ['open', 'in_review']),
        ),
      )
      .limit(1);
    if (!report) throw new NotFoundError('Report not found');
    if (staff.cityIds !== null && (report.cityId === null || !staff.cityIds.includes(report.cityId)))
      throw new NotFoundError('Report not found');
    const [msg] = await tx
      .select({ threadId: ustaadMessages.threadId })
      .from(ustaadMessages)
      .where(eq(ustaadMessages.id, report.targetId))
      .limit(1);
    if (!msg) throw new NotFoundError('Report not found');
    const [thread] = await tx.select().from(ustaadThreads).where(eq(ustaadThreads.id, msg.threadId)).limit(1);
    if (!thread) throw new NotFoundError('Report not found');
    const members = await tx
      .select({ id: ustaadMembers.id, displayName: ustaadMembers.displayName, handle: ustaadMembers.handle })
      .from(ustaadMembers)
      .where(inArray(ustaadMembers.id, [thread.lowId, thread.highId]));
    const messages = await tx
      .select()
      .from(ustaadMessages)
      .where(eq(ustaadMessages.threadId, thread.id))
      .orderBy(asc(ustaadMessages.createdAt))
      .limit(500);
    await tx.insert(auditLog).values({
      actorUserId: staff.userId,
      actorRole: 'staff',
      action: 'ustaad.dm_read',
      entity: 'ustaad_thread',
      entityId: thread.id,
      after: { reportCode: report.code, messages: messages.length },
      reason: q.reason,
    });
    await recordUstaadEvent(
      tx,
      {
        entityType: 'message_thread',
        entityId: thread.id,
        kind: 'staff_read',
        reasonCode: q.reason,
        actorId: staff.userId,
        actorRole: 'staff',
        cityId: report.cityId,
        props: { reportId: report.id },
      },
      {
        name: 'ustaad_dm_read_by_staff',
        memberId: null,
        userId: staff.userId,
        props: { threadId: thread.id, reason: q.reason },
      },
    );
    return {
      threadId: thread.id,
      status: thread.status as UstaadThreadStatus,
      members,
      messages: messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        kind: m.kind as MessageView['kind'],
        text: m.body,
        mediaId: m.mediaId,
        postId: m.postId,
        held: m.heldReasonCode !== null,
        deleted: m.deletedAt !== null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}
