/**
 * Admin next tier part 2 (design 2026-11-15 items 5 to 8): policy history is append-only and restoring is a new
 * version; the home layout and company details are compare-and-set documents with audit and events; a city setting
 * override and reset record an event; the city picker lists only the cities in scope.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  clearCitySetting,
  events,
  getCompany,
  getHomeLayout,
  getHomeLayoutForAdmin,
  listCitiesInScope,
  listContentVersions,
  publishContent,
  resetHomeLayout,
  restoreContentVersion,
  saveCompany,
  saveContentDraft,
  saveHomeLayout,
  saveOperationalSetting,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let raipur = '';
let bhilai = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const city = async (code: string, slug: string, name: string) =>
    (
      await db.insert(s.cities).values({ stateId: state!.id, code, slug, name, status: 'live' }).returning()
    )[0]!.id;
  raipur = await city('RPR', 'raipur', 'Raipur');
  bhilai = await city('BHI', 'bhilai', 'Bhilai');
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-tier2', name: 'Asha Admin' }).returning())[0]!
    .id;
});

afterAll(async () => {
  await client.close();
});

const policy = (title: string) => ({
  title,
  lead: 'Lead',
  updatedOn: '2026-11-15',
  sections: [{ heading: 'One', body: 'Body for {company}' }],
});
const KEY = 'policy.privacy' as const;
const entry = { key: KEY, locale: 'en' as const, cityId: null, staffUserId: '' };

async function publish(title: string): Promise<void> {
  const d = await saveContentDraft(t(), {
    key: KEY,
    locale: 'en',
    cityId: null,
    value: policy(title),
    expectedVersion: null,
    staffUserId: staff,
  });
  await publishContent(t(), {
    key: KEY,
    locale: 'en',
    cityId: null,
    expectedDraftVersion: d.version,
    staffUserId: staff,
  });
}

describe('policy history', () => {
  it('every publish adds a version; restoring writes a new one and puts the old text live', async () => {
    await publish('First');
    await publish('Second');
    const before = await listContentVersions(t(), { key: KEY, locale: 'en', cityId: null });
    expect(before.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(before[0]).toMatchObject({ action: 'published', by: 'Asha Admin' });

    const r = await restoreContentVersion(t(), { ...entry, staffUserId: staff, versionNo: 1 });
    expect(r.version).toBe(3);
    const after = await listContentVersions(t(), { key: KEY, locale: 'en', cityId: null });
    expect(after.map((v) => [v.versionNo, v.action, v.restoredFrom])).toEqual([
      [3, 'restored', 1],
      [2, 'published', null],
      [1, 'published', null],
    ]);
    expect(after[0]?.value).toMatchObject({ title: 'First' });
    const live = await db
      .select()
      .from(s.contentBlocks)
      .where(and(eq(s.contentBlocks.key, KEY), eq(s.contentBlocks.status, 'published')));
    expect(live[0]?.value).toMatchObject({ title: 'First' });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'content.restored'));
    expect(audit).toHaveLength(1);
    const ev = await db.select().from(events).where(eq(events.event, 'admin_policy_restored'));
    expect(ev[0]?.props).toMatchObject({ fromVersion: 1, version: 3 });
  });

  it('history rows can never be changed or removed (append-only trigger)', async () => {
    await expect(db.update(s.contentVersions).set({ action: 'published' })).rejects.toThrow();
    await expect(db.delete(s.contentVersions)).rejects.toThrow();
  });

  it('refuses a version that does not exist, and a history is per language and per city', async () => {
    await expect(
      restoreContentVersion(t(), { ...entry, staffUserId: staff, versionNo: 99 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await listContentVersions(t(), { key: KEY, locale: 'hi', cityId: null })).toEqual([]);
    expect(await listContentVersions(t(), { key: KEY, locale: 'en', cityId: raipur })).toEqual([]);
  });
});

describe('home layout', () => {
  const layout = {
    order: ['faq', 'trust'],
    hidden: ['partners'],
    featured: ['tyres', 'filters', 'batteries'],
    emoji: { tyres: '🛞' },
    mapDefault: 'map',
  };

  it('defaults, saves with compare-and-set, audits, and a city override wins then falls back after reset', async () => {
    expect((await getHomeLayout(t(), null)).order[0]).toBe('roadside');
    const saved = await saveHomeLayout(t(), {
      cityId: null,
      layout,
      expectedVersion: null,
      staffUserId: staff,
    });
    const live = await getHomeLayout(t(), null);
    expect(live.order[0]).toBe('roadside');
    expect(live.order.indexOf('faq')).toBeLessThan(live.order.indexOf('trust'));
    expect(live.hidden).toEqual(['partners']);
    expect(live.mapDefault).toBe('map');
    await expect(
      saveHomeLayout(t(), { cityId: null, layout, expectedVersion: saved.version + 5, staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'STALE_SETTING' });
    await expect(
      saveHomeLayout(t(), {
        cityId: null,
        layout: { ...layout, hidden: ['nope'] },
        expectedVersion: saved.version,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'LAYOUT_INVALID' });

    expect(await getHomeLayoutForAdmin(t(), raipur)).toMatchObject({ inherited: true, version: null });
    const city = await saveHomeLayout(t(), {
      cityId: raipur,
      layout: { ...layout, mapDefault: 'satellite' },
      expectedVersion: null,
      staffUserId: staff,
    });
    expect((await getHomeLayout(t(), raipur)).mapDefault).toBe('satellite');
    expect((await getHomeLayout(t(), bhilai)).mapDefault).toBe('map'); // another city keeps the global layout
    await resetHomeLayout(t(), { cityId: raipur, expectedVersion: city.version, staffUserId: staff });
    expect((await getHomeLayout(t(), raipur)).mapDefault).toBe('map');

    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entity, 'layout'));
    expect(audit.map((a) => a.action).sort()).toEqual(['layout.reset', 'layout.saved', 'layout.saved']);
    const ev = await db.select().from(events).where(eq(events.event, 'admin_layout_published'));
    expect(ev).toHaveLength(3);
  });
});

describe('company details', () => {
  it('is empty until saved, then cleaned, versioned, audited and counted', async () => {
    expect((await getCompany(t())).version).toBeNull();
    const saved = await saveCompany(t(), {
      details: {
        legalName: ' Shourya  Pvt ',
        cin: 'u74999ct2020ptc012345',
        grievanceEmail: 'G@MechDost.com',
      },
      expectedVersion: null,
      staffUserId: staff,
    });
    const got = await getCompany(t());
    expect(got.details).toMatchObject({
      legalName: 'Shourya Pvt',
      cin: 'U74999CT2020PTC012345',
      grievanceEmail: 'g@mechdost.com',
      grievanceName: '',
    });
    await expect(
      saveCompany(t(), { details: { cin: 'bad' }, expectedVersion: saved.version, staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'COMPANY_INVALID', details: { field: 'cin' } });
    await expect(
      saveCompany(t(), { details: {}, expectedVersion: null, staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'STALE_SETTING' }); // creating twice loses
    const second = await saveCompany(t(), {
      details: { legalName: 'Shourya Pvt', grievanceName: 'Asha' },
      expectedVersion: saved.version,
      staffUserId: staff,
    });
    expect(second.version).toBeGreaterThan(saved.version);
    const ev = await db.select().from(events).where(eq(events.event, 'admin_company_saved'));
    expect(ev.at(-1)?.props).toMatchObject({ filled: 2, grievanceShown: true });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'company.saved'));
    expect(audit).toHaveLength(2);
  });
});

describe('city setting overrides', () => {
  it('records an event on override and on reset, and the picker lists only cities in scope', async () => {
    const o = await saveOperationalSetting(t(), {
      key: 'orders.acceptance_timeout_min',
      cityId: bhilai,
      value: 30,
      expectedVersion: null,
      staffUserId: staff,
    });
    await clearCitySetting(t(), {
      key: 'orders.acceptance_timeout_min',
      cityId: bhilai,
      expectedVersion: o.version,
      staffUserId: staff,
    });
    const ev = await db.select().from(events).where(eq(events.event, 'admin_setting_city_changed'));
    expect(ev.map((e) => (e.props as { action: string }).action).sort()).toEqual(['overridden', 'reset']);

    expect((await listCitiesInScope(t(), { all: true })).map((c) => c.code)).toEqual(['BHI', 'RPR']);
    expect((await listCitiesInScope(t(), { all: false, cityIds: [raipur] })).map((c) => c.code)).toEqual([
      'RPR',
    ]);
    expect(await listCitiesInScope(t(), { all: false, cityIds: [] })).toEqual([]);
  });
});
