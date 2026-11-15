import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONSENT_NOTICE_VERSION } from '@mechdost/shared/privacy';
import { describe, expect, it } from 'vitest';
import { buildCases } from '../e2e/state-audit/cases.ts';
import { compareProblems, type CompareFacts } from '../e2e/state-audit/geometry.ts';
import { seedFor } from '../e2e/state-audit/harness.ts';
import { dismissVerdict } from '../e2e/state-audit/dismiss.ts';
import { echoedWords, withoutEcho } from '../e2e/state-audit/hindi-echo.ts';
import { latinOffenders } from './hindi-allowlist';

const facts = (over: Partial<CompareFacts> = {}): CompareFacts => ({
  onShop: true,
  size: 0,
  slugs: [],
  trayShown: false,
  trayHref: '',
  hintShown: false,
  ...over,
});

describe('compare rule (decision 2026-11-15: 1 gives a confirmation, 2+ gives the tray)', () => {
  it('passes an empty list without tray or hint, and ignores pages outside the shop', () => {
    expect(compareProblems(facts())).toEqual([]);
    expect(compareProblems(facts({ onShop: false, size: 3 }))).toEqual([]);
  });
  it('one product: no tray and a visible [data-compare-hint]', () => {
    expect(compareProblems(facts({ size: 1, slugs: ['a'], hintShown: true }))).toEqual([]);
    expect(compareProblems(facts({ size: 1, slugs: ['a'] }))).toEqual([
      expect.stringContaining('[data-compare-hint]'),
    ]);
    expect(compareProblems(facts({ size: 1, slugs: ['a'], hintShown: true, trayShown: true }))).toEqual([
      expect.stringContaining('appears from 2'),
    ]);
  });
  it('two or more: the tray is shown and links every product', () => {
    const href = '/shop/compare?p=a,b';
    expect(compareProblems(facts({ size: 2, slugs: ['a', 'b'], trayShown: true, trayHref: href }))).toEqual(
      [],
    );
    expect(compareProblems(facts({ size: 2, slugs: ['a', 'b'] }))).toEqual([
      expect.stringContaining('no tray is shown'),
    ]);
    expect(compareProblems(facts({ size: 2, slugs: ['a', 'zzz'], trayShown: true, trayHref: href }))).toEqual(
      ['tray link misses zzz'],
    );
  });
  it('a tray over an empty list is a finding', () => {
    expect(compareProblems(facts({ trayShown: true }))).toHaveLength(1);
  });
});

describe('Hindi gate ignores the visitor’s echoed search words', () => {
  it('reads the values of the audited query string', () => {
    expect(echoedWords('/shop?q=zzzz-no-match&vehicle=4W')).toEqual(['zzzz-no-match', '4W']);
    expect(echoedWords('/shop')).toEqual([]);
  });
  it('removes the echoed words, and real English still fails', () => {
    const page = 'कोई परिणाम नहीं zzzz-no-match Order now';
    const words = latinOffenders(withoutEcho(page, echoedWords('/hi/shop?q=zzzz-no-match')));
    expect(words).not.toContain('zzzz');
    expect(words.join(' ')).toContain('Order');
  });
});

describe('audit tooling and CI (source checks, no build run)', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
  it('the runner builds .next-api itself when chunk G is requested and BUILD_ID is missing', () => {
    const run = read('scripts/state-audit-run.mjs');
    expect(run).toContain("'.next-api', 'BUILD_ID'");
    expect(run).toContain("chunks.includes('G')");
    expect(run).toContain('state-audit-api-build.mjs');
  });
  it('the API build resolves copy-map-worker.mjs from its own folder, not from the working directory', () => {
    const build = read('scripts/state-audit-api-build.mjs');
    expect(build).toContain('fileURLToPath(import.meta.url)');
    expect(build).toContain("resolve(webDir, 'scripts', 'copy-map-worker.mjs')");
    expect(build).not.toContain("'scripts/copy-map-worker.mjs'");
  });
  it('CI builds the launch configuration (firebase sign-in, API data) with actions pinned by SHA', () => {
    const ci = readFileSync(resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');
    const job = ci.slice(ci.indexOf('  web-real-mode:'), ci.indexOf('  e2e-demo:'));
    expect(job).toContain('NEXT_PUBLIC_AUTH_MODE: firebase');
    expect(job).toContain('NEXT_PUBLIC_DATA_MODE: api');
    for (const use of job.match(/uses: .+/g) ?? []) expect(use).toMatch(/@[0-9a-f]{40}\b/);
  });
});

describe('consent seed of the audit rows', () => {
  const c = buildCases().find((x) => x.state.consent !== 'open' && !x.realApi);
  it('answers "Essential only" on the notice version the site asks for, so the banner never covers a row', () => {
    if (!c) throw new Error('no case');
    const stored = JSON.parse(seedFor(c, Date.now())['mechdost-consent'] ?? 'null') as {
      analytics: boolean;
      version: string;
    };
    expect(stored.analytics).toBe(false);
    expect(stored.version).toBe(CONSENT_NOTICE_VERSION);
  });
  it('holds for every row of every chunk, API rows included: the banner is open only on consent=open rows', () => {
    const all = buildCases();
    expect(all.length).toBeGreaterThan(3000);
    const openComponents = new Set<string>();
    for (const x of all) {
      const stored = seedFor(x, 0)['mechdost-consent'];
      if (x.state.consent === 'open') {
        expect(stored, x.id).toBeUndefined();
        openComponents.add(x.code);
      } else {
        expect(stored, x.id).toBeDefined();
        expect((JSON.parse(stored ?? '{}') as { version: string }).version, x.id).toBe(
          CONSENT_NOTICE_VERSION,
        );
      }
    }
    expect([...openComponents].toSorted()).toEqual(['CHR-CONSENT', 'CHR-FLOAT', 'SHOP-TRAY']);
  });
  it('leaves the banner open only for rows that say so', () => {
    const open = buildCases().find((x) => x.state.consent === 'open');
    if (!open) throw new Error('no open row');
    expect(seedFor(open, Date.now())['mechdost-consent']).toBeUndefined();
  });
});

describe('dismiss rule (opened panel can be closed, 2026-11-16)', () => {
  const ok = {
    key: 'review-x',
    cancelVisible: true,
    cancelHeight: 44,
    closedByEscape: true,
    focusOnOpener: true,
  };
  it('passes a panel with a 44 px Cancel, Escape and focus return', () => {
    expect(dismissVerdict([ok])).toEqual([]);
  });
  it('fails a panel that opens with no visible close control (the review form)', () => {
    const [f] = dismissVerdict([{ ...ok, cancelVisible: false, cancelHeight: 0, closedByEscape: false }]);
    expect(f).toMatchObject({ rule: 'dismiss', severity: 'P0', where: 'review-x' });
  });
  it('fails when Escape does not close it, and when focus is lost', () => {
    expect(dismissVerdict([{ ...ok, closedByEscape: false }])[0]?.detail).toContain('Escape');
    expect(dismissVerdict([{ ...ok, focusOnOpener: false }])[0]?.detail).toContain('focus');
  });
  it('flags a close control under 44 px', () => {
    expect(dismissVerdict([{ ...ok, cancelHeight: 32 }])[0]?.detail).toContain('32 px');
  });
  it('the model puts the rule on the review, order and request rows', () => {
    const codes = new Set(
      buildCases()
        .filter((c) => c.checks.includes('dismiss'))
        .map((c) => c.code),
    );
    for (const code of ['PDP-REVIEWS', 'ORD-VIEW', 'SR-VIEW', 'PRT-SHOP', 'PRT-WORKSHOP'])
      expect(codes.has(code), code).toBe(true);
  });
});
