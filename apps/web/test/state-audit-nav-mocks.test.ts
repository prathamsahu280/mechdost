import { describe, expect, it } from 'vitest';
import { buildCases } from '../e2e/state-audit/cases.ts';
import { auditMocksFor } from '../e2e/state-audit/api-mode/baseline-fixtures.ts';

const apiCases = buildCases().filter((c) => c.realApi);

describe('navigation rows answer every call of the sections they open (batch 3c-3, 2026-11-16)', () => {
  // Logged as "unmocked API call" by the GitHub run of 2026-11-16 (200+ findings): the bar's rows walk to other
  // sections but carried only the start page's mocks. Each GET below must be answered on every nav case.
  const adminGets = [
    '/admin/orders',
    '/admin/content',
    '/admin/settings',
    '/admin/settings/cities',
    '/admin/service-requests',
    '/admin/partner-applications',
    '/admin/catalogue/products',
    '/admin/recommendation-rules',
    '/admin/recommendation-categories',
    '/admin/reviews',
    '/admin/coins/activity',
    '/admin/pincodes',
    '/admin/pincode-waitlist',
    '/admin/company',
    '/admin/staff',
    '/admin/exports/options',
    '/admin/overview',
    '/admin/shops',
    '/support/tickets',
  ];
  const accountGets = [
    '/orders',
    '/me/shop-invites',
    '/me/vehicles',
    '/me/privacy',
    '/me/addresses',
    '/me/coins',
    '/me/coins/ledger',
    '/me/notification-preferences',
    '/support/tickets',
  ];
  for (const [code, gets] of [
    ['API-NAV-ADMIN', adminGets],
    ['API-NAV-ACCOUNT', accountGets],
  ] as const)
    it(`${code}: every GET is mocked, with a schema-valid body, in every case`, () => {
      const rows = apiCases.filter((x) => x.code === code);
      expect(rows.length).toBeGreaterThan(0);
      const c0 = rows[0];
      if (c0)
        expect(
          gets.filter((p) => !auditMocksFor(c0).some((m) => m.method === 'GET' && m.path.test(p))),
          'unmocked',
        ).toEqual([]);
      for (const c of rows)
        for (const path of gets) {
          const mock = auditMocksFor(c).find((m) => m.method === 'GET' && m.path.test(path));
          expect(mock, `${c.id} ${path}`).toBeDefined();
          const reply = mock?.reply({ c, method: 'GET', path, query: new URLSearchParams(), body: null });
          if ((reply?.status ?? 200) >= 400) continue;
          expect(() => mock?.schema?.parse(reply?.body), `${c.id} ${path}`).not.toThrow();
        }
    });

  it('API-ADM-PHOTOS: no English product name on /hi, in the queue or the product list', () => {
    const hi = apiCases.filter((x) => x.code === 'API-ADM-PHOTOS' && x.locale === 'hi');
    expect(hi.length).toBeGreaterThan(0);
    for (const c of hi)
      for (const path of ['/admin/catalogue/products', '/admin/catalogue/photo-queue']) {
        const mock = auditMocksFor(c).find((m) => m.method === 'GET' && m.path.test(path));
        const reply = mock?.reply({ c, method: 'GET', path, query: new URLSearchParams(), body: null });
        const text = JSON.stringify(reply?.body ?? {});
        expect(text, `${c.id} ${path}`).not.toMatch(/"(?:name|productName)":"[^"]*Audit/);
      }
  });

  it('the start page still answers first: a non-nav row is unchanged', () => {
    const c = apiCases.find((x) => x.code === 'API-ADM-QUEUE');
    expect(c).toBeDefined();
    if (c) expect(auditMocksFor(c).length).toBeGreaterThan(0);
  });
});
