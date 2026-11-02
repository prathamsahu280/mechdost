import { expect, test, type Page } from '@playwright/test';

/**
 * Typed text must be readable in both themes. axe only checks text nodes, not what a person types into an input,
 * so a field with a fixed white background and theme-coloured text passed every audit while being invisible in
 * dark mode (user report 2026-11-02, hero search). This measures the real contrast of typed text.
 */
async function typedContrast(page: Page, selector: string): Promise<number> {
  const field = page.locator(selector).first();
  await field.fill('battery 12V');
  return field.evaluate((el) => {
    const parse = (c: string) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      const [r = 0, g = 0, b = 0, a = 1] = (m?.[1] ?? '0,0,0,0').split(',').map((x) => Number(x.trim()));
      return { r, g, b, a: m?.[0].startsWith('rgba') ? a : 1 };
    };
    // First ancestor (or self) with a visible background is what the text sits on.
    let node: Element | null = el;
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a > 0.5) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    const fg = parse(getComputedStyle(el).color);
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  });
}

const FIELDS: [string, string][] = [
  ['/', '#site-search'],
  ['/shop', '#shop-q'],
  ['/workshops', '#finder-pin'],
  ['/login', '#login-identifier'],
  ['/partners/apply/seller', '#apply-name'],
  ['/quotes/new', '#quote-name'],
];

for (const scheme of ['light', 'dark'] as const) {
  test(`typed text is readable in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [path, selector] of FIELDS) {
      await page.goto(path);
      expect(await typedContrast(page, selector), `${path} ${selector}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
