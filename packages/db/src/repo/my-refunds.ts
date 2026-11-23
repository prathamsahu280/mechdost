import { sql } from 'drizzle-orm';
import { myRefundStage, type MyRefund, type MyRefundPage } from '@mechdost/shared/refunds-api';
import { REFUND_REASONS, type RefundStatus } from '@mechdost/shared/state';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

interface Row {
  id: string;
  created_key: string;
  kind: 'order' | 'service';
  code: string;
  amount_paise: number | string;
  reason_code: string;
  mode: string;
  status: RefundStatus;
  created_at: Date | string;
  decided_at: Date | string | null;
  initiated_at: Date | string | null;
  settled_at: Date | string | null;
  provider_refund_id: string | null;
}

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());
const isReason = (v: string): v is (typeof REFUND_REASONS)[number] =>
  (REFUND_REASONS as readonly string[]).includes(v);

function viewOf(r: Row): MyRefund {
  const stage = myRefundStage(r.status);
  const method = r.mode === 'bank_upi' ? 'manual' : 'original';
  const sent = r.status === 'initiated' || r.status === 'processed';
  return {
    id: r.id,
    target: { kind: r.kind, code: r.code },
    amountPaise: Number(r.amount_paise),
    reasonCode: isReason(r.reason_code) ? r.reason_code : 'other',
    method,
    stage,
    requestedAt: new Date(r.created_at).toISOString(),
    // "Approved" means somebody approved it; a declined request carries a decision date but was never approved.
    approvedAt: r.status === 'requested' || r.status === 'rejected' ? null : iso(r.decided_at),
    sentAt: method === 'original' && sent ? iso(r.initiated_at) : null,
    completedAt: r.status === 'processed' ? iso(r.settled_at) : null,
    // Razorpay's refund id only once the refund was actually sent; no other provider data leaves the server.
    providerRefundId: method === 'original' && sent ? r.provider_refund_id : null,
  };
}

/**
 * The signed-in customer's own refunds, newest first, by keyset cursor (spec 05, 2026-11-23). Ownership is decided in
 * SQL from the customer's own checkouts (`order_groups.user_id`) and workshop requests (`service_requests.user_id`),
 * so another person's refund can never be returned; both halves start from an indexed owner column. Only the fields
 * of `MyRefundDto` are selected: no staff ids, notes, reject reason, idempotency key or payout destination.
 */
export async function listMyRefunds(
  db: Tx,
  userId: string,
  opts: { cursor?: string | undefined; limit?: number | undefined },
): Promise<MyRefundPage> {
  const size = pageSize(opts.limit, 10, 50);
  const after = opts.cursor ? decodeCursor(opts.cursor, 'timestamp') : null;
  const keyset = after
    ? sql`where (m.created_at, m.id) < (${after.k}::timestamptz, ${after.id}::uuid)`
    : sql``;
  const rows = rowsOf<Row>(
    await db.execute(sql`
      with mine as (
        select r.id, 'order'::text as kind, g.code, r.amount_paise, r.reason_code, r.mode, r.status, r.created_at,
               r.decided_at, r.initiated_at, r.settled_at, r.provider_refund_id
        from order_groups g join refunds r on r.group_id = g.id
        where g.user_id = ${userId}
        union all
        select r.id, 'service'::text, sr.code, r.amount_paise, r.reason_code, r.mode, r.status, r.created_at,
               r.decided_at, r.initiated_at, r.settled_at, r.provider_refund_id
        from service_requests sr join service_bills sb on sb.request_id = sr.id join refunds r on r.bill_id = sb.id
        where sr.user_id = ${userId}
      )
      select m.*, m.created_at::text as created_key from mine m ${keyset}
      order by m.created_at desc, m.id desc
      limit ${size + 1}`),
  );
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    refunds: page.map(viewOf),
    nextCursor: rows.length > size && last ? encodeCursor({ k: last.created_key, id: last.id }) : null,
  };
}
