import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyStats } from './workshop-stats-fixture';
import { funnelBars, ratingText, reasonKey, sortWorkshops } from '../src/lib/workshop-analytics-view';

/**
 * Workshop analytics views (design 2026-11-15): the funnel bars, the sortable workshops table (rows without a value
 * last), reason labels, and the JS-budget import graph: the two screens load only on demand.
 */
describe('funnelBars', () => {
  it('gives each step its share of the previous step and of the first', () => {
    const s = emptyStats({
      requests: 10,
      funnel: {
        requested: 10,
        proposed: 8,
        confirmed: 4,
        received: 4,
        estimateSent: 2,
        approved: 1,
        completed: 1,
      },
    });
    const bars = funnelBars(s);
    expect(bars.map((b) => b.ofPrevious)).toEqual([null, 80, 50, 100, 50, 50, 100]);
    expect(bars.map((b) => b.width)).toEqual([100, 80, 40, 40, 20, 10, 10]);
  });

  it('shows no percentages for an empty funnel and never exceeds 100', () => {
    expect(funnelBars(emptyStats()).every((b) => b.ofPrevious === null && b.width === 0)).toBe(true);
    const odd = emptyStats({
      funnel: {
        requested: 2,
        proposed: 3,
        confirmed: 0,
        received: 0,
        estimateSent: 0,
        approved: 0,
        completed: 0,
      },
    });
    expect(Math.max(...funnelBars(odd).map((b) => b.ofPrevious ?? 0))).toBeLessThanOrEqual(100);
  });
});

describe('sortWorkshops', () => {
  const rows = [
    { name: 'Bravo', ...emptyStats({ requests: 5, medianMinutesToPropose: 40, ratingTenths: 45 }) },
    { name: 'Alpha', ...emptyStats({ requests: 9, medianMinutesToPropose: 10, ratingTenths: null }) },
    { name: 'Charlie', ...emptyStats({ requests: 9, medianMinutesToPropose: null, ratingTenths: 30 }) },
  ];
  it('sorts by a count, ties by name', () => {
    expect(sortWorkshops(rows, 'requests', 'desc').map((r) => r.name)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    expect(sortWorkshops(rows, 'requests', 'asc').map((r) => r.name)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });
  it('keeps workshops without a value last in both directions', () => {
    expect(sortWorkshops(rows, 'propose', 'asc').map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(sortWorkshops(rows, 'propose', 'desc').map((r) => r.name)).toEqual(['Bravo', 'Alpha', 'Charlie']);
    expect(sortWorkshops(rows, 'rating', 'desc').map((r) => r.name)).toEqual(['Bravo', 'Charlie', 'Alpha']);
  });
  it('sorts by name and does not change the input', () => {
    const before = rows.map((r) => r.name);
    expect(sortWorkshops(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe('labels', () => {
  it('maps reason codes to locale keys, unknown codes to "other"', () => {
    expect(reasonKey('cancelled', 'changed_mind')).toBe('cancel_changed_mind');
    expect(reasonKey('cancelled', 'something_new')).toBe('cancel_other');
    expect(reasonKey('rejected', 'suspected_fraud')).toBe('reject_suspected_fraud');
    expect(reasonKey('rejected', 'changed_mind')).toBe('reject_other');
  });
  it('writes a rating in tenths', () => {
    expect(ratingText(47)).toBe('4.7');
    expect(ratingText(50)).toBe('5.0');
  });
});

const src = fileURLToPath(new URL('../src/', import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const all = files(src).map((path) => ({
  path: relative(src, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));
const staticImport = (name: string) => new RegExp(`^\\s*import\\s[^;]*from\\s+['"][^'"]*${name}['"]`, 'm');

describe('JS budget: the workshop analytics screens load on demand', () => {
  it('the portal screen is imported statically only by nothing, and dynamically by its wrapper', () => {
    for (const f of all) expect(f.text, f.path).not.toMatch(staticImport('workshop-performance-api'));
    const wrapper = all.find((f) => f.path === 'components/portal/workshop-performance-lazy.tsx');
    expect(wrapper?.text).toMatch(/import\(\s*['"]\.\/workshop-performance-api['"]\s*\)/);
  });

  it('only the portal and admin analytics screens import the wrapper or the admin tab, never the shell', () => {
    const users = all
      .filter((f) => staticImport('workshop-performance-lazy').test(f.text))
      .map((f) => f.path);
    expect(users).toEqual(['components/portal/workshop-portal-api.tsx']);
    for (const f of all) expect(f.text, f.path).not.toMatch(staticImport('admin-workshop-analytics-api'));
    const tab = all.find((f) => f.path === 'components/portal/admin-analytics-api.tsx');
    expect(tab?.text).toMatch(/import\(\s*['"]\.\/admin-workshop-analytics-api['"]\s*\)/);
  });

  it('nothing the header, layout or shop imports mentions workshop analytics', () => {
    const shell = all.filter(
      (f) =>
        f.path.startsWith('app/') ||
        f.path.startsWith('components/layout/') ||
        f.path.startsWith('components/shop/'),
    );
    for (const f of shell)
      expect(f.text, f.path).not.toMatch(/workshop-analytics|workshop-stats-view|workshop-performance/);
  });
});
