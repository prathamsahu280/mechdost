/**
 * Shop staff performance and earnings screen (design 2026-11-16, spec 07): the pure helpers, every key the screen uses
 * in both languages, the lazy wiring (nothing in the portal's first load), a closable panel, and the empty state.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHOP_PAYOUT_ENTRY_KINDS } from '@mechdost/shared/coins';
import type { ShopStaffPerformanceDto } from '@mechdost/shared/shop-staff-performance';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import {
  istDayLabel,
  paiseBarWidth,
  staffIsEmpty,
  staffKindKey,
  STAFF_DAYS_SHOWN,
} from '../src/lib/shop-tools-view';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

const member = (over: Partial<ShopStaffPerformanceDto['members'][number]> = {}) => ({
  userId: 'u1',
  name: 'Anil',
  role: 'staff' as const,
  isYou: false,
  accepted: 0,
  packed: 0,
  handedOver: 0,
  delivered: 0,
  giveUps: 0,
  medianAcceptSeconds: null,
  onTimeBp: null,
  deliveredLedgerPaise: 0,
  ...over,
});
const dto = (over: Partial<ShopStaffPerformanceDto> = {}): ShopStaffPerformanceDto => ({
  shopId: 's1',
  days: 30,
  from: '2026-10-18',
  scope: 'owner',
  onTimeHours: 24,
  members: [member()],
  shop: null,
  earnings: { totalPaise: 0, byKind: [], byDay: [] },
  ...over,
});

describe('helpers', () => {
  it('a day bar is a share of the largest day shown, inside 0 to 100', () => {
    expect(paiseBarWidth(5000, 10_000)).toBe(50);
    expect(paiseBarWidth(10_000, 10_000)).toBe(100);
    expect(paiseBarWidth(1, 10_000)).toBe(0);
    expect(paiseBarWidth(500, 0)).toBe(0);
    expect(paiseBarWidth(-5, 100)).toBe(0);
    expect(STAFF_DAYS_SHOWN).toBe(14);
  });

  it('an IST day is written as that calendar day in either language, whatever the viewer’s time zone', () => {
    expect(istDayLabel('2026-11-16', 'en')).toMatch(/16/);
    expect(istDayLabel('2026-11-16', 'en')).toMatch(/Nov/);
    expect(istDayLabel('2026-11-01', 'hi')).toMatch(/1/);
    expect(istDayLabel('2026-11-01', 'hi')).not.toMatch(/Oct|Nov/);
    expect(istDayLabel('2026-01-01', 'en')).toMatch(/Jan/);
  });

  it('every ledger kind has a text key in both languages', () => {
    for (const kind of SHOP_PAYOUT_ENTRY_KINDS) {
      expect(en.shopTier2).toHaveProperty(staffKindKey(kind));
      expect(hi.shopTier2).toHaveProperty(staffKindKey(kind));
    }
  });

  it('empty means nobody did anything and nothing is owed', () => {
    expect(staffIsEmpty(dto())).toBe(true);
    expect(staffIsEmpty(dto({ members: [member({ packed: 1 })] }))).toBe(false);
    expect(staffIsEmpty(dto({ members: [member({ giveUps: 1 })] }))).toBe(false);
    expect(staffIsEmpty(dto({ earnings: { totalPaise: 100, byKind: [], byDay: [] } }))).toBe(false);
    expect(staffIsEmpty(dto({ earnings: null }))).toBe(true);
  });
});

describe('the screen', () => {
  const screen = read('components/portal/shop-staff-performance-api.tsx');
  const lazy = read('components/portal/shop-staff-performance-lazy.tsx');

  it('every shopTier2 key it uses exists in English and Hindi', () => {
    const used = new Set<string>();
    for (const m of screen.matchAll(/\bt\(\s*'([A-Za-z_0-9]+)'/g)) if (m[1]) used.add(m[1]);
    for (const m of lazy.matchAll(/\bt\(\s*'([A-Za-z_0-9]+)'/g)) if (m[1]) used.add(m[1]);
    expect(used.size).toBeGreaterThan(15);
    const missing = [...used].filter((k) => !(k in en.shopTier2) || !(k in hi.shopTier2));
    expect(missing).toEqual([]);
  });

  it('is behind a toggle that loads it on demand, and the toggle closes it again', () => {
    expect(lazy).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(\s*'\.\/shop-staff-performance-api'\s*\)/s);
    expect(lazy).toMatch(/aria-expanded=\{open\}/);
    expect(lazy).toMatch(/data-panel-cancel=/);
    expect(read('components/portal/shop-profile-api.tsx')).toMatch(/ShopStaffPerformanceLazy/);
    // No static import of the screen anywhere else (JS budget).
    expect(read('components/portal/shop-profile-api.tsx')).not.toMatch(
      /from '\.\/shop-staff-performance-api'/,
    );
  });

  it('empty state has one next action; errors can be retried; the window toggle is tracked', () => {
    expect(screen).toMatch(/staffEmpty/);
    expect(screen).toMatch(/staffShow90/);
    expect(screen).toMatch(/staffSeeOrders/);
    expect(screen).toMatch(/staffRetry/);
    expect(screen).toMatch(/track\('click'/);
  });
});
