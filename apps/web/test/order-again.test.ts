/**
 * "Order again" (audience entry design 2026-11-22, item 4; spec 03/04; accessibility requirements item 4).
 * Budget rule (spec 16 incidents: /cart 179.8 and /shop 179.9 of 180 KB gz): the button lives only on the account
 * orders list and the order page, and the add-to-cart logic is fetched with `import()` when the button is pressed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/analytics';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { foldDemoCart, joinSentences } from '../src/lib/order-again-core';

const root = join(__dirname, '..', 'src');
const src = (p: string) => readFileSync(join(root, p), 'utf8');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('foldDemoCart (browser cart, demo mode)', () => {
  const sold = (slug: string) => slug !== 'gone';
  it('adds new lines, raises smaller ones, keeps larger ones, and reports what is no longer sold by name', () => {
    const r = foldDemoCart(
      [
        { slug: 'a', qty: 5 },
        { slug: 'b', qty: 1 },
      ],
      [
        { slug: 'a', name: 'A', qty: 2 },
        { slug: 'b', name: 'B', qty: 3 },
        { slug: 'c', name: 'C', qty: 1 },
        { slug: 'gone', name: 'Old pack', qty: 1 },
      ],
      sold,
    );
    expect(r.cart).toEqual([
      { slug: 'a', qty: 5 },
      { slug: 'b', qty: 3 },
      { slug: 'c', qty: 1 },
    ]);
    expect(r.added).toBe(2);
    expect(r.already).toBe(1);
    expect(r.missing).toEqual([{ name: 'Old pack', reason: 'not_for_sale' }]);
  });
  it('keeps to 20 lines and 99 units, saying which line did not fit; pressing twice changes nothing', () => {
    const full = Array.from({ length: 20 }, (_, i) => ({ slug: `p${String(i)}`, qty: 1 }));
    const r = foldDemoCart(full, [{ slug: 'x', name: 'X', qty: 1 }], sold);
    expect(r.cart).toHaveLength(20);
    expect(r.missing).toEqual([{ name: 'X', reason: 'too_many_lines' }]);
    const big = foldDemoCart([], [{ slug: 'a', name: 'A', qty: 250 }], sold);
    expect(big.cart).toEqual([{ slug: 'a', qty: 99 }]);
    const again = foldDemoCart(big.cart, [{ slug: 'a', name: 'A', qty: 250 }], sold);
    expect(again.added).toBe(0);
    expect(again.cart).toEqual(big.cart);
  });
});

describe('where the button lives (budget)', () => {
  const importers = walk(root).filter((f) =>
    /components\/account\/order-again'|\.\/order-again'|account\/order-again/.test(readFileSync(f, 'utf8')),
  );
  const rel = (f: string) => f.slice(root.length + 1).replaceAll('\\', '/');
  it('only the account area and the two order views import it', () => {
    expect(importers.map(rel).sort()).toEqual([
      'components/account/account-area.tsx',
      'components/commerce/order-view-api.tsx',
      'components/commerce/order-view.tsx',
    ]);
  });
  it('the button loads the add-to-cart logic only when pressed', () => {
    const btn = src('components/account/order-again.tsx');
    expect(btn).toMatch(/import\('@\/lib\/order-again'\)/);
    expect(btn).not.toMatch(/from '@\/lib\/(order-again|cart-sync|orders-api)'/);
    expect(btn).not.toMatch(/from '@\/demo\//);
    const run = src('lib/order-again.ts');
    expect(run).toMatch(/import\('\.\/cart-sync'\)/);
    expect(run).toMatch(/import\('\.\/orders-api'\)/);
  });
  it('the layout, home, shop and cart sources never mention it', () => {
    for (const f of walk(root)) {
      const r = rel(f);
      if (/^app\/\[locale\]\/(layout|page)\.tsx$|^app\/\[locale\]\/(shop|cart)\//.test(r))
        expect(readFileSync(f, 'utf8'), r).not.toMatch(/order-again|OrderAgain/);
    }
  });
});

describe('accessibility contract (design doc, accessibility requirements item 4)', () => {
  const btn = src('components/account/order-again.tsx');
  it('is a native button with aria-busy, disabled and visible busy text', () => {
    expect(btn).toMatch(/<button/);
    expect(btn).toMatch(/aria-busy=\{busy\}/);
    expect(btn).toMatch(/disabled=\{busy\}/);
    expect(btn).toMatch(/t\('againBusy'\)/);
    expect(btn).toMatch(/min-h-11/);
  });
  it('names the order in its accessible name', () => {
    expect(btn).toMatch(/<span className="sr-only">: \{code\}<\/span>/);
  });
  it('announces in a polite status region and shows a closable list panel with a cart link', () => {
    expect(btn).toMatch(/role="status"/);
    expect(btn).toMatch(/data-disclosure-trigger=\{key\}/);
    expect(btn).toMatch(/data-panel-cancel=\{key\}/);
    expect(btn).toMatch(/<ul/);
    expect(btn).toMatch(/t\('againCart'\)/);
  });
});

describe('joinSentences (the status line)', () => {
  it('never doubles a full stop, in English or Hindi', () => {
    expect(
      joinSentences(['Nothing was added to your cart.', '1 product was already in your cart'], 'en'),
    ).toBe('Nothing was added to your cart. 1 product was already in your cart.');
    expect(joinSentences(['कार्ट में कुछ नहीं जोड़ा गया।', '1 प्रोडक्ट पहले से था', ''], 'hi')).toBe(
      'कार्ट में कुछ नहीं जोड़ा गया। 1 प्रोडक्ट पहले से था।',
    );
    expect(joinSentences(['A', 'B.'], 'en')).not.toMatch(/\.\./);
  });
  it('the component composes its status line with it', () => {
    expect(src('components/account/order-again.tsx')).toMatch(/joinSentences\(/);
  });
});

describe('strings and analytics', () => {
  const keys = [
    'again',
    'againBusy',
    'againTitle',
    'againAdded',
    'againAlready',
    'againNone',
    'againMissingTitle',
    'againReason_not_for_sale',
    'againReason_unknown_sku',
    'againReason_too_many_lines',
    'againError',
    'againCart',
    'againClose',
  ];
  it('every string exists in English and Hindi', () => {
    for (const k of keys) {
      expect((en.order as Record<string, string>)[k], `en ${k}`).toBeTruthy();
      expect((hi.order as Record<string, string>)[k], `hi ${k}`).toBeTruthy();
    }
  });
  it('the click is a registered, strict client event with no free text', () => {
    const ok = CLIENT_EVENT_SCHEMAS.order_again_clicked.safeParse({
      code: 'MD-RPR-2026-ABCDEF',
      source: 'list',
    });
    expect(ok.success).toBe(true);
    expect(
      CLIENT_EVENT_SCHEMAS.order_again_clicked.safeParse({ code: 'MD-RPR-2026-ABCDEF', source: 'list', x: 1 })
        .success,
    ).toBe(false);
  });
});
