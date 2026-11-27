import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { OPERATIONAL_SETTINGS, type SettingKey } from '@mechdost/shared/settings';
import { settingUnit, UNIT_LABEL_KEY } from '../src/lib/admin-settings-view';

/** DC-B2 (2026-11-27 QA): every number setting showed "messages" after its box. Each key gets its own unit word. */
describe('settings units (DC-B2)', () => {
  it('gives delivery settings their own units', () => {
    expect(settingUnit('delivery.rank_rating_weight_pct')).toBe('percent');
    expect(settingUnit('delivery.low_rating_alert_x10')).toBe('tenths');
    expect(settingUnit('delivery.invite_hours')).toBe('hours');
    expect(settingUnit('delivery.max_load_bike_kg')).toBe('kg');
    expect(settingUnit('delivery.max_active_jobs')).toBe('count');
    expect(settingUnit('refunds.approval_sla_hours')).toBe('hours');
  });

  it('keeps "messages" only for the assistant message cap', () => {
    expect(settingUnit('assistant.daily_messages')).toBe('messages');
    const keys = Object.keys(OPERATIONAL_SETTINGS) as SettingKey[];
    const messageKeys = keys.filter((k) => settingUnit(k) === 'messages');
    expect(messageKeys).toEqual(['assistant.daily_messages']);
  });

  it('has an en and hi word for every unit label, and "count" shows no word', () => {
    const enS = (en as Record<string, Record<string, string>>).portal ?? {};
    const hiS = (hi as Record<string, Record<string, string>>).portal ?? {};
    for (const [unit, key] of Object.entries(UNIT_LABEL_KEY)) {
      if (key === null) {
        expect(unit).toBe('count');
        continue;
      }
      expect(enS[key], `${unit} en`).toBeTruthy();
      expect(hiS[key], `${unit} hi`).toBeTruthy();
    }
    expect(enS.api_set_unit_messages).toBe('messages');
  });
});
