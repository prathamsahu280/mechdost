/**
 * Admin settings (hard rule 8): values validated against the shared registry, city overrides win over global,
 * compare-and-set + audit, clearing an override falls back; checkout and routing read the same keys.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { clearCitySetting, listOperationalSettings, saveOperationalSetting, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let raipur = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  raipur = (
    await db
      .insert(s.cities)
      .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
      .returning()
  )[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-settings-admin' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

const row = async (key: string, cityId: string | null) =>
  (await listOperationalSettings(t(), cityId)).find((r) => r.key === key)!;

describe('admin settings', () => {
  it('validates against the registry, saves global then a city override, with compare-and-set and audit', async () => {
    expect((await row('orders.acceptance_timeout_min', null)).effective).toBe(15); // registry default
    await expect(
      saveOperationalSetting(t(), {
        key: 'orders.acceptance_timeout_min',
        cityId: null,
        value: 0,
        expectedVersion: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'SETTING_RANGE' });
    await expect(
      saveOperationalSetting(t(), {
        key: 'catalogue.require_hindi_to_publish',
        cityId: null,
        value: 'yes',
        expectedVersion: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'SETTING_TYPE' });
    const g = await saveOperationalSetting(t(), {
      key: 'orders.acceptance_timeout_min',
      cityId: null,
      value: 20,
      expectedVersion: null,
      staffUserId: staff,
    });
    await expect(
      saveOperationalSetting(t(), {
        key: 'orders.acceptance_timeout_min',
        cityId: null,
        value: 25,
        expectedVersion: g.version + 1,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SETTING' });
    const c = await saveOperationalSetting(t(), {
      key: 'orders.acceptance_timeout_min',
      cityId: raipur,
      value: 10,
      expectedVersion: null,
      staffUserId: staff,
    });
    expect(await row('orders.acceptance_timeout_min', raipur)).toMatchObject({
      global: { value: 20 },
      city: { value: 10 },
      effective: 10,
    });
    expect((await row('orders.acceptance_timeout_min', null)).effective).toBe(20);
    await clearCitySetting(t(), {
      key: 'orders.acceptance_timeout_min',
      cityId: raipur,
      expectedVersion: c.version,
      staffUserId: staff,
    });
    expect((await row('orders.acceptance_timeout_min', raipur)).effective).toBe(20);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.entity, 'setting'));
    expect(audits.map((a) => a.action)).toEqual(['setting.saved', 'setting.saved', 'setting.cleared']);
  });

  it('a nullable setting accepts null; free delivery can be switched off again', async () => {
    const v = await saveOperationalSetting(t(), {
      key: 'checkout.free_delivery_min_paise',
      cityId: null,
      value: 50000,
      expectedVersion: null,
      staffUserId: staff,
    });
    await saveOperationalSetting(t(), {
      key: 'checkout.free_delivery_min_paise',
      cityId: null,
      value: null,
      expectedVersion: v.version,
      staffUserId: staff,
    });
    expect((await row('checkout.free_delivery_min_paise', null)).effective).toBeNull();
  });

  it('a global-only setting refuses a city override (it would do nothing)', async () => {
    await expect(
      saveOperationalSetting(t(), {
        key: 'catalogue.require_hindi_to_publish',
        cityId: raipur,
        value: true,
        expectedVersion: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'SETTING_GLOBAL_ONLY' });
  });
});
