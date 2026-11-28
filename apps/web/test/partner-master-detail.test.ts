import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARTNER_CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/partner-client-events';
import { masterDetailFocusPlan, masterRowHref } from '@/lib/partner-kit';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

describe('master-detail helpers', () => {
  it('builds a row href that keeps the lane and sets the item', () => {
    expect(masterRowHref('/partner/shop/orders', 'packing', 'order', 'MD-RPR-2026-ABC234')).toBe(
      '/partner/shop/orders?lane=packing&order=MD-RPR-2026-ABC234',
    );
  });

  it('moves focus to the detail only for a new selection, to the row on close, never on first load', () => {
    expect(masterDetailFocusPlan(undefined, 'A')).toBe('none');
    expect(masterDetailFocusPlan(undefined, null)).toBe('none');
    expect(masterDetailFocusPlan(null, 'A')).toBe('detail');
    expect(masterDetailFocusPlan('A', 'B')).toBe('detail');
    expect(masterDetailFocusPlan('A', 'A')).toBe('none');
    expect(masterDetailFocusPlan('A', null)).toBe('row');
  });
});

describe('master-detail wiring', () => {
  it('has a strict analytics event with codes only', () => {
    const s = PARTNER_CLIENT_EVENT_SCHEMAS.partner_detail_opened;
    expect(s.safeParse({ portal: 'shop', kind: 'order' }).success).toBe(true);
    expect(s.safeParse({ portal: 'shop', kind: 'order', code: 'MD-1' }).success).toBe(false);
  });

  it('uses fixed grid columns at the nav breakpoint and a focusable detail heading', () => {
    const c = src('components/partner/master-detail.tsx');
    expect(c).toMatch(/nav:grid-cols-\[/);
    expect(c).toMatch(/tabIndex=\{-1\}/);
  });

  it('the shop Orders tab and the workshop Jobs tab use it', () => {
    expect(src('components/portal/shop-orders-tab-api.tsx')).toMatch(/MasterDetail/);
    expect(src('components/portal/workshop-portal-api.tsx')).toMatch(/MasterDetail/);
  });

  it('callers never branch the layout on the viewport: one CSS-driven tree, server HTML equals first paint', () => {
    for (const f of [
      'components/portal/shop-orders-tab-api.tsx',
      'components/portal/workshop-portal-api.tsx',
    ]) {
      const c = src(f);
      expect(c, f).not.toMatch(/useWideLayout/);
      expect(c, f).not.toMatch(/\bwide\s*[?&]|[?&]\s*!?wide\b|\(\s*!?wide\b|if \(.*\bwide\b/);
    }
    const m = src('components/partner/master-detail.tsx');
    // Grid columns, the detail pane and the two navigation links switch with CSS at the 1024 px `nav:` breakpoint.
    expect(m).toMatch(/nav:grid-cols-\[22rem_minmax\(0,1fr\)\]/);
    expect(m).toMatch(/hidden nav:block/);
    expect(m).toMatch(/nav:hidden/);
    // No render-time viewport state: the wide check is read only inside effects (focus, analytics).
    expect(m).not.toMatch(/useSyncExternalStore|useWideLayout/);
    expect(src('components/partner/wide-layout.tsx')).toMatch(/export function isWideNow/);
    expect(src('components/partner/wide-layout.tsx')).toMatch(/\(min-width: 1024px\)/);
  });

  it('has en and hi strings for the empty pane and the close links', () => {
    for (const f of ['en', 'hi']) {
      const j = JSON.parse(
        readFileSync(new URL(`../../../packages/shared/src/i18n/${f}.json`, import.meta.url), 'utf8'),
      ) as Record<string, Record<string, string>>;
      for (const k of ['detail_empty', 'close_order']) expect(j.partnerShop?.[k]).toBeTruthy();
      for (const k of ['detail_empty', 'close_job']) expect(j.partnerWorkshop?.[k]).toBeTruthy();
    }
  });
});
