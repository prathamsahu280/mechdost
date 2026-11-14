/**
 * Navigation assertions of the UI state audit (2026-11-15): which item must be marked current, and what a bar's
 * measured facts must satisfy. `readNav` runs in the page; everything else is pure (unit-tested in
 * `test/state-audit-nav.test.ts`). Pure `.ts` imports only (Node runs the model for the checklist writer).
 */
import type { Finding } from './geometry.ts';

export interface NavItemFacts {
  href: string;
  text: string;
  current: boolean;
  w: number;
  h: number;
  /** At least half of the item is inside the bar's visible area. */
  visible: boolean;
}

export interface NavFacts {
  items: NavItemFacts[];
  /** The items are wider than the bar. */
  overflowing: boolean;
  /** The bar scrolls sideways (overflow-x auto or scroll). */
  scrollable: boolean;
}

const stripLocale = (p: string) => (p === '/hi' ? '/' : p.startsWith('/hi/') ? p.slice(3) : p);

/** The item whose path is the longest match for `pathname` (home only exactly); null when none matches. */
export function currentHref(pathname: string, hrefs: readonly string[]): string | null {
  const path = stripLocale(pathname.split(/[?#]/)[0] ?? pathname);
  let best: string | null = null;
  for (const raw of hrefs) {
    const href = stripLocale(raw);
    const hit = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
    if (hit && (best === null || href.length > stripLocale(best).length)) best = raw;
  }
  return best;
}

/** Rules for one bar on one route. Findings carry `where`, not boxes (the bar is measured as a whole). */
export function navFindings(f: NavFacts, pathname: string): Finding[] {
  const out: Finding[] = [];
  const expected = currentHref(
    pathname,
    f.items.map((i) => i.href),
  );
  const marked = f.items.filter((i) => i.current);
  if (expected !== null && marked.length !== 1)
    out.push({
      rule: 'nav-current',
      severity: 'P1',
      where: 'nav',
      detail: `${expected} should be the one current item, ${String(marked.length)} are marked`,
    });
  else if (expected !== null && marked[0] && stripLocale(marked[0].href) !== stripLocale(expected))
    out.push({
      rule: 'nav-current',
      severity: 'P1',
      where: marked[0].text,
      detail: `current item is ${marked[0].href}, expected ${expected}`,
    });
  else if (expected === null && marked.length > 0)
    out.push({
      rule: 'nav-current',
      severity: 'P1',
      where: marked[0]?.text ?? 'nav',
      detail: `${pathname} is not a nav target but ${String(marked.length)} item(s) are marked current`,
    });
  for (const i of f.items)
    if (i.w < 24 || i.h < 24)
      out.push({
        rule: 'nav-target',
        severity: 'P1',
        where: i.text,
        detail: `target ${String(Math.round(i.w))}×${String(Math.round(i.h))} px is under 24 px (WCAG 2.5.8)`,
      });
  if (f.overflowing && !f.scrollable)
    out.push({
      rule: 'nav-overflow',
      severity: 'P1',
      where: 'nav',
      detail: 'items are wider than the bar and the bar does not scroll: some are unreachable',
    });
  const current = marked[0];
  if (f.overflowing && f.scrollable && current && !current.visible)
    out.push({
      rule: 'nav-current-hidden',
      severity: 'P1',
      where: current.text,
      detail: 'the current item is scrolled out of sight in the bar',
    });
  return out;
}

/** In the page: the facts of the links inside `scope` (the bar itself or a container holding links). */
export function readNav(scope: string): NavFacts {
  const root = document.querySelector<HTMLElement>(scope);
  if (!root) return { items: [], overflowing: false, scrollable: false };
  const bar = root.getBoundingClientRect();
  const style = getComputedStyle(root);
  const items = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .filter((a) => a.getClientRects().length > 0)
    .map((a) => {
      const r = a.getBoundingClientRect();
      const overlapX = Math.min(r.right, bar.right) - Math.max(r.left, bar.left);
      return {
        href: new URL(a.href).pathname,
        text: (a.getAttribute('aria-label') ?? a.textContent).trim().replace(/\s+/g, ' ').slice(0, 40),
        current: a.getAttribute('aria-current') === 'page',
        w: r.width,
        h: r.height,
        visible: overlapX >= r.width / 2,
      };
    });
  return {
    items,
    overflowing: root.scrollWidth > root.clientWidth + 1,
    scrollable: style.overflowX === 'auto' || style.overflowX === 'scroll',
  };
}
