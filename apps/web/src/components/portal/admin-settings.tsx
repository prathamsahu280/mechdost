'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { saveOrderRules, useOrderRules } from '@/demo/order-rules';
import {
  DEFAULT_SETTINGS,
  SETTING_LIMITS,
  resetArea,
  saveSettings,
  useSiteConfig,
  type SiteSettings,
} from '@/demo/site-config';
import { AUTH_MODE } from '@/lib/auth/mode';
import { track } from '@/lib/analytics';
import { riskOfChange, type SettingsCategoryId } from '@/lib/admin-settings-registry';
import { RecentChanges } from './admin-site';
import { SettingsWorkbench, type SettingItem, type SettingsStatus } from './admin-settings-workbench';
import { portalQuiet } from './portal-styles';

/** The API editor (real sign-in builds only): loaded on demand so demo bundles stay the same size. */
const SettingsApi = dynamic(() => import('./admin-settings-api').then((m) => m.SettingsApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />,
});

/**
 * Admin → Settings (spec 08 "Settings", design 2026-11-24): every operational setting in one categorised screen.
 * Real sign-in builds edit the API's registry (`admin-settings-api.tsx`); the browser demo edits the demo store here.
 */
/** The Ustaad Network access switch (spec 23, founder 2026-11-26), on the API only; G1 moves it into Admin → Ustaad. */
const UstaadAccess = dynamic(() => import('./admin-ustaad-access').then((m) => m.AdminUstaadAccess), {
  ssr: false,
});

export function AdminSettings({ actor }: { actor: string }) {
  return AUTH_MODE === 'firebase' ? (
    <>
      <UstaadAccess />
      <SettingsApi />
    </>
  ) : (
    <DemoSettings actor={actor} />
  );
}

/** `money`: stored in paise, edited in rupees. `percent`: stored in basis points, edited in %. */
const SETTING_FIELDS: {
  key: keyof SiteSettings;
  unit: 'minutes' | 'units' | 'rupees' | 'paise' | 'percent' | 'days';
  money: boolean;
  percent?: boolean;
  category: SettingsCategoryId;
}[] = [
  { key: 'acceptMinutes', unit: 'minutes', money: false, category: 'orders' },
  { key: 'bulkMinUnits', unit: 'units', money: false, category: 'orders' },
  { key: 'deliveryFeePaise', unit: 'rupees', money: true, category: 'orders' },
  { key: 'freeDeliveryFromPaise', unit: 'rupees', money: true, category: 'orders' },
  { key: 'coinValuePaise', unit: 'paise', money: false, category: 'coins' },
  { key: 'coinMaxRedeemBp', unit: 'percent', money: false, percent: true, category: 'coins' },
  { key: 'labourPromiseDays', unit: 'days', money: false, category: 'service' },
];
const scaled = (f: { money: boolean; percent?: boolean }) => f.money || f.percent === true;
const RULE_ID = 'setting-customerSelfCancel';

type Draft = Record<keyof SiteSettings, string>;

const toDraft = (s: SiteSettings): Draft =>
  Object.fromEntries(
    SETTING_FIELDS.map((f) => [f.key, String(scaled(f) ? s[f.key] / 100 : s[f.key])]),
  ) as Draft;

function DemoSettings({ actor }: { actor: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const num = (n: number) => new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(n);
  const config = useSiteConfig();
  const rules = useOrderRules();
  const [version, setVersion] = useState(config.versions.settings);
  const [draft, setDraft] = useState<Draft>(() => toDraft(config.settings));
  const [ruleDraft, setRuleDraft] = useState<boolean | null>(null);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  const savedDraft = toDraft(config.settings);
  const ruleValue = ruleDraft ?? rules.customerSelfCancel;
  const bounds = (f: (typeof SETTING_FIELDS)[number]) =>
    SETTING_LIMITS[f.key].map((v) => (scaled(f) ? v / 100 : v)) as [number, number];

  /** What is wrong with a typed value (same rule as the saved values: a whole number inside the limits). */
  const problem = (f: (typeof SETTING_FIELDS)[number]): string | null => {
    const [min, max] = bounds(f);
    const raw = draft[f.key].trim();
    const n = Number(raw);
    return /^\d+$/.test(raw) && n >= min && n <= max
      ? null
      : t('settings_err', { min: num(min), max: num(max) });
  };

  const items: SettingItem[] = [
    ...SETTING_FIELDS.map((f): SettingItem => {
      const [min, max] = bounds(f);
      const changed = draft[f.key] !== savedDraft[f.key];
      const def = scaled(f) ? DEFAULT_SETTINGS[f.key] / 100 : DEFAULT_SETTINGS[f.key];
      return {
        id: `setting-${f.key}`,
        category: f.category,
        label: t(`setting_${f.key}`),
        help: t(`setting_${f.key}_hint`, { min: num(min), max: num(max) }),
        kind: 'number',
        prefix: f.money ? '₹' : undefined,
        unit: f.money ? undefined : t(`unit_${f.unit}`),
        value: draft[f.key],
        saved: savedDraft[f.key],
        hint: t('api_set_default', { value: num(def) }),
        error: changed ? (problem(f) ?? undefined) : undefined,
        risk: null,
      };
    }),
    {
      id: RULE_ID,
      category: 'orders',
      label: t('rules_selfCancel'),
      help: t('rules_selfCancelHint'),
      kind: 'switch',
      value: String(ruleValue),
      saved: String(rules.customerSelfCancel),
      hint: t('api_set_default', { value: t('notify_off') }),
      risk: riskOfChange('customerSelfCancel', rules.customerSelfCancel, ruleValue),
    },
  ];

  function onChange(id: string, value: string) {
    setStatus(null);
    if (id === RULE_ID) {
      setRuleDraft(value === 'true');
      return;
    }
    const key = id.replace('setting-', '') as keyof SiteSettings;
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function onSave() {
    const bad = SETTING_FIELDS.find((f) => problem(f));
    if (bad) {
      setStatus({ tone: 'error', text: t('site_invalid') });
      setFocus({ id: `setting-${bad.key}`, n: (focus?.n ?? 0) + 1 });
      return;
    }
    const values = { ...DEFAULT_SETTINGS };
    for (const f of SETTING_FIELDS) values[f.key] = Number(draft[f.key]) * (scaled(f) ? 100 : 1);
    const changedFields = SETTING_FIELDS.filter((f) => draft[f.key] !== savedDraft[f.key]).length;
    if (changedFields > 0) {
      if (!saveSettings(version, actor, values)) {
        setStatus({ tone: 'error', text: t('site_stale') });
        return;
      }
      setVersion(version + 1);
    }
    let fields = changedFields;
    if (ruleDraft !== null && ruleDraft !== rules.customerSelfCancel) {
      if (!saveOrderRules({ customerSelfCancel: ruleDraft })) {
        setStatus({ tone: 'error', text: t('rules_saveFailed') });
        return;
      }
      fields += 1;
    }
    setRuleDraft(null);
    setStatus({ tone: 'ok', text: t('site_saved') });
    track('admin_site_change', { area: 'settings', action: 'save', fields });
  }

  function onDiscard() {
    setDraft(savedDraft);
    setRuleDraft(null);
    setStatus(null);
  }

  function onReset() {
    if (!resetArea(version, actor, 'settings')) {
      setStatus({ tone: 'error', text: t('site_stale') });
      return;
    }
    setVersion(version + 1);
    setDraft(toDraft(DEFAULT_SETTINGS));
    setStatus({ tone: 'ok', text: t('site_resetDone') });
    track('admin_site_change', { area: 'settings', action: 'reset', fields: 0 });
  }

  return (
    <SettingsWorkbench
      title={t('settings_title')}
      lead={t('settings_lead')}
      toolbar={<p className="rounded-lg bg-private-bg p-3 text-sm text-private">{t('site_demoNote')}</p>}
      headerActions={
        <button type="button" onClick={onReset} className={portalQuiet}>
          {t('site_reset')}
        </button>
      }
      items={items}
      panels={[]}
      onChange={onChange}
      onSave={onSave}
      onDiscard={onDiscard}
      busy={false}
      status={status}
      focusRequest={focus}
      footer={<RecentChanges />}
    />
  );
}
