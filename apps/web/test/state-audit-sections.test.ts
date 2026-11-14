import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_SECTIONS as MODEL_ACCOUNT,
  ADMIN_SECTIONS as MODEL_DEMO_ADMIN,
} from '../e2e/state-audit/model.ts';
import { REAL_ACCOUNT_SECTIONS, REAL_ADMIN_SECTIONS } from '../e2e/state-audit/model-api.ts';

/** `src/lib/sections.ts` reads two build switches at import time: load it once per build mode. */
async function sectionsFor(auth: 'firebase' | 'demo', data: 'api' | 'demo') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', auth);
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', data);
  return import('../src/lib/sections');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('navigation lists in the UI state model follow src/lib/sections.ts', () => {
  it('demo build: the model rows cover exactly the sections shown', async () => {
    const s = await sectionsFor('demo', 'demo');
    expect([...MODEL_DEMO_ADMIN]).toEqual([...s.ADMIN_SECTIONS]);
    expect([...MODEL_ACCOUNT]).toEqual([...s.ACCOUNT_SECTIONS]);
  });

  it('real build: the API rows cover exactly the sections shown (analytics, refunds and errors appear)', async () => {
    const s = await sectionsFor('firebase', 'api');
    expect([...REAL_ADMIN_SECTIONS]).toEqual([...s.ADMIN_SECTIONS]);
    expect([...REAL_ACCOUNT_SECTIONS]).toEqual([...s.ACCOUNT_SECTIONS]);
    for (const only of ['analytics', 'refunds', 'errors']) {
      expect(s.ADMIN_SECTIONS).toContain(only);
      expect(MODEL_DEMO_ADMIN).not.toContain(only);
    }
  });

  it('mixed builds hide what neither source can serve', async () => {
    const mixed = await sectionsFor('demo', 'api');
    expect(mixed.ADMIN_SECTIONS).not.toContain('reviews');
    expect(mixed.ADMIN_SECTIONS).not.toContain('analytics');
    const realAuthDemoData = await sectionsFor('firebase', 'demo');
    expect(realAuthDemoData.ADMIN_SECTIONS).toContain('reviews');
    expect(realAuthDemoData.ADMIN_SECTIONS).not.toContain('quotes');
  });
});
