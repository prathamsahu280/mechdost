import { describe, expect, it } from 'vitest';
import { DEMO_PRODUCTS, searchProducts } from '../src/demo/catalogue';
import { AREA_HI, PRODUCT_HI, SERVICE_HI, SHOP_HI, WORKSHOP_HI } from '../src/demo/i18n/hi';
import {
  localizeArea,
  localizeHours,
  localizeProduct,
  localizeShop,
  localizeWorkshop,
  productNameFor,
  serviceNameFor,
  shopNameFor,
  workshopNameFor,
} from '../src/demo/i18n/localize';
import { productReviews, workshopReviews } from '../src/demo/reviews';
import { DEMO_SHOPS } from '../src/demo/shops';
import { DEMO_WORKSHOPS } from '../src/demo/workshops';
import { latinOffenders } from './hindi-allowlist';

/** Hard rule 10: every piece of demo content has a Hindi version with no stray English (user 2026-11-02). */
describe('Hindi content overlays', () => {
  it('cover every product, workshop, service, shop and locality', () => {
    expect(DEMO_PRODUCTS.filter((p) => !(p.slug in PRODUCT_HI)).map((p) => p.slug)).toEqual([]);
    expect(DEMO_WORKSHOPS.filter((w) => !(w.slug in WORKSHOP_HI)).map((w) => w.slug)).toEqual([]);
    expect(DEMO_SHOPS.filter((s) => !(s.slug in SHOP_HI)).map((s) => s.slug)).toEqual([]);
    const services = new Set(DEMO_WORKSHOPS.flatMap((w) => w.services.map((s) => s.key)));
    expect([...services].filter((k) => !(k in SERVICE_HI))).toEqual([]);
    const areas = new Set([
      ...DEMO_WORKSHOPS.map((w) => w.area),
      ...DEMO_SHOPS.map((s) => s.area),
      ...DEMO_PRODUCTS.flatMap((p) => productReviews(p).map((r) => r.area)),
      ...DEMO_WORKSHOPS.flatMap((w) => workshopReviews(w).map((r) => r.area)),
    ]);
    expect([...areas].filter((a) => !(a in AREA_HI))).toEqual([]);
  });

  it('leave no English words in what a Hindi page shows', () => {
    const offenders: string[] = [];
    const check = (where: string, text: string) => {
      const words = latinOffenders(text);
      if (words.length > 0) offenders.push(`${where}: ${words.join(', ')}`);
    };
    for (const p of DEMO_PRODUCTS.map((x) => localizeProduct(x, 'hi'))) {
      check(p.slug, [p.brand, p.name, p.spec, p.compatibility, ...p.highlights].join(' · '));
    }
    for (const w of DEMO_WORKSHOPS.map((x) => localizeWorkshop(x, 'hi'))) {
      check(
        w.slug,
        [
          w.name,
          w.area,
          w.address,
          w.hours,
          ...w.services.flatMap((s) => [s.name, s.duration, s.included]),
        ].join(' · '),
      );
    }
    for (const s of DEMO_SHOPS.map((x) => localizeShop(x, 'hi'))) check(s.slug, `${s.name} · ${s.area}`);
    for (const area of Object.values(AREA_HI)) check(area, area);
    expect(offenders).toEqual([]);
  });

  it('flags generic English words but not brands, models, units or codes', () => {
    expect(
      latinOffenders('Castrol Activ 4T 20W40 900 ml · MD-RPR-2026-X7K2PQ · JASO MA2 · Shell Helix'),
    ).toEqual([]);
    expect(latinOffenders('Mann-Filter · Tata Power EZ · ravi.sahu@example.com · CG04 MK 2201')).toEqual([]);
    expect(latinOffenders('SKU PRT-SPK-IR · डेमो पासवर्ड Raipur@2026')).toEqual([]);
    expect(latinOffenders('शंकर नगर Auto Hub · General service')).toEqual([
      'Auto',
      'Hub',
      'General',
      'service',
    ]);
    expect(latinOffenders('front/rear (check size)')).toEqual(['front', 'rear', 'check', 'size']);
  });

  it('return English data unchanged', () => {
    const p = DEMO_PRODUCTS[2];
    const w = DEMO_WORKSHOPS[0];
    const s = DEMO_SHOPS[0];
    if (!p || !w || !s) throw new Error('demo data missing');
    expect(localizeProduct(p, 'en')).toBe(p);
    expect(localizeWorkshop(w, 'en')).toBe(w);
    expect(localizeShop(s, 'en')).toBe(s);
    expect(localizeArea('Shankar Nagar', 'en')).toBe('Shankar Nagar');
  });

  it('localise the reported /hi/workshops strings', () => {
    const hub = DEMO_WORKSHOPS.find((w) => w.slug === 'shankar-nagar-auto-hub');
    if (!hub) throw new Error('missing workshop');
    const hi = localizeWorkshop(hub, 'hi');
    expect(hi.name).toBe('शंकर नगर ऑटो हब');
    expect(`${hi.area} · ${hi.pincode}`).toBe('शंकर नगर · 492007');
    expect(hi.services.map((s) => s.name)).toContain('जाँच और डायग्नोसिस');
    expect(hi.services.map((s) => s.name)).toContain('जनरल सर्विस (2W)');
    expect(localizeHours('9:00 – 20:00 · Mon–Sat', 'hi')).toBe('9:00 – 20:00 · सोम–शनि');
    // Brand and model stay; the descriptive words are Hindi.
    const oil = DEMO_PRODUCTS.find((p) => p.slug === 'synthetic-engine-oil-5w30-3-5l');
    if (!oil) throw new Error('missing product');
    const oilHi = localizeProduct(oil, 'hi');
    expect(oilHi.brand).toBe('Shell Helix');
    expect(oilHi.name).toContain('इंजन ऑयल');
  });

  it('look snapshot names up by id and fall back to the snapshot', () => {
    expect(productNameFor('engine-oil-filter-petrol-car', 'Engine oil filter', 'hi')).toBe(
      'इंजन ऑयल फ़िल्टर',
    );
    // Model-only names have no Hindi override: the snapshot (model name) is shown.
    expect(productNameFor('exide-xltz4a-2w-battery', 'XLTZ4A 24F+24P', 'hi')).toBe('XLTZ4A 24F+24P');
    expect(productNameFor('gone', 'Old product', 'hi')).toBe('Old product');
    expect(workshopNameFor('telibandha-car-clinic', 'Telibandha Car Clinic', 'hi')).toBe(
      'तेलीबांधा कार क्लिनिक',
    );
    expect(serviceNameFor('oil', 'Engine oil & filter change', 'en')).toBe('Engine oil & filter change');
    expect(shopNameFor('sharma-auto-parts', 'Sharma Auto Parts', 'hi')).toBe('शर्मा ऑटो पार्ट्स');
  });
});

describe('search works in both languages', () => {
  const slugs = (query: string) => searchProducts({ query }).map((p) => p.slug);

  it('matches Hindi names on /hi and English queries everywhere', () => {
    expect(slugs('बैटरी')).toContain('car-starter-battery-45ah');
    expect(slugs('इंजन ऑयल')).toContain('synthetic-engine-oil-5w30-3-5l');
    expect(slugs('battery')).toContain('car-starter-battery-45ah');
    expect(slugs('brake pads')).toContain('brake-pad-set-front');
    expect(slugs('ब्रेक पैड')).toContain('brake-pad-set-front');
    expect(slugs('Castrol')).toEqual(['castrol-activ-4t-20w40-900ml']);
  });

  it('matches the category name as shown', () => {
    const labels = (k: string) => (k === 'lubricants' ? 'लुब्रिकेंट' : k);
    const found = searchProducts({ query: 'लुब्रिकेंट', categoryLabel: labels }).map((p) => p.category);
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found)).toEqual(new Set(['lubricants']));
  });
});
