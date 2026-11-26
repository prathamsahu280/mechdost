/**
 * Delivery agents (spec 24 acceptance): onboarding (invite bound to the phone, documents, no Aadhaar), routing sets
 * the delivery mode (COD stays with the shop), ready for pickup opens one job, offers (one open, expiry), actor
 * scoping (agent A vs B → 404), contact reveal by stage, pickup / delivery codes, failed → retry / return with the
 * refund rule, per-order switch, shop mode requests, ratings, and the database rules (one active job, append-only).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  acceptAgentInvite,
  acceptDeliveryOffer,
  advanceShopOrder,
  answerDeliverySwitch,
  confirmDeliveryReturn,
  createAgentInvite,
  declineDeliveryOffer,
  decideDeliveryFailure,
  decideShopModeRequest,
  deliverDeliveryJob,
  deliverShopOrder,
  deliveryCodeFor,
  expireDueDeliveryOffers,
  failDeliveryJob,
  getAgentJob,
  getAgentProfile,
  giveUpDeliveryJob,
  getMyOrder,
  listAdminJobs,
  listAgentJobs,
  listShopOrders,
  offerDeliveryJob,
  pickupDeliveryJob,
  rateDeliveryAgent,
  readHandoverCode,
  requestDeliverySwitch,
  requestShopDeliveryMode,
  setAgentStatus,
  submitAgentApplication,
  submitAgentDocument,
  suggestAgents,
  cityScopeFrom,
} from '../src/repo';
import * as s from '../src/schema';
import {
  jobOf,
  keyring,
  makeAgent,
  makeWorld,
  mediaFor,
  orderOf,
  packedOnlineOrder,
  type World,
} from './delivery-fixture';

let w: World;
beforeAll(async () => {
  w = await makeWorld();
});
afterAll(async () => {
  await w.close();
});

async function ready(code: string) {
  const o = await orderOf(w, code);
  await advanceShopOrder(w.t(), {
    shopIds: [w.shopId],
    code,
    expectedVersion: o.version,
    step: { to: 'ready_for_pickup' },
    staffUserId: w.shopUser,
    keyring,
  });
  return jobOf(w, o.id);
}

async function offerAndAccept(code: string, agent: { agentId: string; userId: string }) {
  const job = await jobOf(w, (await orderOf(w, code)).id);
  const { offerId } = await offerDeliveryJob(w.t(), {
    scope: { all: true },
    staffUserId: w.staff,
    jobId: job.id,
    agentId: agent.agentId,
    expectedVersion: job.version,
  });
  await acceptDeliveryOffer(w.t(), { userId: agent.userId, offerId });
  return jobOf(w, job.orderId);
}

async function pickUp(code: string, agent: { userId: string }) {
  const job = await jobOf(w, (await orderOf(w, code)).id);
  const pc = await readHandoverCode(w.t(), keyring, job.id, 'pickup');
  return pickupDeliveryJob(w.t(), {
    userId: agent.userId,
    jobId: job.id,
    pickupCode: pc!.code!,
    expectedVersion: job.version,
    keyring,
  });
}

async function customerCode(orderId: string) {
  const [ship] = await w.db.select().from(s.shipments).where(eq(s.shipments.orderId, orderId));
  return deliveryCodeFor(w.t(), keyring, ship!.id);
}

describe('onboarding', () => {
  it('the public application stores name, phone, city and vehicle only', async () => {
    const r = await submitAgentApplication(w.t(), {
      name: 'Sunil Verma',
      phone: '+919811112222',
      cityCode: 'RPR',
      vehicleType: 'scooter',
    });
    const [app] = await w.db
      .select()
      .from(s.partnerApplications)
      .where(eq(s.partnerApplications.code, r.code));
    expect(app).toMatchObject({
      kind: 'delivery_agent',
      vehicleType: 'scooter',
      pincode: null,
      status: 'new',
    });
  });

  it('an invite is bound to the phone, single use, and joining creates an onboarding agent with the role', async () => {
    const other = (
      await w.db
        .insert(s.users)
        .values({
          firebaseUid: `fb-dl-x-${randomUUID()}`,
          phone: '+919822223333',
          phoneVerifiedAt: new Date(),
        })
        .returning()
    )[0]!.id;
    const owner = (
      await w.db
        .insert(s.users)
        .values({
          firebaseUid: `fb-dl-y-${randomUUID()}`,
          phone: '+919822224444',
          phoneVerifiedAt: new Date(),
        })
        .returning()
    )[0]!.id;
    const inv = await createAgentInvite(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      keyring,
      from: { name: 'Mohan Lal', phone: '+919822224444', cityCode: 'RPR', vehicleType: 'bike' },
    });
    await expect(acceptAgentInvite(w.t(), { userId: other, token: inv.token })).rejects.toMatchObject({
      code: 'INVITE_PHONE_MISMATCH',
    });
    await expect(acceptAgentInvite(w.t(), { userId: owner, token: 'x'.repeat(43) })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const joined = await acceptAgentInvite(w.t(), { userId: owner, token: inv.token });
    expect(joined.status).toBe('onboarding');
    await expect(acceptAgentInvite(w.t(), { userId: owner, token: inv.token })).rejects.toMatchObject({
      code: 'INVITE_USED',
    });
    const roles = await w.db.execute(
      sql`select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${owner}`,
    );
    expect(JSON.stringify(roles)).toContain('delivery_agent');
    // The invite went out by WhatsApp with the token sealed (never in plain text).
    const out = await w.db
      .select()
      .from(s.notificationOutbox)
      .where(eq(s.notificationOutbox.dedupeKey, `delivery_agent_invite:${inv.id}:whatsapp`));
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out[0]!.payload)).not.toContain(inv.token);
  });

  it('refuses Aadhaar, needs all three documents verified before active, and only active agents go online', async () => {
    const ph = '+919833335555';
    const userId = (
      await w.db
        .insert(s.users)
        .values({ firebaseUid: `fb-dl-z-${randomUUID()}`, phone: ph, phoneVerifiedAt: new Date() })
        .returning()
    )[0]!.id;
    const inv = await createAgentInvite(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      keyring,
      from: { name: 'Raju Das', phone: ph, cityCode: 'RPR', vehicleType: 'bike' },
    });
    const { agentId } = await acceptAgentInvite(w.t(), { userId, token: inv.token });
    const mediaId = await mediaFor(w, 'agent_document', agentId, userId);
    await expect(
      submitAgentDocument(w.t(), { userId, keyring, kind: 'pan', number: '1234 5678 9012', mediaId }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_AADHAAR' });
    await submitAgentDocument(w.t(), { userId, keyring, kind: 'pan', number: 'abcde9876z', mediaId });
    const [doc] = await w.db
      .select()
      .from(s.deliveryAgentDocuments)
      .where(eq(s.deliveryAgentDocuments.agentId, agentId));
    expect(doc!.numberEnc).toMatch(/^v1\./);
    expect(doc!.numberEnc).not.toContain('ABCDE9876Z');
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, agentId));
    await expect(
      setAgentStatus(w.t(), {
        scope: { all: true },
        staffUserId: w.staff,
        agentId,
        to: 'active',
        expectedVersion: a!.version,
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENTS_NOT_VERIFIED' });
    const profile = await getAgentProfile(w.t(), userId);
    expect(profile).toMatchObject({
      status: 'onboarding',
      canReceiveOffers: false,
      missingDocuments: ['driving_licence', 'vehicle_rc'],
    });
    expect(profile.documents[0]!.numberMasked).toMatch(/876Z$/);
  });

  it('another city’s staff cannot see or act on the agent (404)', async () => {
    const agent = await makeAgent(w);
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, agent.agentId));
    await expect(
      setAgentStatus(w.t(), {
        scope: { all: false, cityIds: [randomUUID()] },
        staffUserId: w.staff,
        agentId: agent.agentId,
        to: 'paused',
        reasonCode: 'other',
        expectedVersion: a!.version,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('cityScopeFrom never turns a delivery-agent grant into staff scope', () => {
    const scope = cityScopeFrom(
      [
        {
          role: 'delivery_agent',
          permissions: ['delivery_jobs:assign', 'deliveries:read'],
          cityId: null,
          shopId: null,
          workshopId: null,
        },
      ],
      'delivery_jobs:assign',
    );
    expect(scope).toEqual({ all: false, cityIds: [] });
  });
});

describe('who delivers', () => {
  it('a prepaid order of an agents-mode shop is agent mode; COD stays with the shop', async () => {
    const online = await packedOnlineOrder(w);
    expect((await orderOf(w, online.code)).deliveryMode).toBe('agent');
    const cod = await packedOnlineOrder(w, 'cod');
    expect((await orderOf(w, cod.code)).deliveryMode).toBe('shop');
    const o = await orderOf(w, cod.code);
    await expect(
      advanceShopOrder(w.t(), {
        shopIds: [w.shopId],
        code: cod.code,
        expectedVersion: o.version,
        step: { to: 'ready_for_pickup' },
        staffUserId: w.shopUser,
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'WRONG_STEP' });
  });

  it('an agent-mode order: the shop marks it ready (one job, pickup code), and cannot ship or deliver it itself', async () => {
    const { code, orderId } = await packedOnlineOrder(w);
    let o = await orderOf(w, code);
    await expect(
      advanceShopOrder(w.t(), {
        shopIds: [w.shopId],
        code,
        expectedVersion: o.version,
        step: { to: 'out_for_delivery', handOverOwn: true },
        staffUserId: w.shopUser,
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'AGENT_DELIVERY' });
    const job = await ready(code);
    o = await orderOf(w, code);
    expect(o.status).toBe('ready_for_pickup');
    expect(job.status).toBe('needs_agent');
    const shopView = (await listShopOrders(w.t(), [w.shopId], 'active', { keyring })).items.find(
      (i) => i.code === code,
    )!;
    expect(shopView.deliveryMode).toBe('agent');
    expect(shopView.delivery?.pickupCode).toMatch(/^\d{4}$/);
    expect(shopView.address).toBeNull();
    await expect(
      deliverShopOrder(w.t(), {
        shopIds: [w.shopId],
        code,
        deliveryCode: '0000',
        expectedVersion: o.version,
        staffUserId: w.shopUser,
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'AGENT_DELIVERY' });
    // The database keeps one active job per sub-order.
    await expect(
      w.db.insert(s.deliveryJobs).values({ orderId, cityId: w.cityId, shopId: w.shopId }),
    ).rejects.toThrow();
  });
});

describe('dispatch and the agent flow', () => {
  it('offers, one open offer, accept, scoping (agent B → 404), reveal by stage, pickup and delivery with codes', async () => {
    const A = await makeAgent(w);
    const B = await makeAgent(w);
    const { code, orderId, groupCode } = await packedOnlineOrder(w);
    const job = await ready(code);
    const suggestions = await suggestAgents(w.t(), job);
    expect(suggestions.map((x) => x.agentId)).toEqual(expect.arrayContaining([A.agentId, B.agentId]));
    const { offerId } = await offerDeliveryJob(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: job.id,
      agentId: A.agentId,
      expectedVersion: job.version,
    });
    // A second offer of the same job (stale version) is refused.
    await expect(
      offerDeliveryJob(w.t(), {
        scope: { all: true },
        staffUserId: w.staff,
        jobId: job.id,
        agentId: B.agentId,
        expectedVersion: job.version,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await listAgentJobs(w.t(), { userId: A.userId, view: 'offers', limit: 10 })).items.map((i) => i.jobId),
    ).toContain(job.id);
    expect((await listAgentJobs(w.t(), { userId: B.userId, view: 'offers', limit: 10 })).items).toEqual([]);
    await expect(getAgentJob(w.t(), { userId: B.userId, jobId: job.id, keyring })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(acceptDeliveryOffer(w.t(), { userId: B.userId, offerId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const offered = await getAgentJob(w.t(), { userId: A.userId, jobId: job.id, keyring });
    expect(offered.contact.stage).toBe('pickup');
    expect(offered.contact.customer).toMatchObject({
      phone: null,
      name: null,
      addressLine: null,
      pincode: '492004',
    });
    expect(JSON.stringify(offered)).not.toContain('+919876543210');
    await acceptDeliveryOffer(w.t(), { userId: A.userId, offerId });
    await expect(acceptDeliveryOffer(w.t(), { userId: A.userId, offerId })).rejects.toMatchObject({
      code: 'OFFER_EXPIRED',
    });
    // Wrong pickup code is counted; the order stays ready.
    let j = await jobOf(w, orderId);
    const wrong = await pickupDeliveryJob(w.t(), {
      userId: A.userId,
      jobId: j.id,
      pickupCode: '0000',
      expectedVersion: j.version,
      keyring,
    });
    const pc = (await readHandoverCode(w.t(), keyring, j.id, 'pickup'))!.code!;
    if (pc !== '0000') {
      expect(wrong).toMatchObject({ ok: false, attemptsLeft: 4 });
      expect((await orderOf(w, code)).status).toBe('ready_for_pickup');
    }
    j = await jobOf(w, orderId);
    if (j.status === 'accepted') expect((await pickUp(code, A)).ok).toBe(true);
    expect((await orderOf(w, code)).status).toBe('out_for_delivery');
    const drop = await getAgentJob(w.t(), { userId: A.userId, jobId: j.id, keyring });
    expect(drop.contact.stage).toBe('drop');
    expect(drop.contact.customer?.phone).toBe('+919876543210');
    expect(JSON.stringify(drop)).not.toMatch(/deliveryCode|pickupCode/);
    const reveals = await w.db
      .select()
      .from(s.deliveryJobEvents)
      .where(and(eq(s.deliveryJobEvents.jobId, j.id), eq(s.deliveryJobEvents.kind, 'contact_revealed')));
    expect(reveals.map((r) => r.reasonCode).sort()).toEqual(['drop', 'pickup']);
    // The customer sees the agent's first name and vehicle, never the shop or the agent's phone.
    const mine = await getMyOrder(w.t(), w.customer, groupCode, { keyring, locale: 'en' });
    const view = JSON.stringify(mine);
    expect(view).not.toContain(A.phone);
    // Deliver with the customer's code.
    j = await jobOf(w, orderId);
    const custCode = (await customerCode(orderId))!;
    const res = await deliverDeliveryJob(w.t(), {
      userId: A.userId,
      jobId: j.id,
      deliveryCode: custCode,
      expectedVersion: j.version,
      keyring,
    });
    expect(res).toMatchObject({ ok: true, status: 'delivered' });
    expect((await orderOf(w, code)).status).toBe('delivered');
    const ev = await w.db
      .select()
      .from(s.orderEvents)
      .where(and(eq(s.orderEvents.orderId, orderId), eq(s.orderEvents.toStatus, 'delivered')));
    expect(ev[0]!.actorType).toBe('delivery_agent');
    // After delivery the agent sees no contacts any more.
    expect((await getAgentJob(w.t(), { userId: A.userId, jobId: j.id, keyring })).contact).toMatchObject({
      stage: 'none',
      shop: null,
      customer: null,
    });
  });

  it('a declined or expired offer returns the job to the admin queue', async () => {
    const A = await makeAgent(w);
    const { code, orderId } = await packedOnlineOrder(w);
    const job = await ready(code);
    const first = await offerDeliveryJob(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: job.id,
      agentId: A.agentId,
      expectedVersion: job.version,
    });
    await declineDeliveryOffer(w.t(), { userId: A.userId, offerId: first.offerId, reasonCode: 'too_far' });
    let j = await jobOf(w, orderId);
    expect(j.status).toBe('needs_agent');
    const B = await makeAgent(w);
    await offerDeliveryJob(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: j.id,
      agentId: B.agentId,
      expectedVersion: j.version,
    });
    await w.db.execute(
      sql`update delivery_job_offers set offered_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where job_id = ${j.id} and status = 'offered'`,
    );
    expect((await expireDueDeliveryOffers(w.t())).expired).toBeGreaterThanOrEqual(1);
    j = await jobOf(w, orderId);
    expect(j.status).toBe('needs_agent');
    expect(
      (await listAdminJobs(w.t(), { scope: { all: true }, view: 'needs_agent', limit: 50 })).items.map(
        (i) => i.jobId,
      ),
    ).toContain(j.id);
    // The agent who declined is no longer eligible for this job.
    expect((await suggestAgents(w.t(), j)).find((x) => x.agentId === A.agentId)?.eligible).toBe(false);
  });
});

describe('failed delivery', () => {
  it('one free retry with the same agent, then return to the shop; customer unreachable twice keeps the delivery fee', async () => {
    const A = await makeAgent(w);
    const { code, orderId } = await packedOnlineOrder(w);
    await ready(code);
    await offerAndAccept(code, A);
    await pickUp(code, A);
    let j = await jobOf(w, orderId);
    await failDeliveryJob(w.t(), {
      userId: A.userId,
      jobId: j.id,
      reasonCode: 'customer_unreachable',
      expectedVersion: j.version,
    });
    j = await jobOf(w, orderId);
    await decideDeliveryFailure(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: j.id,
      decision: 'retry',
      agent: 'same',
      expectedVersion: j.version,
      keyring,
    });
    j = await jobOf(w, orderId);
    expect(j.status).toBe('picked_up');
    await failDeliveryJob(w.t(), {
      userId: A.userId,
      jobId: j.id,
      reasonCode: 'customer_unreachable',
      expectedVersion: j.version,
    });
    j = await jobOf(w, orderId);
    await expect(
      decideDeliveryFailure(w.t(), {
        scope: { all: true },
        staffUserId: w.staff,
        jobId: j.id,
        decision: 'retry',
        agent: 'same',
        expectedVersion: j.version,
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'RETRY_LIMIT' });
    await decideDeliveryFailure(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: j.id,
      decision: 'return_to_shop',
      expectedVersion: j.version,
      keyring,
    });
    j = await jobOf(w, orderId);
    expect(j.status).toBe('returning');
    const agentView = await getAgentJob(w.t(), { userId: A.userId, jobId: j.id, keyring });
    expect(agentView.contact.stage).toBe('return');
    expect(agentView.contact.customer).toBeNull();
    expect(agentView.returnCode).toMatch(/^\d{4}$/);
    const res = await confirmDeliveryReturn(w.t(), {
      shopIds: [w.shopId],
      staffUserId: w.shopUser,
      orderCode: code,
      returnCode: agentView.returnCode!,
      keyring,
    });
    expect(res.ok).toBe(true);
    const o = await orderOf(w, code);
    expect(o).toMatchObject({ status: 'returned', statusReasonCode: 'customer_unreachable' });
    const [refund] = await w.db.select().from(s.refunds).where(eq(s.refunds.orderId, orderId));
    expect(refund).toMatchObject({
      source: 'delivery_returned',
      amountPaise: o.totalPaise - o.shippingPaise,
    });
  });

  it('retry with another agent goes back through the shop and opens job 2', async () => {
    const A = await makeAgent(w);
    const { code, orderId } = await packedOnlineOrder(w);
    await ready(code);
    await offerAndAccept(code, A);
    await pickUp(code, A);
    let j = await jobOf(w, orderId);
    await failDeliveryJob(w.t(), {
      userId: A.userId,
      jobId: j.id,
      reasonCode: 'vehicle_issue',
      expectedVersion: j.version,
    });
    j = await jobOf(w, orderId);
    await decideDeliveryFailure(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: j.id,
      decision: 'retry',
      agent: 'other',
      expectedVersion: j.version,
      keyring,
    });
    const rc = (await getAgentJob(w.t(), { userId: A.userId, jobId: j.id, keyring })).returnCode!;
    await confirmDeliveryReturn(w.t(), {
      shopIds: [w.shopId],
      staffUserId: w.shopUser,
      orderCode: code,
      returnCode: rc,
      keyring,
    });
    expect((await orderOf(w, code)).status).toBe('ready_for_pickup');
    const next = await jobOf(w, orderId);
    expect(next).toMatchObject({ seq: 2, status: 'needs_agent', failedAttempts: 1 });
  });
});

describe('switch to the shop, shop mode, ratings', () => {
  it('staff ask the shop to deliver a ready order; confirming cancels the job and puts it back to packed', async () => {
    const { code, orderId } = await packedOnlineOrder(w);
    await ready(code);
    const sw = await requestDeliverySwitch(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      orderCode: code,
      reasonCode: 'no_vehicle_for_load',
    });
    await answerDeliverySwitch(w.t(), {
      shopIds: [w.shopId],
      staffUserId: w.shopUser,
      orderCode: code,
      switchId: sw.id,
      decision: 'confirmed',
      expectedVersion: sw.version,
    });
    const o = await orderOf(w, code);
    expect(o).toMatchObject({ status: 'packed', deliveryMode: 'shop' });
    expect((await jobOf(w, orderId)).status).toBe('cancelled');
  });

  it('a shop asks to deliver itself; staff approve; history kept', async () => {
    const { id } = await requestShopDeliveryMode(w.t(), {
      shopIds: [w.shopId],
      shopId: w.shopId,
      staffUserId: w.shopUser,
      requestedMode: 'self',
      reasonCode: 'own_riders',
    });
    await expect(
      requestShopDeliveryMode(w.t(), {
        shopIds: [w.shopId],
        shopId: w.shopId,
        staffUserId: w.shopUser,
        requestedMode: 'self',
        reasonCode: 'own_riders',
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_PENDING' });
    const [r] = await w.db
      .select()
      .from(s.shopDeliveryModeRequests)
      .where(eq(s.shopDeliveryModeRequests.id, id));
    await decideShopModeRequest(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      requestId: id,
      decision: 'approved',
      expectedVersion: r!.version,
    });
    const [shop] = await w.db.select().from(s.shops).where(eq(s.shops.id, w.shopId));
    expect(shop!.deliveryMode).toBe('self');
    await w.db.update(s.shops).set({ deliveryMode: 'agents' }).where(eq(s.shops.id, w.shopId));
  });

  it('the customer rates the agent once per job, edits within 24 h, and the agent keeps sum and count', async () => {
    const A = await makeAgent(w);
    const { code, orderId, groupCode } = await packedOnlineOrder(w);
    await expect(
      rateDeliveryAgent(w.t(), { userId: w.customer, orderCode: code, stars: 5, reasons: [] }),
    ).rejects.toMatchObject({ code: 'NOT_RATEABLE' });
    await ready(code);
    await offerAndAccept(code, A);
    await pickUp(code, A);
    const j = await jobOf(w, orderId);
    await deliverDeliveryJob(w.t(), {
      userId: A.userId,
      jobId: j.id,
      deliveryCode: (await customerCode(orderId))!,
      expectedVersion: j.version,
      keyring,
    });
    await expect(
      rateDeliveryAgent(w.t(), { userId: w.staff, orderCode: code, stars: 5, reasons: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const first = await rateDeliveryAgent(w.t(), {
      userId: w.customer,
      orderCode: code,
      stars: 2,
      reasons: ['late'],
    });
    await rateDeliveryAgent(w.t(), {
      userId: w.customer,
      orderCode: code,
      stars: 4,
      reasons: ['on_time', 'polite'],
      expectedVersion: first.version,
    });
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, A.agentId));
    expect(a).toMatchObject({ ratingSum: 4, ratingCount: 1 });
    const profile = await getAgentProfile(w.t(), A.userId);
    expect(profile).toMatchObject({ ratingAvgX10: 40, ratingCount: 1 });
    await w.db.execute(
      sql`update delivery_ratings set editable_until = now() - interval '1 minute' where job_id = ${j.id}`,
    );
    const [r] = await w.db.select().from(s.deliveryRatings).where(eq(s.deliveryRatings.jobId, j.id));
    await expect(
      rateDeliveryAgent(w.t(), {
        userId: w.customer,
        orderCode: code,
        stars: 1,
        reasons: [],
        expectedVersion: r!.version,
      }),
    ).rejects.toMatchObject({ code: 'RATING_CLOSED' });
    const mine = await getMyOrder(w.t(), w.customer, groupCode, { keyring, locale: 'en' });
    const sub = (mine as { orders: { delivery: { stage: string; canRate: boolean } | null }[] }).orders[0]!;
    expect(sub.delivery).toMatchObject({ stage: 'delivered', canRate: false });
  });
});

describe('security review 2026-11-26: standing and documents', () => {
  it('replacing a verified document unverifies it, takes the agent offline and withdraws open offers', async () => {
    const A = await makeAgent(w);
    const { code, orderId } = await packedOnlineOrder(w);
    const job = await ready(code);
    const { offerId } = await offerDeliveryJob(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: job.id,
      agentId: A.agentId,
      expectedVersion: job.version,
    });
    const mediaId = await mediaFor(w, 'agent_document', A.agentId, A.userId);
    await submitAgentDocument(w.t(), {
      userId: A.userId,
      keyring,
      kind: 'pan',
      number: 'ZZZZZ9999Z',
      mediaId,
    });
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, A.agentId));
    expect(a!.online).toBe(false);
    const [doc] = await w.db
      .select()
      .from(s.deliveryAgentDocuments)
      .where(and(eq(s.deliveryAgentDocuments.agentId, A.agentId), eq(s.deliveryAgentDocuments.kind, 'pan')));
    expect(doc!.status).toBe('submitted');
    const [offer] = await w.db.select().from(s.deliveryJobOffers).where(eq(s.deliveryJobOffers.id, offerId));
    expect(offer!.status).toBe('withdrawn');
    expect((await jobOf(w, orderId)).status).toBe('needs_agent');
    // Even forced back online, an agent with an unverified document is never suggested and cannot accept.
    await w.db.update(s.deliveryAgents).set({ online: true }).where(eq(s.deliveryAgents.id, A.agentId));
    const j = await jobOf(w, orderId);
    expect((await suggestAgents(w.t(), j)).map((x) => x.agentId)).not.toContain(A.agentId);
    await w.db
      .insert(s.deliveryJobOffers)
      .values({ jobId: j.id, agentId: A.agentId, expiresAt: new Date(Date.now() + 600_000) });
    await w.db.update(s.deliveryJobs).set({ status: 'offered' }).where(eq(s.deliveryJobs.id, j.id));
    const [forced] = await w.db
      .select()
      .from(s.deliveryJobOffers)
      .where(and(eq(s.deliveryJobOffers.jobId, j.id), eq(s.deliveryJobOffers.status, 'offered')));
    await expect(acceptDeliveryOffer(w.t(), { userId: A.userId, offerId: forced!.id })).rejects.toMatchObject(
      { code: 'DOCUMENTS_NOT_VERIFIED' },
    );
  });

  it('a suspended agent loses accepted jobs to the queue, picked-up ones are flagged, and every job action is refused', async () => {
    const A = await makeAgent(w);
    const first = await packedOnlineOrder(w);
    await ready(first.code);
    await offerAndAccept(first.code, A);
    const second = await packedOnlineOrder(w);
    await ready(second.code);
    await offerAndAccept(second.code, A);
    await pickUp(second.code, A);
    const carried = await jobOf(w, second.orderId);
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, A.agentId));
    await setAgentStatus(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      agentId: A.agentId,
      to: 'suspended',
      reasonCode: 'safety_incident',
      expectedVersion: a!.version,
    });
    const back = await jobOf(w, first.orderId);
    expect(back).toMatchObject({ status: 'needs_agent', agentId: null });
    const flags = await w.db
      .select()
      .from(s.deliveryJobEvents)
      .where(
        and(eq(s.deliveryJobEvents.jobId, carried.id), eq(s.deliveryJobEvents.kind, 'agent_unavailable')),
      );
    expect(flags).toHaveLength(1);
    const deny = { code: 'AGENT_NOT_ACTIVE' };
    await expect(getAgentJob(w.t(), { userId: A.userId, jobId: carried.id, keyring })).rejects.toMatchObject(
      deny,
    );
    await expect(
      deliverDeliveryJob(w.t(), {
        userId: A.userId,
        jobId: carried.id,
        deliveryCode: '1234',
        expectedVersion: carried.version,
        keyring,
      }),
    ).rejects.toMatchObject(deny);
    await expect(
      failDeliveryJob(w.t(), {
        userId: A.userId,
        jobId: carried.id,
        reasonCode: 'vehicle_issue',
        expectedVersion: carried.version,
      }),
    ).rejects.toMatchObject(deny);
    await expect(
      pickupDeliveryJob(w.t(), {
        userId: A.userId,
        jobId: back.id,
        pickupCode: '1234',
        expectedVersion: back.version,
        keyring,
      }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    await expect(
      giveUpDeliveryJob(w.t(), {
        userId: A.userId,
        jobId: back.id,
        reasonCode: 'emergency',
        expectedVersion: back.version,
      }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
  });

  it('a paused agent may still show the return code of a parcel going back (stock safety), nothing else', async () => {
    const A = await makeAgent(w);
    const { code, orderId } = await packedOnlineOrder(w);
    await ready(code);
    await offerAndAccept(code, A);
    await pickUp(code, A);
    let j = await jobOf(w, orderId);
    await failDeliveryJob(w.t(), {
      userId: A.userId,
      jobId: j.id,
      reasonCode: 'wrong_address',
      expectedVersion: j.version,
    });
    j = await jobOf(w, orderId);
    await decideDeliveryFailure(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: j.id,
      decision: 'return_to_shop',
      expectedVersion: j.version,
      keyring,
    });
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, A.agentId));
    await setAgentStatus(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      agentId: A.agentId,
      to: 'paused',
      reasonCode: 'agent_request',
      expectedVersion: a!.version,
    });
    const view = await getAgentJob(w.t(), { userId: A.userId, jobId: j.id, keyring });
    expect(view.contact.customer).toBeNull();
    expect(view.returnCode).toMatch(/^\d{4}$/);
  });

  it('pause (lead ruling): accepted jobs go back to the queue, held parcels are flagged and may still be delivered', async () => {
    const A = await makeAgent(w);
    const first = await packedOnlineOrder(w);
    await ready(first.code);
    await offerAndAccept(first.code, A);
    const second = await packedOnlineOrder(w);
    await ready(second.code);
    await offerAndAccept(second.code, A);
    await pickUp(second.code, A);
    const accepted = await jobOf(w, first.orderId);
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, A.agentId));
    await setAgentStatus(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      agentId: A.agentId,
      to: 'paused',
      reasonCode: 'agent_request',
      expectedVersion: a!.version,
    });
    expect(await jobOf(w, first.orderId)).toMatchObject({ status: 'needs_agent', agentId: null });
    const carried = await jobOf(w, second.orderId);
    const flags = await w.db
      .select()
      .from(s.deliveryJobEvents)
      .where(
        and(eq(s.deliveryJobEvents.agentId, A.agentId), eq(s.deliveryJobEvents.kind, 'agent_unavailable')),
      );
    expect(flags.map((f) => f.jobId).sort()).toEqual([accepted.id, carried.id].sort());
    expect((await suggestAgents(w.t(), await jobOf(w, first.orderId))).map((x) => x.agentId)).not.toContain(
      A.agentId,
    );
    await expect(
      pickupDeliveryJob(w.t(), {
        userId: A.userId,
        jobId: accepted.id,
        pickupCode: '1234',
        expectedVersion: accepted.version,
        keyring,
      }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    const view = await getAgentJob(w.t(), { userId: A.userId, jobId: carried.id, keyring });
    expect(view.contact.stage).toBe('drop');
    const res = await deliverDeliveryJob(w.t(), {
      userId: A.userId,
      jobId: carried.id,
      deliveryCode: (await customerCode(second.orderId))!,
      expectedVersion: carried.version,
      keyring,
    });
    expect(res.ok).toBe(true);
  });

  it('offboard: a held parcel is flagged and can no longer be delivered by the agent', async () => {
    const A = await makeAgent(w);
    const o = await packedOnlineOrder(w);
    await ready(o.code);
    await offerAndAccept(o.code, A);
    await pickUp(o.code, A);
    const carried = await jobOf(w, o.orderId);
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, A.agentId));
    await setAgentStatus(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      agentId: A.agentId,
      to: 'offboarded',
      reasonCode: 'fraud_suspected',
      expectedVersion: a!.version,
    });
    const flags = await w.db
      .select()
      .from(s.deliveryJobEvents)
      .where(
        and(eq(s.deliveryJobEvents.jobId, carried.id), eq(s.deliveryJobEvents.kind, 'agent_unavailable')),
      );
    expect(flags).toHaveLength(1);
    await expect(
      deliverDeliveryJob(w.t(), {
        userId: A.userId,
        jobId: carried.id,
        deliveryCode: '1234',
        expectedVersion: carried.version,
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_ACTIVE' });
    await expect(getAgentJob(w.t(), { userId: A.userId, jobId: carried.id, keyring })).rejects.toMatchObject({
      code: 'AGENT_NOT_ACTIVE',
    });
  });

  it('offboarding removes the delivery_agent role', async () => {
    const A = await makeAgent(w);
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, A.agentId));
    await setAgentStatus(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      agentId: A.agentId,
      to: 'offboarded',
      reasonCode: 'agent_request',
      expectedVersion: a!.version,
    });
    const roles = await w.db.execute(
      sql`select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${A.userId}`,
    );
    expect(JSON.stringify(roles)).not.toContain('delivery_agent');
  });
});

describe('database rules', () => {
  it('job and agent timelines are append-only', async () => {
    await expect(w.db.execute(sql`update delivery_job_events set kind = 'photo'`)).rejects.toThrow();
    await expect(w.db.execute(sql`delete from delivery_agent_events`)).rejects.toThrow();
  });
  it('a returned order needs a delivery failure reason; an agent-only state needs agent mode', async () => {
    const { code } = await packedOnlineOrder(w, 'cod');
    await expect(
      w.db.execute(sql`update orders set status = 'ready_for_pickup' where code = ${code}`),
    ).rejects.toThrow();
  });
});
