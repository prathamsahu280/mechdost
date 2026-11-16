import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type {
  BillAttachmentTemplate,
  OrderReceiptSource,
  ServiceBillSource,
} from '@mechdost/shared/bill-document';
import type { ServiceBillLine } from '@mechdost/shared/service-bill';
import {
  orderGroups,
  orderItems,
  orders,
  payments,
  serviceBills,
  serviceRequests,
  users,
  workshops,
} from '../schema';
import type { Tx } from './orders';

/**
 * The stored data behind the bill / receipt PDF on the bill emails (Q194, spec 10). Read at send time by the worker
 * from the id the outbox row carries (`billRef`), and only when the row's recipient owns the document: another
 * customer's id (or a forged payload) finds nothing. Nothing is recomputed; the numbers are the stored snapshot.
 */
export type BillSource =
  { kind: 'service'; source: ServiceBillSource } | { kind: 'order'; source: OrderReceiptSource };

const isLine = (v: unknown): v is ServiceBillLine => {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l.description === 'string' &&
    [l.qty, l.unitPaise, l.gstRateBp, l.taxablePaise, l.gstPaise].every((n) => Number.isSafeInteger(n))
  );
};

/** The stored `lines` jsonb as typed bill lines, or null when any line is malformed (then no PDF, the mail still goes). */
export function readBillLines(value: unknown): ServiceBillLine[] | null {
  return Array.isArray(value) && value.every(isLine) ? value : null;
}

export async function loadBillSource(
  db: Tx,
  input: { template: BillAttachmentTemplate; ref: string; recipientUserId: string | null },
): Promise<BillSource | null> {
  if (!input.recipientUserId) return null;
  switch (input.template) {
    case 'service_bill_ready':
    case 'service_completed':
      return loadServiceBill(db, input.ref, input.recipientUserId);
    case 'order_delivered':
      return loadOrderReceipt(db, input.ref, input.recipientUserId);
    case 'payment_received':
      return loadPaymentReceipt(db, input.ref, input.recipientUserId);
  }
}

async function loadServiceBill(db: Tx, requestId: string, userId: string): Promise<BillSource | null> {
  const [row] = await db
    .select({
      code: serviceRequests.code,
      vehicleText: serviceRequests.vehicleText,
      workshopName: workshops.name,
      workshopNameHi: workshops.nameHi,
      customerName: users.name,
      bill: serviceBills,
    })
    .from(serviceRequests)
    .innerJoin(serviceBills, eq(serviceBills.requestId, serviceRequests.id))
    .innerJoin(users, eq(users.id, serviceRequests.userId))
    .leftJoin(workshops, eq(workshops.id, serviceRequests.workshopId))
    .where(and(eq(serviceRequests.id, requestId), eq(serviceRequests.userId, userId)))
    .limit(1);
  if (!row) return null;
  const lines = readBillLines(row.bill.lines);
  if (!lines) return null;
  return {
    kind: 'service',
    source: {
      code: row.code,
      workshopName: row.workshopName ?? '',
      workshopNameHi: row.workshopNameHi,
      customerName: row.customerName,
      vehicleText: row.vehicleText,
      bill: {
        lines,
        taxablePaise: row.bill.taxablePaise,
        cgstPaise: row.bill.cgstPaise,
        sgstPaise: row.bill.sgstPaise,
        roundOffPaise: row.bill.roundOffPaise,
        totalPaise: row.bill.totalPaise,
        gstRegistered: row.bill.gstRegistered,
        billedAt: row.bill.billedAt,
        paidAt: row.bill.paidAt,
        method: row.bill.method,
      },
    },
  };
}

interface ItemRow {
  title: string;
  titleHi: string | null;
  qty: number;
  unitPaise: number;
  totalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

const toItems = (rows: ItemRow[]): OrderReceiptSource['items'] =>
  rows.map((i) => ({
    title: i.title,
    titleHi: i.titleHi,
    qty: i.qty,
    unitPaise: i.unitPaise,
    totalPaise: i.totalPaise,
    gstPaise: i.cgstPaise + i.sgstPaise + i.igstPaise,
  }));

const itemColumns = {
  title: orderItems.title,
  titleHi: orderItems.titleHi,
  qty: orderItems.qty,
  unitPaise: orderItems.unitPaise,
  totalPaise: orderItems.totalPaise,
  cgstPaise: orderItems.cgstPaise,
  sgstPaise: orderItems.sgstPaise,
  igstPaise: orderItems.igstPaise,
};

/** The method the gateway reported for the checkout's captured payment (upi, card…), if any. */
async function capturedMethod(db: Tx, groupId: string): Promise<string | null> {
  const [p] = await db
    .select({ method: payments.method })
    .from(payments)
    .where(and(eq(payments.groupId, groupId), isNotNull(payments.capturedAt)))
    .limit(1);
  return p?.method ?? null;
}

/** One delivered sub-order: its own lines and its own stored totals, under the checkout's code. */
async function loadOrderReceipt(db: Tx, orderId: string, userId: string): Promise<BillSource | null> {
  const [row] = await db
    .select({
      groupId: orders.groupId,
      groupCode: orderGroups.code,
      customerName: users.name,
      deliveredAt: orders.deliveredAt,
      placedAt: orders.placedAt,
      subtotalPaise: orders.subtotalPaise,
      discountPaise: orders.discountPaise,
      shippingPaise: orders.shippingPaise,
      codFeePaise: orders.codFeePaise,
      totalPaise: orders.totalPaise,
      paymentMethod: orderGroups.paymentMethod,
      paymentStatus: orderGroups.paymentStatus,
    })
    .from(orders)
    .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!row) return null;
  const items = await db
    .select(itemColumns)
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.id));
  return {
    kind: 'order',
    source: {
      kind: 'order',
      code: row.groupCode,
      customerName: row.customerName,
      issuedAt: row.deliveredAt ?? row.placedAt,
      items: toItems(items),
      subtotalPaise: row.subtotalPaise,
      discountPaise: row.discountPaise,
      shippingPaise: row.shippingPaise,
      codFeePaise: row.codFeePaise,
      totalPaise: row.totalPaise,
      paymentMethod: row.paymentMethod === 'cod' ? 'cod' : 'online',
      paymentStatus: row.paymentStatus,
      paidMethod: await capturedMethod(db, row.groupId),
    },
  };
}

/** The whole paid checkout: every line and the checkout's stored totals. */
async function loadPaymentReceipt(db: Tx, paymentId: string, userId: string): Promise<BillSource | null> {
  const [row] = await db
    .select({
      groupId: orderGroups.id,
      groupCode: orderGroups.code,
      customerName: users.name,
      capturedAt: payments.capturedAt,
      createdAt: payments.createdAt,
      method: payments.method,
      subtotalPaise: orderGroups.subtotalPaise,
      discountPaise: orderGroups.discountPaise,
      shippingPaise: orderGroups.shippingPaise,
      codFeePaise: orderGroups.codFeePaise,
      totalPaise: orderGroups.totalPaise,
      paymentMethod: orderGroups.paymentMethod,
      paymentStatus: orderGroups.paymentStatus,
    })
    .from(payments)
    .innerJoin(orderGroups, eq(orderGroups.id, payments.groupId))
    .innerJoin(users, eq(users.id, orderGroups.userId))
    .where(and(eq(payments.id, paymentId), eq(orderGroups.userId, userId)))
    .limit(1);
  if (!row) return null;
  const items = await db
    .select(itemColumns)
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orders.groupId, row.groupId))
    .orderBy(asc(orders.subNo), asc(orderItems.id));
  return {
    kind: 'order',
    source: {
      kind: 'payment',
      code: row.groupCode,
      customerName: row.customerName,
      issuedAt: row.capturedAt ?? row.createdAt,
      items: toItems(items),
      subtotalPaise: row.subtotalPaise,
      discountPaise: row.discountPaise,
      shippingPaise: row.shippingPaise,
      codFeePaise: row.codFeePaise,
      totalPaise: row.totalPaise,
      paymentMethod: row.paymentMethod === 'cod' ? 'cod' : 'online',
      paymentStatus: row.paymentStatus,
      paidMethod: row.method,
    },
  };
}
