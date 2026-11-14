import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_DEFAULT_DAYS,
  ANALYTICS_MAX_DAYS,
  analyticsDays,
  resolveAnalyticsRange,
} from '../src/analytics-range';

// 2026-11-14 23:50 IST = 18:20 UTC: still the 14th in India.
const NOW = new Date('2026-11-14T18:20:00Z');

describe('resolveAnalyticsRange (IST calendar days, inclusive)', () => {
  it('defaults to the last 30 IST days ending today', () => {
    const r = resolveAnalyticsRange({}, NOW);
    expect(r).toEqual({
      ok: true,
      fromDate: '2026-10-16',
      toDate: '2026-11-14',
      days: ANALYTICS_DEFAULT_DAYS,
    });
  });

  it('uses the IST date, not the UTC one, for "today"', () => {
    // 2026-11-14 00:10 IST is still the 13th in UTC.
    const r = resolveAnalyticsRange({}, new Date('2026-11-13T18:40:00Z'));
    expect(r).toMatchObject({ ok: true, toDate: '2026-11-14' });
  });

  it('turns IST dates into UTC instants: from at IST midnight, to exclusive at the next IST midnight', () => {
    const r = resolveAnalyticsRange({ from: '2026-11-01', to: '2026-11-01' }, NOW);
    expect(r).toMatchObject({ ok: true, days: 1 });
    if (!r.ok) throw new Error('range');
    const { fromInstant, toInstant } = analyticsDays(r);
    expect(fromInstant.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(toInstant.toISOString()).toBe('2026-11-01T18:30:00.000Z');
  });

  it('lists every day of the range for chart axes', () => {
    const r = resolveAnalyticsRange({ from: '2026-10-30', to: '2026-11-02' }, NOW);
    if (!r.ok) throw new Error('range');
    expect(analyticsDays(r).dates).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('a lone "from" runs to today; a lone "to" takes the 30 days before it', () => {
    expect(resolveAnalyticsRange({ from: '2026-11-10' }, NOW)).toMatchObject({
      ok: true,
      fromDate: '2026-11-10',
      toDate: '2026-11-14',
      days: 5,
    });
    expect(resolveAnalyticsRange({ to: '2026-10-31' }, NOW)).toMatchObject({
      ok: true,
      fromDate: '2026-10-02',
      toDate: '2026-10-31',
    });
  });

  it('refuses reversed, malformed, impossible and over-long ranges', () => {
    expect(resolveAnalyticsRange({ from: '2026-11-10', to: '2026-11-01' }, NOW)).toEqual({
      ok: false,
      code: 'RANGE_INVALID',
    });
    expect(resolveAnalyticsRange({ from: '2026-13-01' }, NOW)).toEqual({ ok: false, code: 'RANGE_INVALID' });
    expect(resolveAnalyticsRange({ from: '2026-02-30' }, NOW)).toEqual({ ok: false, code: 'RANGE_INVALID' });
    expect(resolveAnalyticsRange({ from: '14-11-2026' }, NOW)).toEqual({ ok: false, code: 'RANGE_INVALID' });
    expect(resolveAnalyticsRange({ from: '2026-01-01', to: '2026-11-14' }, NOW)).toEqual({
      ok: false,
      code: 'RANGE_TOO_LONG',
    });
    const longest = resolveAnalyticsRange({ from: '2026-05-19', to: '2026-11-14' }, NOW);
    expect(longest).toMatchObject({ ok: true, days: ANALYTICS_MAX_DAYS });
  });

  it('refuses a range that starts in the future', () => {
    expect(resolveAnalyticsRange({ from: '2026-11-15', to: '2026-11-20' }, NOW)).toEqual({
      ok: false,
      code: 'RANGE_INVALID',
    });
  });
});
