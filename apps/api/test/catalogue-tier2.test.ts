/**
 * Catalogue tier 2 over HTTP (design 2026-11-15 items 4, 6, 7): recommendations (public read, admin rules gated by
 * `categories:write`), Account -> Privacy (consents, data download is private, owner only), "Notify me" for a PIN that
 * is not served (signed in with a verified contact, per-person limit, admin counts gated by `cities:manage`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
// First: loading the app extends Zod with .openapi() before the shared catalogue schemas are created.
import { bearer, buildApp, type ErrorJson } from './helpers';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import * as s from '@mechdost/db/schema';
import { buildDueDataExports, ensureUser, expireDataExports, grantRole, type Tx } from '@mechdost/db/repo';
import { PrivacyViewDto } from '@mechdost/shared/privacy-api';
import { RecommendationListDto, RecoRuleListDto } from '@mechdost/shared/recommendations';
import { WaitlistDemandDto, WaitlistListDto } from '@mechdost/shared/waitlist';
import { EXPORT_REQUEST_RATE } from '../src/routes/privacy';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string, over: { emailVerified?: boolean } = {}): Promise<Person> {
  const identity = {
    firebaseUid: `tier2-${n}`,
    phone: `+9198333333${n}`,
    email: `tier2-${n}@example.com`,
    emailVerified: over.emailVerified ?? true,
  };
  const token = ctx.verifier.add(`token-tier2-0000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p?.headers ?? {},
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const tx = () => ctx.db as unknown as Tx;
let categories: Record<string, string> = {};

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  categories = Object.fromEntries((await ctx.db.select().from(s.categories)).map((x) => [x.slug, x.id]));
});

describe('recommendations', () => {
  const rule = () => ({
    triggerCategoryId: categories.lubricants,
    suggestCategoryId: categories.filters,
    label: 'Goes well with your oil',
    labelHi: 'आपके ऑयल के साथ अच्छा चलता है',
    priority: 5,
    active: true,
  });

  it('only categories:write holders manage rules; a customer and a guest are refused', async () => {
    const customer = await person('01');
    expect((await call(null, 'GET', '/admin/recommendation-rules')).status).toBe(401);
    expect((await call(customer, 'GET', '/admin/recommendation-rules')).status).toBe(403);
    expect((await call(customer, 'POST', '/admin/recommendation-rules', rule())).status).toBe(403);
    const support = await person('02');
    await grantRole(ctx.db, { userId: support.id, role: 'support_agent', grantedBy: null });
    expect((await call(support, 'GET', '/admin/recommendation-rules')).status).toBe(403);
  });

  it('a catalogue manager adds, changes and deletes a rule; the public read follows it, localised and cacheable', async () => {
    const mgr = await person('03');
    await grantRole(ctx.db, { userId: mgr.id, role: 'catalogue_manager', grantedBy: null });
    const bad = await call(mgr, 'POST', '/admin/recommendation-rules', {
      ...rule(),
      labelHi: 'only english',
    });
    expect(bad.status).toBe(400);
    const extra = await call(mgr, 'POST', '/admin/recommendation-rules', { ...rule(), createdBy: 'x' });
    expect(extra.status).toBe(400); // strict: no mass assignment
    const made = await call(mgr, 'POST', '/admin/recommendation-rules', rule());
    expect(made.status).toBe(201);
    expect((await call(mgr, 'POST', '/admin/recommendation-rules', rule())).status).toBe(409);

    const pub = await call(
      null,
      'GET',
      '/recommendations?slot=product&slugs=castrol-activ-4t-20w40-900ml&locale=hi',
    );
    expect(pub.status).toBe(200);
    expect(pub.headers.get('cache-control')).toContain('max-age=300');
    const list = RecommendationListDto.parse(pub.body);
    expect(list.items[0]?.reason.label).toBe('आपके ऑयल के साथ अच्छा चलता है');

    const id = made.body.id as string;
    const version = made.body.version as number;
    const saved = await call(mgr, 'PUT', `/admin/recommendation-rules/${id}`, {
      version,
      rule: { ...rule(), active: false },
    });
    expect(saved.status).toBe(200);
    expect(
      (await call(mgr, 'PUT', `/admin/recommendation-rules/${id}`, { version, rule: rule() })).status,
    ).toBe(409);
    expect(
      RecommendationListDto.parse(
        (await call(null, 'GET', '/recommendations?slot=product&slugs=castrol-activ-4t-20w40-900ml')).body,
      ).items,
    ).toEqual([]);
    const del = await call(
      mgr,
      'DELETE',
      `/admin/recommendation-rules/${id}?version=${String(saved.body.version)}`,
    );
    expect(del.status).toBe(200);
    expect(RecoRuleListDto.parse((await call(mgr, 'GET', '/admin/recommendation-rules')).body).rules).toEqual(
      [],
    );
  });

  it('validates the query: a slug that is not a slug, or a missing slot, is a 400', async () => {
    expect((await call(null, 'GET', '/recommendations?slot=product&slugs=A%20B')).status).toBe(400);
    expect((await call(null, 'GET', '/recommendations?slugs=x')).status).toBe(400);
    expect((await call(null, 'GET', '/recommendations?slot=checkout&slugs=x')).status).toBe(400);
  });
});

describe('privacy', () => {
  it('needs sign-in; shows consents never asked; records a withdrawal', async () => {
    expect((await call(null, 'GET', '/me/privacy')).status).toBe(401);
    const p = await person('11');
    const view = PrivacyViewDto.parse((await call(p, 'GET', '/me/privacy')).body);
    expect(view.consents.every((c) => c.granted === null)).toBe(true);
    expect((await call(p, 'PUT', '/me/privacy/consents/marketing', { granted: true })).status).toBe(200);
    expect((await call(p, 'PUT', '/me/privacy/consents/marketing', { granted: false })).status).toBe(200);
    const after = PrivacyViewDto.parse((await call(p, 'GET', '/me/privacy')).body);
    expect(after.consents.find((c) => c.purpose === 'marketing')).toMatchObject({ granted: false });
    expect((await call(p, 'PUT', '/me/privacy/consents/location', { granted: true })).status).toBe(400);
    expect((await call(p, 'PUT', '/me/privacy/consents/analytics', { granted: true, extra: 1 })).status).toBe(
      400,
    );
  });

  it('the data download is private: owner only, JSON, never cached, gone after expiry', async () => {
    const owner = await person('12');
    const other = await person('13');
    const req = await call(owner, 'POST', '/me/data-exports');
    expect(req.status).toBe(202);
    const id = req.body.id as string;
    expect((await call(owner, 'POST', '/me/data-exports')).status).toBe(409);
    expect((await call(owner, 'GET', `/me/data-exports/${id}/download`)).status).toBe(409); // not built yet
    await buildDueDataExports(tx(), {});
    const file = await call(owner, 'GET', `/me/data-exports/${id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers.get('cache-control')).toContain('no-store');
    expect(file.headers.get('content-disposition')).toContain('attachment');
    expect(JSON.stringify(file.body)).toContain('tier2-12@example.com');
    expect((await call(other, 'GET', `/me/data-exports/${id}/download`)).status).toBe(404);
    expect((await call(null, 'GET', `/me/data-exports/${id}/download`)).status).toBe(401);
    await expireDataExports(tx(), { now: new Date(Date.now() + 25 * 3_600_000) });
    expect((await call(owner, 'GET', `/me/data-exports/${id}/download`)).status).toBe(409);
  });

  it('limits export requests per person (429 after the hourly allowance)', async () => {
    const p = await person('14');
    const statuses: number[] = [];
    for (let i = 0; i <= EXPORT_REQUEST_RATE.limit; i += 1)
      statuses.push((await call(p, 'POST', '/me/data-exports')).status);
    expect(statuses[0]).toBe(202);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('notify me for a PIN that is not served', () => {
  it('needs sign-in; no guest form exists and no typed contact is accepted', async () => {
    expect((await call(null, 'POST', '/me/pincode-waitlist', { pincode: '110001' })).status).toBe(401);
    // Every signed-in token carries a verified phone (the session sync re-applies it), so the unverified case is
    // covered where it can be built: the repository test (packages/db/test/pincode-waitlist.test.ts).
    // The body takes a PIN only: a typed email or phone is refused, never stored.
    const p = await person('22');
    expect(
      (await call(p, 'POST', '/me/pincode-waitlist', { pincode: '110001', email: 'x@example.com' })).status,
    ).toBe(400);
    expect((await call(p, 'POST', '/me/pincode-waitlist', { pincode: '11000' })).status).toBe(400);
  });

  it('joins, lists, refuses a served PIN, and leaves', async () => {
    const p = await person('23');
    expect((await call(p, 'POST', '/me/pincode-waitlist', { pincode: '492004' })).status).toBe(409);
    expect((await call(p, 'POST', '/me/pincode-waitlist', { pincode: '110001' })).status).toBe(201);
    expect(WaitlistListDto.parse((await call(p, 'GET', '/me/pincode-waitlist')).body).entries).toHaveLength(
      1,
    );
    expect((await call(p, 'DELETE', '/me/pincode-waitlist/110001')).status).toBe(200);
    expect((await call(p, 'DELETE', '/me/pincode-waitlist/110001')).status).toBe(404);
  });

  it('the launch checklist counts per PIN and is for cities:manage holders only', async () => {
    const a = await person('24');
    await call(a, 'POST', '/me/pincode-waitlist', { pincode: '110077' });
    expect((await call(a, 'GET', '/admin/pincode-waitlist')).status).toBe(403);
    const admin = await person('25');
    await grantRole(ctx.db, { userId: admin.id, role: 'super_admin', grantedBy: null });
    const demand = WaitlistDemandDto.parse((await call(admin, 'GET', '/admin/pincode-waitlist')).body);
    expect(demand.rows.find((r) => r.pincode === '110077')).toMatchObject({ waiting: 1, cityCode: null });
    // Another customer's wait list is not visible through the customer route.
    const b = await person('26');
    expect(WaitlistListDto.parse((await call(b, 'GET', '/me/pincode-waitlist')).body).entries).toEqual([]);
  });
});
