/**
 * Admin next tier part 2 on the web side (design 2026-11-15 items 5 to 8): the cache refresh route's check, the
 * policy editor's "start from the current text" in both languages, the real-mode layout lists agreeing with the demo
 * editor's, and the company facts.
 */
import { describe, expect, it } from 'vitest';
import { companyFor, EMPTY_COMPANY } from '@mechdost/shared/company';
import { cleanPolicy, POLICY_KEYS } from '@mechdost/shared/policy';
import { DEFAULT_FEATURED, HOME_CATEGORY_KEYS, HOME_SECTIONS } from '@mechdost/shared/site-layout';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { CATEGORY_KEYS } from '@/demo/categories';
import { checkRevalidate } from '@/lib/revalidate-request';
import { builtInPolicy, policyDateLabel, POLICY_PAGES, POLICY_PATH } from '@/lib/policy-view';
import { DEFAULT_FEATURED as WEB_FEATURED, HOME_SECTIONS as WEB_SECTIONS } from '@/lib/site-layout';

const SECRET = 's'.repeat(40);

describe('/api/revalidate check', () => {
  it('is absent (404) without a configured secret of 32+ characters', () => {
    expect(checkRevalidate(undefined, SECRET, { tags: ['content'] })).toEqual({ ok: false, status: 404 });
    expect(checkRevalidate('short', 'short', { tags: ['content'] })).toEqual({ ok: false, status: 404 });
  });

  it('refuses a missing or wrong secret (401), including one of the same length', () => {
    expect(checkRevalidate(SECRET, null, { tags: ['content'] })).toEqual({ ok: false, status: 401 });
    expect(checkRevalidate(SECRET, 'x'.repeat(40), { tags: ['content'] })).toEqual({
      ok: false,
      status: 401,
    });
    expect(checkRevalidate(SECRET, 'x', { tags: ['content'] })).toEqual({ ok: false, status: 401 });
  });

  it('accepts only the three known tags, once each', () => {
    expect(checkRevalidate(SECRET, SECRET, { tags: ['content', 'content', 'company'] })).toEqual({
      ok: true,
      tags: ['content', 'company'],
    });
    for (const body of [
      null,
      {},
      { tags: [] },
      { tags: ['products'] },
      { tags: 'content' },
      { tags: ['content', 1] },
    ])
      expect(checkRevalidate(SECRET, SECRET, body)).toEqual({ ok: false, status: 400 });
  });
});

describe('policy editor helpers', () => {
  it('"start from the current text" gives a valid, publishable policy for every page and language', () => {
    for (const [lang, messages] of [
      ['en', en],
      ['hi', hi],
    ] as const)
      for (const key of POLICY_KEYS) {
        const doc = builtInPolicy(messages, key, '2026-11-15');
        expect(doc, `${key} ${lang}`).not.toBeNull();
        expect(doc?.sections.length).toBe(POLICY_PAGES[key].sections.length);
        const checked = cleanPolicy(doc);
        expect(checked.ok, `${key} ${lang}: ${JSON.stringify(checked)}`).toBe(true);
      }
  });

  it('turns the claim window placeholder into the number the page shows', () => {
    const doc = builtInPolicy(en, 'policy.returns', '2026-11-15');
    expect(JSON.stringify(doc)).not.toContain('{days}');
    expect(builtInPolicy({}, 'policy.privacy', '2026-11-15')).toBeNull();
  });

  it('formats the last-updated date in the page language without shifting the day', () => {
    expect(policyDateLabel('2026-11-15', 'en')).toBe('15 November 2026');
    expect(policyDateLabel('2026-11-15', 'hi')).toContain('2026');
    expect(policyDateLabel('nope', 'en')).toBe('nope');
  });

  it('links each policy to its public page', () => {
    expect(Object.keys(POLICY_PATH).sort()).toEqual([...POLICY_KEYS].sort());
  });
});

describe('home layout lists', () => {
  it('real mode and the demo editor use the same sections, categories and default tiles', () => {
    expect([...HOME_SECTIONS]).toEqual([...WEB_SECTIONS]);
    expect([...HOME_CATEGORY_KEYS]).toEqual([...CATEGORY_KEYS]);
    expect([...DEFAULT_FEATURED]).toEqual([...WEB_FEATURED]);
  });
});

describe('company facts', () => {
  it('keeps the built-in legal facts and shows nothing extra until the admin fills them', () => {
    const built = { company: 'Built-in', registeredAddress: 'Addr', gstin: '22ABVCS4888H1ZL' };
    const facts = companyFor(EMPTY_COMPANY, 'hi', built);
    expect(facts).toMatchObject({ company: 'Built-in', cin: null, grievance: null });
  });
});
