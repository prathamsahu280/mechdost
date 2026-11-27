import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARTNER_CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/partner-client-events';
import {
  bulletGeometry,
  clockText,
  countText,
  freshIds,
  hashTargetId,
  laneFrom,
  minutesAgo,
  offerTimerState,
  soundOnFromStorage,
  tabFocusPlan,
} from '@/lib/partner-kit';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const en = JSON.parse(
  readFileSync(new URL('../../../packages/shared/src/i18n/en.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, string>>;
const hi = JSON.parse(
  readFileSync(new URL('../../../packages/shared/src/i18n/hi.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, string>>;

describe('offer timer maths', () => {
  const now = Date.UTC(2026, 10, 27, 18, 0, 0);
  it('counts down in m:ss and drains the bar', () => {
    const s = offerTimerState(now + 4 * 60_000 + 32_000, now, 15 * 60_000);
    expect(s?.text).toBe('4:32');
    expect(s?.fraction).toBeCloseTo(272 / 900, 3);
    expect(s?.urgent).toBe(false);
    expect(s?.milestone).toBe('five');
  });
  it('turns urgent under a minute, then ends', () => {
    expect(offerTimerState(now + 59_000, now)?.urgent).toBe(true);
    expect(offerTimerState(now + 59_000, now)?.milestone).toBe('one');
    const end = offerTimerState(new Date(now - 1000).toISOString(), now, 60_000);
    expect(end).toMatchObject({ seconds: 0, ended: true, urgent: false, fraction: 0, milestone: 'ended' });
  });
  it('shows text only when the window is unknown, and null for no end time', () => {
    expect(offerTimerState(now + 1000 * 3700, now)?.fraction).toBeNull();
    expect(clockText(3700)).toBe('1:01:40');
    expect(offerTimerState(null, now)).toBeNull();
    expect(offerTimerState('not a date', now)).toBeNull();
  });
});

describe('new-work alert', () => {
  it('plays only for ids that were not there before, never on the first load', () => {
    expect(freshIds(null, ['a', 'b'])).toEqual([]);
    expect(freshIds(new Set(['a']), ['a', 'b'])).toEqual(['b']);
    expect(freshIds(new Set(['a', 'b']), ['a'])).toEqual([]);
  });
  it('sound is on unless the partner turned it off (decision Q-PP-F3)', () => {
    expect(soundOnFromStorage(null)).toBe(true);
    expect(soundOnFromStorage('on')).toBe(true);
    expect(soundOnFromStorage('off')).toBe(false);
  });
  it('plays only while the page is visible and is never the only signal', () => {
    const hook = src('components/partner/new-work-alert.ts');
    expect(hook).toContain("visibilityState !== 'visible') return");
    expect(hook).toMatch(/navigator\.vibrate/);
    expect(src('components/partner/order-sound-button.tsx')).toMatch(/aria-live/);
  });
});

describe('lanes, counts, bullet bar, updated line', () => {
  it('keeps the lane from the URL only when it exists', () => {
    const lanes = ['packing', 'out', 'done'] as const;
    expect(laneFrom('out', lanes, 'packing')).toBe('out');
    expect(laneFrom('bogus', lanes, 'packing')).toBe('packing');
    expect(laneFrom(null, lanes, 'packing')).toBe('packing');
  });
  it('lane tabs are links with aria-current and the count in the name', () => {
    const lanes = src('components/partner/lane-tabs.tsx');
    expect(lanes).toMatch(/aria-current/);
    expect(lanes).not.toMatch(/useSearchParams/);
  });
  it('says 20+ for a paged list', () => {
    expect(countText(20, true)).toBe('20+');
    expect(countText(3, false)).toBe('3');
  });
  it('bullet bar: city marker only when there is a city middle', () => {
    expect(bulletGeometry(80, 60, 100)).toEqual({ valuePct: 80, cityPct: 60 });
    expect(bulletGeometry(5, null).cityPct).toBeNull();
    expect(bulletGeometry(0, 0)).toEqual({ valuePct: 0, cityPct: 0 });
    expect(bulletGeometry(120, 60, 100).valuePct).toBe(100);
  });
  it('minutes ago never goes negative', () => {
    expect(minutesAgo(0, 125_000)).toBe(2);
    expect(minutesAgo(10_000, 0)).toBe(0);
  });
});

describe('kit contract', () => {
  it('every partnerKit string has Hindi', () => {
    const keys = Object.keys(en.partnerKit ?? {});
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(hi.partnerKit?.[k], k).toBeTruthy();
  });
  it('events are codes only', () => {
    expect(
      PARTNER_CLIENT_EVENT_SCHEMAS.partner_tab_viewed.safeParse({ portal: 'shop', tab: 'today' }).success,
    ).toBe(true);
    expect(
      PARTNER_CLIENT_EVENT_SCHEMAS.partner_tab_viewed.safeParse({ portal: 'shop', tab: 'MD-RPR-1' }).success,
    ).toBe(false);
  });
  it('the barrel exports the pieces other portals import', () => {
    const index = src('components/partner/index.ts');
    for (const name of [
      'PartnerFrame',
      'PartnerTabs',
      'KpiTile',
      'OfferTimer',
      'LaneTabs',
      'StepRail',
      'BulletBar',
      'DailyBars',
      'useNewWorkAlert',
      'OrderSoundButton',
      'UpdatedAgo',
    ])
      expect(index, name).toContain(name);
  });
  it('the kit never lands in a storefront chunk', () => {
    const chrome = [
      'components/site/header.tsx',
      'components/site/mobile-tab-bar.tsx',
      'app/[locale]/layout.tsx',
    ];
    for (const f of chrome) expect(src(f)).not.toMatch(/components\/partner/);
  });
  it('the timer bar is hidden from assistive tech and stops under reduced motion', () => {
    const timer = src('components/partner/offer-timer.tsx');
    expect(timer).toMatch(/aria-hidden="true"/);
    const css = src('app/[locale]/globals.css');
    expect(css).toMatch(/\.partner-tread/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*partner-tread/);
  });
});

describe('focus helpers', () => {
  it('moves focus only for a user-initiated tab change, never on first load or the same page', () => {
    expect(tabFocusPlan(null, '/partner/shop', true)).toBe(false);
    expect(tabFocusPlan('/partner/shop', '/partner/shop', true)).toBe(false);
    expect(tabFocusPlan('/partner/shop', '/partner/shop/orders', false)).toBe(false);
    expect(tabFocusPlan('/partner/shop', '/partner/shop/orders', true)).toBe(true);
  });

  it('reads the target id of a hash link, nothing otherwise', () => {
    expect(hashTargetId('/partner/shop/orders#packing')).toBe('packing');
    expect(hashTargetId('/partner/shop/orders#')).toBeNull();
    expect(hashTargetId('/partner/shop/orders')).toBeNull();
    expect(hashTargetId('#a%20b')).toBe('a b');
  });
});
