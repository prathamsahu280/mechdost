import { describe, expect, it } from 'vitest';
import { CONTENT_KEYS, isTrustKey } from '@mechdost/shared/content';
import { COMPONENTS, PROMISE_STATES, TRUST_KEYS, TRUST_STATES } from '../e2e/state-audit/model.ts';
import { seedFor } from '../e2e/state-audit/harness.ts';
import { buildCases } from '../e2e/state-audit/cases.ts';

/** Trust lines and the labour promise in the UI state model (design 2026-11-15; runbook ui-test-catalogue 9.5). */
describe('trust lines and labour promise in the UI state audit', () => {
  it('the model lists exactly the trust content keys', () => {
    expect([...TRUST_KEYS].sort()).toEqual(CONTENT_KEYS.filter(isTrustKey).sort());
  });

  it('every screen with a trust line or the promise has rows for default, override, long and hidden text', () => {
    const trustCodes = ['HOME-HERO', 'PDP-BUYBOX', 'CART-EMPTY', 'CHK-FORM', 'WS-PROFILE', 'PTN-LANDING'];
    for (const code of trustCodes) {
      const def = COMPONENTS.find((c) => c.code === code);
      const trust = def?.params.find((p) => p.name === 'trust');
      expect(trust?.values, code).toEqual([...TRUST_STATES]);
    }
    for (const code of ['WS-PROFILE', 'SR-VIEW', 'PTN-APPLY']) {
      const promise = COMPONENTS.find((c) => c.code === code)?.params.find((p) => p.name === 'promise');
      expect(promise?.values, code).toEqual([...PROMISE_STATES]);
    }
  });

  it('seeds the demo site config: hidden lines, long wording, and the promise on the busy bill', () => {
    const all = buildCases();
    const find = (id: string, test: (state: Readonly<Record<string, string>>) => boolean) =>
      all.find((c) => c.id.startsWith(id) && test(c.state));
    const hidden = find('HOME-HERO', (s) => s.trust === 'hidden');
    expect(hidden).toBeDefined();
    const seeded = JSON.parse(seedFor(hidden!, 0)['mechdost-demo-site'] ?? '{}') as {
      content: Record<string, { en: string; hi: string }>;
      settings: { labourPromiseDays: number };
    };
    expect(Object.keys(seeded.content).sort()).toEqual([...TRUST_KEYS].sort());
    expect(seeded.content['trust.checkout']).toEqual({ en: '-', hi: '-' });
    const long = find('PDP-BUYBOX', (s) => s.trust === 'long');
    const longSeed = JSON.parse(seedFor(long!, 0)['mechdost-demo-site'] ?? '{}') as typeof seeded;
    expect(longSeed.content['trust.product']?.hi.length).toBeGreaterThan(100);
    const billed = find('SR-VIEW', (s) => s.promise === 'on');
    const requests = JSON.parse(seedFor(billed!, 0)['mechdost-demo-requests'] ?? '[]') as {
      bill?: { labourPromiseDays?: number };
    }[];
    expect(requests.filter((r) => r.bill).every((r) => r.bill?.labourPromiseDays === 30)).toBe(true);
    const off = find('SR-VIEW', (s) => s.promise === 'off');
    const offSeed = JSON.parse(seedFor(off!, 0)['mechdost-demo-site'] ?? '{}') as typeof seeded;
    expect(offSeed.settings.labourPromiseDays).toBe(0);
  });
});
