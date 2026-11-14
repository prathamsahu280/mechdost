import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Geometry checks for interactive states (UI test catalogue § "Geometry, not just presence"; learning T68).
 * Presence checks passed while a card's "Add to cart" hung outside the card and a stepper's hover hid its count:
 * these helpers compare real boxes, so a state that pushes, overlaps or misaligns something fails the test.
 * All boxes are page-independent `getBoundingClientRect()` values in CSS pixels; `tolerance` absorbs sub-pixel
 * rounding only.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function box(target: Locator): Promise<Box> {
  const b = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return b;
}

/** The box of the text inside an element (a Range around its contents): catches text that overflows its box. */
export async function textBox(target: Locator): Promise<Box> {
  return target.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    // Visually hidden words (sr-only) report a 1×1 box: leave them out, they are not painted.
    const painted = rects.filter((r) => r.width > 1 || r.height > 1);
    const list = painted.length > 0 ? painted : rects;
    const left = Math.min(...list.map((r) => r.left));
    const top = Math.min(...list.map((r) => r.top));
    const right = Math.max(...list.map((r) => r.right));
    const bottom = Math.max(...list.map((r) => r.bottom));
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

export function isInside(inner: Box, outer: Box, tolerance = 0.5): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    right(inner) <= right(outer) + tolerance &&
    bottom(inner) <= bottom(outer) + tolerance
  );
}

export function overlaps(a: Box, b: Box, tolerance = 0.5): boolean {
  return (
    a.x < right(b) - tolerance &&
    b.x < right(a) - tolerance &&
    a.y < bottom(b) - tolerance &&
    b.y < bottom(a) - tolerance
  );
}

/** `inner` lies fully inside `outer` (e.g. every button inside its card). */
export async function expectInside(inner: Locator, outer: Locator, what: string, tolerance = 0.5) {
  const [i, o] = [await box(inner), await box(outer)];
  expect(isInside(i, o, tolerance), `${what}: ${JSON.stringify(i)} not inside ${JSON.stringify(o)}`).toBe(
    true,
  );
}

/** No two of these boxes intersect (e.g. − / count / +). */
export async function expectNoOverlap(targets: readonly Locator[], what: string, tolerance = 0.5) {
  const boxes = await Promise.all(targets.map((t) => box(t)));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (!a || !b) continue;
      expect(
        overlaps(a, b, tolerance),
        `${what}: #${String(i)} ${JSON.stringify(a)} overlaps #${String(j)} ${JSON.stringify(b)}`,
      ).toBe(false);
    }
}

/** The same edge of every target sits on one line (e.g. each column's action button top), within `tolerance`. */
export async function expectAligned(
  targets: readonly Locator[],
  edge: 'top' | 'bottom' | 'left' | 'height',
  what: string,
  tolerance = 1,
) {
  const boxes = await Promise.all(targets.map((t) => box(t)));
  const values = boxes.map((b) =>
    edge === 'top' ? b.y : edge === 'bottom' ? bottom(b) : edge === 'left' ? b.x : b.height,
  );
  const spread = Math.max(...values) - Math.min(...values);
  expect(spread, `${what}: ${edge} values ${JSON.stringify(values)}`).toBeLessThanOrEqual(tolerance);
}

/** Every element matched by `selector` inside each of `containers` lies inside its container. */
export async function expectChildrenInside(containers: Locator, selector: string, what: string) {
  const problems = await containers.evaluateAll(
    (els, sel) =>
      els.flatMap((el, i) => {
        const outer = el.getBoundingClientRect();
        return (
          [...el.querySelectorAll<HTMLElement>(sel)]
            .filter((child) => child.getClientRects().length > 0)
            // Visually hidden text (sr-only: absolute, 1 × 1, clipped) is not painted, so it cannot stick out.
            .filter((child) => {
              const r = child.getBoundingClientRect();
              return !(getComputedStyle(child).position === 'absolute' && r.width <= 1 && r.height <= 1);
            })
            .filter((child) => {
              const r = child.getBoundingClientRect();
              return (
                r.left < outer.left - 0.5 ||
                r.right > outer.right + 0.5 ||
                r.top < outer.top - 0.5 ||
                r.bottom > outer.bottom + 0.5
              );
            })
            .map((child) => `#${String(i)} ${child.tagName} "${child.textContent.trim().slice(0, 30)}"`)
        );
      }),
    selector,
  );
  expect(problems, `${what}: elements outside their container`).toEqual([]);
}

/** Cards in one visual row (same top) have the same height. */
export async function expectEqualHeightsPerRow(cards: Locator, what: string, tolerance = 1) {
  const boxes = await cards.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { y: Math.round(r.top), h: r.height };
    }),
  );
  const rows = new Map<number, number[]>();
  for (const b of boxes) rows.set(b.y, [...(rows.get(b.y) ?? []), b.h]);
  for (const [y, heights] of rows) {
    const spread = Math.max(...heights) - Math.min(...heights);
    expect(spread, `${what}: row at y=${String(y)} heights ${JSON.stringify(heights)}`).toBeLessThanOrEqual(
      tolerance,
    );
  }
}

/** Seeds browser storage once per test (later loads keep what the app changed, e.g. a cleared list). */
export async function seedStorage(page: Page, values: Record<string, string>) {
  await page.addInitScript((v: Record<string, string>) => {
    if (window.localStorage.getItem('mechdost-e2e-seeded') === '1') return;
    window.localStorage.setItem('mechdost-e2e-seeded', '1');
    for (const [k, val] of Object.entries(v)) window.localStorage.setItem(k, val);
  }, values);
}
