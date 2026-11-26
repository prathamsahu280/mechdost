/**
 * Delivery agents in the browser demo (spec 24, design 2026-11-26): the demo store mirrors the contract's machines
 * (`deliveryJobMachine`, `deliveryOfferMachine`, `agentStatusMachine`) and the repositories' rules: a stale move is a
 * refused no-op, an agent only ever sees jobs offered to or held by them (null = 404), contacts are revealed by stage,
 * codes lock after 5 wrong tries, and a failed delivery comes back to the shop with the agent's return code.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { storeCore, type DemoOrder } from '../src/demo/store';
import {
  DEMO_AGENT_IDS,
  acceptInvite,
  acceptOffer,
  adminJobs,
  agentJobDetail,
  agentJobs,
  agentProfile,
  applyAsAgent,
  confirmSwitch,
  customerDelivery,
  decideFailure,
  decideShopMode,
  declineOffer,
  deliverJob,
  failJob,
  inviteAgent,
  markReadyForPickup,
  offerJob,
  pickupJob,
  previewInvite,
  requestShopMode,
  requestSwitch,
  returnReceived,
  saveAgentDocument,
  setOnline,
  shopDeliveryMode,
  shopOrderDelivery,
  shopModeView,
  sweepExpiredOffers,
} from '../src/demo/delivery-store';

function fakeWindow() {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}

const SHOP = 'gupta-lubes-spares';
const A = DEMO_AGENT_IDS.sunil;
const B = DEMO_AGENT_IDS.deepak;

function seedPackedOrder(code = 'MD-RPR-2026-ABC234', shop = SHOP): DemoOrder {
  const now = new Date().toISOString();
  const order: DemoOrder = {
    code,
    createdAt: now,
    lines: [
      {
        slug: 'castrol-activ-4t-20w40-900ml',
        name: 'Castrol Activ',
        brand: 'Castrol',
        qty: 1,
        unitPaise: 44_000,
      },
    ],
    subtotalPaise: 44_000,
    deliveryPaise: 4_000,
    totalPaise: 48_000,
    customer: {
      name: 'Ravi Sahu',
      phone: '9876543210',
      address: 'C-605 Salasar Greens, Sarona',
      pincode: '492099',
    },
    payment: 'cod',
    stage: 3, // packed
    shop: { slug: shop, status: 'accepted', offeredAt: now, expiresAt: now },
  };
  storeCore.write(storeCore.keys.orders, [order, ...storeCore.ordersSnapshot()]);
  return order;
}

const order = (code: string) => storeCore.ordersSnapshot().find((o) => o.code === code);
const jobOf = (code: string) =>
  adminJobs('needs_agent')
    .concat(
      adminJobs('offered'),
      adminJobs('active'),
      adminJobs('failed'),
      adminJobs('returning'),
      adminJobs('done'),
    )
    .find((j) => j.orderCode === code);

/** Ready → offered to A → accepted → picked up with the shop's code. Returns the job id. */
function toPickedUp(code: string): string {
  expect(markReadyForPickup(code, SHOP).ok).toBe(true);
  const job = jobOf(code);
  if (!job) throw new Error('no job');
  expect(offerJob(job.jobId, A, job.version).ok).toBe(true);
  const offer = agentJobs(A, 'offers')[0];
  if (!offer?.offerId) throw new Error('no offer');
  expect(acceptOffer(A, offer.offerId).ok).toBe(true);
  const pickupCode = shopOrderDelivery(code, SHOP)?.pickupCode;
  if (!pickupCode) throw new Error('no pickup code');
  const detail = agentJobDetail(A, job.jobId, 'en');
  if (!detail) throw new Error('no detail');
  expect(pickupJob(A, job.jobId, pickupCode, 'photo-1', detail.version)).toMatchObject({
    ok: true,
    status: 'picked_up',
  });
  return job.jobId;
}

describe('demo delivery agents', () => {
  beforeEach(() => {
    fakeWindow();
  });

  it('only agent-mode shops get "ready for pickup"; self-delivery shops are unchanged', () => {
    expect(shopDeliveryMode(SHOP)).toBe('agents');
    expect(shopDeliveryMode('sharma-auto-parts')).toBe('self');
    seedPackedOrder('MD-RPR-2026-ABC235', 'sharma-auto-parts');
    expect(markReadyForPickup('MD-RPR-2026-ABC235', 'sharma-auto-parts')).toEqual({
      ok: false,
      code: 'NOT_AGENT_MODE',
    });
    expect(shopOrderDelivery('MD-RPR-2026-ABC235', 'sharma-auto-parts')).toBeNull();
  });

  it('happy path: ready → offer → accept → pickup (shop code) → deliver (customer code)', () => {
    seedPackedOrder();
    const code = 'MD-RPR-2026-ABC234';
    expect(customerDelivery(code)).toBeNull();
    const jobId = toPickedUp(code);
    // Picked up: the order is out for delivery and the customer's code exists; the customer sees the first name.
    expect(order(code)?.stage).toBe(4);
    expect(customerDelivery(code)).toMatchObject({
      stage: 'picked_up',
      agentFirstName: 'Sunil',
      vehicleType: 'bike',
    });
    const detail = agentJobDetail(A, jobId, 'en');
    expect(detail?.contact.stage).toBe('drop');
    expect(detail?.contact.customer?.phone).toBe('9876543210');
    const wrong = deliverJob(
      A,
      jobId,
      '0000' === order(code)?.delivery?.code ? '1111' : '0000',
      'photo-2',
      detail?.version ?? 0,
    );
    expect(wrong).toMatchObject({ ok: false, attemptsLeft: 4, locked: false });
    const right = deliverJob(
      A,
      jobId,
      order(code)?.delivery?.code ?? '',
      'photo-2',
      agentJobDetail(A, jobId, 'en')?.version ?? 0,
    );
    expect(right).toMatchObject({ ok: true, status: 'delivered' });
    expect(order(code)?.stage).toBe(5);
    // Delivered: nothing of the customer stays visible to the agent.
    expect(agentJobDetail(A, jobId, 'en')?.contact.customer).toBeNull();
    expect(customerDelivery(code)?.stage).toBe('delivered');
  });

  it('before pickup the agent sees the customer area and PIN only', () => {
    seedPackedOrder();
    markReadyForPickup('MD-RPR-2026-ABC234', SHOP);
    const job = jobOf('MD-RPR-2026-ABC234');
    offerJob(job?.jobId ?? '', A, job?.version ?? 0);
    const detail = agentJobDetail(A, job?.jobId ?? '', 'en');
    expect(detail?.contact.stage).toBe('pickup');
    expect(detail?.contact.shop?.name).toBe('Gupta Lubes & Spares');
    expect(detail?.contact.customer).toMatchObject({
      pincode: '492099',
      name: null,
      phone: null,
      addressLine: null,
    });
  });

  it('role leak: another agent gets 404 (null) for a job never offered to them', () => {
    seedPackedOrder();
    const jobId = toPickedUp('MD-RPR-2026-ABC234');
    expect(agentJobDetail(B, jobId, 'en')).toBeNull();
    expect(agentJobs(B, 'active')).toHaveLength(0);
    expect(pickupJob(B, jobId, '1234', 'p', 0)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('a stale version is refused (CAS) and an expired offer goes back to the queue', () => {
    seedPackedOrder();
    markReadyForPickup('MD-RPR-2026-ABC234', SHOP);
    const job = jobOf('MD-RPR-2026-ABC234');
    expect(offerJob(job?.jobId ?? '', A, (job?.version ?? 0) + 5)).toEqual({
      ok: false,
      code: 'JOB_CHANGED',
    });
    offerJob(job?.jobId ?? '', A, job?.version ?? 0);
    const offerId = agentJobs(A, 'offers')[0]?.offerId ?? '';
    sweepExpiredOffers(Date.now() + 16 * 60_000); // default 15 min (founder 2026-11-26)
    expect(jobOf('MD-RPR-2026-ABC234')?.status).toBe('needs_agent');
    expect(acceptOffer(A, offerId)).toEqual({ ok: false, code: 'OFFER_EXPIRED' });
  });

  it('decline needs a reason code and returns the job to admin', () => {
    seedPackedOrder();
    markReadyForPickup('MD-RPR-2026-ABC234', SHOP);
    const job = jobOf('MD-RPR-2026-ABC234');
    offerJob(job?.jobId ?? '', A, job?.version ?? 0);
    const offerId = agentJobs(A, 'offers')[0]?.offerId ?? '';
    expect(declineOffer(A, offerId, 'other')).toEqual({ ok: false, code: 'NOTE_REQUIRED' });
    expect(declineOffer(A, offerId, 'too_far').ok).toBe(true);
    expect(jobOf('MD-RPR-2026-ABC234')?.status).toBe('needs_agent');
  });

  it('pickup code locks after 5 wrong tries', () => {
    seedPackedOrder();
    markReadyForPickup('MD-RPR-2026-ABC234', SHOP);
    const job = jobOf('MD-RPR-2026-ABC234');
    offerJob(job?.jobId ?? '', A, job?.version ?? 0);
    acceptOffer(A, agentJobs(A, 'offers')[0]?.offerId ?? '');
    const right = shopOrderDelivery('MD-RPR-2026-ABC234', SHOP)?.pickupCode ?? '';
    const wrong = right === '0000' ? '1111' : '0000';
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = pickupJob(
        A,
        job?.jobId ?? '',
        wrong,
        'p',
        agentJobDetail(A, job?.jobId ?? '', 'en')?.version ?? 0,
      );
    }
    expect(last).toMatchObject({ ok: false, locked: true, attemptsLeft: 0 });
    expect(
      pickupJob(A, job?.jobId ?? '', right, 'p', agentJobDetail(A, job?.jobId ?? '', 'en')?.version ?? 0),
    ).toMatchObject({ ok: false, locked: true });
  });

  it('a photo is required while photos are on', () => {
    seedPackedOrder();
    markReadyForPickup('MD-RPR-2026-ABC234', SHOP);
    const job = jobOf('MD-RPR-2026-ABC234');
    offerJob(job?.jobId ?? '', A, job?.version ?? 0);
    acceptOffer(A, agentJobs(A, 'offers')[0]?.offerId ?? '');
    const code = shopOrderDelivery('MD-RPR-2026-ABC234', SHOP)?.pickupCode ?? '';
    expect(
      pickupJob(A, job?.jobId ?? '', code, null, agentJobDetail(A, job?.jobId ?? '', 'en')?.version ?? 0),
    ).toEqual({
      ok: false,
      code: 'PHOTO_REQUIRED',
    });
  });

  it('failed → return to shop with the agent return code → order returned, refund by fault', () => {
    seedPackedOrder();
    const code = 'MD-RPR-2026-ABC234';
    const jobId = toPickedUp(code);
    expect(
      failJob(A, jobId, 'customer_refused', undefined, 'p3', agentJobDetail(A, jobId, 'en')?.version ?? 0).ok,
    ).toBe(true);
    expect(customerDelivery(code)?.stage).toBe('attempt_failed');
    const failed = jobOf(code);
    expect(decideFailure(failed?.jobId ?? '', 'return_to_shop', undefined, failed?.version ?? 0).ok).toBe(
      true,
    );
    const back = agentJobDetail(A, jobId, 'en');
    expect(back?.contact.stage).toBe('return');
    expect(back?.contact.customer).toBeNull();
    expect(shopOrderDelivery(code, SHOP)?.returning).toBe(true);
    expect(returnReceived(code, SHOP, back?.returnCode ?? '').ok).toBe(true);
    expect(order(code)?.returned?.refund).toBe('parts_only');
    expect(customerDelivery(code)?.stage).toBe('returned');
  });

  it('retry with another agent sends the parcel back and opens a new job', () => {
    seedPackedOrder();
    const code = 'MD-RPR-2026-ABC234';
    const jobId = toPickedUp(code);
    failJob(A, jobId, 'vehicle_issue', undefined, 'p3', agentJobDetail(A, jobId, 'en')?.version ?? 0);
    const failed = jobOf(code);
    decideFailure(failed?.jobId ?? '', 'retry', 'other', failed?.version ?? 0);
    returnReceived(code, SHOP, agentJobDetail(A, jobId, 'en')?.returnCode ?? '');
    expect(order(code)?.stage).toBe(3);
    expect(jobOf(code)).toMatchObject({ status: 'needs_agent', attempt: 2 });
    expect(customerDelivery(code)?.stage).toBe('retrying');
  });

  it('admin switch to shop delivery: the shop confirms and the job is cancelled', () => {
    seedPackedOrder();
    const code = 'MD-RPR-2026-ABC234';
    markReadyForPickup(code, SHOP);
    expect(requestSwitch(code, 'no_agent_available').ok).toBe(true);
    const sw = shopOrderDelivery(code, SHOP)?.switchRequest;
    expect(sw?.reasonCode).toBe('no_agent_available');
    expect(confirmSwitch(code, SHOP, sw?.id ?? '', sw?.version ?? 0).ok).toBe(true);
    expect(jobOf(code)?.status).toBe('cancelled');
    expect(shopOrderDelivery(code, SHOP)?.mode).toBe('shop');
  });

  it('shop asks to deliver itself; admin approves; one pending request at a time', () => {
    expect(requestShopMode(SHOP, 'self', 'own_riders').ok).toBe(true);
    expect(requestShopMode(SHOP, 'self', 'own_riders')).toEqual({ ok: false, code: 'REQUEST_PENDING' });
    const req = shopModeView(SHOP).requests[0];
    expect(decideShopMode(req?.id ?? '', true, req?.version ?? 0).ok).toBe(true);
    expect(shopDeliveryMode(SHOP)).toBe('self');
  });

  it('apply → invite → accept with the same phone → onboarding agent with documents to upload', () => {
    const app = applyAsAgent({
      name: 'Manish Dewangan',
      phone: '9123456780',
      cityCode: 'RPR',
      vehicleType: 'scooter',
    });
    const inv = inviteAgent({ applicationCode: app.code });
    if (!inv.ok) throw new Error(inv.code);
    expect(previewInvite(inv.data.token)?.phoneLast4).toBe('6780');
    expect(acceptInvite(inv.data.token, { id: 'acct-x', phone: '9000000099' })).toEqual({
      ok: false,
      code: 'INVITE_PHONE_MISMATCH',
    });
    const ok = acceptInvite(inv.data.token, { id: 'acct-m', phone: '9123456780' });
    if (!ok.ok) throw new Error(ok.code);
    const profile = agentProfile(ok.data.agentId);
    expect(profile?.status).toBe('onboarding');
    expect(profile?.missingDocuments).toEqual(['pan', 'driving_licence', 'vehicle_rc']);
    expect(saveAgentDocument(ok.data.agentId, 'pan', '123412341234')).toEqual({
      ok: false,
      code: 'DOCUMENT_AADHAAR',
    });
    expect(saveAgentDocument(ok.data.agentId, 'pan', 'abcde1234f').ok).toBe(true);
    // Not active yet: cannot go online.
    expect(setOnline(ok.data.agentId, true, profile?.version ?? 0)).toEqual({
      ok: false,
      code: 'AGENT_NOT_ACTIVE',
    });
  });
});
