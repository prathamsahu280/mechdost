import { describe, expect, it } from 'vitest';
import { CataloguePageSchema, CatalogueProductSchema } from '@mechdost/shared/catalogue';
import { PublicWorkshopDto } from '@mechdost/shared/service-api';
import { buildCases } from '../e2e/state-audit/cases.ts';
import { auditCard, auditProduct, auditProductName } from '../e2e/state-audit/api-mode/audit-products.ts';
import { serverReply } from '../e2e/state-audit/api-mode/server-mock.ts';
import setup from '../e2e/state-audit/api-mode/server-mock-setup.ts';
import { AUDIT_API_ORIGIN } from '../e2e/state-audit/api-mode/session.ts';
import { wishlistMocks } from '../e2e/state-audit/api-mode/storefront-fixtures.ts';
import { latinOffenders } from './hindi-allowlist';

/**
 * The server-side half of the API-mode audit (batch 2c, 2026-11-16): the Next server fetches the catalogue from the
 * API origin while rendering, where the browser's `page.route` mock cannot answer. `server-mock.ts` answers those
 * requests from the same typed fixtures; these tests pin its contract.
 */
const q = (s = '') => new URLSearchParams(s);

describe('server-side mock of the audit API', () => {
  it('answers the catalogue page with a body the shared schema accepts, in the asked language', () => {
    const en = serverReply('GET', '/v1/catalogue/products', q('locale=en&city=RPR&limit=24'));
    const hi = serverReply('GET', '/v1/catalogue/products', q('locale=hi&city=RPR&limit=24'));
    expect(en.status).toBe(200);
    const page = CataloguePageSchema.parse(en.body);
    expect(page.items.length).toBeGreaterThan(0);
    expect(CataloguePageSchema.parse(hi.body).items[0]?.name).toBe(auditProductName(0, 'hi'));
  });

  it('answers an audit product by slug and 404s anything else (the page then shows not found)', () => {
    const ok = serverReply('GET', '/v1/catalogue/products/audit-product-3', q('locale=hi&city=RPR'));
    expect(ok.status).toBe(200);
    expect(CatalogueProductSchema.parse(ok.body).name).toBe(auditProductName(3, 'hi'));
    const missing = serverReply('GET', '/v1/catalogue/products/no-such-product', q('locale=en'));
    expect(missing.status).toBe(404);
  });

  it('answers a workshop profile for the audit workshops', () => {
    const ok = serverReply('GET', '/v1/workshops/home-garage-2', q('locale=hi'));
    expect(ok.status).toBe(200);
    expect(PublicWorkshopDto.parse(ok.body).slug).toBe('home-garage-2');
    expect(serverReply('GET', '/v1/workshops/nobody-here', q()).status).toBe(404);
  });

  it('answers every other path with a typed 404 so the page falls back to its default text', () => {
    const r = serverReply('GET', '/v1/site/home-layout', q('city=RPR'));
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: { code: 'NOT_MOCKED' } });
    expect(serverReply('POST', '/v1/catalogue/products', q()).status).toBe(405);
  });
});

describe('the local server of the run', () => {
  it('listens on the audit API origin, answers JSON, and stops with its teardown', async () => {
    const stop = await setup();
    try {
      const res = await fetch(`${AUDIT_API_ORIGIN}/v1/catalogue/products/audit-product-1?locale=hi`);
      expect(res.status).toBe(200);
      expect(CatalogueProductSchema.parse(await res.json()).slug).toBe('audit-product-1');
      expect((await fetch(`${AUDIT_API_ORIGIN}/v1/nothing`)).status).toBe(404);
    } finally {
      await stop();
    }
    await expect(fetch(`${AUDIT_API_ORIGIN}/v1/nothing`)).rejects.toThrow();
  });
});

describe('audit products have Hindi versions like real content data (hard rule 10)', () => {
  it('names, specs and highlights carry no English words in Hindi', () => {
    for (const i of [0, 1, 7, 99]) {
      const card = auditCard(i, 'hi');
      const text = [card.name, card.specSummary ?? '', ...card.highlights, card.category.name].join(' · ');
      expect(latinOffenders(text), text).toEqual([]);
      const p = auditProduct(i, 'hi');
      expect(latinOffenders([p.description ?? '', p.compatibility ?? ''].join(' ')), p.name).toEqual([]);
      for (const v of p.variants) expect(latinOffenders(v.offer?.seller ?? ''), v.offer?.seller).toEqual([]);
    }
  });

  it('the browser mock and the server mock name a product the same way', () => {
    const base = buildCases().find((x) => x.code === 'API-WISHLIST' && x.locale === 'hi');
    expect(base).toBeDefined();
    if (!base) return;
    const c = { ...base, state: { ...base.state, list: 'items', stress: 'none' } };
    const mock = wishlistMocks(c).find((m) => String(m.path).includes('wishlist'));
    const body = mock?.reply({ c, method: 'GET', path: '/me/wishlist', query: q(), body: null }).body as {
      items: { slug: string; name: string }[];
    };
    expect(body.items[0]?.name).toBe(auditProductName(0, 'hi'));
    expect(body.items[0]?.name).not.toBe(auditProductName(0, 'en'));
  });
});
