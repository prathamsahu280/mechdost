'use client';

import { AGENT_VEHICLE_TYPES } from '@mechdost/shared/delivery/codes';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { Switch } from '@/components/ui/switch';
import { portalField, portalPrimary } from '@/components/portal/portal-styles';
import { deliverySettings, saveDeliverySettings, type DemoDeliverySettings } from '@/demo/delivery-store';
import { track } from '@/lib/analytics';
import { useStatusLine } from './parts';

type IntKey = 'offerTimeoutMin' | 'maxActiveJobs' | 'maxAttempts';
const INT_SETTING: Record<IntKey, keyof typeof OPERATIONAL_SETTINGS> = {
  offerTimeoutMin: 'delivery.offer_timeout_min',
  maxActiveJobs: 'delivery.max_active_jobs',
  maxAttempts: 'delivery.max_attempts',
};
const LABEL: Record<IntKey | 'agentsEnabled' | 'photosRequired', string> = {
  agentsEnabled: 'api_set_delivery_agents_enabled',
  photosRequired: 'api_set_delivery_photos_required',
  offerTimeoutMin: 'api_set_delivery_offer_timeout_min',
  maxActiveJobs: 'api_set_delivery_max_active_jobs',
  maxAttempts: 'api_set_delivery_max_attempts',
};
const bounds = (key: keyof typeof OPERATIONAL_SETTINGS) => {
  const spec = OPERATIONAL_SETTINGS[key];
  return 'min' in spec ? { min: spec.min, max: spec.max } : { min: 0, max: 0 };
};

/**
 * The browser demo's delivery settings (Raipur only), with the same limits as the real per-city settings
 * (`OPERATIONAL_SETTINGS`, `delivery.*`). Real builds edit them on Admin → Settings → Partners.
 */
export function DemoDeliverySettings() {
  const t = useTranslations('deliveryAdmin');
  const p = useTranslations('portal');
  const v = useTranslations('delivery.vehicle');
  const [form, setForm] = useState<DemoDeliverySettings>(() => deliverySettings());
  const { say, line } = useStatusLine();

  function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const ints = (Object.keys(INT_SETTING) as IntKey[]).every((k) => {
      const b = bounds(INT_SETTING[k]);
      return Number.isInteger(form[k]) && form[k] >= b.min && form[k] <= b.max;
    });
    const loads = AGENT_VEHICLE_TYPES.every(
      (x) => Number.isInteger(form.maxLoadKg[x]) && form.maxLoadKg[x] >= 1,
    );
    if (!ints || !loads) {
      say(t('settingsInvalid'), 'error');
      return;
    }
    const r = saveDeliverySettings(form);
    track('click', { id: 'admin_delivery_settings_saved', path: window.location.pathname });
    say(r.ok ? t('settingsSaved') : t('genericError', { code: r.code }), r.ok ? 'ok' : 'error');
  }

  return (
    <form noValidate onSubmit={save} className="mt-3 grid gap-4">
      {(['agentsEnabled', 'photosRequired'] as const).map((k) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <label htmlFor={`ds-${k}`} className="text-[15px] font-bold text-ink">
            {p(LABEL[k] as 'api_set_delivery_agents_enabled')}
          </label>
          <Switch
            id={`ds-${k}`}
            checked={form[k]}
            onChange={(on) => {
              setForm({ ...form, [k]: on });
            }}
            onText={t('on')}
            offText={t('off')}
          />
        </div>
      ))}
      <div className="grid gap-3 tab:grid-cols-3">
        {(Object.keys(INT_SETTING) as IntKey[]).map((k) => {
          const b = bounds(INT_SETTING[k]);
          return (
            <div key={k}>
              <label htmlFor={`ds-${k}`} className="text-sm font-bold text-ink">
                {p(LABEL[k] as 'api_set_delivery_agents_enabled')}
              </label>
              <input
                id={`ds-${k}`}
                type="number"
                inputMode="numeric"
                min={b.min}
                max={b.max}
                value={form[k]}
                onChange={(e) => {
                  setForm({ ...form, [k]: Number(e.target.value) });
                }}
                className={portalField}
              />
            </div>
          );
        })}
      </div>
      <div className="grid gap-3 tab:grid-cols-4">
        {AGENT_VEHICLE_TYPES.map((x) => (
          <div key={x}>
            <label htmlFor={`ds-load-${x}`} className="text-sm font-bold text-ink">
              {t('maxLoad', { vehicle: v(x) })}
            </label>
            <input
              id={`ds-load-${x}`}
              type="number"
              inputMode="numeric"
              min={1}
              value={form.maxLoadKg[x]}
              onChange={(e) => {
                setForm({ ...form, maxLoadKg: { ...form.maxLoadKg, [x]: Number(e.target.value) } });
              }}
              className={portalField}
            />
          </div>
        ))}
      </div>
      <button type="submit" className={`${portalPrimary} w-fit`}>
        {t('settingsSave')}
      </button>
      {line}
    </form>
  );
}
