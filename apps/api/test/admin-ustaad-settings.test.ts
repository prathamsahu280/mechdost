/**
 * Admin → Ustaad settings and tables over HTTP (spec 23 § 3, § 8 "Admin", § 15; SR-8, SR-38, SR-40, SR-41; task G1).
 * Role-leak rows: anonymous 401 everywhere; customer, shop, support and finance 403; community manager and ops read
 * but never write; marketing reaches only the promotions routes; super admin everything, invariants enforced
 * (AT-PROMO-1 label change → 422, AT-LEVEL-2 staff approval off → 422). The admin routes are never behind the
 * `ustaad.access` switch, so switching the network off cannot lock the admin out.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { USTAAD_SETTING_KEYS } from '@mechdost/shared/ustaad/settings';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
type Headers = Record<string, string>;
const who: Record<string, Headers> = {};
let shopId = '';

async function person(
  n: string,
  role: string | null,
  scope: { shopId?: string; cityId?: string; workshopId?: string } = {},
): Promise<Headers> {
  const phone = `+9198666666${n}`;
  const token = ctx.verifier.add(`token-ustaad-admin-0${n}`, {
    firebaseUid: `ua-${n}`,
    phone,
    email: `ua-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `ua-${n}`,
    phone,
    email: `ua-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null, cityId: null, ...scope });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const req = (path: string, h: Headers | null, method = 'GET', body?: unknown) =>
  ctx.app.request(`/v1/admin/ustaad/${path}`, {
    method,
    headers: h ?? { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const code = async (r: Response) => ((await r.json()) as ErrorJson).error.code;

const PROMO = {
  slot: 'feed',
  titleEn: 'Exide batteries',
  titleHi: 'एक्साइड बैटरी',
  bodyEn: '',
  bodyHi: '',
  target: 'url_internal',
  targetId: '/shop/exide',
  cityIds: [],
  segmentCodes: [],
  startsAt: '2026-12-01T00:00:00.000Z',
  endsAt: '2026-12-08T00:00:00.000Z',
};

const LISTS = [
  'settings',
  'levels',
  'badges',
  'tags',
  'words',
  'reasons',
  'reach-cities',
  'tutorial-cards',
  'coachmarks',
] as const;

beforeAll(async () => {
  ctx = await buildApp();
  // Migration `ustaad_identity_seed` (workstream B) seeds the six coach-marks; this CRUD test creates one itself.
  await ctx.db.delete(s.ustaadCoachmarks);
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('no state');
  const [city] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  if (!city) throw new Error('no city');
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: city.id });
  const [shop] = await ctx.db
    .insert(s.shops)
    .values({
      name: 'Leak Shop',
      phone: '+919811177777',
      addressLine: 'Pandri',
      pincode: '492001',
      cityId: city.id,
      stateId: state.id,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  if (!shop) throw new Error('no shop');
  shopId = shop.id;
  const [workshop] = await ctx.db
    .insert(s.workshops)
    .values({
      cityId: city.id,
      slug: 'leak-garage-ua',
      name: 'Leak Garage',
      addressLine: 'Pandri',
      area: 'Pandri',
      pincode: '492001',
      location: { lng: 81.64, lat: 21.23 },
      vehicleTypes: ['2W'],
      hours: { open: '09:00', close: '20:00', days: [0, 1, 2, 3, 4, 5, 6] },
    })
    .returning();
  if (!workshop) throw new Error('no workshop');
  who.admin = await person('01', 'super_admin');
  // City scoped (SR-38); the network settings are global, so a Raipur manager still reads them.
  who.cm = await person('02', 'community_manager', { cityId: city.id });
  who.ops = await person('03', 'ops_manager');
  who.marketing = await person('04', 'marketing');
  who.support = await person('05', 'support_agent');
  who.finance = await person('06', 'finance');
  who.customer = await person('07', null);
  if (shopId) who.shop = await person('08', 'seller_owner', { shopId });
  who.workshop = await person('09', 'workshop_owner', { workshopId: workshop.id });
  // A network member (the mechanic role that joining grants): member routes, never the admin.
  who.mechanic = await person('10', 'mechanic');
});

describe('role-leak matrix', () => {
  it('anonymous callers get 401 on every list and every write', async () => {
    for (const path of [...LISTS, 'promotions']) expect((await req(path, null)).status).toBe(401);
    expect((await req('settings', null, 'PATCH', { changes: [] })).status).toBe(401);
    expect((await req('levels', null, 'POST', {})).status).toBe(401);
  });

  it('customer, shop, workshop, mechanic member, support and finance get 403 on every list, promotions included', async () => {
    for (const role of ['customer', 'shop', 'workshop', 'mechanic', 'support', 'finance']) {
      const h = who[role];
      if (!h) continue;
      for (const path of [...LISTS, 'promotions'])
        expect((await req(path, h)).status, `${role} ${path}`).toBe(403);
    }
  });

  it('community manager and ops read every list but cannot write', async () => {
    for (const role of ['cm', 'ops']) {
      const h = who[role] ?? {};
      for (const path of [...LISTS, 'promotions'])
        expect((await req(path, h)).status, `${role} ${path}`).toBe(200);
      const patch = await req('settings', h, 'PATCH', {
        changes: [{ key: 'ustaad.posts.per_day', value: 10, version: null }],
      });
      expect(patch.status).toBe(403);
      expect((await req('promotions', h, 'POST', PROMO)).status).toBe(403);
      expect((await req('tutorial-cards', h, 'POST', {})).status).toBe(403);
    }
    const listed = (await (await req('settings', who.cm ?? {})).json()) as { canEdit: boolean };
    expect(listed.canEdit).toBe(false);
  });

  it('marketing reaches only promotions: 403 on the settings and every other table', async () => {
    const h = who.marketing ?? {};
    for (const path of LISTS) expect((await req(path, h)).status, path).toBe(403);
    expect((await req('promotions', h)).status).toBe(200);
    const created = await req('promotions', h, 'POST', PROMO);
    expect(created.status).toBe(200);
  });
});

describe('settings', () => {
  it('lists every registry key with its default and version; the super admin may edit and raise the video', async () => {
    const r = await req('settings', who.admin ?? {});
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      settings: { key: string; default: unknown; version: number | null }[];
      canEdit: boolean;
      canRaiseVideo: boolean;
    };
    expect(body.settings.map((x) => x.key).sort()).toEqual([...USTAAD_SETTING_KEYS].sort());
    expect(body.canEdit).toBe(true);
    expect(body.canRaiseVideo).toBe(true);
  });

  it('saves two weights together and refuses a pair that does not sum to 100 (SETTING_RELATION)', async () => {
    const ok = await req('settings', who.admin ?? {}, 'PATCH', {
      changes: [
        { key: 'ustaad.feed.w_follows', value: 25, version: null },
        { key: 'ustaad.feed.w_city', value: 30, version: null },
      ],
    });
    expect(ok.status).toBe(200);
    const bad = await req('settings', who.admin ?? {}, 'PATCH', {
      changes: [{ key: 'ustaad.discover.w_new', value: 9, version: null }],
    });
    expect(bad.status).toBe(422);
    expect(await code(bad)).toBe('SETTING_RELATION');
  });

  it('AT-PROMO-1: changing the Sponsored label is 422 SETTING_INVARIANT, as a setting and on a promotion', async () => {
    const asSetting = await req('settings', who.admin ?? {}, 'PATCH', {
      changes: [{ key: 'ustaad.promo.label', value: 'Ad', version: null }],
    });
    expect(asSetting.status).toBe(422);
    expect(await code(asSetting)).toBe('SETTING_INVARIANT');
    const onPromo = await req('promotions', who.admin ?? {}, 'POST', { ...PROMO, label: 'Ad' });
    expect(onPromo.status).toBe(422);
    expect(await code(onPromo)).toBe('SETTING_INVARIANT');
  });

  it('AT-LEVEL-2: staff final approval cannot be switched off; nor can Bada skip the staff review', async () => {
    const off = await req('settings', who.admin ?? {}, 'PATCH', {
      changes: [{ key: 'ustaad.verify.staff_final_approval', value: false, version: null }],
    });
    expect(off.status).toBe(422);
    expect(await code(off)).toBe('SETTING_INVARIANT');
    const bada = await req('levels', who.admin ?? {}, 'POST', {
      level: 'bada',
      ruleGroup: 'A',
      minFollowers: 50,
      minBestAnswers: 10,
      minHelpfulPct: 70,
      minVerifiedYears: 2,
      minVideos: 0,
      minRecommendations: 0,
      needsStaffReview: false,
      perkEn: '',
      perkHi: '',
      coinMultiplierBp: 12_000,
      nameEn: 'Bada Ustaad',
      nameHi: 'बड़ा उस्ताद',
      position: 4,
    });
    expect(bada.status).toBe(422);
    expect(await code(bada)).toBe('SETTING_INVARIANT');
  });

  it('spec 20 guard: a Coins multiplier above 1× is 422 COIN_GUARD_REQUIRED', async () => {
    const r = await req('levels', who.admin ?? {}, 'POST', {
      level: 'pakka',
      ruleGroup: 'Z',
      minFollowers: 1,
      minBestAnswers: 1,
      minHelpfulPct: 0,
      minVerifiedYears: 0,
      minVideos: 0,
      minRecommendations: 0,
      needsStaffReview: false,
      perkEn: '',
      perkHi: '',
      coinMultiplierBp: 15_000,
      nameEn: 'Pakka Ustaad',
      nameHi: 'पक्का उस्ताद',
      position: 3,
    });
    expect(r.status).toBe(422);
    expect(await code(r)).toBe('COIN_GUARD_REQUIRED');
  });

  it('video above 180 s needs a reason code; with one the super admin saves (audited)', async () => {
    const change = { changes: [{ key: 'ustaad.posts.video_max_s', value: 240, version: null }] };
    const without = await req('settings', who.admin ?? {}, 'PATCH', change);
    expect(without.status).toBe(422);
    expect(await code(without)).toBe('SETTING_INVARIANT');
    const withReason = await req('settings', who.admin ?? {}, 'PATCH', { ...change, reasonCode: 'pilot' });
    expect(withReason.status).toBe(200);
  });

  it('a stale version is 409; an unknown key 422 SETTING_UNKNOWN; an extra field 400', async () => {
    const stale = await req('settings', who.admin ?? {}, 'PATCH', {
      changes: [{ key: 'ustaad.feed.w_follows', value: 25, version: 99 }],
    });
    expect(stale.status).toBe(409);
    const unknown = await req('settings', who.admin ?? {}, 'PATCH', {
      changes: [{ key: 'ustaad.nope', value: 1, version: null }],
    });
    expect(unknown.status).toBe(422);
    expect(await code(unknown)).toBe('SETTING_UNKNOWN');
    const extra = await req('settings', who.admin ?? {}, 'PATCH', {
      changes: [{ key: 'ustaad.posts.per_day', value: 5, version: null }],
      official: true,
    });
    expect(extra.status).toBe(400);
  });

  it('switching the network off does not lock the admin out', async () => {
    const off = await req('settings', who.admin ?? {}, 'PATCH', {
      changes: [{ key: 'ustaad.access', value: 'off', version: null }],
    });
    expect(off.status).toBe(200);
    expect((await req('settings', who.admin ?? {})).status).toBe(200);
  });
});

describe('tables', () => {
  it('tags: create, edit with version (stale 409) and merge', async () => {
    const h = who.admin ?? {};
    const mk = async (slug: string) =>
      (await (
        await req('tags', h, 'POST', {
          slug,
          nameEn: slug,
          nameHi: 'टैग',
          group: 'part',
          aliases: [],
          active: true,
        })
      ).json()) as { id: string; version: number };
    const a = await mk('battri');
    const b = await mk('battery');
    const stale = await req(`tags/${a.id}`, h, 'PATCH', {
      slug: 'battri',
      nameEn: 'Battri',
      nameHi: 'बैट्री',
      group: 'part',
      aliases: [],
      active: true,
      version: a.version + 1,
    });
    expect(stale.status).toBe(409);
    const merged = await req(`tags/${a.id}/merge`, h, 'POST', { intoId: b.id, version: a.version });
    expect(merged.status).toBe(200);
    const list = (await (await req('tags', h)).json()) as {
      tags: { id: string; mergedIntoId: string | null }[];
    };
    expect(list.tags.find((x) => x.id === a.id)?.mergedIntoId).toBe(b.id);
  });

  it('words, reasons, reach cities, tutorial cards and coach-marks are editable by the super admin', async () => {
    const h = who.admin ?? {};
    expect(
      (
        await req('words', h, 'POST', {
          list: 'scam_phrase',
          phrase: 'Registration fee',
          lang: 'any',
          active: true,
        })
      ).status,
    ).toBe(200);
    const reasons = (await (await req('reasons', h)).json()) as {
      reasons: { code: string; labelEn: string; labelHi: string; version: number }[];
    };
    const other = reasons.reasons.find((r) => r.code === 'other');
    if (!other) throw new Error('no other');
    const off = await req('reasons/other', h, 'PATCH', {
      labelEn: other.labelEn,
      labelHi: other.labelHi,
      active: false,
      defaultClock: 'standard_24h',
      version: other.version,
    });
    expect(off.status).toBe(422);
    const cities = (await (await req('reach-cities', h)).json()) as {
      cities: { cityId: string; version: number | null; enabled: boolean }[];
    };
    const raipur = cities.cities[0];
    if (!raipur) throw new Error('no city');
    expect(
      (
        await req(`reach-cities/${raipur.cityId}`, h, 'PUT', {
          enabled: !raipur.enabled,
          version: raipur.version,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req('tutorial-cards', h, 'POST', {
          code: 'welcome',
          position: 1,
          titleEn: 'Welcome',
          titleHi: 'स्वागत है',
          bodyEn: 'Ask, show, learn.',
          bodyHi: 'पूछो, दिखाओ, सीखो।',
          active: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req('coachmarks', h, 'POST', {
          target: 'mic',
          textEn: 'Hold to ask',
          textHi: 'दबाकर पूछें',
          position: 1,
          active: true,
        })
      ).status,
    ).toBe(200);
  });

  it('promotions move draft → scheduled; a jump to live is 409 BAD_MOVE; an unsafe target is 400', async () => {
    const h = who.admin ?? {};
    const p = (await (await req('promotions', h, 'POST', PROMO)).json()) as { id: string; version: number };
    const live = await req(`promotions/${p.id}/move`, h, 'POST', { to: 'live', version: p.version });
    expect(live.status).toBe(409);
    expect(await code(live)).toBe('BAD_MOVE');
    expect(
      (await req(`promotions/${p.id}/move`, h, 'POST', { to: 'scheduled', version: p.version })).status,
    ).toBe(200);
    expect((await req('promotions', h, 'POST', { ...PROMO, targetId: 'https://evil.example' })).status).toBe(
      400,
    );
  });

  it('a foreign id is 404', async () => {
    const r = await req('tags/0190a2c4-0000-7000-8000-000000000000/merge', who.admin ?? {}, 'POST', {
      intoId: '0190a2c4-0000-7000-8000-000000000001',
      version: 1,
    });
    expect(r.status).toBe(404);
  });
});
