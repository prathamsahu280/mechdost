import { describe, expect, it } from 'vitest';
import { apiLimitRelationProblem, apiLimitsFrom, settingProblem } from '../src/settings';

describe('API limit settings', () => {
  it('have the agreed defaults and bounds', () => {
    expect(apiLimitsFrom({})).toEqual({
      signedInPerMinute: 300,
      guestPerIpPerMinute: 600,
      ipFloodPerMinute: 3000,
    });
    expect(settingProblem('api.signed_in_per_minute', 59)).toBe('range');
    expect(settingProblem('api.signed_in_per_minute', 60)).toBeNull();
    expect(settingProblem('api.signed_in_per_minute', 5001)).toBe('range');
    expect(settingProblem('api.guest_per_ip_per_minute', 5000)).toBeNull();
    expect(settingProblem('api.ip_flood_per_minute', 299)).toBe('range');
    expect(settingProblem('api.ip_flood_per_minute', 20_000)).toBeNull();
    expect(settingProblem('api.ip_flood_per_minute', 20_001)).toBe('range');
    expect(settingProblem('api.ip_flood_per_minute', 'x')).toBe('type');
  });

  it('ignores invalid stored values and never lets the flood guard sit below the guest limit', () => {
    expect(
      apiLimitsFrom({ 'api.signed_in_per_minute': 'bad', 'api.guest_per_ip_per_minute': 10 })
        .guestPerIpPerMinute,
    ).toBe(600);
    const l = apiLimitsFrom({ 'api.guest_per_ip_per_minute': 4000, 'api.ip_flood_per_minute': 1000 });
    expect(l.ipFloodPerMinute).toBe(4000);
  });

  it('flood must stay at or above guest on save', () => {
    expect(
      apiLimitRelationProblem('api.guest_per_ip_per_minute', 3001, { 'api.ip_flood_per_minute': 3000 }),
    ).toBe(true);
    expect(
      apiLimitRelationProblem('api.guest_per_ip_per_minute', 3000, { 'api.ip_flood_per_minute': 3000 }),
    ).toBe(false);
    expect(
      apiLimitRelationProblem('api.ip_flood_per_minute', 500, { 'api.guest_per_ip_per_minute': 600 }),
    ).toBe(true);
    expect(apiLimitRelationProblem('api.signed_in_per_minute', 60, {})).toBe(false);
  });
});
