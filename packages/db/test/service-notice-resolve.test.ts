/**
 * Service-request notices resolve themselves (spec 10, user 2026-11-23): "the workshop proposed", "estimate ready" and
 * "bill ready" ask the customer to act; they are marked done in the transaction of the change that makes the action
 * moot, and every open ask is cleared when the request ends. Driven through the real repository functions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { CreateServiceRequestInput, SendEstimateInput } from '@mechdost/shared/service-requests';
import { istDateString } from '@mechdost/shared/time';
import {
  advanceJob,
  billJob,
  cancelMyServiceRequest,
  cancelServiceRequestByStaff,
  createServiceRequest,
  decideEstimate,
  decideProposal,
  getMyServiceRequest,
  markJobPaid,
  proposeSlot,
  receiveVehicle,
  sendEstimate,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
let wsId: string;
let wsSlug: string;
const t = () => db as unknown as Tx;
const TODAY = istDateString(new Date());
let keyN = 0;

const LINES: SendEstimateInput['lines'] = [
  { description: 'Engine oil 1 L', serviceKey: null, qty: 1, unitPaise: 45_000, gstRateBp: 1800 },
];
const step = (code: string, version: number) => ({
  workshopIds: [wsId],
  code,
  expectedVersion: version,
  staffUserId: f.staff,
});

async function request() {
  keyN += 1;
  const input: CreateServiceRequestInput = {
    workshopSlug: wsSlug,
    vehicleType: '2W',
    vehicleId: null,
    vehicle: 'Honda Activa 6G',
    serviceKeys: ['routine2w'],
    concern: null,
    pincode: '492001',
    lat: null,
    lng: null,
    preferredDate: TODAY,
    preferredSlot: 'morning',
    pickup: false,
  };
  return createServiceRequest(t(), {
    userId: f.customer,
    idempotencyKey: `svc-notice-key-${String(keyN).padStart(6, '0')}`,
    request: input,
  });
}

const propose = (code: string, version: number) =>
  proposeSlot(t(), {
    ...step(code, version),
    date: TODAY,
    slot: 'morning' as const,
    lowPaise: 80_000,
    highPaise: 150_000,
    note: null,
  });

const accept = async (code: string, version: number) =>
  (await decideProposal(t(), { userId: f.customer, code, accept: true, expectedVersion: version })).version;

/** The customer's notice rows of one kind for one request. */
function rows(requestId: string, kind: string) {
  return db
    .select()
    .from(s.notifications)
    .where(
      and(
        eq(s.notifications.userId, f.customer),
        eq(s.notifications.entityId, requestId),
        eq(s.notifications.kind, kind),
      ),
    );
}
async function idOf(code: string): Promise<string> {
  const [row] = await db
    .select({ id: s.serviceRequests.id })
    .from(s.serviceRequests)
    .where(eq(s.serviceRequests.code, code));
  if (!row) throw new Error('request not found');
  return row.id;
}

async function toEstimate(code: string, version: number) {
  const v = (await receiveVehicle(t(), { ...step(code, version), odometerKm: 5_000 })).version;
  return sendEstimate(t(), { ...step(code, v), lines: LINES });
}
async function approveAll(code: string, sentVersion: number) {
  const view = await getMyServiceRequest(t(), f.customer, code, 'en');
  return decideEstimate(t(), {
    userId: f.customer,
    code,
    decision: {
      revision: 1,
      version: sentVersion,
      consent: true,
      decisions: (view.estimate?.items ?? []).map((i) => ({ itemId: i.id, decision: 'approved' as const })),
    },
  });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  const w = await addWorkshop(db, f, { name: 'Notice WS', gstin: '22AAAAA0000A1Z5' });
  wsId = w.id;
  wsSlug = w.slug;
});
afterAll(async () => {
  await client.close();
});

describe('service notices that ask the customer to act', () => {
  it('"proposed" is open while the proposal waits and resolved when the customer accepts', async () => {
    const r = await request();
    const id = await idOf(r.code);
    const p = await propose(r.code, r.version);
    const [open] = await rows(id, 'service.proposed');
    expect(open).toMatchObject({ resolvedAt: null, readAt: null });
    await accept(r.code, p.version);
    const [done] = await rows(id, 'service.proposed');
    expect(done?.resolvedAt).not.toBeNull();
    expect(done?.readAt).not.toBeNull();
    // The milestone notice of the new status is not touched.
    const [confirmed] = await rows(id, 'service.confirmed');
    expect(confirmed?.resolvedAt).toBeNull();
  });

  it('"proposed" is resolved when the customer declines the proposal', async () => {
    const r = await request();
    const id = await idOf(r.code);
    const p = await propose(r.code, r.version);
    await decideProposal(t(), {
      userId: f.customer,
      code: r.code,
      accept: false,
      expectedVersion: p.version,
    });
    expect((await rows(id, 'service.proposed'))[0]?.resolvedAt).not.toBeNull();
  });

  it('"proposed" is resolved when the customer cancels', async () => {
    const r = await request();
    const id = await idOf(r.code);
    const p = await propose(r.code, r.version);
    await cancelMyServiceRequest(t(), {
      userId: f.customer,
      code: r.code,
      expectedVersion: p.version,
      reasonCode: 'changed_mind',
    });
    expect((await rows(id, 'service.proposed'))[0]?.resolvedAt).not.toBeNull();
  });

  it('"estimate ready" is open until the estimate is decided, then resolved', async () => {
    const r = await request();
    const id = await idOf(r.code);
    const v = await accept(r.code, (await propose(r.code, r.version)).version);
    const sent = await toEstimate(r.code, v);
    expect((await rows(id, 'service.estimate_ready'))[0]?.resolvedAt).toBeNull();
    await approveAll(r.code, sent.version);
    expect((await rows(id, 'service.estimate_ready'))[0]?.resolvedAt).not.toBeNull();
  });

  it('"bill ready" is open until the bill is paid, then resolved', async () => {
    const r = await request();
    const id = await idOf(r.code);
    let v = await accept(r.code, (await propose(r.code, r.version)).version);
    const sent = await toEstimate(r.code, v);
    v = (await approveAll(r.code, sent.version)).version;
    v = (await advanceJob(t(), { ...step(r.code, v), to: 'in_progress' })).version;
    v = (await advanceJob(t(), { ...step(r.code, v), to: 'ready' })).version;
    const bill = await billJob(t(), step(r.code, v));
    expect((await rows(id, 'service.bill_ready'))[0]?.resolvedAt).toBeNull();
    await markJobPaid(t(), { ...step(r.code, bill.version), method: 'cash' });
    const after = await rows(id, 'service.bill_ready');
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((n) => n.resolvedAt !== null)).toBe(true);
  });

  it("staff cancelling a request clears its open asks and leaves another request's alone", async () => {
    const a = await request();
    const b = await request();
    const idA = await idOf(a.code);
    const idB = await idOf(b.code);
    const va = await accept(a.code, (await propose(a.code, a.version)).version);
    const sent = await toEstimate(a.code, va);
    await propose(b.code, b.version);
    await cancelServiceRequestByStaff(t(), {
      scope: { all: true },
      code: a.code,
      expectedVersion: sent.version,
      staffUserId: f.staff,
      reasonCode: 'workshop_unavailable',
    });
    expect((await rows(idA, 'service.estimate_ready'))[0]?.resolvedAt).not.toBeNull();
    expect((await rows(idB, 'service.proposed'))[0]?.resolvedAt).toBeNull();
  });
});
