import { sql } from 'drizzle-orm';
import { parseLiveTopic, type LiveEvent, type LiveKind, type LivePing } from '@mechdost/shared/live';
import type { Permission } from '@mechdost/shared/rbac';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

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

/** A ping is a hint (clients also poll): after this many tries it is dropped, not retried forever (review low). */
export const LIVE_MAX_ATTEMPTS = 20;

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
      where sent_at is null and attempts < ${LIVE_MAX_ATTEMPTS}
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
    sql`delete from live_outbox
      where (sent_at is not null and sent_at < now() - make_interval(hours => ${olderThanHours}))
        or (sent_at is null and created_at < now() - make_interval(hours => ${olderThanHours}))
      returning id`,
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
export const STAFF_WITH = (permission: Permission, cityId: ReturnType<typeof sql>) => sql`
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
  } else if (parsed.kind === 'quote') {
    // A bulk quote (spec 19): its customer and the city's staff who can read quotes.
    const quoteId = parsed.id;
    query = sql`
      select u.id as user_id, u.firebase_uid from quote_requests q join users u on u.id = q.user_id
        where q.id = ${quoteId} and u.status = 'active'
      union
      select staff.user_id, staff.firebase_uid
        from (${STAFF_WITH('quotes:read', sql`select city_id from quote_requests where id = ${quoteId}`)}) staff
        -- An id that is no quote resolves to nobody (an all-city grant would otherwise match a null city).
        where exists (select 1 from quote_requests where id = ${quoteId})`;
  } else if (parsed.kind === 'request') {
    // A service request (design 2026-11-16): its customer, the users of the workshop holding it, and the city's staff
    // who can read service requests. An id that is no request resolves to nobody (an all-city grant would otherwise
    // match a null city).
    const requestId = parsed.id;
    query = sql`
      select u.id as user_id, u.firebase_uid from service_requests r join users u on u.id = r.user_id
        where r.id = ${requestId} and u.status = 'active'
      union
      select u.id, u.firebase_uid from service_requests r
        join user_roles ur on ur.workshop_id = r.workshop_id
        join users u on u.id = ur.user_id
        where r.id = ${requestId} and r.workshop_id is not null and u.status = 'active'
      union
      select staff.user_id, staff.firebase_uid
        from (${STAFF_WITH('service:read', sql`select city_id from service_requests where id = ${requestId}`)}) staff
        where exists (select 1 from service_requests where id = ${requestId})`;
  } else {
    // workshop topics resolve once their tables carry membership (Phase 2); fail closed until then.
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
 * Pending inbox wipes (lost access, migrations 0020/0022/0023). Each wipe runs **twice**: once at once, and again
 * `REWIPE_SECONDS` after that first pass (`wiped_at`, not `created_at`: a relay that was down must not run both
 * passes back to back), longer than the relay's 30 s outbox lease and its 20 s publish cap, so a ping a relay
 * resolved just before the access change and published just after the first wipe is removed too (security review
 * 2026-11-03). Claimed with SKIP LOCKED; wiping is idempotent.
 */
export const REWIPE_SECONDS = 120;

export interface LiveRevocation {
  id: number;
  firebaseUid: string;
  /** Null = whole inbox; otherwise one node (`order~uuid` / `assignment~uuid`). */
  node: string | null;
  /** Passes including this one; the row is done once it reaches 2. */
  attempts: number;
}

export async function claimLiveRevocations(db: Tx, limit = 100): Promise<LiveRevocation[]> {
  const result = await db.execute(sql`
    update live_revocations set attempts = attempts + 1, wiped_at = now()
    where id in (
      select id from live_revocations
      where done_at is null
        and (attempts = 0 or coalesce(wiped_at, created_at) < now() - make_interval(secs => ${REWIPE_SECONDS}))
      order by id
      limit ${Math.min(Math.max(limit, 1), 1000)}
      for update skip locked
    )
    returning id, firebase_uid, node, attempts`);
  return rowsOf<{
    id: number | string;
    firebase_uid: string;
    node: string | null;
    attempts: number | string;
  }>(result).map((r) => ({
    id: Number(r.id),
    firebaseUid: r.firebase_uid,
    node: r.node,
    attempts: Number(r.attempts),
  }));
}

/** Marks wipes that have had their second pass as done; purges done rows after 7 days. */
export async function markLiveRevocationsDone(db: Tx, rows: readonly LiveRevocation[]): Promise<void> {
  const done = rows.filter((r) => r.attempts >= 2).map((r) => r.id);
  if (done.length > 0) {
    await db.execute(
      sql`update live_revocations set done_at = now() where id in (${sql.join(
        done.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }
  await db.execute(sql`delete from live_revocations where done_at < now() - interval '7 days'`);
}

/**
 * A publish that timed out may still land in Firebase later (the cap stops our wait, not the write). Every wipe
 * from the last day that concerns one of that batch's recipients is therefore re-armed for another full pass
 * REWIPE_SECONDS from now (security review 2026-11-03).
 */
export async function rearmRevocationsFor(db: Tx, firebaseUids: readonly string[]): Promise<number> {
  if (firebaseUids.length === 0) return 0;
  const result = await db.execute(sql`
    update live_revocations
    set done_at = null, attempts = least(attempts, 1), wiped_at = now()
    where created_at > now() - interval '1 day'
      and firebase_uid in (${sql.join(
        [...new Set(firebaseUids)].map((uid) => sql`${uid}`),
        sql`, `,
      )})
    returning id`);
  return rowsOf(result).length;
}
