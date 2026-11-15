/**
 * Visual review 2026-11-16 (V1-V4): offer countdown in hours, shop header "★ 4.6" kept together, codes never broken
 * at hyphens, delivery-code form stacking at 390 px.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { offerLeftParams } from '../src/lib/offer-time';
import { CodeText, withCode } from '../src/components/ui/code-text';

const root = join(__dirname, '..', '..', '..');
const msgs = (l: 'en' | 'hi') =>
  JSON.parse(readFileSync(join(root, `packages/shared/src/i18n/${l}.json`), 'utf8')) as {
    portal: Record<string, string>;
  };
const say = (l: 'en' | 'hi', total: number) =>
  createTranslator({ locale: l, messages: { portal: msgs(l).portal }, namespace: 'portal' })(
    'expiresIn',
    offerLeftParams(total),
  );
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('V1 offer countdown', () => {
  it('splits minutes into hours and minutes', () => {
    expect(offerLeftParams(45)).toMatchObject({ hours: 0, mins: 45 });
    expect(offerLeftParams(90)).toMatchObject({ hours: 1, mins: 30 });
    expect(offerLeftParams(1440)).toMatchObject({ hours: 24, mins: 0 });
    expect(offerLeftParams(-5)).toMatchObject({ hours: 0, mins: 0 });
  });
  it('reads naturally in English', () => {
    expect(say('en', 45)).toBe('45 min left to accept');
    expect(say('en', 60)).toBe('1 h left to accept');
    expect(say('en', 90)).toBe('1 h 30 min left to accept');
    expect(say('en', 1440)).toBe('24 h left to accept');
  });
  it('reads naturally in Hindi', () => {
    expect(say('hi', 45)).toContain('45 मिनट');
    expect(say('hi', 90)).toContain('1 घंटा 30 मिनट');
    expect(say('hi', 1440)).toContain('24 घंटे');
    expect(say('hi', 1440)).not.toContain('1440');
  });
  it('every call site goes through the helper', () => {
    for (const f of [
      'components/portal/shop-portal.tsx',
      'components/portal/shop-portal-api.tsx',
      'components/portal/admin-console.tsx',
      'components/portal/admin-orders-api.tsx',
    ]) {
      expect(src(f), f).toMatch(/offerLeftParams/);
      expect(src(f), f).not.toMatch(/expiresIn', \{ minutes/);
    }
  });
});

describe('V3 rating stays together', () => {
  it('shopStats and the workshop header glue the star to the number', () => {
    for (const l of ['en', 'hi'] as const) expect(msgs(l).portal.shopStats).toContain('★ {rating}');
    expect(src('components/portal/workshop-portal.tsx')).toContain('★ {workshop.rating');
  });
});

describe('V4 codes never break', () => {
  it('CodeText is nowrap', () => {
    expect(renderToStaticMarkup(createElement(CodeText, null, 'SR-RPR-2026-HND104'))).toContain(
      'whitespace-nowrap',
    );
  });
  it('withCode wraps only the code inside a sentence', () => {
    const html = renderToStaticMarkup(
      createElement('h1', null, withCode('Service request SR-RPR-2026-HND104', 'SR-RPR-2026-HND104')),
    );
    expect(html).toBe('<h1>Service request <span class="whitespace-nowrap">SR-RPR-2026-HND104</span></h1>');
  });
  it('page headings use it', () => {
    for (const f of [
      'app/[locale]/service/[code]/page.tsx',
      'app/[locale]/orders/[code]/page.tsx',
      'app/[locale]/quotes/[code]/page.tsx',
    ])
      expect(src(f), f).toMatch(/withCode/);
  });
});

describe('V8 labour redo link contrast', () => {
  it('sits on surface-alt, where accent-soft-text is 4.4:1, so it uses ink text with an underline', () => {
    const s = src('components/workshops/service-estimate.tsx');
    const at = s.indexOf('labour_redo_claim_open');
    const link = s.slice(at, at + 260);
    expect(link).toMatch(/text-ink underline/);
    expect(link).not.toMatch(/text-accent/);
  });
});

describe('V7 assistant chips and V9 coupon category fixture', () => {
  it('chips wrap instead of scrolling inside an overflow-hidden panel', () => {
    const s = src('components/assistant/assistant-panel.tsx');
    const at = s.indexOf('copy.suggestionsLabel');
    expect(s.slice(at, at + 120)).toMatch(/flex-wrap/);
    expect(s.slice(at, at + 120)).not.toMatch(/overflow-x-auto/);
  });
  it('the audit fixture answers the category picker in Hindi when asked for hi', () => {
    const f = readFileSync(join(__dirname, '..', 'e2e/state-audit/api-mode/fixtures.ts'), 'utf8');
    expect(f).toContain("query.get('locale') === 'hi' ? 'टायर'");
  });
});

describe('V2 delivery-code form', () => {
  for (const f of ['components/portal/shop-portal.tsx', 'components/portal/shop-portal-api.tsx']) {
    it(`${f} stacks under 420 px with a 44 px button`, () => {
      const s = src(f);
      const at = s.indexOf("t('deliveryConfirm')");
      const block = s.slice(at - 1400, at);
      expect(block).toMatch(/flex-col gap-2 min-\[420px\]:flex-row/);
      expect(block).toMatch(/w-full min-\[420px\]:w-32/);
      expect(block).toMatch(/min-h-11/);
    });
  }
});
