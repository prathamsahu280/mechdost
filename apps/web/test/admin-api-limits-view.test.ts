import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { fromInput, settingBounds, settingUnit } from '../src/lib/admin-settings-view';

/** Admin → Settings: the three API request limits (spec 08/13, decision 2026-11-16, Q195). */
const KEYS = ['api.signed_in_per_minute', 'api.guest_per_ip_per_minute', 'api.ip_flood_per_minute'] as const;
const LABELS = [
  'api_set_api_signed_in_per_minute',
  'api_set_api_guest_per_ip_per_minute',
  'api_set_api_ip_flood_per_minute',
  'api_set_unit_requests',
] as const;

describe('API limit settings screen', () => {
  it('shows each limit in requests with its bounds, and validates like the API', () => {
    for (const k of KEYS) expect(settingUnit(k)).toBe('requests');
    expect(settingBounds('api.signed_in_per_minute')).toEqual([60, 5000]);
    expect(settingBounds('api.ip_flood_per_minute')).toEqual([300, 20000]);
    expect(fromInput('api.signed_in_per_minute', '300')).toEqual({ ok: true, value: 300 });
    expect(fromInput('api.signed_in_per_minute', '59')).toEqual({ ok: false, problem: 'range' });
    expect(fromInput('api.ip_flood_per_minute', '20001')).toEqual({ ok: false, problem: 'range' });
    expect(fromInput('api.guest_per_ip_per_minute', '')).toEqual({ ok: false, problem: 'type' });
  });

  it('has English and Hindi text for every label and unit', () => {
    const e = en.portal as Record<string, string>;
    const h = hi.portal as Record<string, string>;
    for (const l of LABELS) {
      expect(e[l], l).toBeTruthy();
      expect(h[l], l).toMatch(/[ऀ-ॿ]/);
    }
  });

  it('the screen maps every key to a label (portal-only component, not in the layout or home graph)', () => {
    const src = readFileSync(
      new URL('../src/components/portal/admin-settings-api.tsx', import.meta.url),
      'utf8',
    );
    for (const k of KEYS) expect(src).toContain(`'${k}'`);
    // DC-B2 (2026-11-27): the unit words moved to the shared settings view helper.
    const view = readFileSync(new URL('../src/lib/admin-settings-view.ts', import.meta.url), 'utf8');
    expect(view).toContain("requests: 'api_set_unit_requests'");
  });
});
