import { sql } from 'drizzle-orm';
import { parseLiveTopic, type LiveEvent, type LiveKind, type LivePing } from '@mechdost/shared/live';
import type { Permission } from '@mechdost/shared/rbac';
import type { Tx } from './orders';

/**
 * Live-update relay storage (decision 2026-11-01). Triggers fill `live_outbox` inside business transactions
 * (migration 0014); the relay in the worker:
 *   1. claims a batch with `FOR UPDATE SKIP LOCKED` (parallel relays never take the same rows; a crashed relay's
 *      claim expires after the lease and is retried — at-least-once, clients drop duplicates by version),
 *   2. resolves recipients **from Postgres** (customers, shop staff, city staff) — clients never choose topics,
 *   3. publishes thin pings to the transport, then marks the rows sent.
 * Each step is a short statement; nothing holds a transaction open while talking to the transport.
 */
export interface LiveRow {
  id: number;
  topic: string;
  ping: LivePing;
}

export interface LiveRecipient {
  userId: string;
  firebaseUid: string;
}

interface ClaimedRow {
  id: number | string;
  topic: string;
  kind: string;
  entity_id: string;
  entity_version: number;
  event: string;
  created_at: Date | string;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

export async function claimLiveBatch(
  db: Tx,
  opts: { limit?: number; leaseSeconds?: number } = {},
): Promise<LiveRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const lease = Math.min(Math.max(opts.leaseSeconds ?? 30, 5), 600);
  const result = await db.execute(sql`
    update live_outbox set claimed_at = now(), attempts = attempts + 1
    where id in (
      select id from live_outbox
      where sent_at is null
        and (claimed_at is null or claimed_at < now() - make_interval(secs => ${lease}))
      order by id
      limit ${limit}
      for update skip locked
    )
    returning id, topic, kind, entity_id, entity_version, event, created_at`);
  return rowsOf<ClaimedRow>(result)
    .map((r) => ({
      id: Number(r.id),
      topic: r.topic,
      ping: {
        e: r.event as LiveEvent,
        k: r.kind as LiveKind,
        id: r.entity_id,
        v: r.entity_version,
        at: new Date(r.created_at).toISOString(),
      },
    }))
    .sort((a, b) => a.id - b.id);
}

export async function markLiveSent(db: Tx, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(
    sql`update live_outbox set sent_at = now() where id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}) and sent_at is null`,
  );
}

/** Sent rows are kept 24 h for debugging, then purged (hard rule 16: the history lives in `*_events`). */
export async function purgeSentLive(db: Tx, olderThanHours = 24): Promise<number> {
  const result = await db.execute(
    sql`delete from live_outbox where sent_at is not null and sent_at < now() - make_interval(hours => ${olderThanHours}) returning id`,
  );
  return rowsOf(result).length;
}

/** Health: age of the oldest unsent ping (alert when > 5 s; research/realtime-alternatives.md §9). */
export async function oldestPendingLiveMs(db: Tx): Promise<number> {
  const result = await db.execute(
    sql`select coalesce(extract(epoch from now() - min(created_at)) * 1000, 0)::float8 as age from live_outbox where sent_at is null`,
  );
  return Number(rowsOf<{ age: number | string }>(result)[0]?.age ?? 0);
}

/**
 * Staff who hold `permission` (through any role, including custom DB roles) for the city: least privilege, the
 * same permission the API checks when the client refetches. Partner-scoped grants (shop/workshop) never count.
 */
const STAFF_WITH = (permission: Permission, cityId: ReturnType<typeof sql>) => sql`
  select u.id as user_id, u.firebase_uid from user_roles ur
  join role_permissions rp on rp.role_id = ur.role_id and rp.permission_key = ${permission}
  join users u on u.id = ur.user_id
  where ur.shop_id is null and ur.workshop_id is null
    and (ur.city_id is null or ur.city_id = (${cityId}))
    and u.status = 'active'`;

/**
 * Who may see a topic, from Postgres only. Order: its customer, the shop holding an active offer or acceptance,
 * and city (or all-city) staff holding `orders:read`. Shop: its users and city staff holding `partners:read`. Unknown topics resolve
 * to nobody (fail closed).
 */
export async function resolveLiveRecipients(db: Tx, topic: string): Promise<LiveRecipient[]> {
  const parsed = parseLiveTopic(topic);
  if (!parsed) return [];
  let query;
  if (parsed.kind === 'order') {
    const orderId = parsed.id;
    query = sql`
      select u.id as user_id, u.firebase_uid from orders o join users u on u.id = o.user_id
        where o.id = ${orderId} and u.status = 'active'
      union
      select u.id, u.firebase_uid from order_assignments a
        join shop_users su on su.shop_id = a.shop_id
        join users u on u.id = su.user_id
        where a.order_id = ${orderId} and a.status in ('offered','accepted') and u.status = 'active'
      union
      ${STAFF_WITH('orders:read', sql`select city_id from orders where id = ${orderId}`)}`;
  } else if (parsed.kind === 'shop') {
    const shopId = parsed.id;
    query = sql`
      select u.id as user_id, u.firebase_uid from shop_users su join users u on u.id = su.user_id
        where su.shop_id = ${shopId} and u.status = 'active'
      union
      ${STAFF_WITH('partners:read', sql`select city_id from shops where id = ${shopId}`)}`;
  } else if (parsed.kind === 'user') {
    query = sql`select id as user_id, firebase_uid from users where id = ${parsed.id} and status = 'active'`;
  } else if (parsed.kind === 'staff_city') {
    query = STAFF_WITH('orders:read', sql`${parsed.id}::uuid`);
  } else {
    // workshop / quote topics resolve once their tables carry membership (Phase 2); fail closed until then.
    return [];
  }
  const rows = rowsOf<{ user_id: string; firebase_uid: string }>(await db.execute(query));
  const seen = new Set<string>();
  const out: LiveRecipient[] = [];
  for (const r of rows) {
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    out.push({ userId: r.user_id, firebaseUid: r.firebase_uid });
  }
  return out;
}

/**
 * Pending inbox wipes (lost access, migration 0020). Claimed with SKIP LOCKED; a crashed relay's rows come back
 * after 60 s. Wiping is idempotent, so at-least-once is enough.
 */
export async function claimLiveRevocations(
  db: Tx,
  limit = 100,
): Promise<{ id: number; firebaseUid: string }[]> {
  const result = await db.execute(sql`
    update live_revocations set attempts = attempts + 1
    where id in (
      select id from live_revocations
      where done_at is null and (attempts = 0 or created_at < now() - interval '60 seconds')
      order by id
      limit ${Math.min(Math.max(limit, 1), 1000)}
      for update skip locked
    )
    returning id, firebase_uid`);
  return rowsOf<{ id: number | string; firebase_uid: string }>(result).map((r) => ({
    id: Number(r.id),
    firebaseUid: r.firebase_uid,
  }));
}

export async function markLiveRevocationsDone(db: Tx, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(
    sql`update live_revocations set done_at = now() where id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  await db.execute(sql`delete from live_revocations where done_at < now() - interval '7 days'`);
}
