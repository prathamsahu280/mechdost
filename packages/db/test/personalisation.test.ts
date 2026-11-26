/**
 * Shopping personalisation phases 2 and 3 (design 2026-11-25, founder approval 2026-11-26): the recently viewed list
 * kept on the server only with the `personalisation` consent (capped, idempotent per minute, cleared on withdrawal,
 * in the data export), "Similar options" (same size/spec and segment, another brand, buyable only), product and
 * workshop-fitting "goes well with" rules, the seeded default pairs, and the suggestion funnel per surface and
 * algorithm. Runs on the Raipur demo catalogue.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { RECENT_MAX } from '@mechdost/shared/recently-viewed';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  clearRecentlyViewed,
  createRecoRule,
  deleteRecoRule,
  fittingFor,
  listRecoRules,
  recentlyViewed,
  recommendFor,
  placeOrder,
  quoteCheckout,
  recordClientEvents,
  recordRecentViews,
  recoFunnel,
  searchRecoProducts,
  setConsent,
  similarFor,
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
let asha = '';
let ravi = '';
const cat: Record<string, string> = {};
const prod: Record<string, string> = {};

const CASTROL = 'castrol-activ-4t-20w40-900ml';
const HP = 'hp-racer4-20w40-900ml';
const MOTUL = 'motul-3100-4t-10w30-1l';
const SHELL = 'shell-advance-ax7-10w30-1l';
const FILTER = 'engine-oil-filter-petrol-car';
const CAR_TYRE = 'car-tyre-185-65-r15';
const at = (iso: string) => ({ viewedAt: iso });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const users = await db
    .insert(s.users)
    .values([{ firebaseUid: 'fb-p23-staff' }, { firebaseUid: 'fb-p23-asha' }, { firebaseUid: 'fb-p23-ravi' }])
    .returning();
  [staff, asha, ravi] = users.map((u) => u.id) as [string, string, string];
  for (const c of await db.select().from(s.categories)) cat[c.slug] = c.id;
  for (const p of await db.select({ id: s.products.id, slug: s.products.slug }).from(s.products))
    prod[p.slug] = p.id;
});

afterAll(async () => {
  await client.close();
});

describe('recently viewed on the server (phase 2)', () => {
  it('stores nothing without the personalisation consent', async () => {
    const res = await recordRecentViews(t(), {
      userId: asha,
      cityCode: 'RPR',
      views: [{ slug: CASTROL, ...at('2026-11-26T10:00:00.000Z') }],
    });
    expect(res).toEqual({ stored: false, items: [] });
    const rows = await db.select().from(s.recentlyViewed).where(eq(s.recentlyViewed.userId, asha));
    expect(rows).toHaveLength(0);
    expect(await recentlyViewed(t(), asha)).toEqual({ stored: false, items: [] });
  });

  it('with consent keeps the newest views first with the city, one row per product', async () => {
    await setConsent(t(), { userId: asha, purpose: 'personalisation', granted: true });
    await recordRecentViews(t(), {
      userId: asha,
      cityCode: 'RPR',
      views: [{ slug: CASTROL, ...at('2026-11-26T10:00:00.000Z') }],
    });
    const res = await recordRecentViews(t(), {
      userId: asha,
      cityCode: 'RPR',
      views: [{ slug: MOTUL, ...at('2026-11-26T10:05:00.000Z') }],
    });
    expect(res.stored).toBe(true);
    expect(res.items.map((i) => i.slug)).toEqual([MOTUL, CASTROL]);
    const [row] = await db.select().from(s.recentlyViewed).where(eq(s.recentlyViewed.userId, asha)).limit(1);
    expect(row?.cityCode).toBe('RPR');
  });

  it('a second view of the same product within a minute changes nothing; a later one moves it up', async () => {
    const before = await recentlyViewed(t(), asha);
    const same = await recordRecentViews(t(), {
      userId: asha,
      cityCode: 'RPR',
      views: [{ slug: CASTROL, ...at('2026-11-26T10:00:30.000Z') }],
    });
    expect(same.items).toEqual(before.items);
    const later = await recordRecentViews(t(), {
      userId: asha,
      cityCode: 'RPR',
      views: [{ slug: CASTROL, ...at('2026-11-26T10:10:00.000Z') }],
    });
    expect(later.items.map((i) => i.slug)).toEqual([CASTROL, MOTUL]);
  });

  it('never keeps more than RECENT_MAX products and ignores unknown slugs and future times', async () => {
    const slugs = fixture.products.map((p) => p.slug).slice(0, RECENT_MAX + 4);
    for (const [i, slug] of slugs.entries())
      await recordRecentViews(t(), {
        userId: asha,
        cityCode: 'RPR',
        views: [{ slug, viewedAt: new Date(Date.UTC(2026, 10, 26, 11, i)).toISOString() }],
      });
    await recordRecentViews(t(), {
      userId: asha,
      cityCode: 'RPR',
      views: [{ slug: 'no-such-product', ...at('2026-11-26T12:00:00.000Z') }],
    });
    const list = await recentlyViewed(t(), asha);
    expect(list.items).toHaveLength(RECENT_MAX);
    expect(list.items[0]?.slug).toBe(slugs.at(-1));
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.recentlyViewed)
      .where(eq(s.recentlyViewed.userId, asha));
    expect(n).toBe(RECENT_MAX);
    // A time in the future is stored as "now" (a wrong device clock cannot pin a product to the top).
    await recordRecentViews(t(), {
      userId: asha,
      cityCode: 'RPR',
      views: [{ slug: SHELL, ...at('2099-01-01T00:00:00.000Z') }],
    });
    const after = await recentlyViewed(t(), asha);
    expect(new Date(after.items[0]?.viewedAt ?? 0).getTime()).toBeLessThan(Date.UTC(2030, 0, 1));
  });

  it("is the person's own list: another account sees and clears only its own", async () => {
    await setConsent(t(), { userId: ravi, purpose: 'personalisation', granted: true });
    await recordRecentViews(t(), {
      userId: ravi,
      cityCode: 'RPR',
      views: [{ slug: HP, ...at('2026-11-26T10:00:00.000Z') }],
    });
    expect((await recentlyViewed(t(), ravi)).items.map((i) => i.slug)).toEqual([HP]);
    expect(await clearRecentlyViewed(t(), ravi)).toBe(1);
    expect((await recentlyViewed(t(), ravi)).items).toEqual([]);
    expect((await recentlyViewed(t(), asha)).items).toHaveLength(RECENT_MAX);
  });

  it('withdrawing the consent deletes the stored list at once', async () => {
    await setConsent(t(), { userId: asha, purpose: 'personalisation', granted: false });
    const rows = await db.select().from(s.recentlyViewed).where(eq(s.recentlyViewed.userId, asha));
    expect(rows).toHaveLength(0);
    expect((await recentlyViewed(t(), asha)).stored).toBe(false);
  });
});

describe('Similar options (phase 3)', () => {
  it('suggests the same pack and grade of another brand that can be bought, never the product itself', async () => {
    const items = await similarFor(t(), { slug: CASTROL, cityCode: 'RPR', locale: 'en' });
    const slugs = items.map((i) => i.card.slug);
    expect(slugs).toContain(HP);
    expect(slugs).not.toContain(CASTROL);
    // 10W30 1 l is another grade and pack.
    expect(slugs).not.toContain(MOTUL);
    expect(items.every((i) => i.reason.source === 'similar')).toBe(true);
    expect(items.find((i) => i.card.slug === HP)?.reason.size).toBe('900 ml');
  });

  it('pairs the 10W30 1 l oils with each other and gives nothing for a product with no size or key spec', async () => {
    expect(
      (await similarFor(t(), { slug: MOTUL, cityCode: 'RPR', locale: 'en' })).map((i) => i.card.slug),
    ).toEqual([SHELL]);
    expect(await similarFor(t(), { slug: FILTER, cityCode: 'RPR', locale: 'en' })).toEqual([]);
    expect(await similarFor(t(), { slug: 'no-such-product', cityCode: 'RPR', locale: 'en' })).toEqual([]);
  });

  it('leaves out a brand-mate, a hidden product and one nobody offers', async () => {
    await db.update(s.products).set({ status: 'draft' }).where(eq(s.products.slug, HP));
    expect(
      (await similarFor(t(), { slug: CASTROL, cityCode: 'RPR', locale: 'en' })).map((i) => i.card.slug),
    ).not.toContain(HP);
    await db.update(s.products).set({ status: 'live' }).where(eq(s.products.slug, HP));
  });
});

describe('"Goes well with": product pairs and the workshop fitting link (phase 3)', () => {
  it('a product → product rule suggests that product with its label, and is listed with product names', async () => {
    const rule = await createRecoRule(t(), {
      staffUserId: staff,
      input: {
        triggerProductId: prod[CASTROL] ?? '',
        suggestKind: 'product',
        suggestProductId: prod[FILTER] ?? '',
        label: 'The filter for this oil change',
        labelHi: 'इस ऑयल बदलाव के लिए फ़िल्टर',
        priority: 1,
        active: true,
      },
    });
    expect(rule.triggerProduct?.slug).toBe(CASTROL);
    expect(rule.suggestProduct?.slug).toBe(FILTER);
    expect(rule.triggerCategory).toBeNull();
    const items = await recommendFor(t(), { slugs: [CASTROL], cityCode: 'RPR', locale: 'hi' });
    expect(items[0]?.card.slug).toBe(FILTER);
    expect(items[0]?.reason.label).toBe('इस ऑयल बदलाव के लिए फ़िल्टर');
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, rule.id));
    expect(audit.map((a) => a.action)).toContain('recommendation_rule.created');
    expect((await listRecoRules(t())).some((r) => r.id === rule.id)).toBe(true);
    await deleteRecoRule(t(), { ruleId: rule.id, expectedVersion: rule.version, staffUserId: staff });
  });

  it('a category → workshop fitting rule gives the fitting link for products of that category only', async () => {
    const rule = await createRecoRule(t(), {
      staffUserId: staff,
      input: {
        triggerCategoryId: cat.tyres ?? '',
        suggestKind: 'workshop_fitting',
        label: 'Get it fitted at a nearby workshop',
        labelHi: 'पास की वर्कशॉप में फ़िट करवाएँ',
        priority: 5,
        active: true,
      },
    });
    expect(await fittingFor(t(), { slugs: [CAR_TYRE], locale: 'en' })).toEqual({
      label: 'Get it fitted at a nearby workshop',
    });
    expect(await fittingFor(t(), { slugs: [CASTROL], locale: 'en' })).toBeNull();
    // Paused rules give nothing.
    await db
      .update(s.recommendationRules)
      .set({ active: false })
      .where(eq(s.recommendationRules.id, rule.id));
    expect(await fittingFor(t(), { slugs: [CAR_TYRE], locale: 'en' })).toBeNull();
  });

  it('refuses a second identical pair and a rule whose shape does not match its kind', async () => {
    const input = {
      triggerProductId: prod[MOTUL] ?? '',
      suggestKind: 'product' as const,
      suggestProductId: prod[FILTER] ?? '',
      label: 'Filter for this oil',
      labelHi: 'इस ऑयल के लिए फ़िल्टर',
      priority: 3,
      active: true,
    };
    await createRecoRule(t(), { staffUserId: staff, input });
    await expect(createRecoRule(t(), { staffUserId: staff, input })).rejects.toMatchObject({
      code: 'DUPLICATE_RULE',
    });
    await expect(
      db.execute(
        sql`insert into recommendation_rules (trigger_category_id, suggest_kind, suggest_product_id, label, label_hi)
          values (${cat.tyres}::uuid, 'workshop_fitting', ${prod[FILTER]}::uuid, 'Bad rule', 'गलत नियम')`,
      ),
    ).rejects.toThrow();
  });

  it('the product picker finds visible products by name', async () => {
    const found = await searchRecoProducts(t(), 'activ');
    expect(found.map((p) => p.slug)).toContain(CASTROL);
  });

  it('the default pairs migration seeds tyre → tube, battery → accessories, oil → filter and fitting rules', async () => {
    // The migration ran before the catalogue existed (fresh test database); run it again now that it does.
    const file = fileURLToPath(new URL('../drizzle/0103_personalisation_default_pairs.sql', import.meta.url));
    await db.insert(s.categories).values([
      { slug: 'truck-bus-tyres', name: 'Truck & bus tyres', nameHi: 'ट्रक और बस टायर', parentId: cat.tyres },
      { slug: 'tubes-flaps', name: 'Tubes & flaps', nameHi: 'ट्यूब और फ़्लैप', parentId: cat.tyres },
    ]);
    for (const stmt of readFileSync(file, 'utf8').split('--> statement-breakpoint'))
      if (stmt.trim()) await db.execute(sql.raw(stmt));
    const rules = await listRecoRules(t());
    expect(
      rules.some(
        (r) => r.triggerCategory?.slug === 'truck-bus-tyres' && r.suggestCategory?.slug === 'tubes-flaps',
      ),
    ).toBe(true);
    expect(
      rules.some((r) => r.triggerCategory?.slug === 'tyres' && r.suggestKind === 'workshop_fitting'),
    ).toBe(true);
    expect(rules.every((r) => /[ऀ-ॿ]/u.test(r.labelHi))).toBe(true);
    // Running it again adds nothing.
    const count = rules.length;
    for (const stmt of readFileSync(file, 'utf8').split('--> statement-breakpoint'))
      if (stmt.trim()) await db.execute(sql.raw(stmt));
    expect((await listRecoRules(t())).length).toBe(count);
  });
});

describe('suggestion funnel per surface and algorithm (spec 12)', () => {
  it('counts impressions, clicks and the add-to-cart that followed a click in the same session', async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 60_000);
    const row = (event: string, props: Record<string, unknown>, when = now) => ({
      event,
      occurredAt: when,
      page: '/shop/x',
      props,
    });
    await recordClientEvents(t(), {
      source: 'web',
      anonymousId: 'anon-p23-1',
      sessionId: 'sess-p23-1',
      consentVersion: '2026-11-14',
      rows: [
        row('reco_impression', { surface: 'product', algo: 'similar', count: 4 }),
        row('reco_click', { surface: 'product', algo: 'similar', slug: HP, position: 2 }),
        row('add_to_cart', { slug: HP, qty: 1 }, later),
        row('reco_impression', { surface: 'cart', algo: 'recent', count: 3 }),
      ],
    });
    // Another session's add of the same product is not attributed.
    await recordClientEvents(t(), {
      source: 'web',
      anonymousId: 'anon-p23-2',
      sessionId: 'sess-p23-2',
      consentVersion: '2026-11-14',
      rows: [row('add_to_cart', { slug: HP, qty: 1 }, later)],
    });
    const rows = await recoFunnel(t(), {
      from: new Date(now.getTime() - 3_600_000),
      to: new Date(now.getTime() + 3_600_000),
    });
    expect(rows.find((r) => r.surface === 'product' && r.algo === 'similar')).toEqual({
      surface: 'product',
      algo: 'similar',
      impressions: 1,
      shown: 4,
      clicks: 1,
      adds: 1,
      orders: 0,
    });
    expect(rows.find((r) => r.surface === 'cart' && r.algo === 'recent')?.impressions).toBe(1);
  });

  it('counts an order placed later in the same session that holds the clicked product, once', async () => {
    const now = new Date();
    const lines = [{ sku: fixture.products.find((p) => p.slug === SHELL)?.sku ?? '', qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const placed = await placeOrder(t(), {
      method: 'cod',
      userId: ravi,
      idempotencyKey: 'p23-funnel-order-0001',
      address: {
        contactName: 'Ravi Sahu',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        line2: null,
        landmark: null,
        pincode: '492004',
      },
      lines,
      expectedTotalPaise: q.totalPaise,
      note: null,
      locale: 'en',
      coins: 0,
    });
    const at = (ms: number) => new Date(now.getTime() + ms);
    await recordClientEvents(t(), {
      source: 'web',
      anonymousId: 'anon-p23-3',
      sessionId: 'sess-p23-3',
      consentVersion: '2026-11-14',
      rows: [
        {
          event: 'reco_click',
          occurredAt: at(0),
          page: '/shop/x',
          props: { surface: 'home', algo: 'recent', slug: SHELL, position: 1 },
        },
        { event: 'add_to_cart', occurredAt: at(1000), page: '/shop/x', props: { slug: SHELL, qty: 1 } },
        {
          event: 'purchase_submitted',
          occurredAt: at(2000),
          page: '/checkout',
          props: { code: placed.code, valuePaise: q.totalPaise, demo: false, businessPurchase: false },
        },
        // A click on a product the order does not hold is not attributed.
        {
          event: 'reco_click',
          occurredAt: at(0),
          page: '/shop/x',
          props: { surface: 'home', algo: 'recent', slug: HP, position: 2 },
        },
      ],
    });
    const rows = await recoFunnel(t(), { from: at(-3_600_000), to: at(3_600_000) });
    expect(rows.find((r) => r.surface === 'home' && r.algo === 'recent')).toMatchObject({
      clicks: 2,
      adds: 1,
      orders: 1,
    });
  });
});
