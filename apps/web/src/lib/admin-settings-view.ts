import {
  needsCoinGuard,
  OPERATIONAL_SETTINGS,
  settingProblem,
  type SettingKey,
  type SettingSpec,
} from '@mechdost/shared/settings';

/**
 * View helpers for Admin → Settings in real sign-in builds (spec 08 "Settings"; Stream D 2026-11-14). The API's
 * registry (`@mechdost/shared/settings`) holds money in paise and durations in minutes or days; the screen shows
 * money in whole rupees and checks every value with the same rules before sending it.
 */
export type SettingUnit =
  'rupees' | 'minutes' | 'days' | 'units' | 'count' | 'bp' | 'coins' | 'requests' | 'switch';

export function settingUnit(key: SettingKey): SettingUnit {
  const spec: SettingSpec = OPERATIONAL_SETTINGS[key];
  if (spec.kind === 'boolean') return 'switch';
  if (key.startsWith('api.')) return 'requests';
  if (key.endsWith('_paise')) return 'rupees';
  if (key.endsWith('_minutes') || key.endsWith('_min')) return 'minutes';
  if (key.endsWith('_days')) return 'days';
  if (key.endsWith('_units')) return 'units';
  // Coin rules (spec 20): shares in basis points (100 = 1%), bonuses in coins.
  if (key.endsWith('_bp')) return 'bp';
  if (key.endsWith('_bonus')) return 'coins';
  return 'count';
}

/** Lower and upper bound as the person types them (rupees for money). */
export function settingBounds(key: SettingKey): [number, number] | null {
  const spec: SettingSpec = OPERATIONAL_SETTINGS[key];
  if (spec.kind === 'boolean') return null;
  const scale = settingUnit(key) === 'rupees' ? 100 : 1;
  return [Math.ceil(spec.min / scale), Math.floor(spec.max / scale)];
}

export function isNullable(key: SettingKey): boolean {
  const spec: SettingSpec = OPERATIONAL_SETTINGS[key];
  return spec.kind === 'int' && spec.nullable === true;
}

/** A stored value as the input shows it ('' = no value). */
export function toInput(key: SettingKey, value: number | boolean | null): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return '';
  return String(settingUnit(key) === 'rupees' ? value / 100 : value);
}

/** `guard`: an order reward that stays 0 until an anti-abuse guard is chosen (spec 20, COIN_GUARD_REQUIRED). */
export type InputProblem = 'type' | 'range' | 'guard';

export type InputResult = { ok: true; value: number | boolean | null } | { ok: false; problem: InputProblem };

/** What the person typed → the value the API stores, checked like the API (`settingProblem`). */
export function fromInput(key: SettingKey, raw: string): InputResult {
  const unit = settingUnit(key);
  let value: number | boolean | null;
  if (unit === 'switch') value = raw === 'true';
  else {
    const text = raw.trim();
    if (text === '') {
      if (!isNullable(key)) return { ok: false, problem: 'type' };
      value = null;
    } else if (!/^\d{1,10}$/.test(text)) return { ok: false, problem: 'type' };
    else value = Number(text) * (unit === 'rupees' ? 100 : 1);
  }
  const problem = settingProblem(key, value);
  if (problem) return { ok: false, problem };
  return needsCoinGuard(key, value) ? { ok: false, problem: 'guard' } : { ok: true, value };
}
