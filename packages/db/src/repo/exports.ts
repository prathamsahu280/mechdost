import { sql, type SQL } from 'drizzle-orm';
import { maskEmail, maskPhone } from '@mechdost/shared/contact-mask';
import { exportWindow, MAX_EXPORT_ROWS, paiseToRupees, type ExportDataset } from '@mechdost/shared/exports';
import { auditLog } from '../schema';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * CSV export reads (design 2026-11-15 item 4, specs 08/13/14). One SQL statement per dataset, always bounded:
 * an IST window of at most 180 days (the API enforces it), an optional list of city ids, keyset paging on
 * `(created time, id)` over the indexes added in 0066, and the caller's row cap. Times are formatted to IST in SQL,
 * paise leave as exact integers (rupee strings are built by string maths in `paiseToRupees`), phone and email
 * of customers are masked here unless the actor may read them, so the raw values never leave this module for a
 * masked actor. No bank/UPI destination, address text or free text notes are exported.
 */
export interface ExportQuery {
  dataset: ExportDataset;
  /** IST calendar days, YYYY-MM-DD, both inclusive. */
  from: string;
  to: string;
  /** City ids the file may cover; null = every city. Ignored for customers (they have no city). */
  cityIds: readonly string[] | null;
  /** Customers: phone and email masked (true unless the actor holds `customers:read_pii`). */
  maskContacts: boolean;
}

type Col = string | { money: string };

const IST = (col: string) => `to_char(${col} at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS')`;
const UTC_TEXT = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

interface Source {
  columns: readonly Col[];
  /** Select list: the data aliases plus `ct` (cursor time) and `cid` (cursor id). */
  select: SQL;
  from: SQL;
  where: SQL;
  ts: string;
  id: string;
}

function inCities(col: string, ids: readonly string[] | null): SQL {
  if (ids === null) return sql`true`;
  if (ids.length === 0) return sql`false`;
  return sql`${sql.raw(col)} in (${sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  )})`;
}

function source(q: ExportQuery): Source {
  const { start, end } = exportWindow(q.from, q.to);
  const win = (ts: string) =>
    sql`${sql.raw(ts)} >= ${start.toISOString()}::timestamptz and ${sql.raw(ts)} < ${end.toISOString()}::timestamptz`;
  switch (q.dataset) {
    case 'orders':
      return {
        columns: [
          'code',
          'placed_at_ist',
          'city_code',
          'payment_method',
          'payment_status',
          'coins_redeemed',
          { money: 'subtotal' },
          { money: 'discount' },
          { money: 'shipping' },
          { money: 'cod_fee' },
          { money: 'coin_discount' },
          { money: 'total' },
        ],
        select: sql.raw(
          `g.code, ${IST('g.created_at')} as placed_at_ist, c.code as city_code, g.payment_method, g.payment_status,
           g.coins_redeemed::text as coins_redeemed, g.subtotal_paise::text as subtotal, g.discount_paise::text as discount,
           g.shipping_paise::text as shipping, g.cod_fee_paise::text as cod_fee, g.coin_discount_paise::text as coin_discount,
           g.total_paise::text as total, ${UTC_TEXT('g.created_at')} as ct, g.id::text as cid`,
        ),
        from: sql.raw('order_groups g join cities c on c.id = g.city_id'),
        where: sql`${win('g.created_at')} and ${inCities('g.city_id', q.cityIds)}`,
        ts: 'g.created_at',
        id: 'g.id',
      };
    case 'sub_orders':
      return {
        columns: [
          'code',
          'order_code',
          'placed_at_ist',
          'delivered_at_ist',
          'city_code',
          'status',
          'shop_id',
          'pincode',
          'status_reason_code',
          { money: 'subtotal' },
          { money: 'discount' },
          { money: 'shipping' },
          { money: 'cod_fee' },
          { money: 'tax' },
          { money: 'total' },
        ],
        select: sql.raw(
          `o.code, g.code as order_code, ${IST('o.placed_at')} as placed_at_ist, ${IST('o.delivered_at')} as delivered_at_ist,
           c.code as city_code, o.status, o.shop_id::text as shop_id, o.pincode, o.status_reason_code,
           o.subtotal_paise::text as subtotal, o.discount_paise::text as discount, o.shipping_paise::text as shipping,
           o.cod_fee_paise::text as cod_fee, o.tax_paise::text as tax, o.total_paise::text as total,
           ${UTC_TEXT('o.placed_at')} as ct, o.id::text as cid`,
        ),
        from: sql.raw('orders o join order_groups g on g.id = o.group_id join cities c on c.id = o.city_id'),
        where: sql`${win('o.placed_at')} and ${inCities('o.city_id', q.cityIds)}`,
        ts: 'o.placed_at',
        id: 'o.id',
      };
    case 'refunds':
      return {
        columns: [
          'refund_id',
          'order_code',
          'sub_order_code',
          'created_at_ist',
          'settled_at_ist',
          'city_code',
          'status',
          'mode',
          'source',
          'reason_code',
          { money: 'amount' },
        ],
        select: sql.raw(
          `r.id::text as refund_id, g.code as order_code, o.code as sub_order_code, ${IST('r.created_at')} as created_at_ist,
           ${IST('r.settled_at')} as settled_at_ist, c.code as city_code, r.status, r.mode, r.source, r.reason_code,
           r.amount_paise::text as amount, ${UTC_TEXT('r.created_at')} as ct, r.id::text as cid`,
        ),
        from: sql.raw(
          'refunds r join order_groups g on g.id = r.group_id join cities c on c.id = g.city_id left join orders o on o.id = r.order_id',
        ),
        where: sql`${win('r.created_at')} and ${inCities('g.city_id', q.cityIds)}`,
        ts: 'r.created_at',
        id: 'r.id',
      };
    case 'service_requests':
      return {
        columns: [
          'code',
          'created_at_ist',
          'completed_at_ist',
          'city_code',
          'status',
          'status_reason_code',
          'routing_mode',
          'service_mode',
          'vehicle_type',
          'workshop_id',
          'pincode',
          'preferred_date',
          'preferred_slot',
          'pickup_requested',
          { money: 'visit_fee' },
        ],
        select: sql.raw(
          `sr.code, ${IST('sr.created_at')} as created_at_ist, ${IST('sr.completed_at')} as completed_at_ist,
           c.code as city_code, sr.status, sr.status_reason_code, sr.routing_mode, sr.service_mode, sr.vehicle_type,
           sr.workshop_id::text as workshop_id, sr.pincode, sr.preferred_date::text as preferred_date, sr.preferred_slot,
           sr.pickup_requested::text as pickup_requested, sr.visit_fee_paise::text as visit_fee,
           ${UTC_TEXT('sr.created_at')} as ct, sr.id::text as cid`,
        ),
        from: sql.raw('service_requests sr join cities c on c.id = sr.city_id'),
        where: sql`${win('sr.created_at')} and ${inCities('sr.city_id', q.cityIds)}`,
        ts: 'sr.created_at',
        id: 'sr.id',
      };
    case 'partners': {
      const branch = (table: 'shops' | 'workshops', kind: string, alias: string) =>
        sql`select ${sql.raw(`'${kind}'`)} as kind, ${sql.raw(`${alias}.id`)} as id, ${sql.raw(`${alias}.name`)} as name,
          c.code as city_code, ${sql.raw(`${alias}.status`)} as status, ${sql.raw(`${alias}.pincode`)} as pincode,
          ${sql.raw(`${alias}.gstin`)} as gstin, ${sql.raw(`${alias}.rating_avg::text`)} as rating_avg,
          ${sql.raw(`${alias}.rating_count::text`)} as rating_count, ${sql.raw(`${alias}.created_at`)} as ts
          from ${sql.raw(table)} ${sql.raw(alias)} join cities c on c.id = ${sql.raw(`${alias}.city_id`)}
          where ${win(`${alias}.created_at`)} and ${inCities(`${alias}.city_id`, q.cityIds)}`;
      return {
        columns: [
          'kind',
          'id',
          'name',
          'city_code',
          'status',
          'pincode',
          'gstin',
          'rating_avg',
          'rating_count',
          'created_at_ist',
        ],
        select: sql.raw(
          `p.kind, p.id::text as id, p.name, p.city_code, p.status, p.pincode, p.gstin, p.rating_avg, p.rating_count,
           ${IST('p.ts')} as created_at_ist, ${UTC_TEXT('p.ts')} as ct, p.id::text as cid`,
        ),
        from: sql`(${branch('shops', 'shop', 's')} union all ${branch('workshops', 'workshop', 'w')}) p`,
        where: sql`true`,
        ts: 'p.ts',
        id: 'p.id',
      };
    }
    case 'coupon_usage':
      // One row per coupon use, by the order's city (a coupon for every city still belongs to the orders' cities).
      // The customer is a short hash, never a name, phone, email or id: enough to count repeat use, nothing to identify.
      return {
        columns: [
          'coupon_code',
          'order_code',
          'used_at_ist',
          'city_code',
          'funder',
          'source',
          'status',
          'released_at_ist',
          { money: 'discount' },
          'customer_ref',
        ],
        select: sql.raw(
          `k.code::text as coupon_code, g.code as order_code, ${IST('r.created_at')} as used_at_ist, c.code as city_code,
           r.funder, case when coalesce((g.coupon_snapshot ->> 'automatic')::boolean, false) then 'automatic' else 'code' end as source,
           case when r.released_at is null then 'kept' else 'released' end as status,
           ${IST('r.released_at')} as released_at_ist, r.discount_paise::text as discount,
           left(md5(r.user_id::text), 12) as customer_ref, ${UTC_TEXT('r.created_at')} as ct, r.id::text as cid`,
        ),
        from: sql.raw(
          'coupon_redemptions r join coupons k on k.id = r.coupon_id join order_groups g on g.id = r.group_id join cities c on c.id = g.city_id',
        ),
        where: sql`${win('r.created_at')} and ${inCities('g.city_id', q.cityIds)}`,
        ts: 'r.created_at',
        id: 'r.id',
      };
    case 'customers':
      return {
        columns: [
          'user_id',
          'name',
          'phone',
          'email',
          'created_at_ist',
          'status',
          'language',
          'phone_verified',
          'email_verified',
        ],
        select: sql.raw(
          `u.id::text as user_id, u.name, u.phone, u.email::text as email, ${IST('u.created_at')} as created_at_ist,
           u.status, u.language, (u.phone_verified_at is not null)::text as phone_verified,
           (u.email_verified_at is not null)::text as email_verified, ${UTC_TEXT('u.created_at')} as ct, u.id::text as cid`,
        ),
        from: sql.raw('users u'),
        where: sql`u.deleted_at is null and ${win('u.created_at')}`,
        ts: 'u.created_at',
        id: 'u.id',
      };
  }
}

const headerOf = (columns: readonly Col[]): string[] =>
  columns.flatMap((c) => (typeof c === 'string' ? [c] : [`${c.money}_rupees`, `${c.money}_paise`]));

/** The CSV header row of a dataset (money columns come as `<name>_rupees` then `<name>_paise`). */
export function exportHeader(dataset: ExportDataset): string[] {
  return headerOf(
    source({ dataset, from: '2000-01-01', to: '2000-01-01', cityIds: null, maskContacts: true }).columns,
  );
}

type RawRow = Record<string, unknown>;

function toCells(columns: readonly Col[], row: RawRow, maskContacts: boolean): string[] {
  const text = (v: unknown) =>
    typeof v === 'string'
      ? v
      : typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean'
        ? String(v)
        : '';
  return columns.flatMap((c) => {
    if (typeof c !== 'string') {
      const raw = row[c.money];
      const paise = raw === null || raw === undefined ? null : BigInt(text(raw));
      return [paiseToRupees(paise), text(raw)];
    }
    const v = row[c];
    if (maskContacts && c === 'phone') return [text(maskPhone(v === null ? null : text(v)))];
    if (maskContacts && c === 'email') return [text(maskEmail(v === null ? null : text(v)))];
    return [text(v)];
  });
}

/**
 * How many rows the query covers, counted only up to `limit` (default one more than the file cap) so an oversized
 * range is detected cheaply and refused instead of read.
 */
export async function countExportRows(db: Tx, q: ExportQuery, limit = MAX_EXPORT_ROWS + 1): Promise<number> {
  const src = source(q);
  const result = await db.execute(
    sql`select count(*)::int as n from (select 1 from ${src.from} where ${src.where} limit ${limit}) counted`,
  );
  return rowsOf<{ n: number }>(result)[0]?.n ?? 0;
}

/**
 * The rows as pages of CSV cells (header not included), oldest first, keyset-paged so memory stays at one page.
 * Stops after `MAX_EXPORT_ROWS` rows whatever the data does.
 */
export async function* exportPages(db: Tx, q: ExportQuery, pageRows = 1000): AsyncGenerator<string[][]> {
  const src = source(q);
  let cursor: { ct: string; cid: string } | null = null;
  let sent = 0;
  while (sent < MAX_EXPORT_ROWS) {
    const take = Math.min(pageRows, MAX_EXPORT_ROWS - sent);
    const after: SQL = cursor
      ? sql`and (${sql.raw(src.ts)}, ${sql.raw(src.id)}) > (${cursor.ct}::timestamptz, ${cursor.cid}::uuid)`
      : sql``;
    const result = await db.execute(
      sql`select ${src.select} from ${src.from} where ${src.where} ${after}
          order by ${sql.raw(src.ts)}, ${sql.raw(src.id)} limit ${take}`,
    );
    const rows = rowsOf<RawRow>(result);
    if (rows.length === 0) return;
    yield rows.map((r) => toCells(src.columns, r, q.maskContacts));
    sent += rows.length;
    const last = rows[rows.length - 1];
    if (rows.length < take || !last) return;
    cursor = { ct: String(last.ct), cid: String(last.cid) };
  }
}

const rangeDays = (q: ExportQuery) => {
  const w = exportWindow(q.from, q.to);
  return Math.round((w.end.getTime() - w.start.getTime()) / 86_400_000);
};
const masked = (q: ExportQuery) => q.dataset === 'customers' && q.maskContacts;

/** The export was prepared for `actorId`: audit row (who, dataset, range, rows) and analytics event. */
export async function recordExportRequest(
  db: Tx,
  input: { actorId: string; query: ExportQuery; cityCode: string | null; rowCount: number },
): Promise<void> {
  const q = input.query;
  await db.transaction(async (tx) => {
    await tx.insert(auditLog).values({
      actorUserId: input.actorId,
      actorRole: 'staff',
      action: 'export.requested',
      entity: 'export',
      entityId: q.dataset,
      after: {
        dataset: q.dataset,
        from: q.from,
        to: q.to,
        cityCode: input.cityCode,
        rowCount: input.rowCount,
        masked: masked(q),
      },
    });
    await recordServerEvent(tx, 'admin_export_run', {
      userId: input.actorId,
      props: { dataset: q.dataset, rangeDays: rangeDays(q), rowCount: input.rowCount, masked: masked(q) },
    });
  });
}

/** The prepared file was streamed to the same staff member: rows actually written. */
export async function recordExportDownload(
  db: Tx,
  input: { actorId: string; query: ExportQuery; rowCount: number },
): Promise<void> {
  const q = input.query;
  await db.transaction(async (tx) => {
    await tx.insert(auditLog).values({
      actorUserId: input.actorId,
      actorRole: 'staff',
      action: 'export.downloaded',
      entity: 'export',
      entityId: q.dataset,
      after: { dataset: q.dataset, from: q.from, to: q.to, rowCount: input.rowCount, masked: masked(q) },
    });
    await recordServerEvent(tx, 'admin_export_downloaded', {
      userId: input.actorId,
      props: { dataset: q.dataset, rowCount: input.rowCount },
    });
  });
}
