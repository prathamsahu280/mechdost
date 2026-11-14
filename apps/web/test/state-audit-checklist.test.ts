import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_PRODUCTS } from '../src/demo/catalogue';
import { CATEGORY_SLUGS } from '../src/demo/categories';
import { buildCases, CHUNKS, titleOf } from '../e2e/state-audit/cases.ts';
import {
  baseOf,
  idOf,
  itemLine,
  mergeChecklist,
  renderChecklist,
  resultsFromReport,
  tickChecklist,
  type TestResult,
} from '../e2e/state-audit/checklist.ts';
import { ALL_PRODUCTS, CARTS, COMPARES } from '../e2e/state-audit/model.ts';

const CHECKLIST = fileURLToPath(new URL('../../../docs/qa/ui-state-checklist.md', import.meta.url));

describe('UI state model', () => {
  const cases = buildCases();

  it('gives every case a unique id that starts its test title', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cases) expect(titleOf(c).startsWith(`${c.id} `)).toBe(true);
  });

  it('uses only real demo products and categories in carts and compare lists', () => {
    const slugs = new Set(DEMO_PRODUCTS.map((p) => p.slug));
    expect([...ALL_PRODUCTS].sort()).toEqual([...slugs].sort());
    for (const lines of Object.values(CARTS)) {
      for (const l of lines) expect(slugs.has(l.slug), l.slug).toBe(true);
      expect(lines.length).toBeLessThanOrEqual(20);
      for (const l of lines) expect(l.qty >= 1 && l.qty <= 99).toBe(true);
    }
    for (const list of Object.values(COMPARES)) {
      if (!list) continue;
      expect(list.slugs.length).toBeLessThanOrEqual(4);
      for (const s of list.slugs) {
        const p = DEMO_PRODUCTS.find((x) => x.slug === s);
        expect(p, s).toBeDefined();
        expect(p ? CATEGORY_SLUGS[p.category] : null).toBe(list.category);
      }
    }
  });

  it('puts every case in exactly one overnight chunk', () => {
    for (const c of cases) {
      const owners = Object.entries(CHUNKS).filter(([, prefixes]) =>
        prefixes.split(',').some((p) => c.id.startsWith(p)),
      );
      expect(
        owners.map(([k]) => k),
        c.id,
      ).toHaveLength(1);
    }
  });

  it('keeps a per-push core subset small enough for CI (about 5 minutes)', () => {
    const core = cases.filter((c) => c.tier === 'core');
    expect(core.length).toBeGreaterThan(40);
    expect(core.length).toBeLessThanOrEqual(100);
  });

  it('docs/qa/ui-state-checklist.md lists exactly the cases of the model', () => {
    const file = readFileSync(CHECKLIST, 'utf8').replace(/\r\n/g, '\n');
    const listed = file
      .split('\n')
      .filter((l) => idOf(l) !== null)
      .map(baseOf);
    expect(listed, 'run node apps/web/scripts/state-audit-checklist.mjs').toEqual(cases.map(itemLine));
  });
});

describe('checklist merge and ticking', () => {
  const cases = buildCases().slice(0, 3);
  const [a, b, c] = cases;
  if (!a || !b || !c) throw new Error('model too small');
  const fresh = renderChecklist(cases);

  it('ticks passes, marks failures with a summary and screenshot, and fills the run results', () => {
    const results = new Map<string, TestResult>([
      [a.id, { status: 'pass', summary: '', screenshot: null }],
      [b.id, { status: 'fail', summary: 'P0 covered ×1; P2 tap44 ×1', screenshot: '../../shots/b.png' }],
    ]);
    const out = tickChecklist(fresh, results, '2026-11-15');
    expect(out).toMatchObject({ passed: 1, failed: 1, skipped: 0, untouched: 1 });
    const lines = out.markdown.split('\n');
    expect(lines).toContain(`${itemLine(a).replace('- [ ] ', '- [x] ')} — 2026-11-15 pass`);
    expect(lines).toContain(
      `${itemLine(b).replace('- [ ] ', '- [!] ')} — 2026-11-15 FAIL: P0 covered ×1; P2 tap44 ×1 · [screenshot](../../shots/b.png)`,
    );
    expect(lines).toContain(itemLine(c));
    expect(out.markdown).toContain('Last run 2026-11-15: 1 passed, 1 failed, 0 skipped, 1 not in this run.');
    expect(out.markdown).toContain(`| ${b.id} | P0 covered ×1; P2 tap44 ×1 | [png](../../shots/b.png) |`);
  });

  it('re-ticking replaces the previous result instead of appending', () => {
    const first = tickChecklist(
      fresh,
      new Map([[a.id, { status: 'fail', summary: 'P1 overlap ×2', screenshot: null }]]),
      '2026-11-15',
    );
    const second = tickChecklist(
      first.markdown,
      new Map([[a.id, { status: 'flaky', summary: 'P2 tap44 ×3', screenshot: null }]]),
      '2026-11-16',
    );
    const line = second.markdown.split('\n').find((l) => idOf(l) === a.id);
    expect(line).toBe(
      `${itemLine(a).replace('- [ ] ', '- [x] ')} — 2026-11-16 pass after a retry (P2 tap44 ×3)`,
    );
  });

  it('merging a regenerated list keeps ticks on unchanged lines and the triage section', () => {
    const ticked = tickChecklist(
      fresh,
      new Map([[a.id, { status: 'pass', summary: '', screenshot: null }]]),
      '2026-11-15',
    );
    const edited = ticked.markdown.replace('Triaged from the run results', 'Triaged by hand: keep me');
    const merged = mergeChecklist(edited, fresh);
    expect(merged).toContain(`${itemLine(a).replace('- [ ] ', '- [x] ')} — 2026-11-15 pass`);
    expect(merged).toContain('Triaged by hand: keep me');
    // A line whose state changed starts unticked again.
    const changed = fresh.replace(itemLine(a), itemLine(a).replace('asserts:', 'asserts: hindi'));
    expect(mergeChecklist(ticked.markdown, changed)).toContain(
      itemLine(a).replace('asserts:', 'asserts: hindi'),
    );
  });

  it('reads results, summaries and screenshots from a Playwright JSON report', () => {
    const body = (s: string) => Buffer.from(s).toString('base64');
    const report = {
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  title: `${a.id} @core · 390px`,
                  tests: [{ status: 'expected', results: [{ status: 'passed', attachments: [] }] }],
                },
                {
                  title: `${b.id} · 320px`,
                  tests: [
                    {
                      status: 'unexpected',
                      results: [
                        {
                          status: 'failed',
                          attachments: [
                            {
                              name: 'state-audit-summary',
                              body: body('P1 inside ×2'),
                              contentType: 'text/plain',
                            },
                            {
                              name: 'state-audit-failure',
                              path: '/abs/test-results/b/state-audit-failure.png',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  title: `${c.id} · 1440px`,
                  tests: [{ status: 'skipped', results: [{ status: 'skipped' }] }],
                },
                { title: 'not an audit test', tests: [{ status: 'expected', results: [] }] },
              ],
            },
          ],
        },
      ],
    };
    const results = resultsFromReport(report, (p) => `link:${p}`);
    expect(results.get(a.id)).toEqual({ status: 'pass', summary: '', screenshot: null });
    expect(results.get(b.id)).toEqual({
      status: 'fail',
      summary: 'P1 inside ×2',
      screenshot: 'link:/abs/test-results/b/state-audit-failure.png',
    });
    expect(results.get(c.id)?.status).toBe('skipped');
    expect(results.size).toBe(3);
  });
});
