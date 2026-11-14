import { describe, expect, it } from 'vitest';
import { buildCases } from '../e2e/state-audit/cases.ts';
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
      'API-ADM-SHOPS',
      'API-ADM-QUEUE',
      'API-ADM-ERRORS',
      'API-ADM-ANALYTICS',
      'API-ADM-COINS',
      'API-ADM-REVIEWS',
      'API-ADM-QUOTES',
      'API-ADM-CONTENT',
      'API-NAV-ADMIN',
      'API-NAV-ACCOUNT',
      'API-SVC-HOMEFIND',
      'API-SVC-HOMEREQ',
      'API-WS-HOMEJOB',
      'API-WS-PHOTOS',
      'API-SVC-PHOTOS',
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
