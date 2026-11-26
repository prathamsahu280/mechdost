/**
 * Delivery agents (spec 24): the HTTP answers match the contract DTOs the web builds on (`@mechdost/shared/delivery/api`),
 * wrong codes answer 422 WRONG_CODE with the tries left, and routes under prefixes other files already guard
 * (`/shop/orders/*`, `/admin/orders/*`, `/admin/shops/*`) run each limiter once.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from '@mechdost/db/testing';
import { loadKeyring } from '@mechdost/db/crypto';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import {
  acceptAgentInvite,
  acceptShopOffer,
  advanceShopOrder,
  applyRazorpayPayment,
  createAgentInvite,
  decideAgentDocument,
  ensureUser,
  grantRole,
  placeOrder,
  quoteCheckout,
  recordRazorpayOrder,
  routeOrder,
  setAgentOnline,
  setAgentStatus,
  submitAgentDocument,
  syncRbacCatalogue,
} from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import {
  AdminJobDetail,
  AdminJobPage,
  AgentJobDetail,
  AgentJobPage,
  AgentOwnPayoutPage,
  AgentPayoutPage,
  AgentProfile,
  ShopDeliveryModeView,
  ShopOrderDelivery,
} from '@mechdost/shared/delivery/api';
import { bearer, buildApp, type ErrorJson } from './helpers';

const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
let n = 0;
let shopId = '';
let cityId = '';

async function login(role: string | null, scope: { shopId?: string } = {}) {
  n += 1;
  const phone = `+9196${String(10_000_000 + n).slice(-8)}`;
  const uid = `dl-c-${String(n)}-${randomUUID().slice(0, 6)}`;
  const token = ctx.verifier.add(`token-dlc-${uid}`, {
    firebaseUid: uid,
    phone,
    email: `${uid}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: uid,
    phone,
    email: `${uid}@example.com`,
    emailVerified: true,
  });
  if (role)
    await grantRole(ctx.db, {
      userId: user.id,
      role,
      shopId: scope.shopId ?? null,
      cityId: null,
      grantedBy: null,
    });
  return { headers: bearer(token), userId: user.id, phone };
}

const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  ctx.app.request(`/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let staff: Awaited<ReturnType<typeof login>>;
let finance: Awaited<ReturnType<typeof login>>;
let shopUser: Awaited<ReturnType<typeof login>>;
let customer: Awaited<ReturnType<typeof login>>;
let agentLogin: Awaited<ReturnType<typeof login>> & { agentId: string };
let orderCode = '';

beforeAll(async () => {
  ctx = await buildApp({ keyring });
  await syncRbacCatalogue(ctx.db);
  await seedRaipurDemo(ctx.db, fixture);
  const [shop] = await ctx.db.select().from(s.shops).where(eq(s.shops.name, 'Sharma Auto Parts'));
  shopId = shop!.id;
  cityId = shop!.cityId;
  staff = await login('ops_manager');
  finance = await login('finance');
  shopUser = await login('seller_owner', { shopId });
  customer = await login(null);
  // Admin city prices at MRP, so the shop is offered (see packages/db/test/shop-orders.test.ts).
  for (const v of await ctx.db.select().from(s.productVariants))
    if (v.mrpPaise !== null)
      await ctx.db
        .insert(s.adminPrices)
        .values({ variantId: v.id, cityId, sellingPaise: v.mrpPaise, updatedBy: staff.userId });
  await ctx.db.update(s.shops).set({ deliveryMode: 'agents' }).where(eq(s.shops.id, shopId));
  await ctx.db.update(s.shopInventory).set({ onHand: 100_000 }).where(eq(s.shopInventory.shopId, shopId));
  await ctx.db.insert(s.settings).values({ key: 'delivery.agents_enabled', value: true });
  await ctx.db.insert(s.settings).values({ key: 'delivery.photos_required', value: false });

  // An active, verified, online agent.
  const who = await login(null);
  const invite = await createAgentInvite(ctx.db, {
    scope: { all: true },
    staffUserId: staff.userId,
    keyring,
    from: { name: 'Contract Agent', phone: who.phone, cityCode: 'RPR', vehicleType: 'bike' },
  });
  const { agentId } = await acceptAgentInvite(ctx.db, { userId: who.userId, token: invite.token });
  const numbers = {
    pan: 'PQRST1234K',
    driving_licence: 'CG0420190012345',
    vehicle_rc: 'CG04AB1234',
  } as const;
  for (const kind of ['pan', 'driving_licence', 'vehicle_rc'] as const) {
    const id = randomUUID();
    const [m] = await ctx.db
      .insert(s.mediaObjects)
      .values({
        ownerKind: 'agent_document',
        ownerId: agentId,
        bucket: 'b',
        path: `delivery/${agentId}/${id}.webp`,
        thumbPath: `delivery/${agentId}/${id}-thumb.webp`,
        width: 1,
        height: 1,
        bytes: 1,
        thumbBytes: 1,
        sha256: 'b'.repeat(64),
        uploadedBy: who.userId,
      })
      .returning();
    await submitAgentDocument(ctx.db, {
      userId: who.userId,
      keyring,
      kind,
      number: numbers[kind],
      mediaId: m!.id,
    });
    await decideAgentDocument(ctx.db, {
      scope: { all: true },
      staffUserId: staff.userId,
      agentId,
      kind,
      decision: 'verified',
    });
  }
  const [a] = await ctx.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, agentId));
  const { version } = await setAgentStatus(ctx.db, {
    scope: { all: true },
    staffUserId: staff.userId,
    agentId,
    to: 'active',
    expectedVersion: a!.version,
  });
  await setAgentOnline(ctx.db, { userId: who.userId, online: true, expectedVersion: version });
  agentLogin = { ...who, agentId };

  // A prepaid order, routed to the agents-mode shop, accepted and packed.
  const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
  const q = await quoteCheckout(ctx.db, { pincode: '492004', lines, locale: 'en' });
  const placed = await placeOrder(ctx.db, {
    method: 'online',
    userId: customer.userId,
    idempotencyKey: `dl-contract-${randomUUID()}`,
    address: {
      contactName: 'Ravi',
      contactPhone: '+919876543210',
      line1: 'House 12',
      line2: null,
      landmark: null,
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: q.onlineTotalPaise,
    note: null,
    locale: 'en',
  });
  const [group] = await ctx.db.select().from(s.orderGroups).where(eq(s.orderGroups.code, placed.code));
  await recordRazorpayOrder(ctx.db, {
    groupId: group!.id,
    providerOrderId: 'order_dlcontract01',
    amountPaise: placed.totalPaise,
  });
  await applyRazorpayPayment(ctx.db, {
    providerOrderId: 'order_dlcontract01',
    providerPaymentId: 'pay_dlcontract01',
    status: 'captured',
    amountPaise: placed.totalPaise,
    currency: 'INR',
    method: 'upi',
  });
  orderCode = placed.orders[0]!.code;
  let [o] = await ctx.db.select().from(s.orders).where(eq(s.orders.code, orderCode));
  const r = await routeOrder(ctx.db, {
    scope: { all: true },
    code: orderCode,
    shopId,
    expectedVersion: o!.version,
    staffUserId: staff.userId,
  });
  await acceptShopOffer(ctx.db, {
    shopIds: [shopId],
    assignmentId: r.assignmentId,
    staffUserId: shopUser.userId,
  });
  [o] = await ctx.db.select().from(s.orders).where(eq(s.orders.code, orderCode));
  await advanceShopOrder(ctx.db, {
    shopIds: [shopId],
    code: orderCode,
    expectedVersion: o!.version,
    step: { to: 'packed' },
    staffUserId: shopUser.userId,
    keyring,
  });
});

describe('answers match the contract', () => {
  it('shop ready → admin queue and detail → offer → agent offers, accept, wrong pickup code, profile, payouts', async () => {
    let [o] = await ctx.db.select().from(s.orders).where(eq(s.orders.code, orderCode));
    const ready = await req('POST', `/shop/orders/${orderCode}/advance`, shopUser.headers, {
      to: 'ready_for_pickup',
      version: o!.version,
    });
    expect(ready.status).toBe(200);
    const shopList = (await (await req('GET', '/shop/orders?view=active', shopUser.headers)).json()) as {
      orders: { code: string; delivery: unknown }[];
    };
    const card = shopList.orders.find((x) => x.code === orderCode)!;
    expect(ShopOrderDelivery.safeParse(card.delivery).success).toBe(true);

    const queue = await (await req('GET', '/admin/delivery/jobs?view=needs_agent', staff.headers)).json();
    const page = AdminJobPage.parse(queue);
    const row = page.items.find((i) => i.orderCode === orderCode)!;
    const detail = AdminJobDetail.parse(
      await (await req('GET', `/admin/delivery/jobs/${row.jobId}`, staff.headers)).json(),
    );
    expect(detail.suggestions.map((x) => x.agentId)).toContain(agentLogin.agentId);
    const offered = await req('POST', `/admin/delivery/jobs/${row.jobId}/offer`, staff.headers, {
      agentId: agentLogin.agentId,
      version: row.version,
    });
    expect(offered.status).toBe(200);

    const offers = AgentJobPage.parse(
      await (await req('GET', '/agent/jobs?view=offers', agentLogin.headers)).json(),
    );
    const offer = offers.items.find((i) => i.jobId === row.jobId)!;
    const accepted = await req('POST', `/agent/offers/${offer.offerId!}/accept`, agentLogin.headers);
    const job = AgentJobDetail.parse(await accepted.json());
    expect(job.contact.stage).toBe('pickup');

    const wrong = await req('POST', `/agent/jobs/${job.jobId}/pickup`, agentLogin.headers, {
      pickupCode: '0000',
      version: job.version,
    });
    if (wrong.status !== 200) {
      expect(wrong.status).toBe(422);
      const body = (await wrong.json()) as ErrorJson;
      expect(body.error.code).toBe('WRONG_CODE');
      expect(body.error.details).toMatchObject({ attemptsLeft: 4 });
    }
    AgentProfile.parse(await (await req('GET', '/agent/me', agentLogin.headers)).json());

    const pay = await req('POST', '/admin/delivery/payouts', finance.headers, {
      agentId: agentLogin.agentId,
      amountPaise: 25_000,
      periodFrom: '2026-11-01',
      periodTo: '2026-11-07',
      method: 'upi',
      idempotencyKey: `pay-${randomUUID()}`,
    });
    expect(pay.status).toBe(200);
    AgentPayoutPage.parse(
      await (
        await req('GET', `/admin/delivery/payouts?agentId=${agentLogin.agentId}`, finance.headers)
      ).json(),
    );
    AgentOwnPayoutPage.parse(await (await req('GET', '/agent/payouts', agentLogin.headers)).json());
    const csv = await req('GET', '/admin/delivery/payouts.csv', finance.headers);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('Content-Type')).toContain('text/csv');
    ShopDeliveryModeView.parse(
      await (await req('GET', `/shop/delivery-mode/${shopId}`, shopUser.headers)).json(),
    );
    [o] = await ctx.db.select().from(s.orders).where(eq(s.orders.code, orderCode));
    expect(o!.status).toBe('ready_for_pickup');
  });
});

describe('limiters run once on routes under prefixes other files guard', () => {
  const drop = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const a = Number((await req(method, path, headers, body)).headers.get('RateLimit-Remaining'));
    const b = Number((await req(method, path, headers, body)).headers.get('RateLimit-Remaining'));
    return a - b;
  };
  it('shop return code, admin switch, admin shop mode, customer rating', async () => {
    expect(
      await drop('POST', `/shop/orders/${orderCode}/return-received`, shopUser.headers, {
        returnCode: '1234',
      }),
    ).toBe(1);
    expect(
      await drop('POST', `/admin/orders/${orderCode}/delivery-switch`, staff.headers, {
        reasonCode: 'no_agent_available',
      }),
    ).toBe(1);
    expect(
      await drop('PUT', `/admin/shops/${shopId}/delivery-mode`, staff.headers, {
        mode: 'self',
        note: 'Testing only',
        version: 0,
      }),
    ).toBe(1);
    expect(await drop('PUT', `/me/orders/${orderCode}/delivery-rating`, customer.headers, { stars: 5 })).toBe(
      1,
    );
  });
  it('the shop return code and the admin switch still need sign-in and the right permission', async () => {
    expect(
      (await req('POST', `/shop/orders/${orderCode}/return-received`, {}, { returnCode: '1234' })).status,
    ).toBe(401);
    expect(
      (
        await req('POST', `/shop/orders/${orderCode}/return-received`, customer.headers, {
          returnCode: '1234',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req('POST', `/admin/orders/${orderCode}/delivery-switch`, finance.headers, {
          reasonCode: 'other',
          note: 'x',
        })
      ).status,
    ).toBe(403);
    // A shop user is not an agent and not staff.
    expect((await req('GET', '/agent/me', shopUser.headers)).status).toBe(403);
    expect((await req('GET', '/admin/delivery/jobs', shopUser.headers)).status).toBe(403);
    void cityId;
  });
});
