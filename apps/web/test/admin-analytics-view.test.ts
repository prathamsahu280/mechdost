import { describe, expect, it } from 'vitest';
import {
  chartTicks,
  durationParts,
  formatCount,
  funnelRows,
  localName,
  rangePreset,
  reasonLabelKey,
  sharePercent,
  shortDay,
} from '../src/lib/admin-analytics-view';

// 23:50 IST on 14 November 2026.
const NOW = new Date('2026-11-14T18:20:00Z');

describe('admin analytics view helpers', () => {
  it('builds IST date presets ending today', () => {
    expect(rangePreset(7, NOW)).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(rangePreset(30, NOW)).toEqual({ from: '2026-10-16', to: '2026-11-14' });
    expect(rangePreset(90, NOW)).toEqual({ from: '2026-08-17', to: '2026-11-14' });
  });

  it('gives whole percentages, null when there is nothing to divide by', () => {
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(2, 3)).toBe(67);
    expect(sharePercent(0, 0)).toBeNull();
    expect(sharePercent(5, 0)).toBeNull();
  });

  it('turns the funnel into steps with conversion from the previous and the first step', () => {
    expect(
      funnelRows([
        { step: 'product_view', count: 200 },
        { step: 'add_to_cart', count: 50 },
        { step: 'checkout_started', count: 0 },
        { step: 'order_placed', count: 4 },
      ]),
    ).toEqual([
      { step: 'product_view', count: 200, ofPrevious: null, width: 100 },
      { step: 'add_to_cart', count: 50, ofPrevious: 25, width: 25 },
      { step: 'checkout_started', count: 0, ofPrevious: 0, width: 0 },
      { step: 'order_placed', count: 4, ofPrevious: null, width: 2 },
    ]);
    expect(funnelRows([{ step: 'order_placed', count: 0 }])).toEqual([
      { step: 'order_placed', count: 0, ofPrevious: null, width: 0 },
    ]);
  });

  it('picks round axis ticks that cover the largest value', () => {
    expect(chartTicks([0, 3, 7])).toEqual([0, 5, 10]);
    expect(chartTicks([0, 0])).toEqual([0, 1]);
    expect(chartTicks([120_000, 950_000])).toEqual([0, 500_000, 1_000_000]);
    expect(chartTicks([11])).toEqual([0, 10, 20]);
  });

  it('formats counts with Indian grouping in both languages', () => {
    expect(formatCount(1234567, 'en')).toBe('12,34,567');
    expect(formatCount(1234567, 'hi')).toBe('12,34,567');
  });

  it('splits a duration into a unit for the locale strings', () => {
    expect(durationParts(45)).toEqual({ unit: 's', value: 45 });
    expect(durationParts(90)).toEqual({ unit: 'min', value: 2 });
    expect(durationParts(5400)).toEqual({ unit: 'h', value: 2 });
  });

  it('labels an IST day briefly', () => {
    expect(shortDay('2026-11-01', 'en')).toBe('1 Nov');
    expect(shortDay('2026-11-01', 'hi')).toMatch(/^1 नव/);
  });

  it('maps reason codes to the order namespace, unknown codes to "other"', () => {
    expect(reasonLabelKey('cancelled', 'changed_mind')).toBe('cancelReason_changed_mind');
    expect(reasonLabelKey('rejected', 'all_shops_declined')).toBe('rejectReason_all_shops_declined');
    expect(reasonLabelKey('cancelled', 'legacy_code')).toBe('cancelReason_other');
  });

  it('shows the Hindi name on /hi when there is one', () => {
    expect(localName({ name: 'Sharma Auto Parts', nameHi: 'शर्मा ऑटो पार्ट्स' }, 'hi')).toBe(
      'शर्मा ऑटो पार्ट्स',
    );
    expect(localName({ name: 'Sharma Auto Parts', nameHi: null }, 'hi')).toBe('Sharma Auto Parts');
    expect(localName({ name: 'Sharma Auto Parts', nameHi: 'शर्मा' }, 'en')).toBe('Sharma Auto Parts');
  });
});
