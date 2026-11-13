/**
 * Seller onboarding over HTTP (plan 2026-11-13 Task 4): the public form needs Turnstile and is rate limited; the
 * invite link opens and submits once; staff review with the delivery area; shops ask for prices and staff decide;
 * a shop cannot see another shop's requests; the agreement plus an approved price take a new shop live.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
const HUMAN = 'turnstile-ok';
const OIL = 'CAS-ACT4T-0900';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let ops: Record<string, string>;
let marketing: Record<string, string>;
let n = 0;

async function person(tag: string, phone: string, role?: string, shopId?: string) {
  const token = ctx.verifier.add(`token-onboarding-${tag}-000000`, {
    firebaseUid: `onb-${tag}`,
    phone,
    email: `onb-${tag}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `onb-${tag}`,
    phone,
    email: `onb-${tag}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, shopId: shopId ?? null, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const application = (over: Record<string, unknown> = {}) => {
  n += 1;
  return {
    name: 'Ravi Sahu',
    phone: `+9198700000${String(n).padStart(2, '0')}`,
    email: `seller${String(n)}@example.com`,
    businessName: 'Sahu Auto Parts',
    shopName: 'Sahu Auto Parts',
    gstStatus: 'registered',
    gstNumber: '27AAPFU0939F1ZV',
    addressLine: 'Shop 4, GE Road, Pandri',
    pincode: '492004',
    location: { lat: 21.25, lng: 81.65, accuracyM: 12, source: 'search' },
    productSlugs: ['castrol-activ-4t-20w40-900ml'],
    consent: true,
    ...over,
  };
};

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) => ctx.app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });

beforeAll(async () => {
  ctx = await buildApp({ keyring, turnstile: new FakeTurnstile([HUMAN]) });
  await seedRaipurDemo(ctx.db, fixture);
  ops = await person('ops', '+919870099001', 'ops_manager');
  marketing = await person('mkt', '+919870099002', 'marketing');
});

describe('public application form', () => {
  it('needs Turnstile, validates strictly, and is rate limited per IP', async () => {
    expect((await post('/v1/partner-applications', { application: application() })).status).toBe(400);
    const bot = await post('/v1/partner-applications', {
      application: application(),
      turnstileToken: 'robot',
    });
    expect(bot.status).toBe(400);
    expect(((await bot.json()) as ErrorJson).error.code).toBe('TURNSTILE_FAILED');
    const bad = await post('/v1/partner-applications', {
      application: application({ gstNumber: '27AAPFU0939F1ZW' }),
      turnstileToken: HUMAN,
    });
    expect(bad.status).toBe(400);
    const ok = await post('/v1/partner-applications', { application: application(), turnstileToken: HUMAN });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { code: string }).code).toMatch(/^PA-RPR-/);
    let last = 201;
    for (let i = 0; i < 6; i++)
      last = (await post('/v1/partner-applications', { application: application(), turnstileToken: HUMAN }))
        .status;
    expect(last).toBe(429);
  });
});

describe('per-phone limit (final review 2026-11-13)', () => {
  it('one mobile number can apply 3 times a day, whatever the IP; another number still can', async () => {
    const fresh = await buildApp({ keyring, turnstile: new FakeTurnstile([HUMAN]) });
    const submit = (phone: string) =>
      fresh.app.request('/v1/partner-applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ application: application({ phone }), turnstileToken: HUMAN }),
      });
    for (let i = 0; i < 3; i++) expect((await submit('+919870011111')).status).toBe(201);
    const fourth = await submit('+919870011111');
    expect(fourth.status).toBe(429);
    expect((await submit('+919870022222')).status).toBe(201);
  });
});

describe('invites and review', () => {
  it('staff invite a seller; the link opens and submits once; marketing cannot see applications', async () => {
    const res = await post(
      '/v1/admin/partner-invites',
      { name: 'Asha Verma', email: 'asha@example.com', phone: '+919812345670' },
      ops,
    );
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };
    expect(
      (await ctx.app.request('/v1/partner-invites/unknown-token-unknown-token-unknown-token00')).status,
    ).toBe(404);
    const open = await ctx.app.request(`/v1/partner-invites/${token}`);
    expect(await open.json()).toMatchObject({ name: 'Asha Verma', phoneLast4: '5670' });
    const submit = () =>
      post(`/v1/partner-invites/${token}/application`, {
        application: application({ phone: '+919812345670', gstNumber: '22ABVCS4888H1ZL' }),
        turnstileToken: HUMAN,
      });
    const first = await submit();
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ status: 'approved' });
    expect((await submit()).status).toBe(409);
    expect((await ctx.app.request('/v1/admin/partner-applications', { headers: marketing })).status).toBe(
      403,
    );
  });

  it('an invited form needs no contacts: they come from the invite (final review 2026-11-13)', async () => {
    const res = await post(
      '/v1/admin/partner-invites',
      { name: 'Isha Nair', email: 'isha@example.com', phone: '+919812345692' },
      ops,
    );
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };
    const { name: _n, email: _e, phone: _p, ...rest } = application({ gstNumber: '27AAPFU0939F1ZV' });
    const submitted = await post(`/v1/partner-invites/${token}/application`, {
      application: rest,
      turnstileToken: HUMAN,
    });
    expect(submitted.status).toBe(201);
  });

  it('staff approve with the delivery area; the shop asks for a price; staff approve it; the shop goes live', async () => {
    // A fresh app: the public form's per-IP limit was used up by the test above.
    const fresh = await buildApp({ keyring, turnstile: new FakeTurnstile([HUMAN]) });
    const created = await fresh.app.request('/v1/partner-applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        application: application({ gstNumber: '29AAPFU0939F1ZR', phone: '+919870000999' }),
        turnstileToken: HUMAN,
      }),
    });
    expect(created.status).toBe(201);
    const { code } = (await created.json()) as { code: string };
    const detail = (await (
      await ctx.app.request(`/v1/admin/partner-applications/${code}`, { headers: ops })
    ).json()) as {
      version: number;
      gstNumber: string;
    };
    expect(detail.gstNumber).toBe('29AAPFU0939F1ZR');
    const approved = await post(
      `/v1/admin/partner-applications/${code}/approve`,
      { version: detail.version, coverage: [{ pincode: '492004', shippingPaise: 4000, leadDays: 2 }] },
      ops,
    );
    expect(approved.status).toBe(200);
    const { shopId } = (await approved.json()) as { shopId: string };

    const owner = await person('owner', '+919870000999', 'seller_owner', shopId);
    const other = await person(
      'other',
      '+919870000998',
      'seller_owner',
      (await ctx.db.select().from(s.shops).limit(1))[0]!.id,
    );
    const ask = await post(
      `/v1/shop-onboarding/${shopId}/price-requests`,
      { sku: OIL, pricePaise: 43000, onHand: 6 },
      owner,
    );
    expect(ask.status).toBe(201);
    expect(
      (await ctx.app.request(`/v1/shop-onboarding/${shopId}/price-requests`, { headers: other })).status,
    ).toBe(404);

    const admin = await person('admin', '+919870099003', 'super_admin');
    const published = await post(
      '/v1/admin/agreements',
      {
        textEn: 'MechDost seller agreement (placeholder text, version 1).',
        textHi: 'MechDost विक्रेता अनुबंध (अस्थायी पाठ, संस्करण 1)।',
      },
      admin,
    );
    expect(published.status).toBe(200);
    const agreement = (await (
      await ctx.app.request(`/v1/shop-onboarding/${shopId}/agreement`, { headers: owner })
    ).json()) as {
      current: { version: number };
    };
    expect(
      (await post(`/v1/shop-onboarding/${shopId}/agreement`, { version: agreement.current.version }, owner))
        .status,
    ).toBe(200);

    const queue = (await (
      await ctx.app.request('/v1/admin/price-requests?status=pending', { headers: ops })
    ).json()) as {
      items: { id: string; version: number; shopId: string }[];
    };
    const mine = queue.items.find((i) => i.shopId === shopId)!;
    expect(
      (
        await post(
          `/v1/admin/price-requests/${mine.id}/decide`,
          { version: mine.version, decision: 'approved' },
          marketing,
        )
      ).status,
    ).toBe(403);
    const decided = await post(
      `/v1/admin/price-requests/${mine.id}/decide`,
      { version: mine.version, decision: 'approved' },
      ops,
    );
    expect(decided.status).toBe(200);
    const [shop] = (await ctx.db.select().from(s.shops)).filter((x) => x.id === shopId);
    expect(shop?.status).toBe('approved');
  });
});

describe('admin list paging (final review 2026-11-13)', () => {
  it('invites and applications page with nextCursor and lose no rows; a bad cursor is 422', async () => {
    const walk = async (path: string) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 50; guard++) {
        const url = `${path}${path.includes('?') ? '&' : '?'}limit=1${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await ctx.app.request(url, { headers: ops });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          items: { code?: string; id?: string }[];
          nextCursor: string | null;
        };
        ids.push(...body.items.map((i) => i.code ?? i.id ?? ''));
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      return ids;
    };
    const invites = await walk('/v1/admin/partner-invites');
    expect(invites.length).toBeGreaterThan(1);
    expect(new Set(invites).size).toBe(invites.length);
    const apps = await walk('/v1/admin/partner-applications');
    expect(apps.length).toBeGreaterThan(1);
    expect(new Set(apps).size).toBe(apps.length);
    expect((await ctx.app.request('/v1/admin/partner-invites?cursor=bad!', { headers: ops })).status).toBe(
      422,
    );
  });
});

describe('agreement editor (final review 2026-11-13)', () => {
  it('staff read the current agreement: none yet, then the published version', async () => {
    const superAdmin = await person('super-editor', '+919870099077', 'super_admin');
    const before = await ctx.app.request('/v1/admin/agreements/current', { headers: superAdmin });
    expect(before.status).toBe(200);
    const body = (await before.json()) as { agreement: { version: number } | null };
    const published = await post(
      '/v1/admin/agreements',
      {
        textEn: 'MechDost seller agreement text for the editor test.',
        textHi: 'संपादक परीक्षण के लिए MechDost विक्रेता अनुबंध का पाठ।',
      },
      superAdmin,
    );
    expect(published.status).toBe(200);
    const after = (await (
      await ctx.app.request('/v1/admin/agreements/current', { headers: superAdmin })
    ).json()) as { agreement: { version: number; textEn: string } | null };
    expect(after.agreement?.version).toBe((body.agreement?.version ?? 0) + 1);
    expect(after.agreement?.textEn).toContain('editor test');
    // Agreement text is content (`content:write`, which marketing has); ops does not edit it.
    expect((await ctx.app.request('/v1/admin/agreements/current', { headers: marketing })).status).toBe(200);
    expect((await ctx.app.request('/v1/admin/agreements/current', { headers: ops })).status).toBe(403);
  });
});
