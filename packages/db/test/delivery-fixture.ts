/**
 * Shared world for the delivery-agent suites (spec 24): the seeded Raipur demo, agents switched on, a prepaid order
 * routed to an `agents`-mode shop, accepted and packed. Each suite creates its own test database.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { loadKeyring } from '../src/crypto';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  acceptAgentInvite,
  acceptShopOffer,
  advanceShopOrder,
  applyRazorpayPayment,
  createAgentInvite,
  decideAgentDocument,
  placeOrder,
  quoteCheckout,
  recordRazorpayOrder,
  routeOrder,
  setAgentOnline,
  setAgentStatus,
  submitAgentDocument,
  syncRbacCatalogue,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

export const OIL = 'CAS-ACT4T-0900';
export const SHOP = 'Sharma Auto Parts';
export const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

export interface World {
  db: TestDb;
  close: () => Promise<void>;
  t: () => Tx;
  customer: string;
  staff: string;
  shopUser: string;
  shopId: string;
  cityId: string;
}

let n = 0;
const phone = () => `+9198${String(10_000_000 + Math.floor(Math.random() * 89_999_999)).slice(0, 8)}`;

export async function makeWorld(): Promise<World> {
  const { db, client } = await createTestDb();
  const t = () => db as unknown as Tx;
  await syncRbacCatalogue(t());
  await seedRaipurDemo(t(), fixture);
  const customer = (
    await db
      .insert(s.users)
      .values({ firebaseUid: `fb-dl-cust-${randomUUID()}` })
      .returning()
  )[0]!.id;
  const staff = (
    await db
      .insert(s.users)
      .values({ firebaseUid: `fb-dl-staff-${randomUUID()}` })
      .returning()
  )[0]!.id;
  const shopUser = (
    await db
      .insert(s.users)
      .values({ firebaseUid: `fb-dl-shop-${randomUUID()}` })
      .returning()
  )[0]!.id;
  await db.execute(sql`insert into admin_prices (variant_id, city_id, selling_paise, updated_by)
    select v.id, c.id, v.mrp_paise, ${staff} from product_variants v cross join cities c where c.code = 'RPR'`);
  const [shop] = await db.select().from(s.shops).where(eq(s.shops.name, SHOP));
  await db.update(s.shops).set({ deliveryMode: 'agents' }).where(eq(s.shops.id, shop!.id));
  await db.update(s.shopInventory).set({ onHand: 100_000 }).where(eq(s.shopInventory.shopId, shop!.id));
  await db.insert(s.settings).values({ key: 'delivery.agents_enabled', value: true });
  await db.insert(s.settings).values({ key: 'delivery.photos_required', value: false });
  // Staff switched the agent WhatsApp messages on (spec 10 gate); Meta statuses are not synced in tests.
  for (const key of ['delivery.agent_invite', 'delivery.offer'])
    await db
      .insert(s.notificationTemplates)
      .values({ key, channel: 'whatsapp', locale: 'en', body: 'x', enabled: true });
  return {
    db,
    close: () => client.close(),
    t,
    customer,
    staff,
    shopUser,
    shopId: shop!.id,
    cityId: shop!.cityId,
  };
}

/** A verified, active, online agent (invite → join → documents → verified → active → online). */
export async function makeAgent(w: World, vehicleType: 'bike' | 'three_wheeler' | 'goods_vehicle' = 'bike') {
  n += 1;
  const ph = phone();
  const userId = (
    await w.db
      .insert(s.users)
      .values({ firebaseUid: `fb-dl-agent-${randomUUID()}`, phone: ph, phoneVerifiedAt: new Date() })
      .returning()
  )[0]!.id;
  const invite = await createAgentInvite(w.t(), {
    scope: { all: true },
    staffUserId: w.staff,
    keyring,
    from: { name: `Agent ${n} Kumar`, phone: ph, cityCode: 'RPR', vehicleType },
  });
  const { agentId } = await acceptAgentInvite(w.t(), { userId, token: invite.token });
  const numbers = {
    pan: `ABCDE${String(1000 + n)}F`,
    driving_licence: `CG04201900${String(10000 + n)}`,
    vehicle_rc: `CG04AB${String(1000 + n)}`,
  } as const;
  for (const kind of ['pan', 'driving_licence', 'vehicle_rc'] as const) {
    const mediaId = await mediaFor(w, 'agent_document', agentId, userId);
    await submitAgentDocument(w.t(), { userId, keyring, kind, number: numbers[kind], mediaId });
    await decideAgentDocument(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      agentId,
      kind,
      decision: 'verified',
    });
  }
  const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, agentId));
  const { version } = await setAgentStatus(w.t(), {
    scope: { all: true },
    staffUserId: w.staff,
    agentId,
    to: 'active',
    expectedVersion: a!.version,
  });
  await setAgentOnline(w.t(), { userId, online: true, expectedVersion: version });
  return { agentId, userId, phone: ph };
}

export async function mediaFor(
  w: World,
  ownerKind: 'agent_document' | 'delivery_photo',
  ownerId: string,
  userId: string,
) {
  const id = randomUUID();
  const [m] = await w.db
    .insert(s.mediaObjects)
    .values({
      ownerKind,
      ownerId,
      bucket: 'private-docs',
      path: `delivery/${ownerId}/${id}.webp`,
      thumbPath: `delivery/${ownerId}/${id}-thumb.webp`,
      width: 10,
      height: 10,
      bytes: 100,
      thumbBytes: 50,
      sha256: 'a'.repeat(64),
      uploadedBy: userId,
    })
    .returning();
  return m!.id;
}

/** A prepaid sub-order routed to the agents-mode shop, accepted and packed. */
export async function packedOnlineOrder(w: World, method: 'online' | 'cod' = 'online') {
  n += 1;
  const lines = [{ sku: OIL, qty: 2 }];
  const q = await quoteCheckout(w.t(), { pincode: '492004', lines, locale: 'en' });
  const placed = await placeOrder(w.t(), {
    method,
    userId: w.customer,
    idempotencyKey: `delivery-key-${String(n).padStart(6, '0')}-${randomUUID().slice(0, 8)}`,
    address: {
      contactName: 'Ravi Sahu',
      contactPhone: '+919876543210',
      line1: 'House 12, Pandri',
      line2: null,
      landmark: 'Near the temple',
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: method === 'online' ? q.onlineTotalPaise : q.totalPaise,
    note: null,
    locale: 'en',
  });
  if (method === 'online') {
    const [group] = await w.db.select().from(s.orderGroups).where(eq(s.orderGroups.code, placed.code));
    const providerOrderId = `order_dl${String(n).padStart(6, '0')}`;
    await recordRazorpayOrder(w.t(), { groupId: group!.id, providerOrderId, amountPaise: placed.totalPaise });
    await applyRazorpayPayment(w.t(), {
      providerOrderId,
      providerPaymentId: `pay_${providerOrderId}`,
      status: 'captured',
      amountPaise: placed.totalPaise,
      currency: 'INR',
      method: 'upi',
    });
  }
  const code = placed.orders[0]!.code;
  let [o] = await w.db.select().from(s.orders).where(eq(s.orders.code, code));
  const r = await routeOrder(w.t(), {
    scope: { all: true },
    code,
    shopId: w.shopId,
    expectedVersion: o!.version,
    staffUserId: w.staff,
  });
  await acceptShopOffer(w.t(), {
    shopIds: [w.shopId],
    assignmentId: r.assignmentId,
    staffUserId: w.shopUser,
  });
  [o] = await w.db.select().from(s.orders).where(eq(s.orders.code, code));
  await advanceShopOrder(w.t(), {
    shopIds: [w.shopId],
    code,
    expectedVersion: o!.version,
    step: { to: 'packed' },
    staffUserId: w.shopUser,
    keyring,
  });
  return { code, orderId: o!.id, groupCode: placed.code };
}

export const orderOf = async (w: World, code: string) =>
  (await w.db.select().from(s.orders).where(eq(s.orders.code, code)))[0]!;
export const jobOf = async (w: World, orderId: string) =>
  (
    await w.db
      .select()
      .from(s.deliveryJobs)
      .where(eq(s.deliveryJobs.orderId, orderId))
      .orderBy(sql`seq desc`)
  )[0]!;
