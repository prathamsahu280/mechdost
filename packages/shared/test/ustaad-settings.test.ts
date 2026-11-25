import { describe, expect, it } from 'vitest';
import {
  USTAAD_SETTINGS,
  USTAAD_SETTING_KEYS,
  ustaadDefaults,
  ustaadSettingInvariant,
  ustaadSettingProblem,
  type UstaadSettingValues,
} from '../src/ustaad/settings';

const base = (over: Partial<UstaadSettingValues> = {}): UstaadSettingValues => ({
  ...ustaadDefaults(),
  ...over,
});

describe('Ustaad settings registry (spec 23 § 15)', () => {
  it('every key is under ustaad.*, has a default that passes its own check', () => {
    expect(USTAAD_SETTING_KEYS.length).toBeGreaterThan(60);
    for (const key of USTAAD_SETTING_KEYS) {
      expect(key.startsWith('ustaad.')).toBe(true);
      expect(ustaadSettingProblem(key, USTAAD_SETTINGS[key].default)).toBeNull();
    }
  });

  it('defaults are valid together (no invariant fires on the defaults)', () => {
    expect(ustaadSettingInvariant(base(), 'super_admin', { protectedWords: 10 })).toBeNull();
  });

  it('ustaad.access is an enum off | staff_preview | open, default staff_preview', () => {
    expect(USTAAD_SETTINGS['ustaad.access']).toMatchObject({
      kind: 'enum',
      values: ['off', 'staff_preview', 'open'],
      default: 'staff_preview',
    });
    expect(ustaadSettingProblem('ustaad.access', 'open')).toBeNull();
    expect(ustaadSettingProblem('ustaad.access', 'everyone')).toBe('range');
    expect(ustaadSettingProblem('ustaad.access', 1)).toBe('type');
  });

  it('int and boolean kinds check type and range', () => {
    expect(ustaadSettingProblem('ustaad.posts.max_photos', 11)).toBe('range');
    expect(ustaadSettingProblem('ustaad.posts.max_photos', 6.5)).toBe('type');
    expect(ustaadSettingProblem('ustaad.media.data_saver_default', 'yes')).toBe('type');
  });

  it('zones.hide_below 4 → SETTING_INVARIANT (SR-31, SR-40)', () => {
    expect(ustaadSettingInvariant(base({ 'ustaad.zones.hide_below': 4 }), 'super_admin')).toEqual({
      key: 'ustaad.zones.hide_below',
      code: 'SETTING_INVARIANT',
    });
  });

  it('zones.exact_from must stay above hide_below', () => {
    expect(
      ustaadSettingInvariant(
        base({ 'ustaad.zones.hide_below': 10, 'ustaad.zones.exact_from': 10 }),
        'super_admin',
      ),
    ).toEqual({ key: 'ustaad.zones.exact_from', code: 'SETTING_INVARIANT' });
  });

  it('promo.every_n 7 → SETTING_INVARIANT (SR-41)', () => {
    expect(ustaadSettingInvariant(base({ 'ustaad.promo.every_n': 7 }), 'super_admin')).toEqual({
      key: 'ustaad.promo.every_n',
      code: 'SETTING_INVARIANT',
    });
  });

  it('video 181 s without a reason → invariant; with a reason by a super admin → ok; by anyone else → invariant', () => {
    const v = base({ 'ustaad.posts.video_max_s': 181 });
    expect(ustaadSettingInvariant(v, 'super_admin')).toEqual({
      key: 'ustaad.posts.video_max_s',
      code: 'SETTING_INVARIANT',
    });
    expect(ustaadSettingInvariant(v, 'super_admin', { reasonCode: 'founder_request' })).toBeNull();
    expect(ustaadSettingInvariant(v, 'community_manager', { reasonCode: 'founder_request' })).toEqual({
      key: 'ustaad.posts.video_max_s',
      code: 'SETTING_INVARIANT',
    });
  });

  it('auto correction with an empty protected list → invariant', () => {
    const v = base({ 'ustaad.correction.default_mode': 'auto' });
    expect(ustaadSettingInvariant(v, 'super_admin', { protectedWords: 0 })).toEqual({
      key: 'ustaad.correction.default_mode',
      code: 'SETTING_INVARIANT',
    });
    expect(ustaadSettingInvariant(v, 'super_admin', { protectedWords: 3 })).toBeNull();
  });

  it('feed weights summing 99 → SETTING_RELATION; discover weights too', () => {
    expect(ustaadSettingInvariant(base({ 'ustaad.feed.w_follows': 29 }), 'super_admin')).toEqual({
      key: 'ustaad.feed.w_follows',
      code: 'SETTING_RELATION',
    });
    expect(ustaadSettingInvariant(base({ 'ustaad.discover.w_new': 6 }), 'super_admin')).toEqual({
      key: 'ustaad.discover.w_new',
      code: 'SETTING_RELATION',
    });
  });

  it('media.video_max_mb above 150 and url_ttl above 10 are refused by range (locked ceilings)', () => {
    expect(ustaadSettingProblem('ustaad.media.video_max_mb', 151)).toBe('range');
    expect(ustaadSettingProblem('ustaad.media.url_ttl_min', 11)).toBe('range');
  });

  it('locked keys cannot change from their default', () => {
    expect(ustaadSettingInvariant(base({ 'ustaad.general.mechanics_only': false }), 'super_admin')).toEqual({
      key: 'ustaad.general.mechanics_only',
      code: 'SETTING_INVARIANT',
    });
    expect(
      ustaadSettingInvariant(base({ 'ustaad.mod.minor_report_restricts': false }), 'super_admin'),
    ).toEqual({ key: 'ustaad.mod.minor_report_restricts', code: 'SETTING_INVARIANT' });
  });
});
