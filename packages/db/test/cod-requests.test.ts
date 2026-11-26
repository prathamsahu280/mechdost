/**
 * Cash-on-delivery eligibility (founder ruling 2026-11-26, spec 03 § Cash-on-delivery eligibility): the real
 * defaults (everyone off, approved customers on, verified Ustaad members on), one pending request per customer
 * (database-enforced), decisions by compare-and-set with history, audit and analytics rows, city scope for staff,
 * and the checkout honouring it (quote reason + placement refusal, personal cap, minimum order and pieces).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  codStatusFor,
  decideCodRequest,
  listCodRequests,
  myCodRequests,
  placeCodOrder,
  quoteCheckout,
  requestCod,
  revokeCodApproval,
  withdrawCodRequest,
  type ShippingAddress,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let raipur = '';
const ALL = { all: true } as const;
const OIL = 'CAS-ACT4T-0900';
const PIN = '492004';
const address = (): ShippingAddress => ({
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  line2: null,
  landmark: null,
  pincode: PIN,
});
let n = 0;
const newUser = async () =>
  (
    await db
      .insert(s.users)
      .values({ firebaseUid: `fb-cod-${String(++n)}` })
      .returning()
  )[0]!.id;
const key = () => `cod-key-${String(++n).padStart(10, '0')}`;

async function setGlobal(k: string, value: unknown) {
  await db.execute(sql`insert into settings (city_id, key, value) values (null, ${k}, ${JSON.stringify(value)}::jsonb)
    on conflict (city_id, key) do update set value = excluded.value`);
}

async function placeOil(userId: string, qty = 1) {
  const lines = [{ sku: OIL, qty }];
  const q = await quoteCheckout(t(), { pincode: PIN, lines, locale: 'en' }, { userId });
  return placeCodOrder(t(), {
    userId,
    address: address(),
    note: null,
    locale: 'en',
    idempotencyKey: key(),
    lines,
    expectedTotalPaise: q.totalPaise,
  });
}

beforeAll(async () => {
  // The real defaults: no "everyone" switch from the legacy test fixture.
  ({ db, client } = await createTestDb({ codDefaults: true }));
  await seedRaipurDemo(t(), fixture);
  staff = await newUser();
  raipur = (await db.select({ id: s.cities.id }).from(s.cities).where(eq(s.cities.code, 'RPR')))[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('defaults (founder ruling 2026-11-26)', () => {
  it('a normal customer gets no cash on delivery, even for one piece, and the quote says why', async () => {
    const user = await newUser();
    const q = await quoteCheckout(
      t(),
      { pincode: PIN, lines: [{ sku: OIL, qty: 1 }], locale: 'en' },
      { userId: user },
    );
    expect(q.cod.allowed).toBe(false);
    expect(q.cod.eligibility).toMatchObject({ eligible: false, reason: 'not_approved', canRequest: true });
    await expect(placeOil(user)).rejects.toMatchObject({
      code: 'COD_NOT_ELIGIBLE',
      details: { reason: 'not_approved' },
    });
  });

  it('a guest quote asks to sign in', async () => {
    const q = await quoteCheckout(t(), { pincode: PIN, lines: [{ sku: OIL, qty: 1 }], locale: 'en' });
    expect(q.cod.eligibility.reason).toBe('sign_in_required');
    expect(q.cod.allowed).toBe(false);
  });
});

describe('requests and decisions', () => {
  it('one pending request per customer; a second is refused', async () => {
    const user = await newUser();
    const r = await requestCod(t(), {
      userId: user,
      pincode: PIN,
      reasonCode: 'no_upi_or_card',
      note: 'No UPI',
    });
    expect(r.status).toBe('pending');
    await expect(
      requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'other', note: null }),
    ).rejects.toMatchObject({ code: 'COD_REQUEST_PENDING' });
    // Database-enforced too (partial unique index), not only by the repository's check.
    await expect(
      db.execute(
        sql`insert into cod_requests (user_id, city_id, pincode, reason_code) values (${user}, ${raipur}, ${PIN}, 'other')`,
      ),
    ).rejects.toThrow();
    const status = await codStatusFor(t(), { userId: user, pincode: PIN });
    expect(status.eligibility.reason).toBe('request_pending');
  });

  it('approve → COD at checkout with the personal cap; stale version is refused; history, audit and event rows', async () => {
    const user = await newUser();
    const r = await requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'regular_buyer', note: null });
    await expect(
      decideCodRequest(t(), {
        requestId: r.id,
        expectedVersion: r.version + 1,
        decision: 'approve',
        staffUserId: staff,
        scope: ALL,
      }),
    ).rejects.toMatchObject({ code: 'STALE_COD_REQUEST' });
    const approved = await decideCodRequest(t(), {
      requestId: r.id,
      expectedVersion: r.version,
      decision: 'approve',
      capPaise: 100_000,
      staffUserId: staff,
      scope: ALL,
    });
    expect(approved.status).toBe('approved');
    const status = await codStatusFor(t(), { userId: user, pincode: PIN });
    expect(status.eligibility).toMatchObject({ eligible: true, via: 'approved', capPaise: 100_000 });
    const placed = await placeOil(user);
    expect(placed.paymentMethod).toBe('cod');
    // Three bottles (₹1,320 + delivery) are over the personal ₹1,000 cap, though under the city's ₹5,000.
    await expect(placeOil(user, 3)).rejects.toMatchObject({
      code: 'COD_NOT_ALLOWED',
      details: { reason: 'over_cap' },
    });

    const events = await db.select().from(s.codRequestEvents).where(eq(s.codRequestEvents.requestId, r.id));
    expect(events.map((e) => e.toStatus)).toEqual(['pending', 'approved']);
    const audits = await db
      .select({ action: s.auditLog.action })
      .from(s.auditLog)
      .where(eq(s.auditLog.entityId, r.id));
    expect(audits.map((a) => a.action).sort()).toEqual(['cod_request.approved', 'cod_request.created']);
    const analytics = await db.execute<{ name: string }>(
      sql`select event as name from events where event in ('cod_requested','cod_request_approved') and props->>'requestId' = ${r.id}`,
    );
    expect((analytics.rows as { name: string }[]).map((x) => x.name).sort()).toEqual([
      'cod_request_approved',
      'cod_requested',
    ]);
    // The append-only history cannot be edited.
    await expect(
      db.execute(sql`update cod_request_events set to_status = 'rejected' where request_id = ${r.id}`),
    ).rejects.toThrow();
    // Bell + email notice queued for the customer.
    const notices = await db
      .select({ kind: s.notifications.kind })
      .from(s.notifications)
      .where(eq(s.notifications.userId, user));
    expect(notices.map((x) => x.kind)).toContain('account.cod_approved');
  });

  it('reject needs a reason code; the customer waits before asking again', async () => {
    const user = await newUser();
    const r = await requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'large_order', note: null });
    await expect(
      decideCodRequest(t(), {
        requestId: r.id,
        expectedVersion: r.version,
        decision: 'reject',
        staffUserId: staff,
        scope: ALL,
      }),
    ).rejects.toMatchObject({ code: 'COD_REASON_REQUIRED' });
    await decideCodRequest(t(), {
      requestId: r.id,
      expectedVersion: r.version,
      decision: 'reject',
      reasonCode: 'insufficient_history',
      staffUserId: staff,
      scope: ALL,
    });
    const status = await codStatusFor(t(), { userId: user, pincode: PIN });
    expect(status.eligibility).toMatchObject({ eligible: false, reason: 'rejected', canRequest: false });
    expect(status.request?.decisionReasonCode).toBe('insufficient_history');
    await expect(
      requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'other', note: null }),
    ).rejects.toMatchObject({ code: 'COD_REQUEST_TOO_SOON' });
  });

  it('revoke takes COD away again; expired approvals stop counting and can be approved anew', async () => {
    const user = await newUser();
    const r = await requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'no_upi_or_card', note: null });
    const a = await decideCodRequest(t(), {
      requestId: r.id,
      expectedVersion: r.version,
      decision: 'approve',
      staffUserId: staff,
      scope: ALL,
    });
    await revokeCodApproval(t(), {
      requestId: r.id,
      expectedVersion: a.version,
      reasonCode: 'cod_refused',
      staffUserId: staff,
      scope: ALL,
    });
    expect((await codStatusFor(t(), { userId: user, pincode: PIN })).eligibility.reason).toBe('revoked');
    await expect(placeOil(user)).rejects.toMatchObject({
      code: 'COD_NOT_ELIGIBLE',
      details: { reason: 'revoked' },
    });

    const other = await newUser();
    const r2 = await requestCod(t(), {
      userId: other,
      pincode: PIN,
      reasonCode: 'no_upi_or_card',
      note: null,
    });
    await decideCodRequest(t(), {
      requestId: r2.id,
      expectedVersion: r2.version,
      decision: 'approve',
      expiresAt: new Date(Date.now() + 3_600_000),
      staffUserId: staff,
      scope: ALL,
    });
    // Let it run out (the check allows end dates only after the decision; move both back).
    await db.execute(
      sql`update cod_requests set decided_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = ${r2.id}`,
    );
    const st = await codStatusFor(t(), { userId: other, pincode: PIN });
    expect(st.eligibility).toMatchObject({ eligible: false, reason: 'expired', canRequest: true });
    const r3 = await requestCod(t(), {
      userId: other,
      pincode: PIN,
      reasonCode: 'regular_buyer',
      note: null,
    });
    const a3 = await decideCodRequest(t(), {
      requestId: r3.id,
      expectedVersion: r3.version,
      decision: 'approve',
      staffUserId: staff,
      scope: ALL,
    });
    expect(a3.status).toBe('approved');
    const [old] = await db
      .select({ status: s.codRequests.status })
      .from(s.codRequests)
      .where(eq(s.codRequests.id, r2.id));
    expect(old?.status).toBe('expired');
  });

  it('withdraw by the customer; a foreign id is a 404', async () => {
    const user = await newUser();
    const stranger = await newUser();
    const r = await requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'other', note: null });
    await expect(
      withdrawCodRequest(t(), { userId: stranger, requestId: r.id, expectedVersion: r.version }),
    ).rejects.toMatchObject({
      status: 404,
    });
    await withdrawCodRequest(t(), { userId: user, requestId: r.id, expectedVersion: r.version });
    expect((await myCodRequests(t(), user))[0]?.status).toBe('withdrawn');
  });

  it('staff city scope: another city is a 404 and the queue hides it', async () => {
    const user = await newUser();
    const r = await requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'other', note: null });
    const elsewhere = { all: false as const, cityIds: ['00000000-0000-7000-8000-000000000000'] };
    await expect(
      decideCodRequest(t(), {
        requestId: r.id,
        expectedVersion: r.version,
        decision: 'approve',
        staffUserId: staff,
        scope: elsewhere,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const hidden = await listCodRequests(t(), { scope: elsewhere, status: 'pending', limit: 50 });
    expect(hidden.items).toHaveLength(0);
    const shown = await listCodRequests(t(), {
      scope: { all: false, cityIds: [raipur] },
      status: 'pending',
      limit: 50,
    });
    expect(shown.items.some((i) => i.id === r.id)).toBe(true);
  });

  it('staff cannot decide their own request', async () => {
    const r = await requestCod(t(), { userId: staff, pincode: PIN, reasonCode: 'other', note: null });
    await expect(
      decideCodRequest(t(), {
        requestId: r.id,
        expectedVersion: r.version,
        decision: 'approve',
        staffUserId: staff,
        scope: ALL,
      }),
    ).rejects.toMatchObject({ code: 'COD_SELF_DECISION' });
  });
});

describe('Ustaad route and cart rules', () => {
  it('a verified, active Ustaad member has COD; unverified does not', async () => {
    const member = await newUser();
    await db.insert(s.ustaadMembers).values({
      userId: member,
      handle: `cod_member_${String(n)}`,
      displayName: 'Ramesh',
      track: 'ustaad',
      level: 'naya',
      verificationState: 'pending_verification',
      cityId: raipur,
      areaLabel: 'Pandri',
      pincode: PIN,
      workPlace: 'shop',
    });
    expect((await codStatusFor(t(), { userId: member, pincode: PIN })).eligibility.reason).toBe(
      'ustaad_not_verified',
    );
    await db
      .update(s.ustaadMembers)
      .set({ verificationState: 'verified', verifiedAt: new Date() })
      .where(eq(s.ustaadMembers.userId, member));
    expect((await codStatusFor(t(), { userId: member, pincode: PIN })).eligibility).toMatchObject({
      eligible: true,
      via: 'ustaad',
    });
    expect((await placeOil(member)).paymentMethod).toBe('cod');
  });

  it('minimum order and pieces apply to eligible customers; "everyone" brings back the old behaviour', async () => {
    const user = await newUser();
    await setGlobal('checkout.cod_everyone', true);
    await setGlobal('checkout.cod_min_items', 2);
    await expect(placeOil(user, 1)).rejects.toMatchObject({
      code: 'COD_NOT_ALLOWED',
      details: { reason: 'below_min_items' },
    });
    expect((await placeOil(user, 2)).paymentMethod).toBe('cod');
    await setGlobal('checkout.cod_min_items', 1);
    await setGlobal('checkout.cod_min_order_paise', 10_000_000);
    await expect(placeOil(user, 1)).rejects.toMatchObject({
      code: 'COD_NOT_ALLOWED',
      details: { reason: 'below_min_order' },
    });
    await setGlobal('checkout.cod_min_order_paise', 0);
    await setGlobal('checkout.cod_everyone', false);
    const q = await quoteCheckout(
      t(),
      { pincode: PIN, lines: [{ sku: OIL, qty: 1 }], locale: 'en' },
      { userId: user },
    );
    expect(q.cod.allowed).toBe(false);
  });

  it('a city value overrides the global one', async () => {
    const user = await newUser();
    await db.execute(
      sql`insert into settings (city_id, key, value) values (${raipur}, 'checkout.cod_everyone', 'true'::jsonb)`,
    );
    const q = await quoteCheckout(
      t(),
      { pincode: PIN, lines: [{ sku: OIL, qty: 1 }], locale: 'en' },
      { userId: user },
    );
    expect(q.cod.eligibility).toMatchObject({ eligible: true, via: 'everyone' });
    await db
      .delete(s.settings)
      .where(and(eq(s.settings.cityId, raipur), eq(s.settings.key, 'checkout.cod_everyone')));
  });
});
