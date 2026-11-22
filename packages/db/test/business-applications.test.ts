/**
 * Business applications (audience entry design 2026-11-22, item 3): a signed-in trade application, a fleet lead,
 * the admin queue, approving a trade application verifies the account (audited, with events and an email),
 * revoking and restoring with a reason (conditional UPDATE on version).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FleetApplication, TradeApplication } from '@mechdost/shared/business-applications';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  decideBusinessApplication,
  getBusinessApplication,
  getTradeProfile,
  listBusinessApplications,
  setTradeAccountStanding,
  submitFleetApplication,
  submitTradeApplication,
  syncRbacCatalogue,
  type Tx,
} from '../src/repo';
import { events } from '../src/repo/events';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const ALL = { all: true } as const;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let n = 0;

async function newUser(over: Partial<typeof s.users.$inferInsert> = {}) {
  n += 1;
  const [u] = await db
    .insert(s.users)
    .values({
      firebaseUid: `fb-biz-${String(n)}`,
      name: 'Ravi Sahu',
      phone: `+9198765431${String(n).padStart(2, '0')}`,
      email: `ravi${String(n)}@example.com`,
      ...over,
    })
    .returning();
  return u!.id;
}

const trade = (over: Partial<TradeApplication> = {}): TradeApplication => ({
  businessName: 'Sahu Motors',
  businessType: 'garage',
  gstin: '22ABVCS4888H1ZL',
  pincode: '492004',
  spendBand: '25k_to_1l',
  categories: ['lubricants', 'batteries'],
  consent: true,
  ...over,
});
const fleet = (over: Partial<FleetApplication> = {}): FleetApplication => ({
  companyName: 'Raipur Cabs',
  fleet: { w2: 0, w3: 4, w4: 25 },
  pincode: '492004',
  contactName: 'Asha Verma',
  phone: '+919876543210',
  email: 'asha@example.com',
  needs: ['scheduled_maintenance', 'monthly_billing'],
  consent: true,
  ...over,
});
const mailFor = async (template: string) =>
  (await db.select().from(s.notificationOutbox)).filter((r) => r.templateKey === template);

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  await syncRbacCatalogue(t());
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-biz-staff' }).returning())[0]!.id;
});
afterAll(async () => {
  await client.close();
});

describe('trade application', () => {
  it('stores the account, the codes and a snapshot of the contact; writes the event, audit and staff notice', async () => {
    const userId = await newUser();
    const r = await submitTradeApplication(t(), { userId, application: trade() });
    expect(r).toMatchObject({ status: 'new' });
    expect(r.code).toMatch(/^BA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/);
    const [row] = await db
      .select()
      .from(s.businessApplications)
      .where(eq(s.businessApplications.code, r.code));
    expect(row).toMatchObject({
      kind: 'trade',
      userId,
      businessType: 'garage',
      spendBand: '25k_to_1l',
      gstin: '22ABVCS4888H1ZL',
      categories: ['lubricants', 'batteries'],
      contactName: 'Ravi Sahu',
      createdBy: userId,
    });
    expect(row?.contactPhone).toMatch(/^\+91/);
    const ev = await db
      .select()
      .from(s.businessApplicationEvents)
      .where(eq(s.businessApplicationEvents.applicationId, row!.id));
    expect(ev).toMatchObject([{ fromStatus: null, toStatus: 'new', actorUserId: userId }]);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, row!.id));
    expect(audit.map((a) => a.action)).toContain('business_application.submitted');
    const tracked = await db.select().from(events).where(eq(events.event, 'business_application_submitted'));
    expect(tracked.at(-1)?.props).toEqual({ kind: 'trade', signedIn: true });
    expect(JSON.stringify(tracked.at(-1)?.props)).not.toContain('Sahu');
    const mail = await mailFor('trade_application_received');
    expect(mail.at(-1)?.recipient).toMatch(/@example\.com$/);
  });

  it('GSTIN is optional', async () => {
    const userId = await newUser();
    const r = await submitTradeApplication(t(), { userId, application: trade({ gstin: undefined }) });
    const [row] = await db
      .select()
      .from(s.businessApplications)
      .where(eq(s.businessApplications.code, r.code));
    expect(row?.gstin).toBeNull();
  });

  it('refuses a second open application, unknown categories and PIN codes we do not serve', async () => {
    const userId = await newUser();
    await submitTradeApplication(t(), { userId, application: trade() });
    await expect(submitTradeApplication(t(), { userId, application: trade() })).rejects.toMatchObject({
      code: 'TRADE_APPLICATION_OPEN',
    });
    const other = await newUser();
    await expect(
      submitTradeApplication(t(), {
        userId: other,
        application: trade({ categories: ['no-such-category'] }),
      }),
    ).rejects.toMatchObject({ code: 'CATEGORIES' });
    await expect(
      submitTradeApplication(t(), { userId: other, application: trade({ pincode: '110001' }) }),
    ).rejects.toMatchObject({ code: 'PINCODE_NOT_SERVED' });
  });
});

describe('fleet enquiry', () => {
  it('can be sent signed out: a lead with no account and no email to the typed address', async () => {
    const before = (await mailFor('fleet_application_received')).length;
    const r = await submitFleetApplication(t(), { userId: null, application: fleet() });
    const [row] = await db
      .select()
      .from(s.businessApplications)
      .where(eq(s.businessApplications.code, r.code));
    expect(row).toMatchObject({
      kind: 'fleet',
      userId: null,
      fleet2w: 0,
      fleet3w: 4,
      fleet4w: 25,
      needs: ['scheduled_maintenance', 'monthly_billing'],
      contactEmail: 'asha@example.com',
    });
    expect((await mailFor('fleet_application_received')).length).toBe(before);
    const tracked = await db.select().from(events).where(eq(events.event, 'business_application_submitted'));
    expect(tracked.at(-1)?.props).toEqual({ kind: 'fleet', signedIn: false });
  });

  it('signed in: the account gets the received email', async () => {
    const before = (await mailFor('fleet_application_received')).length;
    const userId = await newUser();
    await submitFleetApplication(t(), { userId, application: fleet() });
    expect((await mailFor('fleet_application_received')).length).toBe(before + 1);
  });
});

describe('database rules', () => {
  it('a fleet lead can never be approved and a trade application can never be closed', async () => {
    const f = await submitFleetApplication(t(), { userId: null, application: fleet() });
    await expect(
      client.query(`update business_applications set status = 'approved' where code = '${f.code}'`),
    ).rejects.toThrow();
    const userId = await newUser();
    const r = await submitTradeApplication(t(), { userId, application: trade() });
    await expect(
      client.query(`update business_applications set status = 'closed' where code = '${r.code}'`),
    ).rejects.toThrow();
  });
});

describe('admin queue and decisions', () => {
  it('lists by kind and status, scoped by city; unknown scope sees nothing', async () => {
    const all = await listBusinessApplications(t(), ALL, {});
    expect(all.items.some((i) => i.kind === 'trade')).toBe(true);
    expect(all.items.some((i) => i.kind === 'fleet')).toBe(true);
    const onlyFleet = await listBusinessApplications(t(), ALL, { kind: 'fleet' });
    expect(onlyFleet.items.every((i) => i.kind === 'fleet')).toBe(true);
    const none = await listBusinessApplications(t(), { all: false, cityIds: [] }, {});
    expect(none.items).toHaveLength(0);
    await expect(
      getBusinessApplication(t(), { all: false, cityIds: [] }, all.items[0]!.code),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('approving a trade application verifies the account; audited; events; email; stale versions refused', async () => {
    const userId = await newUser();
    const r = await submitTradeApplication(t(), { userId, application: trade() });
    expect((await getTradeProfile(t(), userId)).status).toBe('pending');
    const detail = await getBusinessApplication(t(), ALL, r.code);
    await expect(
      decideBusinessApplication(t(), {
        scope: ALL,
        code: r.code,
        expectedVersion: detail.version + 5,
        staffUserId: staff,
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'STALE_APPLICATION' });
    await decideBusinessApplication(t(), {
      scope: ALL,
      code: r.code,
      expectedVersion: detail.version,
      staffUserId: staff,
      decision: 'approved',
    });
    expect(await getTradeProfile(t(), userId)).toMatchObject({
      status: 'verified',
      businessName: 'Sahu Motors',
      gstin: '22ABVCS4888H1ZL',
    });
    const [acc] = await db.select().from(s.tradeAccounts).where(eq(s.tradeAccounts.userId, userId));
    const ev = await db.select().from(s.tradeAccountEvents).where(eq(s.tradeAccountEvents.userId, userId));
    expect(ev).toMatchObject([{ event: 'trade_account_verified', actorUserId: staff }]);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, acc!.id));
    expect(audit.map((a) => a.action)).toContain('trade_account.verified');
    const tracked = await db.select().from(events).where(eq(events.event, 'trade_account_verified'));
    expect(tracked.at(-1)?.props).toEqual({ via: 'application' });
    expect((await mailFor('trade_account_verified')).length).toBeGreaterThan(0);
    // Already verified: a new application is refused.
    await expect(submitTradeApplication(t(), { userId, application: trade() })).rejects.toMatchObject({
      code: 'TRADE_ALREADY_VERIFIED',
    });
    // A decided application cannot be decided again.
    await expect(
      decideBusinessApplication(t(), {
        scope: ALL,
        code: r.code,
        expectedVersion: detail.version + 1,
        staffUserId: staff,
        decision: 'rejected',
        reasonCode: 'duplicate',
      }),
    ).rejects.toThrow();
  });

  it('staff can never decide their own application or change their own trade standing (security review 2026-11-22)', async () => {
    const userId = await newUser();
    const r = await submitTradeApplication(t(), { userId, application: trade() });
    const d = await getBusinessApplication(t(), ALL, r.code);
    for (const decision of ['in_review', 'approved', 'rejected'] as const)
      await expect(
        decideBusinessApplication(t(), {
          scope: ALL,
          code: r.code,
          expectedVersion: d.version,
          staffUserId: userId,
          decision,
          ...(decision === 'rejected' ? { reasonCode: 'duplicate' as const } : {}),
        }),
      ).rejects.toMatchObject({ status: 403, code: 'STAFF_SELF_CHANGE' });
    await decideBusinessApplication(t(), {
      scope: ALL,
      code: r.code,
      expectedVersion: d.version,
      staffUserId: staff,
      decision: 'approved',
    });
    const acc = (await getBusinessApplication(t(), ALL, r.code)).tradeAccount!;
    await expect(
      setTradeAccountStanding(t(), {
        scope: ALL,
        code: r.code,
        expectedVersion: acc.version,
        staffUserId: userId,
        to: 'revoked',
        reasonCode: 'misuse',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'STAFF_SELF_CHANGE' });
  });

  it('revokes with a reason code and restores, each on the current version', async () => {
    const userId = await newUser();
    const r = await submitTradeApplication(t(), { userId, application: trade() });
    const d = await getBusinessApplication(t(), ALL, r.code);
    await decideBusinessApplication(t(), {
      scope: ALL,
      code: r.code,
      expectedVersion: d.version,
      staffUserId: staff,
      decision: 'approved',
    });
    const acc = (await getBusinessApplication(t(), ALL, r.code)).tradeAccount!;
    expect(acc.status).toBe('verified');
    await expect(
      setTradeAccountStanding(t(), {
        scope: ALL,
        code: r.code,
        expectedVersion: acc.version + 3,
        staffUserId: staff,
        to: 'revoked',
        reasonCode: 'misuse',
      }),
    ).rejects.toMatchObject({ code: 'STALE_TRADE_ACCOUNT' });
    await expect(
      setTradeAccountStanding(t(), {
        scope: ALL,
        code: r.code,
        expectedVersion: acc.version,
        staffUserId: staff,
        to: 'revoked',
        reasonCode: 'nonsense' as never,
      }),
    ).rejects.toMatchObject({ code: 'REASON_CODE' });
    await setTradeAccountStanding(t(), {
      scope: ALL,
      code: r.code,
      expectedVersion: acc.version,
      staffUserId: staff,
      to: 'revoked',
      reasonCode: 'misuse',
    });
    expect((await getTradeProfile(t(), userId)).status).toBe('revoked');
    const after = (await getBusinessApplication(t(), ALL, r.code)).tradeAccount!;
    expect(after).toMatchObject({ status: 'revoked', reasonCode: 'misuse' });
    const revoked = await db.select().from(events).where(eq(events.event, 'trade_account_revoked'));
    expect(revoked.at(-1)?.props).toEqual({ reasonCode: 'misuse' });
    await setTradeAccountStanding(t(), {
      scope: ALL,
      code: r.code,
      expectedVersion: after.version,
      staffUserId: staff,
      to: 'verified',
    });
    expect((await getTradeProfile(t(), userId)).status).toBe('verified');
    const hist = await db
      .select()
      .from(s.tradeAccountEvents)
      .where(and(eq(s.tradeAccountEvents.userId, userId)));
    expect(hist.map((h) => h.event).sort()).toEqual([
      'trade_account_revoked',
      'trade_account_verified',
      'trade_account_verified',
    ]);
    // Out of scope: 404.
    await expect(
      setTradeAccountStanding(t(), {
        scope: { all: false, cityIds: [] },
        code: r.code,
        expectedVersion: 1,
        staffUserId: staff,
        to: 'revoked',
        reasonCode: 'misuse',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejecting needs a reason code and leaves the account alone; fleet leads are reviewed and closed only', async () => {
    const userId = await newUser();
    const r = await submitTradeApplication(t(), { userId, application: trade() });
    const d = await getBusinessApplication(t(), ALL, r.code);
    await expect(
      decideBusinessApplication(t(), {
        scope: ALL,
        code: r.code,
        expectedVersion: d.version,
        staffUserId: staff,
        decision: 'rejected',
      }),
    ).rejects.toMatchObject({ code: 'REASON_CODE' });
    await decideBusinessApplication(t(), {
      scope: ALL,
      code: r.code,
      expectedVersion: d.version,
      staffUserId: staff,
      decision: 'rejected',
      reasonCode: 'not_a_business',
    });
    expect((await getTradeProfile(t(), userId)).status).toBe('none');
    // After a rejection the person may apply again.
    await submitTradeApplication(t(), { userId, application: trade() });

    const f = await submitFleetApplication(t(), { userId: null, application: fleet() });
    const fd = await getBusinessApplication(t(), ALL, f.code);
    await expect(
      decideBusinessApplication(t(), {
        scope: ALL,
        code: f.code,
        expectedVersion: fd.version,
        staffUserId: staff,
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'NOT_A_TRADE_APPLICATION' });
    await decideBusinessApplication(t(), {
      scope: ALL,
      code: f.code,
      expectedVersion: fd.version,
      staffUserId: staff,
      decision: 'in_review',
    });
    const fd2 = await getBusinessApplication(t(), ALL, f.code);
    await decideBusinessApplication(t(), {
      scope: ALL,
      code: f.code,
      expectedVersion: fd2.version,
      staffUserId: staff,
      decision: 'closed',
    });
    expect((await getBusinessApplication(t(), ALL, f.code)).status).toBe('closed');
  });
});

describe('history tables (run last, once rows exist)', () => {
  it('are append-only', async () => {
    await expect(client.query('delete from business_application_events')).rejects.toThrow();
    await expect(client.query("update trade_account_events set reason_code = 'x'")).rejects.toThrow();
  });
});
