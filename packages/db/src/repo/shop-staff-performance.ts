import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { SHOP_PAYOUT_ENTRY_KINDS, type ShopPayoutEntryKind } from '@mechdost/shared/coins';
import { SHOP_ON_TIME_HOURS } from '@mechdost/shared/shop-performance';
import {
  emptyStaffCounts,
  staffMetricsOf,
  type ShopStaffPerformanceDto,
  type StaffCounts,
  type StaffPerformanceWindow,
} from '@mechdost/shared/shop-staff-performance';
import { shops, shopStaffInvites, shopUsers, users } from '../schema';
import { NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * Shop staff performance and earnings (design 2026-11-16; spec 07). For one shop over 30 or 90 IST days (the window
 * starts at midnight IST of its first day): what each person did, from the actor on the order timeline
 * (`order_events`, append-only), and what the payout ledger shows (`shop_payout_entries`, integer paise).
 *
 * Access is decided here from the caller's own grants, never from the request: `workShopIds` are the shops the caller
 * works at, `ownedShopIds` the ones they own. A shop outside `workShopIds` is a 404 (it does not exist for them). The
 * owner gets every member, the shop totals and the ledger; a staff member only their own row (and their own share of
 * the ledger: the orders they delivered), no shop money.
 *
 * Indexed reads, all starting from one shop: assignments by `shop_id`, then the order timeline by `(order_id, id)`;
 * the ledger by `(shop_id, created_at, id)`. Members and totals are merged here from per-person rows.
 */
const IST = 'Asia/Kolkata';

/** Midnight IST of the first of the last `days` IST days, as an instant. */
const sinceOf = (days: number) =>
  sql`((date_trunc('day', now() at time zone ${IST}) - make_interval(days => ${days - 1})) at time zone ${IST})`;

interface ActorRow {
  user_id: string;
  to_status: string;
  n: unknown;
  secs: number[] | null;
}

/** Per person: how often they performed each timeline step on this shop's assignments. */
async function stepCounts(tx: Tx, shopId: string, days: number, only: string | null) {
  const mine = only ? sql`and ev.actor_id = ${only}` : sql``;
  const rows = rowsOf<ActorRow>(
    await tx.execute(sql`
      select ev.actor_id::text as user_id, ev.to_status, count(*) as n,
        array_agg(extract(epoch from ev.created_at - a.offered_at)::int)
          filter (where ev.to_status = 'confirmed') as secs
      from order_assignments a
      join order_events ev on ev.order_id = a.order_id
      where a.shop_id = ${shopId} and a.offered_at >= ${sinceOf(days)}
        and a.status in ('accepted', 'given_up')
        and ev.actor_type = 'shop' and ev.actor_id is not null ${mine}
        and ev.created_at >= a.offered_at
        and (a.given_up_at is null or ev.created_at <= a.given_up_at)
        and (ev.to_status in ('confirmed', 'packed', 'shipped', 'delivered')
          or (ev.to_status = 'needs_rerouting' and ev.from_status = 'confirmed' and a.status = 'given_up'))
      group by ev.actor_id, ev.to_status`),
  );
  const byUser = new Map<string, StaffCounts>();
  const of = (id: string) => {
    let c = byUser.get(id);
    if (!c) {
      c = emptyStaffCounts();
      byUser.set(id, c);
    }
    return c;
  };
  for (const r of rows) {
    const c = of(r.user_id);
    const n = num(r.n);
    if (r.to_status === 'confirmed') {
      c.accepted += n;
      c.acceptSeconds.push(...(r.secs ?? []).map(Number));
    } else if (r.to_status === 'packed') c.packed += n;
    else if (r.to_status === 'shipped') c.handedOver += n;
    else if (r.to_status === 'delivered') c.delivered += n;
    else c.giveUps += n;
  }

  // On time: of the orders a person accepted, those whose hand-over window has ended (or that were handed over), how
  // many were handed over within the window. A give-up is due and never on time (same rule as the shop's score).
  const hours = sql`(${SHOP_ON_TIME_HOURS}::int * interval '1 hour')`;
  for (const r of rowsOf<{ user_id: string; due: unknown; on_time: unknown }>(
    await tx.execute(sql`
      select c.actor_id::text as user_id, count(*) as due,
        count(*) filter (where a.status = 'accepted' and sh.at is not null and sh.at <= a.responded_at + ${hours}) as on_time
      from order_assignments a
      join lateral (
        select ev.actor_id from order_events ev
        where ev.order_id = a.order_id and ev.to_status = 'confirmed' and ev.actor_type = 'shop'
          and ev.actor_id is not null and ev.created_at >= a.offered_at
        order by ev.id limit 1
      ) c on true
      left join lateral (
        select min(ev.created_at) as at from order_events ev
        where ev.order_id = a.order_id and ev.to_status = 'shipped' and ev.created_at >= a.offered_at
      ) sh on a.status = 'accepted'
      where a.shop_id = ${shopId} and a.offered_at >= ${sinceOf(days)}
        and a.status in ('accepted', 'given_up') and a.responded_at is not null ${
          only ? sql`and c.actor_id = ${only}` : sql``
        }
        and (a.status = 'given_up' or sh.at is not null or a.responded_at + ${hours} <= now())
      group by c.actor_id`),
  )) {
    const c = of(r.user_id);
    c.due = num(r.due);
    c.onTime = num(r.on_time);
  }
  return byUser;
}

const sumCounts = (all: Iterable<StaffCounts>): StaffCounts => {
  const t = emptyStaffCounts();
  for (const c of all) {
    t.accepted += c.accepted;
    t.packed += c.packed;
    t.handedOver += c.handedOver;
    t.delivered += c.delivered;
    t.giveUps += c.giveUps;
    t.acceptSeconds.push(...c.acceptSeconds);
    t.due += c.due;
    t.onTime += c.onTime;
  }
  return t;
};

/** Ledger paise on the orders each person delivered (an admin override or an order without a ledger row adds none). */
async function ledgerByDeliverer(tx: Tx, shopId: string, days: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of rowsOf<{ user_id: string; paise: unknown }>(
    await tx.execute(sql`
      select d.actor_id::text as user_id, sum(e.amount_paise) as paise
      from shop_payout_entries e
      join lateral (
        select ev.actor_id from order_events ev
        where ev.order_id = e.order_id and ev.to_status = 'delivered' and ev.actor_type = 'shop'
          and ev.actor_id is not null
        order by ev.id desc limit 1
      ) d on true
      where e.shop_id = ${shopId} and e.created_at >= ${sinceOf(days)}
      group by d.actor_id`),
  ))
    out.set(r.user_id, num(r.paise));
  return out;
}

async function shopEarnings(tx: Tx, shopId: string, days: number) {
  const rows = rowsOf<{ day: string; kind: string; paise: unknown; n: unknown }>(
    await tx.execute(sql`
      select to_char(e.created_at at time zone ${IST}, 'YYYY-MM-DD') as day, e.kind,
        sum(e.amount_paise) as paise, count(*) as n
      from shop_payout_entries e
      where e.shop_id = ${shopId} and e.created_at >= ${sinceOf(days)}
      group by 1, 2`),
  );
  const kinds = new Map<ShopPayoutEntryKind, { paise: number; entries: number }>();
  const dayTotals = new Map<string, number>();
  let totalPaise = 0;
  for (const r of rows) {
    const kind = SHOP_PAYOUT_ENTRY_KINDS.find((k) => k === r.kind);
    if (!kind) continue;
    const paise = num(r.paise);
    totalPaise += paise;
    const k = kinds.get(kind) ?? { paise: 0, entries: 0 };
    k.paise += paise;
    k.entries += num(r.n);
    kinds.set(kind, k);
    dayTotals.set(r.day, (dayTotals.get(r.day) ?? 0) + paise);
  }
  return {
    totalPaise,
    byKind: SHOP_PAYOUT_ENTRY_KINDS.filter((k) => kinds.has(k)).map((kind) => ({
      kind,
      paise: kinds.get(kind)?.paise ?? 0,
      entries: kinds.get(kind)?.entries ?? 0,
    })),
    byDay: [...dayTotals.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([day, paise]) => ({ day, paise })),
  };
}

export async function getShopStaffPerformance(
  db: Tx,
  input: {
    shopId: string;
    ownedShopIds: readonly string[];
    workShopIds: readonly string[];
    userId: string;
    days: StaffPerformanceWindow;
  },
): Promise<ShopStaffPerformanceDto> {
  if (!input.workShopIds.includes(input.shopId)) throw new NotFoundError('Shop not found');
  const [shop] = await db.select({ cityId: shops.cityId }).from(shops).where(eq(shops.id, input.shopId));
  if (!shop) throw new NotFoundError('Shop not found');
  const owner = input.ownedShopIds.includes(input.shopId);
  const only = owner ? null : input.userId;
  const { days } = input;

  const memberRows = await db
    .select({ userId: shopUsers.userId, role: shopUsers.role })
    .from(shopUsers)
    .where(and(eq(shopUsers.shopId, input.shopId), only ? eq(shopUsers.userId, only) : undefined))
    .orderBy(asc(shopUsers.role), asc(shopUsers.createdAt), asc(shopUsers.id));
  // A helper is shown under the name the owner typed in the invite, never the account's own name (privacy).
  const ids = memberRows.map((m) => m.userId);
  const typed =
    ids.length === 0
      ? []
      : await db
          .select({ usedBy: shopStaffInvites.usedBy, name: shopStaffInvites.name })
          .from(shopStaffInvites)
          .where(
            and(
              eq(shopStaffInvites.shopId, input.shopId),
              eq(shopStaffInvites.status, 'used'),
              inArray(shopStaffInvites.usedBy, ids),
            ),
          );
  const typedName = new Map(typed.map((r) => [r.usedBy, r.name]));
  const ownName =
    ids.length === 0
      ? []
      : await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  const accountName = new Map(ownName.map((r) => [r.id, r.name]));

  const counts = await stepCounts(db, input.shopId, days, only);
  const ledger = await ledgerByDeliverer(db, input.shopId, days);
  const [{ from } = { from: '' }] = rowsOf<{ from: string }>(
    await db.execute(
      sql`select to_char(date_trunc('day', now() at time zone ${IST}) - make_interval(days => ${days - 1}), 'YYYY-MM-DD') as "from"`,
    ),
  );

  const members = memberRows.map((m) => ({
    userId: m.userId,
    name: typedName.get(m.userId) ?? (m.role === 'owner' ? (accountName.get(m.userId) ?? null) : null),
    role: m.role === 'owner' ? ('owner' as const) : ('staff' as const),
    isYou: m.userId === input.userId,
    ...staffMetricsOf(counts.get(m.userId) ?? emptyStaffCounts()),
    deliveredLedgerPaise: ledger.get(m.userId) ?? 0,
  }));
  const dto: ShopStaffPerformanceDto = {
    shopId: input.shopId,
    days,
    from,
    scope: owner ? 'owner' : 'self',
    onTimeHours: SHOP_ON_TIME_HOURS,
    members,
    shop: owner ? staffMetricsOf(sumCounts(counts.values())) : null,
    earnings: owner ? await shopEarnings(db, input.shopId, days) : null,
  };
  await recordServerEvent(db, 'shop_staff_performance_viewed', {
    userId: input.userId,
    cityId: shop.cityId,
    props: { shopId: input.shopId, scope: dto.scope, days },
  });
  return dto;
}
