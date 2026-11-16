/**
 * The data behind the bill / receipt PDF (Q194): read from the stored snapshot by the id the outbox row carries, only for
 * the document's owner (another customer's id finds nothing), and the emails that carry a PDF queue that id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { BILL_REF_KEY } from '@mechdost/shared/bill-document';
import { computeServiceBill, type EstimateLine } from '@mechdost/shared/service-bill';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  loadBillSource,
  queueOrderStatusEmail,
  queuePaymentReceivedEmail,
  queueServiceStatusEmail,
  readBillLines,
  type Tx,
} from '../src/repo';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
let workshopId: string;
let variantId: string;
let shopId: string;
const t = () => db as unknown as Tx;
let n = 0;

const lines: EstimateLine[] = [
  {
    id: 'a',
    description: 'ब्रेक पैड (आगे)',
    qty: 2,
    unitPaise: 50000,
    gstRateBp: 1800,
    decision: 'approved',
  },
];

async function billedRequest(userId: string) {
  n += 1;
  const bill = computeServiceBill(lines, { gstRegistered: true });
  const [r] = await db
    .insert(s.serviceRequests)
    .values({
      code: `SR-RPR-2026-BD${String(n).padStart(4, '0')}`,
      userId,
      cityId: f.raipur,
      workshopId,
      routingMode: 'chosen',
      vehicleType: '2W',
      vehicleText: 'Honda Activa 6G',
      vehicleKey: 'honda activa 6g',
      services: [],
      pincode: '492001',
      preferredDate: '2026-11-20',
      preferredSlot: 'morning',
      status: 'billed',
      odometerKm: 12_400,
      receivedAt: new Date(),
      idempotencyKey: `bill-doc-${String(n).padStart(8, '0')}`,
    })
    .returning();
  await db.insert(s.serviceBills).values({
    requestId: r!.id,
    lines: bill.lines,
    gstRegistered: true,
    taxablePaise: bill.taxablePaise,
    cgstPaise: bill.cgstPaise,
    sgstPaise: bill.sgstPaise,
    roundOffPaise: bill.roundOffPaise,
    totalPaise: bill.totalPaise,
  });
  return { request: r!, bill };
}

async function deliveredOrder(userId: string) {
  n += 1;
  const code = `MD-RPR-2026-BD${String(n).padStart(4, '0')}`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId: f.raipur,
      paymentMethod: 'online',
      paymentStatus: 'paid',
      subtotalPaise: 118000,
      shippingPaise: 4900,
      totalPaise: 122900,
      idempotencyKey: `bill-order-${String(n).padStart(8, '0')}`,
    })
    .returning();
  const [o] = await db
    .insert(s.orders)
    .values({
      groupId: g!.id,
      subNo: 1,
      code: `${code}-1`,
      userId,
      cityId: f.raipur,
      status: 'delivered',
      shopId,
      deliveredAt: new Date('2026-11-16T10:00:00Z'),
      shippingAddress: { line1: 'Sarona', pincode: '492001' },
      pincode: '492001',
      subtotalPaise: 118000,
      shippingPaise: 4900,
      totalPaise: 122900,
    })
    .returning();
  await db.insert(s.orderItems).values({
    orderId: o!.id,
    variantId,
    title: 'Activ 4T',
    titleHi: 'एक्टिव 4T',
    sku: 'CAS-1000',
    hsn: '2710',
    gstRateBp: 1800,
    unitPaise: 59000,
    qty: 2,
    taxablePaise: 100000,
    cgstPaise: 9000,
    sgstPaise: 9000,
    totalPaise: 118000,
  });
  const [p] = await db
    .insert(s.payments)
    .values({
      groupId: g!.id,
      providerOrderId: `order_bd_${String(n)}`,
      providerPaymentId: `pay_bd_${String(n)}`,
      amountPaise: 122900,
      status: 'paid',
      method: 'upi',
      capturedAt: new Date('2026-11-16T09:00:00Z'),
    })
    .returning();
  return { group: g!, order: o!, payment: p!, code };
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  workshopId = (await addWorkshop(db, f)).id;
  await db
    .update(s.users)
    .set({ name: 'आशा वर्मा' })
    .where(sql`id = ${f.customer}`);
  const [state] = await db.select().from(s.states).limit(1);
  const [shop] = await db
    .insert(s.shops)
    .values({
      name: 'Near Auto',
      phone: '+919800000000',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: f.raipur,
      stateId: state!.id,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  shopId = shop!.id;
  const [cat] = await db
    .insert(s.categories)
    .values({ slug: 'lubricants', name: 'Lubricants', sort: 1 })
    .returning();
  const [brand] = await db.insert(s.brands).values({ slug: 'castrol', name: 'Castrol' }).returning();
  const [p] = await db
    .insert(s.products)
    .values({
      slug: 'castrol-activ',
      name: 'Activ',
      brandId: brand!.id,
      categoryId: cat!.id,
      hsn: '2710',
      gstRateBp: 1800,
      status: 'live',
    })
    .returning();
  const [v] = await db
    .insert(s.productVariants)
    .values({ productId: p!.id, sku: 'SKU-1', mrpPaise: 60000 })
    .returning();
  variantId = v!.id;
});

afterAll(async () => {
  await client.close();
});

describe('loadBillSource', () => {
  it('reads the stored service bill for its owner, with the stored totals', async () => {
    const { request, bill } = await billedRequest(f.customer);
    const got = await loadBillSource(t(), {
      template: 'service_bill_ready',
      ref: request.id,
      recipientUserId: f.customer,
    });
    expect(got?.kind).toBe('service');
    if (got?.kind !== 'service') return;
    expect(got.source.code).toBe(request.code);
    expect(got.source.customerName).toBe('आशा वर्मा');
    expect(got.source.bill.totalPaise).toBe(bill.totalPaise);
    expect(got.source.bill.lines).toEqual(bill.lines);
    expect(got.source.bill.paidAt).toBeNull();
  });

  it("finds nothing for another customer's id, a forged id, or a row without a recipient", async () => {
    const { request } = await billedRequest(f.customer);
    const ask = (ref: string, recipientUserId: string | null) =>
      loadBillSource(t(), { template: 'service_completed', ref, recipientUserId });
    expect(await ask(request.id, f.other)).toBeNull();
    expect(await ask(request.id, null)).toBeNull();
    expect(await ask('00000000-0000-4000-8000-000000000000', f.customer)).toBeNull();
  });

  it('reads a delivered sub-order and a paid checkout, owner only', async () => {
    const d = await deliveredOrder(f.customer);
    const sub = await loadBillSource(t(), {
      template: 'order_delivered',
      ref: d.order.id,
      recipientUserId: f.customer,
    });
    expect(sub?.kind).toBe('order');
    if (sub?.kind !== 'order') return;
    expect(sub.source).toMatchObject({
      kind: 'order',
      code: d.code,
      totalPaise: 122900,
      shippingPaise: 4900,
      paidMethod: 'upi',
    });
    expect(sub.source.items).toEqual([
      {
        title: 'Activ 4T',
        titleHi: 'एक्टिव 4T',
        qty: 2,
        unitPaise: 59000,
        totalPaise: 118000,
        gstPaise: 18000,
      },
    ]);
    const paid = await loadBillSource(t(), {
      template: 'payment_received',
      ref: d.payment.id,
      recipientUserId: f.customer,
    });
    expect(paid?.kind === 'order' && paid.source.kind).toBe('payment');
    expect(
      await loadBillSource(t(), { template: 'order_delivered', ref: d.order.id, recipientUserId: f.other }),
    ).toBeNull();
    expect(
      await loadBillSource(t(), {
        template: 'payment_received',
        ref: d.payment.id,
        recipientUserId: f.other,
      }),
    ).toBeNull();
  });

  it('a malformed stored line gives no document instead of a wrong one', () => {
    expect(readBillLines([{ description: 'x' }])).toBeNull();
    expect(readBillLines('nope')).toBeNull();
  });
});

describe('queued emails carry the bill reference (an id, never contact details)', () => {
  it('the bill-ready and completed emails hold the request id; other service emails do not', async () => {
    const { request } = await billedRequest(f.customer);
    await db
      .update(s.users)
      .set({ email: 'asha@example.com', emailVerifiedAt: new Date() })
      .where(sql`id = ${f.customer}`);
    const ref = { id: request.id, code: request.code, userId: f.customer, workshopId };
    await queueServiceStatusEmail(t(), { request: ref, to: 'billed', version: 1 });
    await queueServiceStatusEmail(t(), { request: ref, to: 'completed', version: 2 });
    await queueServiceStatusEmail(t(), { request: ref, to: 'ready', version: 3 });
    const rows = await db
      .select()
      .from(s.notificationOutbox)
      .where(sql`channel = 'email'`);
    const by = (key: string) => rows.find((r) => r.templateKey === key)?.payload as Record<string, unknown>;
    expect(by('service_bill_ready')[BILL_REF_KEY]).toBe(request.id);
    expect(by('service_completed')[BILL_REF_KEY]).toBe(request.id);
    expect(by('service_ready')[BILL_REF_KEY]).toBeUndefined();
  });

  it('the delivered email holds the sub-order id, the payment email the payment id', async () => {
    await db
      .update(s.users)
      .set({ email: 'asha@example.com', emailVerifiedAt: new Date() })
      .where(sql`id = ${f.customer}`);
    const d = await deliveredOrder(f.customer);
    await queueOrderStatusEmail(t(), { orderId: d.order.id, to: 'delivered', version: 9 });
    await queuePaymentReceivedEmail(t(), {
      paymentId: d.payment.id,
      groupId: d.group.id,
      amountPaise: 122900,
      method: 'upi',
      providerPaymentId: 'pay_bd',
    });
    const rows = await db
      .select()
      .from(s.notificationOutbox)
      .where(sql`channel = 'email'`);
    const by = (key: string) =>
      rows
        .filter((r) => r.templateKey === key)
        .map((r) => (r.payload as Record<string, unknown>)[BILL_REF_KEY]);
    expect(by('order_delivered')).toContain(d.order.id);
    expect(by('payment_received')).toContain(d.payment.id);
  });
});
