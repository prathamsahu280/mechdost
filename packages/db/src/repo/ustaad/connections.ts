/**
 * Connect (spec 23 § 4 flow 7, § 6.2, § 7.9; workstream D2): a two-way request the other member accepts or ignores.
 * One row per ordered pair (unique `(low_id, high_id)`, stronger than a partial "one pending" index): a first request
 * inserts with `ON CONFLICT DO NOTHING`, a later one is a conditional UPDATE on the existing row
 * (`machine.assert` + `(id, status, version)`). Crossed requests (both ask) become one accepted connection. A member
 * whose request was declined or withdrawn waits `limits.connect_cooldown_days` before asking again (no pestering); the
 * one who declined may ask at once. Requests are capped by `limits.connect_requests_per_day` (atomic daily counter);
 * restricted members cannot ask. Blocked either
 * way = 404 (SR-35).
 */
import { and, desc, eq, lt, ne, or, sql } from 'drizzle-orm';
import { ustaadConnectionMachine, type UstaadConnectionStatus } from '@mechdost/shared/state';
import type { ConnectionListQuery, ConnectionView } from '@mechdost/shared/ustaad/dto/social';
import { orderedPair } from '@mechdost/shared/ustaad/social-rules';
import { ustaadConnections, ustaadMembers } from '../../schema';
import { ConflictError, DailyCapError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import {
  bumpUstaadDailyCounter,
  decodeUstaadCursor,
  encodeUstaadCursor,
  ustaadActingMember,
  ustaadMemberCards,
  ustaadNotBlockedSql,
  ustaadVisibleMember,
} from './graph-common';
import { notifyUstaad } from './notify';
import { assertUstaadMemberCanWrite, type UstaadActor } from './qa';
import { readUstaadSettingValues } from './settings';

type ConnectionRow = typeof ustaadConnections.$inferSelect;
export type UstaadConnectionAction = 'accept' | 'decline' | 'ignore' | 'withdraw' | 'remove';

const PAGE = 20;
const DAY_MS = 86_400_000;

async function moveConnection(
  tx: Tx,
  row: ConnectionRow,
  to: UstaadConnectionStatus,
  actor: { userId: string | null; role: 'member' | 'system' },
  set: Partial<typeof ustaadConnections.$inferInsert> = {},
  reasonCode: string | null = null,
): Promise<ConnectionRow> {
  const from = row.status as UstaadConnectionStatus;
  ustaadConnectionMachine.assert(from, to, actor.role);
  const [moved] = await tx
    .update(ustaadConnections)
    .set({ ...set, status: to })
    .where(
      and(
        eq(ustaadConnections.id, row.id),
        eq(ustaadConnections.status, from),
        eq(ustaadConnections.version, row.version),
      ),
    )
    .returning();
  if (!moved) throw new ConflictError('This request changed, refresh and try again', 'STALE');
  await recordUstaadEvent(
    tx,
    {
      entityType: 'connection',
      entityId: row.id,
      kind: to,
      fromStatus: from,
      toStatus: to,
      reasonCode,
      actorId: actor.userId,
      actorRole: actor.role,
    },
    actor.role === 'member'
      ? {
          name: 'ustaad_connection_changed',
          memberId: null,
          userId: actor.userId,
          props: { connectionId: row.id, to },
        }
      : undefined,
  );
  return moved;
}

async function connected(tx: Tx, row: ConnectionRow, actorUserId: string, acceptorId: string) {
  const otherId = row.requestedBy;
  await recordUstaadEvent(
    tx,
    {
      entityType: 'connection',
      entityId: row.id,
      kind: 'connected',
      actorId: actorUserId,
      actorRole: 'member',
    },
    {
      name: 'ustaad_connected',
      memberId: acceptorId,
      userId: actorUserId,
      props: { memberId: acceptorId, otherId },
    },
  );
  const cards = await tx
    .select({ userId: ustaadMembers.userId })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, otherId))
    .limit(1);
  const [acceptor] = await tx
    .select({ name: ustaadMembers.displayName, nameHi: ustaadMembers.displayNameHi })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, acceptorId))
    .limit(1);
  const to = cards[0];
  if (to && acceptor)
    await notifyUstaad(tx, 'ustaad.connect_accepted', {
      userId: to.userId,
      entityId: row.id,
      version: `accepted-${String(row.version)}`,
      params: (locale) => ({
        memberName: locale === 'hi' ? (acceptor.nameHi ?? acceptor.name) : acceptor.name,
      }),
    });
}

/**
 * Ask to connect. Returns the row's status: `requested`, or `accepted` when the other member had already asked
 * (crossed requests) or the two are already connected. Refuses `USTAAD_SELF_CONNECT` (422),
 * `USTAAD_CONNECT_COOLDOWN` (409) inside the cooldown after a decline or withdraw, `USTAAD_RESTRICTED` (403), `USTAAD_DAILY_CAP` (429), 404 when blocked.
 */
export async function requestUstaadConnection(
  db: Tx,
  actor: UstaadActor,
  targetId: string,
): Promise<{ id: string; status: UstaadConnectionStatus }> {
  if (targetId === actor.memberId) throw new ValidationError('That is you', 'USTAAD_SELF_CONNECT');
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    assertUstaadMemberCanWrite(me);
    const target = await ustaadVisibleMember(tx, me.id, targetId);
    const s = await readUstaadSettingValues(tx, [
      'ustaad.limits.connect_requests_per_day',
      'ustaad.limits.connect_cooldown_days',
    ]);
    const pair = orderedPair(me.id, target.id);
    const [created] = await tx
      .insert(ustaadConnections)
      .values({ ...pair, requestedBy: me.id, status: 'requested' })
      .onConflictDoNothing()
      .returning();
    let row: ConnectionRow;
    if (created) {
      row = created;
      await recordUstaadEvent(tx, {
        entityType: 'connection',
        entityId: row.id,
        kind: 'requested',
        toStatus: 'requested',
        actorId: actor.userId,
        actorRole: 'member',
      });
    } else {
      const [cur] = await tx
        .select()
        .from(ustaadConnections)
        .where(and(eq(ustaadConnections.lowId, pair.lowId), eq(ustaadConnections.highId, pair.highId)))
        .for('update');
      if (!cur) throw new ConflictError('Try again', 'STALE');
      if (cur.status === 'accepted') return { id: cur.id, status: 'accepted' };
      if (cur.status === 'requested' && cur.requestedBy === me.id) return { id: cur.id, status: 'requested' };
      if (cur.status === 'requested') {
        // Crossed requests: the other member asked first, so this is an accept.
        const moved = await moveConnection(tx, cur, 'accepted', { userId: actor.userId, role: 'member' });
        await connected(tx, moved, actor.userId, me.id);
        return { id: moved.id, status: 'accepted' };
      }
      // Cooldown (security review 2026-11-26): after this member's request was declined or withdrawn (or the
      // connection removed), the same requester waits `limits.connect_cooldown_days`; the other member may ask now.
      const coolMs = Number(s['ustaad.limits.connect_cooldown_days']) * DAY_MS;
      if (cur.requestedBy === me.id && Date.now() - cur.updatedAt.getTime() < coolMs)
        throw new ConflictError('You can ask this member again later', 'USTAAD_CONNECT_COOLDOWN');
      row = await moveConnection(
        tx,
        cur,
        'requested',
        { userId: actor.userId, role: 'member' },
        { requestedBy: me.id },
      );
    }
    // Atomic daily cap on new requests (security review): a refusal rolls the request back.
    if (
      !(await bumpUstaadDailyCounter(
        tx,
        me.id,
        'connect_requests',
        1,
        Number(s['ustaad.limits.connect_requests_per_day']),
      ))
    )
      throw new DailyCapError('You have sent enough requests for today', 'USTAAD_DAILY_CAP');
    // One notice per pair and requester, ever: request → withdraw → request loops cannot spam the receiver.
    await notifyUstaad(tx, 'ustaad.connect_request', {
      userId: target.userId,
      entityId: row.id,
      version: `req-${me.id}`,
      params: (locale) => ({
        memberName: locale === 'hi' ? (me.displayNameHi ?? me.displayName) : me.displayName,
      }),
    });
    return { id: row.id, status: 'requested' };
  });
}

/**
 * Accept / decline (`ignore`) by the receiver, withdraw by the requester, remove by either once connected. Anyone else,
 * or a move from the wrong side, gets 404 (no oracle); a lost race gets 409 `STALE`.
 */
export async function moveUstaadConnection(
  db: Tx,
  actor: UstaadActor,
  connectionId: string,
  action: UstaadConnectionAction,
): Promise<{ id: string; status: UstaadConnectionStatus }> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    const [row] = await tx
      .select()
      .from(ustaadConnections)
      .where(
        and(
          eq(ustaadConnections.id, connectionId),
          or(eq(ustaadConnections.lowId, me.id), eq(ustaadConnections.highId, me.id)),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError('Request not found');
    const receiver = row.requestedBy !== me.id;
    const by = { userId: actor.userId, role: 'member' as const };
    if (
      (action === 'accept' || action === 'decline' || action === 'ignore') &&
      row.status === 'requested' &&
      receiver
    ) {
      if (action === 'accept') {
        const otherId = row.lowId === me.id ? row.highId : row.lowId;
        await ustaadVisibleMember(tx, me.id, otherId);
        const moved = await moveConnection(tx, row, 'accepted', by);
        await connected(tx, moved, actor.userId, me.id);
        return { id: moved.id, status: 'accepted' };
      }
      return {
        id: row.id,
        status: (await moveConnection(tx, row, 'declined', by)).status as UstaadConnectionStatus,
      };
    }
    if (action === 'withdraw' && row.status === 'requested' && !receiver)
      return {
        id: row.id,
        status: (await moveConnection(tx, row, 'removed', by, {}, 'withdrawn'))
          .status as UstaadConnectionStatus,
      };
    if (action === 'remove' && row.status === 'accepted')
      return {
        id: row.id,
        status: (await moveConnection(tx, row, 'removed', by, {}, 'removed'))
          .status as UstaadConnectionStatus,
      };
    throw new NotFoundError('Request not found');
  });
}

/** Inside a block (same transaction): the pair's connection becomes `removed` (system). */
export async function removeUstaadConnectionForBlock(
  tx: Tx,
  a: string,
  b: string,
  actorUserId: string,
): Promise<void> {
  const pair = orderedPair(a, b);
  const [row] = await tx
    .select()
    .from(ustaadConnections)
    .where(and(eq(ustaadConnections.lowId, pair.lowId), eq(ustaadConnections.highId, pair.highId)))
    .for('update');
  if (row && (row.status === 'requested' || row.status === 'accepted'))
    await moveConnection(tx, row, 'removed', { userId: actorUserId, role: 'system' }, {}, 'blocked');
}

/** My connections (`connected`), requests to me (`incoming`) or from me (`outgoing`); newest change first. */
export async function listUstaadConnections(
  db: Tx,
  actor: UstaadActor,
  q: ConnectionListQuery,
): Promise<{ items: ConnectionView[]; nextCursor: string | null }> {
  const me = await ustaadActingMember(db, actor.memberId);
  const mine = or(eq(ustaadConnections.lowId, me.id), eq(ustaadConnections.highId, me.id)) ?? sql`false`;
  const box =
    q.box === 'connected'
      ? eq(ustaadConnections.status, 'accepted')
      : q.box === 'incoming'
        ? and(eq(ustaadConnections.status, 'requested'), ne(ustaadConnections.requestedBy, me.id))
        : and(eq(ustaadConnections.status, 'requested'), eq(ustaadConnections.requestedBy, me.id));
  const other = sql`case when ${ustaadConnections.lowId} = ${me.id} then ${ustaadConnections.highId} else ${ustaadConnections.lowId} end`;
  const cur = decodeUstaadCursor(q.cursor);
  const rows = await db
    .select()
    .from(ustaadConnections)
    .where(
      and(
        mine,
        box,
        ustaadNotBlockedSql(me.id, other),
        cur
          ? or(
              lt(ustaadConnections.updatedAt, cur.at),
              and(eq(ustaadConnections.updatedAt, cur.at), lt(ustaadConnections.id, cur.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(ustaadConnections.updatedAt), desc(ustaadConnections.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const cards = await ustaadMemberCards(
    db,
    page.map((r) => (r.lowId === me.id ? r.highId : r.lowId)),
  );
  const items: ConnectionView[] = [];
  for (const r of page) {
    const card = cards.get(r.lowId === me.id ? r.highId : r.lowId);
    if (card)
      items.push({
        id: r.id,
        status: r.status as UstaadConnectionStatus,
        mine: r.requestedBy === me.id,
        other: card,
        updatedAt: r.updatedAt.toISOString(),
      });
  }
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > PAGE && last ? encodeUstaadCursor(last.updatedAt, last.id) : null,
  };
}
