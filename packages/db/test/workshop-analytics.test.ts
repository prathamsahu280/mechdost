/**
 * Workshop analytics (design 2026-11-15, spec 08 / 07): per-workshop aggregates over service requests in an IST range.
 * Covers the funnel read from the append-only timeline, median minutes (propose, estimate, job), acceptance with
 * declines, the latest estimate version's lines, bills and visit fees, comebacks (same customer, same vehicle, same
 * workshop, within 30 days), photos, ratings, mode split, reasons, the city scope, the range edges, a single
 * workshop's own numbers, and the shared rate and median helpers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveAnalyticsRange, type AnalyticsRange } from '@mechdost/shared/analytics-range';
import { workshopMedians, workshopRates } from '@mechdost/shared/workshop-analytics-api';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { cityWorkshopAnalytics, ownWorkshopAnalytics, workshopCityId, type Tx } from '../src/repo';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const NOW = new Date('2026-11-14T06:00:00Z');
const NOV = (() => {
  const r = resolveAnalyticsRange({ from: '2026-11-01', to: '2026-11-10' }, NOW);
  if (!r.ok) throw new Error(r.code);
  return r as AnalyticsRange;
})();
let n = 0;
const W = { a: '', b: '', c: '', quiet: '', bhilai: '' };

interface Req {
  ws: string;
  at: string;
  status: string;
  user?: string;
  vehicleKey?: string;
  vehicleId?: string;
  mode?: 'workshop' | 'home';
  reason?: string;
  completedAt?: string;
  city?: string;
  /** Timeline: [to_status, minutes after `at`]. */
  steps?: [string, number][];
  proposeAfter?: number;
}

const plus = (at: string, minutes: number) => new Date(new Date(at).getTime() + minutes * 60_000);

async function req(i: Req): Promise<string> {
  n += 1;
  const received = !['awaiting_workshop', 'proposed', 'confirmed', 'cancelled'].includes(i.status);
  const home = i.mode === 'home';
  const [r] = await db
    .insert(s.serviceRequests)
    .values({
      code: `SR-RPR-2026-WA${String(n).padStart(4, '0')}`,
      userId: i.user ?? f.customer,
      cityId: i.city ?? f.raipur,
      workshopId: i.ws,
      routingMode: 'chosen',
      vehicleId: i.vehicleId ?? null,
      vehicleType: '2W',
      vehicleText: 'Honda Activa 6G',
      vehicleKey: i.vehicleKey ?? 'honda activa 6g',
      services: [],
      pincode: '492001',
      preferredDate: '2026-11-20',
      preferredSlot: 'morning',
      status: i.status,
      statusReasonCode: i.reason ?? null,
      customerMessage: i.status === 'rejected' ? 'We cannot take this request now.' : null,
      odometerKm: received ? 12_000 : null,
      completedAt: i.completedAt ? new Date(i.completedAt) : null,
      idempotencyKey: `wa-request-${String(n).padStart(8, '0')}`,
      serviceMode: home ? 'home' : 'workshop',
      location: home ? { lng: 81.63, lat: 21.25 } : null,
      homeAddress: home ? { line: 'x' } : null,
      visitFeePaise: home ? 20_000 : null,
      createdAt: new Date(i.at),
    })
    .returning();
  if (!r) throw new Error('request');
  const steps: [string, number][] = [['awaiting_workshop', 0], ...(i.steps ?? [])];
  for (const [to, minutes] of steps)
    await db.insert(s.serviceEvents).values({
      requestId: r.id,
      toStatus: to,
      actorType: 'system',
      createdAt: plus(i.at, minutes),
    });
  if (i.proposeAfter !== undefined)
    await db.insert(s.serviceProposals).values({
      requestId: r.id,
      workshopId: i.ws,
      proposedDate: '2026-11-20',
      slot: 'morning',
      lowPaise: 50_000,
      highPaise: 90_000,
      status: 'accepted',
      createdAt: plus(i.at, i.proposeAfter),
    });
  return r.id;
}

async function estimate(
  requestId: string,
  revision: number,
  lines: { qty: number; unit: number; decision: string }[],
) {
  const [e] = await db
    .insert(s.estimates)
    .values({ requestId, revision, status: revision === 1 ? 'superseded' : 'decided', decidedAt: new Date() })
    .returning();
  if (!e) throw new Error('estimate');
  for (const [k, l] of lines.entries())
    await db.insert(s.estimateItems).values({
      estimateId: e.id,
      lineNo: k + 1,
      description: `Line ${String(k + 1)}`,
      qty: l.qty,
      unitPaise: l.unit,
      gstRateBp: 1800,
      decision: l.decision,
    });
}

async function bill(requestId: string, total: number, paid: 'cash' | 'upi' | null) {
  await db.insert(s.serviceBills).values({
    requestId,
    lines: [{ d: 'x' }],
    gstRegistered: false,
    taxablePaise: total,
    cgstPaise: 0,
    sgstPaise: 0,
    roundOffPaise: 0,
    totalPaise: total,
    paidAt: paid ? new Date('2026-11-09T10:00:00Z') : null,
    method: paid,
  });
}

async function photo(requestId: string) {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const [m] = await db
    .insert(s.mediaObjects)
    .values({
      ownerKind: 'service_photo',
      ownerId: requestId,
      bucket: 'service-photos',
      path: `service-photos/${requestId}/${id}.webp`,
      thumbPath: `service-photos/${requestId}/${id}-thumb.webp`,
      width: 100,
      height: 100,
      bytes: 1000,
      thumbBytes: 100,
      sha256: 'a'.repeat(64),
    })
    .returning();
  if (!m) throw new Error('media');
  await db.insert(s.servicePhotos).values({ requestId, stage: 'before', mediaId: m.id });
}

async function review(requestId: string, ws: string, rating: number, at: string) {
  await db.insert(s.reviews).values({
    userId: f.customer,
    cityId: f.raipur,
    serviceRequestId: requestId,
    targetType: 'workshop',
    targetId: ws,
    rating,
    status: 'approved',
    moderatedAt: new Date(at),
    createdAt: new Date(at),
  });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  for (const k of ['a', 'b', 'c', 'quiet'] as const) W[k] = (await addWorkshop(db, f)).id;
  W.bhilai = (await addWorkshop(db, f, { pincode: '490001' })).id;

  // A: a full job — proposed after 30 min, received at 120, estimate at 150, ready at 330, paid; photo; 5 stars.
  const a1 = await req({
    ws: W.a,
    at: '2026-11-02T06:00:00Z',
    status: 'completed',
    completedAt: '2026-11-04T10:00:00Z',
    proposeAfter: 30,
    steps: [
      ['proposed', 30],
      ['confirmed', 60],
      ['vehicle_received', 120],
      ['estimate_sent', 150],
      ['approved', 200],
      ['ready', 330],
      ['paid', 400],
      ['completed', 410],
    ],
  });
  await estimate(a1, 1, [{ qty: 1, unit: 100_000, decision: 'approved' }]);
  await estimate(a1, 2, [
    { qty: 2, unit: 50_000, decision: 'approved' },
    { qty: 1, unit: 30_000, decision: 'declined' },
    { qty: 1, unit: 20_000, decision: 'approved' },
  ]);
  await bill(a1, 120_000, 'cash');
  await photo(a1);
  await review(a1, W.a, 5, '2026-11-05T10:00:00Z');
  // A: the same customer and vehicle returns 10 days after completion, at the same workshop (comeback).
  await req({ ws: W.a, at: '2026-11-14T06:00:00Z', status: 'confirmed', steps: [['confirmed', 5]] });
  // A: a second job, another vehicle, no photo, unpaid bill; home mode with a visit fee; proposed after 90 min.
  const a2 = await req({
    ws: W.a,
    at: '2026-11-03T06:00:00Z',
    status: 'billed',
    mode: 'home',
    user: f.other,
    vehicleKey: 'bajaj pulsar',
    proposeAfter: 90,
    steps: [
      ['proposed', 90],
      ['confirmed', 100],
      ['vehicle_received', 200],
      ['estimate_sent', 230],
      ['approved', 240],
      ['ready', 300],
      ['billed', 310],
    ],
  });
  await estimate(a2, 1, [{ qty: 1, unit: 40_000, decision: 'approved' }]);
  await bill(a2, 60_000, null);
  // A: cancelled by the customer; rejected by staff.
  await req({ ws: W.a, at: '2026-11-04T06:00:00Z', status: 'cancelled', reason: 'changed_mind' });
  await req({ ws: W.a, at: '2026-11-05T06:00:00Z', status: 'cancelled', reason: 'changed_mind' });
  // A declined one request, which moved on to B (so it is B's request now).
  const moved = await req({ ws: W.b, at: '2026-11-06T06:00:00Z', status: 'awaiting_workshop' });
  await db.insert(s.serviceEvents).values({
    requestId: moved,
    fromStatus: 'awaiting_workshop',
    toStatus: 'needs_routing',
    actorType: 'workshop',
    visibleToCustomer: false,
    payload: { declinedBy: W.a, reasonCode: 'too_busy' },
  });
  // B: one proposed after 10 minutes, completed with a 4-star review, a comeback at a different workshop (not B's).
  const b1 = await req({
    ws: W.b,
    at: '2026-11-02T08:00:00Z',
    status: 'completed',
    completedAt: '2026-11-03T08:00:00Z',
    user: f.other,
    vehicleKey: 'tvs jupiter',
    proposeAfter: 10,
    steps: [
      ['proposed', 10],
      ['confirmed', 20],
      ['vehicle_received', 60],
      ['estimate_sent', 80],
      ['approved', 90],
      ['ready', 150],
      ['paid', 160],
    ],
  });
  await bill(b1, 80_000, 'upi');
  await review(b1, W.b, 4, '2026-11-06T10:00:00Z');
  await req({
    ws: W.c,
    at: '2026-11-08T06:00:00Z',
    status: 'confirmed',
    user: f.other,
    vehicleKey: 'tvs jupiter',
  });
  // C: three requests, proposed after 50 minutes.
  for (const day of ['02', '03', '04'])
    await req({
      ws: W.c,
      at: `2026-11-${day}T09:00:00Z`,
      status: 'proposed',
      proposeAfter: 50,
      steps: [['proposed', 50]],
    });
  // Outside the range and in another city: ignored.
  await req({ ws: W.a, at: '2026-10-20T06:00:00Z', status: 'proposed', steps: [['proposed', 5]] });
  await req({ ws: W.bhilai, at: '2026-11-03T06:00:00Z', status: 'proposed', city: f.bhilai });
});

afterAll(async () => {
  await client.close();
});

const stats = async () => cityWorkshopAnalytics(t(), { cityIds: [f.raipur], range: NOV });
const of = (r: Awaited<ReturnType<typeof stats>>, id: string) => {
  const w = r.workshops.find((x) => x.id === id);
  if (!w) throw new Error('workshop missing');
  return w;
};

describe('workshop analytics', () => {
  it('lists every workshop of the city, quiet ones with zeros, and none of another city', async () => {
    const r = await stats();
    expect(r.workshops.map((x) => x.id).sort()).toEqual([W.a, W.b, W.c, W.quiet].sort());
    expect(of(r, W.quiet)).toMatchObject({ requests: 0, ratingTenths: null, billed: 0 });
  });

  it('counts requests, the mode split, the funnel from the timeline, and reasons', async () => {
    const a = of(await stats(), W.a);
    // 4 assigned in range (completed, home job, 2 cancelled) + 1 declined that moved on; the 14 Nov comeback request
    // and the October one are outside the range.
    expect(a.requests).toBe(5);
    expect(a.byMode).toEqual({ workshop: 3, home: 1 });
    expect(a.funnel).toEqual({
      requested: 5,
      proposed: 2,
      confirmed: 2,
      received: 2,
      estimateSent: 2,
      approved: 2,
      completed: 1,
    });
    expect(a.cancelled).toBe(2);
    expect(a.cancelReasons).toEqual([{ code: 'changed_mind', count: 2 }]);
    expect(a.rejected).toBe(0);
  });

  it('computes median minutes to propose, to estimate and for the job', async () => {
    const a = of(await stats(), W.a);
    expect(a.medianMinutesToPropose).toBe(60); // 30 and 90 -> 60
    expect(a.medianMinutesToEstimate).toBe(30); // 30 and 30
    expect(a.medianMinutesJob).toBe(155); // 330-120=210 and 300-200=100
  });

  it('counts acceptance as proposed against declined', async () => {
    const r = await stats();
    expect(of(r, W.a)).toMatchObject({ offersProposed: 2, offersDeclined: 1 });
    expect(workshopRates(of(r, W.a)).acceptancePercent).toBe(67);
    // The declined request is B's now: B's "requests" are its own two, with the proposal of the finished job only.
    expect(of(r, W.b)).toMatchObject({ requests: 2, offersProposed: 1, offersDeclined: 0 });
  });

  it('reads lines from the latest estimate version only', async () => {
    const a = of(await stats(), W.a);
    expect(a.estimates).toBe(2);
    expect(a.estimatesWithDeclinedLine).toBe(1);
    expect(a.linesSent).toBe(4); // 3 lines of revision 2 + 1 line of the home job
    expect(a.linesApproved).toBe(3);
    expect(a.linesSentPaise).toBe(2 * 50_000 + 30_000 + 20_000 + 40_000);
    expect(a.linesApprovedPaise).toBe(2 * 50_000 + 20_000 + 40_000);
  });

  it('sums bills, visit fees, payment methods and unpaid bills', async () => {
    const a = of(await stats(), W.a);
    expect(a).toMatchObject({
      billed: 2,
      billedPaise: 180_000,
      visitFeesPaise: 20_000,
      paidCash: 1,
      paidUpi: 0,
      billsUnpaid: 1,
    });
    expect(workshopRates(a).averageBillPaise).toBe(90_000);
    expect(of(await stats(), W.b)).toMatchObject({ billed: 1, paidUpi: 1 });
  });

  it('measures comebacks at the same workshop only, and photos on received vehicles', async () => {
    const r = await stats();
    // A's completed job is followed 10 days later by a new request of the same customer and vehicle.
    expect(of(r, W.a)).toMatchObject({ completedJobs: 1, returnedWithin30Days: 1, withPhotos: 1 });
    expect(workshopRates(of(r, W.a)).photosPercent).toBe(50);
    // B's job is followed by a request for the same vehicle at ANOTHER workshop: not B's comeback.
    expect(of(r, W.b)).toMatchObject({ completedJobs: 1, returnedWithin30Days: 0 });
  });

  it('averages the approved workshop reviews written in the range', async () => {
    const r = await stats();
    expect(of(r, W.a)).toMatchObject({ ratingTenths: 50, ratingCount: 1 });
    expect(of(r, W.b)).toMatchObject({ ratingTenths: 40, ratingCount: 1 });
    expect(r.totals).toMatchObject({ ratingTenths: 45, ratingCount: 2 });
  });

  it('adds the workshops up in the totals and uses true medians over every request', async () => {
    const r = await stats();
    expect(r.totals.requests).toBe(of(r, W.a).requests + of(r, W.b).requests + of(r, W.c).requests);
    expect(r.totals.billed).toBe(3);
    // proposal delays 30, 90 (A), 10 (B), 50 x3 (C) -> median 50
    expect(r.totals.medianMinutesToPropose).toBe(50);
  });

  it('gives a single workshop the same numbers as the city table', async () => {
    const city = of(await stats(), W.a);
    const cityId = await workshopCityId(t(), W.a);
    expect(cityId).toBe(f.raipur);
    const own = await ownWorkshopAnalytics(t(), { cityId: f.raipur, workshopId: W.a, range: NOV });
    expect(own).toEqual(city);
  });

  it('never reads another city through a workshop id', async () => {
    expect(
      await ownWorkshopAnalytics(t(), { cityId: f.raipur, workshopId: W.bhilai, range: NOV }),
    ).toBeNull();
    expect((await cityWorkshopAnalytics(t(), { cityIds: [f.bhilai], range: NOV })).totals.requests).toBe(1);
  });

  it('answers an empty list of cities and an empty range with zeros', async () => {
    const none = await cityWorkshopAnalytics(t(), { cityIds: [], range: NOV });
    expect(none.workshops).toEqual([]);
    expect(none.totals.requests).toBe(0);
    const r = resolveAnalyticsRange({ from: '2026-09-01', to: '2026-09-02' }, NOW);
    if (!r.ok) throw new Error('range');
    expect((await cityWorkshopAnalytics(t(), { cityIds: [f.raipur], range: r })).totals.requests).toBe(0);
  });

  it('respects the range edges in IST (a request at 00:30 IST on the first day is in)', async () => {
    const edge = await req({
      ws: W.quiet,
      at: '2026-10-31T19:00:00Z', // 2026-11-01 00:30 IST
      status: 'proposed',
      steps: [['proposed', 5]],
    });
    expect(edge).toBeTruthy();
    expect(of(await stats(), W.quiet).requests).toBe(1);
  });

  it('hides the city medians below three active workshops and gives them from three', async () => {
    const r = await stats();
    expect(workshopMedians([of(r, W.a), of(r, W.b)]).values.requests).toBeNull();
    const m = workshopMedians(r.workshops);
    expect(m.workshops).toBe(4); // the quiet one now has the edge request
    expect(m.values.requests).not.toBeNull();
    expect(m.values.minutesToPropose).not.toBeNull();
    const quietOnly = workshopMedians([emptyOnly(r)]);
    expect(quietOnly.workshops).toBe(0);
  });
});

function emptyOnly(r: Awaited<ReturnType<typeof stats>>) {
  const w = r.workshops[0];
  if (!w) throw new Error('none');
  return { ...w, requests: 0 };
}
