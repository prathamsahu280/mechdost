import { and, asc, desc, eq } from 'drizzle-orm';
import {
  applicationReasonPhrase,
  cancelReasonPhrase,
  emailDate,
  paymentMethodPhrase,
  refundNotePhrase,
  rejectReasonPhrase,
  rupees,
  slotPhrase,
  warningReasonPhrase,
} from '@mechdost/shared/email-phrases';
import type { OrderStatus, ServiceRequestStatus } from '@mechdost/shared/state';
import {
  cities,
  orderGroups,
  orderItems,
  orders,
  pincodes,
  serviceProposals,
  shopUsers,
  shops,
  workshops,
} from '../schema';
import { queueEmail } from './email-notifications';
import { queueStaffOrderPlaced } from './notice-events';
import { localized } from './localized';
import type { Locale } from './notify';
import type { Tx } from './orders';

/**
 * Where each email milestone reads its words from (spec 10, design 2026-11-15). Every function runs inside the
 * transaction of the state change it announces (never before it, never after it), looks up what the copy needs,
 * picks localized phrases in the recipient's language and hands one row to `queueEmail`. Nothing here changes
 * state; none of it ever includes a seller's or a customer's contact details for the other side.
 */

const ORDER_EMAIL: Partial<
  Record<OrderStatus, 'order_confirmed' | 'order_delivered' | 'order_cancelled' | 'order_rejected'>
> = {
  confirmed: 'order_confirmed',
  delivered: 'order_delivered',
  cancelled: 'order_cancelled',
  rejected: 'order_rejected',
};

/** Moves of a sub-order that email the customer; `transitionOrder` calls this for every move. */
export async function queueOrderStatusEmail(
  tx: Tx,
  input: { orderId: string; to: OrderStatus; version: number },
): Promise<void> {
  const template = ORDER_EMAIL[input.to];
  if (!template) return;
  const [row] = await tx
    .select({
      userId: orders.userId,
      code: orderGroups.code,
      method: orderGroups.paymentMethod,
      paymentStatus: orderGroups.paymentStatus,
      reasonCode: orders.statusReasonCode,
      message: orders.customerMessage,
      locality: pincodes.locality,
      localityHi: pincodes.localityHi,
      cityName: cities.name,
    })
    .from(orders)
    .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .leftJoin(shops, eq(shops.id, orders.shopId))
    .leftJoin(pincodes, eq(pincodes.pincode, shops.pincode))
    .leftJoin(cities, eq(cities.id, shops.cityId))
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!row) return;
  const paidOnline = row.method === 'online' && row.paymentStatus === 'paid';
  await queueEmail(tx, {
    template,
    entityId: input.orderId,
    version: input.version,
    userId: row.userId,
    payload: (locale) => ({
      orderCode: row.code,
      shopArea: localized(row.locality ?? row.cityName ?? '', row.localityHi, locale),
      reason:
        template === 'order_rejected'
          ? rejectReasonPhrase(row.reasonCode, locale)
          : cancelReasonPhrase(row.reasonCode, locale),
      message: row.message ?? '',
      refundNote: refundNotePhrase(paidOnline, locale),
    }),
  });
}

/** "Out for delivery" with the delivery code, queued by `issueDeliveryCode` (which holds the code, sealed). */
export async function queueOutForDeliveryEmail(
  tx: Tx,
  input: { orderId: string; version: number; sealedCode: Record<string, string> },
): Promise<void> {
  const [row] = await tx
    .select({ userId: orders.userId, code: orderGroups.code })
    .from(orders)
    .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!row) return;
  await queueEmail(tx, {
    template: 'order_out_for_delivery',
    entityId: input.orderId,
    version: input.version,
    userId: row.userId,
    payload: { orderCode: row.code, ...input.sealedCode },
  });
}

const ITEM_LINES = 6;

/** "Your order is placed": cash on delivery at checkout, online orders once the payment is captured. */
export async function queueOrderPlacedEmail(tx: Tx, groupId: string): Promise<void> {
  const [group] = await tx
    .select({
      userId: orderGroups.userId,
      code: orderGroups.code,
      method: orderGroups.paymentMethod,
      total: orderGroups.totalPaise,
    })
    .from(orderGroups)
    .where(eq(orderGroups.id, groupId))
    .limit(1);
  if (!group) return;
  const lines = await tx
    .select({ title: orderItems.title, titleHi: orderItems.titleHi, qty: orderItems.qty })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orders.groupId, groupId))
    .orderBy(asc(orderItems.id));
  await queueEmail(tx, {
    template: 'order_placed',
    entityId: groupId,
    version: 1,
    userId: group.userId,
    payload: (locale) => {
      const shown = lines
        .slice(0, ITEM_LINES)
        .map((l) => `${localized(l.title, l.titleHi, locale)} × ${String(l.qty)}`);
      const more = lines.length - shown.length;
      if (more > 0) shown.push(locale === 'hi' ? `और ${String(more)} सामान` : `and ${String(more)} more`);
      return {
        orderCode: group.code,
        items: shown.join('\n'),
        total: rupees(group.total),
        paymentMethod: paymentMethodPhrase(group.method, locale),
      };
    },
  });
  // The placed checkout now waits for routing: tell the staff who route in its city (bell and push).
  await queueStaffOrderPlaced(tx, groupId);
}

/** A captured online payment: the billing receipt. `paymentRowVersion` makes a replayed webhook mail once. */
export async function queuePaymentReceivedEmail(
  tx: Tx,
  input: {
    paymentId: string;
    groupId: string;
    amountPaise: number;
    method: string | null;
    providerPaymentId: string;
  },
): Promise<void> {
  const [group] = await tx
    .select({ userId: orderGroups.userId, code: orderGroups.code })
    .from(orderGroups)
    .where(eq(orderGroups.id, input.groupId))
    .limit(1);
  if (!group) return;
  await queueEmail(tx, {
    template: 'payment_received',
    entityId: input.paymentId,
    version: 1,
    userId: group.userId,
    payload: (locale) => ({
      orderCode: group.code,
      amount: rupees(input.amountPaise),
      method: paymentMethodPhrase(input.method, locale),
      paymentId: input.providerPaymentId,
    }),
  });
}

const SERVICE_EMAIL: Partial<
  Record<
    ServiceRequestStatus,
    | 'service_proposed'
    | 'service_confirmed'
    | 'service_estimate_ready'
    | 'service_ready'
    | 'service_bill_ready'
    | 'service_completed'
  >
> = {
  proposed: 'service_proposed',
  confirmed: 'service_confirmed',
  estimate_sent: 'service_estimate_ready',
  ready: 'service_ready',
  billed: 'service_bill_ready',
  completed: 'service_completed',
};

interface ServiceRef {
  id: string;
  code: string;
  userId: string;
  workshopId: string | null;
}

async function workshopNames(tx: Tx, workshopId: string | null) {
  if (!workshopId) return null;
  const [w] = await tx
    .select({ name: workshops.name, nameHi: workshops.nameHi })
    .from(workshops)
    .where(eq(workshops.id, workshopId))
    .limit(1);
  return w ?? null;
}

const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Service milestones that email the customer; `transitionRequest` calls this after every move. */
export async function queueServiceStatusEmail(
  tx: Tx,
  input: {
    request: ServiceRef;
    to: ServiceRequestStatus;
    version: number;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const template = SERVICE_EMAIL[input.to];
  if (!template) return;
  const r = input.request;
  const w = await workshopNames(tx, r.workshopId);
  let proposal: { date: string; slot: string; low: number; high: number } | null = null;
  if (template === 'service_proposed' && typeof input.payload?.date === 'string') {
    proposal = {
      date: input.payload.date,
      slot: typeof input.payload.slot === 'string' ? input.payload.slot : '',
      low: asNumber(input.payload.lowPaise) ?? 0,
      high: asNumber(input.payload.highPaise) ?? 0,
    };
  } else if (template === 'service_confirmed') {
    const [p] = await tx
      .select({
        date: serviceProposals.proposedDate,
        slot: serviceProposals.slot,
        low: serviceProposals.lowPaise,
        high: serviceProposals.highPaise,
      })
      .from(serviceProposals)
      .where(and(eq(serviceProposals.requestId, r.id), eq(serviceProposals.status, 'accepted')))
      .orderBy(desc(serviceProposals.createdAt))
      .limit(1);
    proposal = p ?? null;
  }
  await queueEmail(tx, {
    template,
    entityId: r.id,
    version: input.version,
    userId: r.userId,
    payload: (locale) => ({
      requestCode: r.code,
      workshopName: w ? localized(w.name, w.nameHi, locale) : '',
      slot: proposal ? `${emailDate(proposal.date, locale)}, ${slotPhrase(proposal.slot, locale)}` : '',
      expectedCost: proposal ? `${rupees(proposal.low)} – ${rupees(proposal.high)}` : '',
      amount: rupees(asNumber(input.payload?.totalPaise) ?? 0),
    }),
  });
}

/** "We have your service request": sent once, when the booking is created. */
export async function queueServiceReceivedEmail(tx: Tx, input: ServiceRef): Promise<void> {
  const w = await workshopNames(tx, input.workshopId);
  await queueEmail(tx, {
    template: 'service_request_received',
    entityId: input.id,
    version: 1,
    userId: input.userId,
    payload: (locale) => ({
      requestCode: input.code,
      workshop: w
        ? localized(w.name, w.nameHi, locale)
        : locale === 'hi'
          ? 'MechDost आपके लिए सही वर्कशॉप चुनेगा'
          : 'MechDost will choose the right workshop for you',
    }),
  });
}

/** Support ticket milestones (customer tickets only; a guest WhatsApp ticket has no email). */
export async function queueTicketEmail(
  tx: Tx,
  input: {
    template: 'ticket_received' | 'ticket_reply' | 'ticket_resolved';
    entityId: string;
    version: number | string;
    userId: string | null;
    ticketCode: string;
  },
): Promise<void> {
  if (!input.userId) return;
  await queueEmail(tx, {
    template: input.template,
    entityId: input.entityId,
    version: input.version,
    userId: input.userId,
    payload: { ticketCode: input.ticketCode },
  });
}

/** Seller application milestones, to the address on the application (the applicant has no account yet). */
export async function queueApplicationEmail(
  tx: Tx,
  input: {
    template: 'application_received' | 'application_approved' | 'application_rejected';
    applicationId: string;
    version: number;
    name: string;
    email: string | null;
    code: string;
    reasonCode?: string | null;
  },
): Promise<void> {
  if (!input.email) return;
  // TODO(preferred language): applications carry no language; add the site language to the form, then pass it here.
  await queueEmail(tx, {
    template: input.template,
    entityId: input.applicationId,
    version: input.version,
    audience: 'partner',
    to: { email: input.email, locale: 'en' as Locale },
    payload: (locale) => ({
      name: input.name,
      applicationCode: input.code,
      reason: applicationReasonPhrase(input.reasonCode ?? null, locale),
    }),
  });
}

/** The people of a shop with a login: the same users the live pings and the shop portal use. */
async function shopPeople(tx: Tx, shopId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: shopUsers.userId })
    .from(shopUsers)
    .where(eq(shopUsers.shopId, shopId));
  return rows.map((r) => r.userId);
}

/** An order was offered to a shop: an email fallback to the portal bell and push (every person of the shop). */
export async function queueShopOrderRoutedEmail(
  tx: Tx,
  input: { assignmentId: string; shopId: string; orderCode: string; minutes: number },
): Promise<void> {
  for (const userId of await shopPeople(tx, input.shopId))
    await queueEmail(tx, {
      template: 'shop_order_routed',
      entityId: `${input.assignmentId}:${userId}`,
      version: 1,
      audience: 'partner',
      userId,
      payload: { orderCode: input.orderCode, minutes: input.minutes },
    });
}

/** A warning was issued to a shop: calm wording, count in the rolling window (workshops have no login email yet). */
export async function queueShopWarningEmail(
  tx: Tx,
  input: { warningId: string; shopId: string; reasonCode: string; counting: number; windowDays: number },
): Promise<void> {
  const [shop] = await tx
    .select({ name: shops.name, nameHi: shops.nameHi })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) return;
  for (const userId of await shopPeople(tx, input.shopId))
    await queueEmail(tx, {
      template: 'partner_warning_issued',
      entityId: `${input.warningId}:${userId}`,
      version: 1,
      audience: 'partner',
      userId,
      payload: (locale) => ({
        name: localized(shop.name, shop.nameHi, locale),
        reason: warningReasonPhrase(input.reasonCode, locale),
        count: input.counting,
        windowDays: input.windowDays,
      }),
    });
}
