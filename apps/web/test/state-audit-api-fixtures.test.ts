import { describe, expect, it } from 'vitest';
import { buildCases } from '../e2e/state-audit/cases.ts';
import { baselineMocks } from '../e2e/state-audit/api-mode/baseline-fixtures.ts';
import { mocksFor } from '../e2e/state-audit/api-mode/fixtures.ts';
import { fakeIdToken, persistedUser } from '../e2e/state-audit/api-mode/session.ts';

const apiCases = buildCases().filter((c) => c.realApi);

describe('API-mode audit fixtures (Q106)', () => {
  it('has API rows for every area that has no demo screen', () => {
    const codes = new Set(apiCases.map((c) => c.code));
    for (const code of [
      'API-ADM-REFUNDQ',
      'API-ORD-REFUNDLINE',
      'API-SHOP-PORTAL',
      'API-SHOP-TIER2',
      'API-SHOP-SLIP',
      'API-PARTNER-STATUS',
      'API-ADM-SHOPS',
      'API-ADM-QUEUE',
      'API-ADM-ERRORS',
      'API-ADM-ANALYTICS',
      'API-ADM-COINS',
      'API-ADM-REVIEWS',
      'API-ADM-QUOTES',
      'API-ADM-CONTENT',
      'API-ADM-POLICIES',
      'API-ADM-LAYOUT',
      'API-ADM-COMPANY',
      'API-NAV-ADMIN',
      'API-NAV-ACCOUNT',
      'API-SVC-HOMEFIND',
      'API-SVC-HOMEREQ',
      'API-WS-HOMEJOB',
      'API-WS-PHOTOS',
      'API-SVC-PHOTOS',
      'API-ACC-SUPPORT',
      'API-ADM-SUPPORT',
      'API-ADM-EXPORTS',
      'API-WISHLIST',
      'API-ADM-PHOTOS',
    ])
      expect(codes.has(code), code).toBe(true);
  });

  it('every fixture of every API case satisfies the shared response schema it is served under', () => {
    let checked = 0;
    for (const c of apiCases) {
      for (const mock of mocksFor(c)) {
        const reply = mock.reply({
          c,
          method: mock.method,
          path: '/x',
          query: new URLSearchParams('view=active'),
          body: null,
        });
        if ((reply.status ?? 200) >= 400) continue;
        if (mock.schema) {
          expect(
            () => mock.schema?.parse(reply.body),
            `${c.id} ${mock.method} ${String(mock.path)}`,
          ).not.toThrow();
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('every refund variant the model names has a fixture', () => {
    for (const c of apiCases.filter((x) => x.code === 'API-ADM-REFUNDQ')) {
      const list = mocksFor(c).find((m) => m.path.test('/admin/refunds'));
      expect(list, c.id).toBeDefined();
    }
  });

  it('the signed-in user is an unsigned, far-future token that production would never accept', () => {
    const now = Date.parse('2026-11-15T10:00:00Z');
    const token = fakeIdToken('audit-admin', now);
    const [, payload, sig] = token.split('.');
    expect(sig).toBe('audit');
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
      exp: number;
      iss: string;
    };
    expect(claims.exp * 1000).toBeGreaterThan(now + 3_000 * 86_400_000);
    expect(claims.iss).toContain('demo-audit');
    const stored = persistedUser('audit-admin', '9876543210', now);
    expect(Object.keys(stored)[0]).toBe('firebase:authUser:audit-fake-api-key:[DEFAULT]');
  });
});

describe('API-mode baseline mocks (the calls every signed-in page makes)', () => {
  const c = apiCases[0];
  const ask = (path: string, query = '') => {
    if (!c) throw new Error('no API case');
    const mock = baselineMocks(c).find((m) => m.method === 'GET' && m.path.test(path));
    expect(mock, path).toBeDefined();
    const reply = mock?.reply({ c, method: 'GET', path, query: new URLSearchParams(query), body: null });
    expect(() => mock?.schema?.parse(reply?.body), path).not.toThrow();
    return reply?.body;
  };

  it('answers every call the chunk G run logged as unmocked, with a body that satisfies its schema', () => {
    for (const path of [
      '/me/notifications',
      '/me/notifications/unread-count',
      '/me/cart',
      '/me/wishlist',
      '/workshop/home-settings',
      '/service-requests',
      '/quotes',
      '/workshops/home-garage-1',
      '/admin/catalogue/photo-queue',
    ])
      ask(path);
  });

  it('answers the cart and wishlist refreshes with "unchanged"', () => {
    expect(ask('/me/cart', 'since=3')).toMatchObject({ unchanged: true });
    expect(ask('/me/wishlist', 'since=0')).toMatchObject({ unchanged: true });
  });

  it('a row mock listed first wins over the baseline', () => {
    const wish = apiCases.find((x) => x.code === 'API-WISHLIST');
    if (!wish) throw new Error('no wishlist row');
    const own = mocksFor(wish);
    const all = [...own, ...baselineMocks(wish)];
    const first = all.find((m) => m.method === 'GET' && m.path.test('/me/wishlist'));
    expect(first).toBe(own.find((m) => m.path.test('/me/wishlist')));
  });
});
