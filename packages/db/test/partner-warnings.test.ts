/**
 * Partner warnings (spec 08 "Warnings", design 2026-11-15): append-only records with a reason code; a rolling window
 * (settings, default 3 in 30 days) only prompts staff to consider a pause and never pauses; withdrawing appends a
 * row; a partner sees only its own; a partner elsewhere is a 404 for staff outside its city.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  issuePartnerWarning,
  listPartnerWarningsForAdmin,
  listPartnerWarningsForPartner,
  withdrawPartnerWarning,
  type CityScope,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let cityId = '';
let otherCityId = '';
let stateId = '';
const all: CityScope = { all: true };

async function shop(name: string, city = cityId): Promise<string> {
  const [row] = await db
    .insert(s.shops)
    .values({
      name,
      phone: '+919800000000',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: city,
      stateId,
      location: { lng: 81.64, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  return row!.id;
}
const warn = (shopId: string, reasonCode: 'missed_offers' | 'other' = 'missed_offers', note?: string) =>
  issuePartnerWarning(t(), {
    kind: 'shop',
    partnerId: shopId,
    scope: all,
    reasonCode,
    note: note ?? null,
    staffUserId: staff,
  });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  stateId = (
    await db.insert(s.states).values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' }).returning()
  )[0]!.id;
  const city = async (code: string, slug: string) =>
    (
      await db
        .insert(s.cities)
        .values({ stateId, code, slug, name: slug, status: 'live', centroid: { lng: 81.64, lat: 21.227 } })
        .returning()
    )[0]!.id;
  cityId = await city('RPR', 'raipur');
  otherCityId = await city('BPL', 'bilaspur');
  await db
    .insert(s.pincodes)
    .values({ pincode: '492001', stateId, cityId, centroid: { lng: 81.64, lat: 21.227 } });
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-warn-staff' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('issuing warnings', () => {
  it('records a coded warning, audits it, and prompts a pause at the threshold without pausing', async () => {
    const id = await shop('Warned Auto');
    const first = await warn(id);
    expect(first.warnings).toMatchObject({ counting: 1, threshold: 3, windowDays: 30, suggestPause: false });
    await warn(id, 'other', 'Kept customers waiting');
    const third = await warn(id);
    expect(third.warnings).toMatchObject({ counting: 3, suggestPause: true });
    // Only a prompt: the shop is still approved (user ruling 2026-11-15).
    expect((await db.select().from(s.shops).where(eq(s.shops.id, id)))[0]?.status).toBe('approved');
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(sql`${s.auditLog.action} = 'partner.warning_issued' and ${s.auditLog.entityId} = ${id}`);
    expect(audit).toHaveLength(3);
  });

  it('needs a known code, a note for "other", and an in-scope partner', async () => {
    const id = await shop('Scope Auto');
    await expect(warn(id, 'nope' as never)).rejects.toMatchObject({ code: 'WARNING_REASON' });
    await expect(warn(id, 'other')).rejects.toMatchObject({ code: 'WARNING_NOTE' });
    await expect(
      issuePartnerWarning(t(), {
        kind: 'shop',
        partnerId: id,
        scope: { all: false, cityIds: [otherCityId] },
        reasonCode: 'missed_offers',
        note: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('only warnings inside the window count; the window and threshold are admin settings', async () => {
    const id = await shop('Window Auto');
    await warn(id);
    await db.execute(sql`insert into partner_warnings (partner_kind, shop_id, reason_code, created_by, created_at)
      values ('shop', ${id}, 'missed_offers', ${staff}, now() - interval '31 days')`);
    expect((await listPartnerWarningsForAdmin(t(), all, 'shop', id)).counting).toBe(1);
    await db.insert(s.settings).values({ key: 'partners.warning_threshold', value: 1 });
    await db.insert(s.settings).values({ key: 'partners.warning_window_days', value: 60 });
    const view = await listPartnerWarningsForAdmin(t(), all, 'shop', id);
    expect(view).toMatchObject({ counting: 2, threshold: 1, windowDays: 60, suggestPause: true });
    await db.delete(s.settings).where(sql`${s.settings.key} like 'partners.warning_%'`);
  });

  it('a paused shop is not prompted again', async () => {
    const id = await shop('Paused Auto');
    await warn(id);
    await warn(id);
    await warn(id);
    await db
      .update(s.shops)
      .set({ status: 'paused', statusReason: 'Stock audit', statusChangedBy: staff })
      .where(eq(s.shops.id, id));
    expect((await listPartnerWarningsForAdmin(t(), all, 'shop', id)).suggestPause).toBe(false);
  });
});

describe('workshops use the same model', () => {
  it('warns a workshop and lists it for the workshop; a shop id is not a workshop id', async () => {
    const [w] = await db
      .insert(s.workshops)
      .values({
        cityId,
        slug: 'warn-garage',
        name: 'Warn Garage',
        addressLine: 'Telibandha, Raipur',
        area: 'Telibandha',
        pincode: '492001',
        location: { lng: 81.64, lat: 21.227 },
        vehicleTypes: ['4W'],
        hours: { open: '09:00', close: '18:00', days: [1, 2, 3, 4, 5, 6] },
      })
      .returning();
    const r = await issuePartnerWarning(t(), {
      kind: 'workshop',
      partnerId: w!.id,
      scope: all,
      reasonCode: 'quality_complaints',
      note: null,
      staffUserId: staff,
    });
    expect(r.warnings.counting).toBe(1);
    expect((await listPartnerWarningsForPartner(t(), [w!.id], 'workshop', w!.id)).warnings).toHaveLength(1);
    const aShop = await shop('Not A Workshop');
    await expect(
      issuePartnerWarning(t(), {
        kind: 'workshop',
        partnerId: aShop,
        scope: all,
        reasonCode: 'missed_offers',
        note: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('withdrawing and the append-only history', () => {
  it('a withdrawal is a new row; the count drops; it cannot be withdrawn twice; rows cannot be edited or deleted', async () => {
    const id = await shop('Withdraw Auto');
    const w = await warn(id);
    const done = await withdrawPartnerWarning(t(), {
      kind: 'shop',
      partnerId: id,
      warningId: w.id,
      scope: all,
      note: 'Issued by mistake',
      staffUserId: staff,
    });
    expect(done.counting).toBe(0);
    expect(done.warnings[0]).toMatchObject({ id: w.id, withdrawn: true });
    await expect(
      withdrawPartnerWarning(t(), {
        kind: 'shop',
        partnerId: id,
        warningId: w.id,
        scope: all,
        note: 'Again please',
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'WARNING_WITHDRAWN' });
    await expect(
      db.execute(sql`update partner_warnings set note = 'edited' where id = ${w.id}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from partner_warnings where id = ${w.id}`)).rejects.toThrow();
  });
});

describe('what the partner sees', () => {
  it('its own warnings with codes, never the threshold; another shop is a 404', async () => {
    const mine = await shop('Mine Auto');
    const theirs = await shop('Theirs Auto');
    await warn(mine, 'other', 'Late handover twice');
    const view = await listPartnerWarningsForPartner(t(), [mine], 'shop', mine);
    expect(view).toMatchObject({ windowDays: 30, counting: 1 });
    expect(view.warnings[0]).toMatchObject({
      reasonCode: 'other',
      note: 'Late handover twice',
      withdrawn: false,
    });
    expect(view).not.toHaveProperty('threshold');
    expect(view).not.toHaveProperty('suggestPause');
    await expect(listPartnerWarningsForPartner(t(), [mine], 'shop', theirs)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
