'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  AdminContentList,
  AdminContentSaved,
  AdminSettingList,
  OkTrue,
  SavedVersion,
  type AdminContentEntryDto,
  type AdminSettingRowDto,
} from '@mechdost/shared/admin-config-api';
import {
  CONTENT_KEYS,
  contentMax,
  isTrustKey,
  trustPlacementOf,
  TRUST_HIDDEN,
  type ContentKey,
  type TrustKey,
} from '@mechdost/shared/content';
import { SETTING_KEYS, isGlobalOnly, isSettingKey, type SettingKey } from '@mechdost/shared/settings';
import { adminApi } from '@/lib/admin-api';
import { contentField, contentStep } from '@/lib/admin-content-view';
import {
  fromInput,
  isNullable,
  settingBounds,
  settingUnit,
  toInput,
  type InputProblem,
} from '@/lib/admin-settings-view';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import type { ContentDefaults } from './admin-site';
import { CityPicker } from './admin-city-picker';
import { portalCard, portalPrimary, portalQuiet, portalField } from './portal-styles';

type SaveStatus = 'idle' | 'busy' | 'saved' | 'invalid' | CommonErrorKey;

/** Label per setting key (explicit literals keep next-intl's key checking). */
const SETTING_LABEL = {
  'checkout.cod_cap_paise': 'api_set_checkout_cod_cap_paise',
  'checkout.cod_fee_paise': 'api_set_checkout_cod_fee_paise',
  'checkout.free_delivery_min_paise': 'api_set_checkout_free_delivery_min_paise',
  'checkout.cod_reservation_minutes': 'api_set_checkout_cod_reservation_minutes',
  'checkout.online_payment_minutes': 'api_set_checkout_online_payment_minutes',
  'partners.default_shipping_paise': 'api_set_partners_default_shipping_paise',
  'partners.default_lead_days': 'api_set_partners_default_lead_days',
  'partners.invite_days': 'api_set_partners_invite_days',
  'partners.warning_threshold': 'api_set_partners_warning_threshold',
  'partners.warning_window_days': 'api_set_partners_warning_window_days',
  'partners.agreement_required': 'api_set_partners_agreement_required',
  'orders.customer_self_cancel_cod': 'api_set_orders_customer_self_cancel_cod',
  'orders.customer_self_cancel_online': 'api_set_orders_customer_self_cancel_online',
  'orders.acceptance_timeout_min': 'api_set_orders_acceptance_timeout_min',
  'orders.closed_shop_grace_min': 'api_set_orders_closed_shop_grace_min',
  'refunds.approval_sla_hours': 'api_set_refunds_approval_sla_hours',
  'notifications.retention_days': 'api_set_notifications_retention_days',
  'notifications.push_prompt_snooze_days': 'api_set_notifications_push_prompt_snooze_days',
  'notifications.promo_per_week': 'api_set_notifications_promo_per_week',
  'notifications.offer_expiry_reminder_min': 'api_set_notifications_offer_expiry_reminder_min',
  'quotes.min_units': 'api_set_quotes_min_units',
  'quotes.cod_cap_paise': 'api_set_quotes_cod_cap_paise',
  'catalogue.require_hindi_to_publish': 'api_set_catalogue_require_hindi_to_publish',
  'customers.require_verified_email': 'api_set_customers_require_verified_email',
  'support.customer_messages_per_ticket_per_day': 'api_set_support_customer_messages_per_ticket_per_day',
  'support.hours_start_minute': 'api_set_support_hours_start_minute',
  'support.hours_end_minute': 'api_set_support_hours_end_minute',
  'support.first_reply_working_minutes': 'api_set_support_first_reply_working_minutes',
  'support.auto_close_days': 'api_set_support_auto_close_days',
  'assistant.daily_messages': 'api_set_assistant_daily_messages',
  'coins.value_paise': 'coins_api_set_value_paise',
  'coins.max_redeem_bp': 'coins_api_set_max_redeem_bp',
  'coins.min_order_paise': 'coins_api_set_min_order_paise',
  'coins.earn_order_bp': 'coins_api_set_earn_order_bp',
  'coins.first_order_bonus': 'coins_api_set_first_order_bonus',
  'coins.workshop_booking_bonus': 'coins_api_set_workshop_booking_bonus',
  'coins.workshop_reward_min_bill_paise': 'coins_api_set_workshop_reward_min_bill_paise',
  'coins.workshop_reward_cooldown_days': 'coins_api_set_workshop_reward_cooldown_days',
  'coins.adjust_daily_cap': 'coins_api_set_adjust_daily_cap',
  'coins.unlock_days': 'coins_api_set_unlock_days',
  'coins.expiry_days': 'coins_api_set_expiry_days',
  'service.labour_promise_enabled': 'api_set_service_labour_promise_enabled',
  'service.labour_promise_days': 'api_set_service_labour_promise_days',
  'service.home_fee_max_paise': 'api_set_service_home_fee_max_paise',
  'service.photos_required': 'api_set_service_photos_required',
  'service.photos_public': 'api_set_service_photos_public',
  'service.photos_max_per_stage': 'api_set_service_photos_max_per_stage',
  'service.acceptance_timeout_min': 'api_set_service_acceptance_timeout_min',
  'catalogue.shop_photo_uploads': 'api_set_catalogue_shop_photo_uploads',
  'api.signed_in_per_minute': 'api_set_api_signed_in_per_minute',
  'api.guest_per_ip_per_minute': 'api_set_api_guest_per_ip_per_minute',
  'api.ip_flood_per_minute': 'api_set_api_ip_flood_per_minute',
} as const satisfies Record<SettingKey, string>;

const UNIT_LABEL = {
  rupees: 'api_set_unit_rupees',
  minutes: 'api_set_unit_minutes',
  days: 'api_set_unit_days',
  units: 'api_set_unit_units',
  count: 'api_set_unit_count',
  requests: 'api_set_unit_requests',
  bp: 'coins_api_unit_bp',
  coins: 'coins_api_unit_coins',
} as const;

const CONTENT_LABEL = {
  'announcement.orders': 'field_announcement_orders',
  'announcement.workshops': 'field_announcement_workshops',
  'hero.eyebrow': 'field_hero_eyebrow',
  'hero.titleLine1': 'field_hero_titleLine1',
  'hero.titleLine2': 'field_hero_titleLine2',
  'hero.lead': 'field_hero_lead',
} as const satisfies Record<Exclude<ContentKey, TrustKey>, string>;

const CONTENT_GROUPS: { id: 'announcement' | 'hero' | 'trust'; keys: ContentKey[] }[] = [
  { id: 'announcement', keys: ['announcement.orders', 'announcement.workshops'] },
  { id: 'hero', keys: ['hero.eyebrow', 'hero.titleLine1', 'hero.titleLine2', 'hero.lead'] },
  {
    id: 'trust',
    keys: [
      'trust.homeGenuine',
      'trust.homeBill',
      'trust.homeEstimates',
      'trust.product',
      'trust.checkout',
      'trust.emailFooter',
      'trust.workshop',
      'trust.partner',
    ],
  },
];

function StatusLine({ status }: { status: SaveStatus }) {
  const t = useTranslations('portal');
  if (status === 'idle') return <p role="status" className="text-sm font-bold" />;
  const text =
    status === 'busy'
      ? t('api_common_saving')
      : status === 'saved'
        ? t('site_saved')
        : status === 'invalid'
          ? t('site_invalid')
          : t(status);
  const tone = status === 'busy' ? 'text-muted' : status === 'saved' ? 'text-success' : 'text-error';
  return (
    <p role="status" className={`text-sm font-bold ${tone}`}>
      {text}
    </p>
  );
}

export function LoadState({ error, onRetry }: { error: CommonErrorKey | null; onRetry: () => void }) {
  const t = useTranslations('portal');
  return error ? (
    <div role="alert" className={`${portalCard} space-y-3`}>
      <p className="text-sm font-bold text-error">{t(error)}</p>
      <button type="button" className={portalQuiet} onClick={onRetry}>
        {t('api_common_retry')}
      </button>
    </div>
  ) : (
    <p role="status" className={`${portalCard} text-sm text-muted`}>
      {t('api_common_loading')}
    </p>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Admin → Settings on the API (spec 08; real sign-in builds). Every operational setting of the registry, with its
 * default; changes are saved as the global value, each with compare-and-set. City overrides stay on the API only.
 */
export function SettingsApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [rows, setRows] = useState<AdminSettingRowDto[] | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);
  // City code, '' = the all-cities values (design 2026-11-15 item 7).
  const [city, setCity] = useState('');

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/settings${city ? `?city=${city}` : ''}`, AdminSettingList);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setRows(res.data.settings);
  }, [locale, city]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  return (
    <section aria-labelledby="settings-title" className="space-y-4">
      <div>
        <h2 id="settings-title" className="font-heading text-xl font-extrabold text-ink">
          {t('settings_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('api_set_lead')}</p>
      </div>
      <CityPicker id="settings-city" value={city} onChange={setCity} />
      {rows ? (
        <SettingsForm key={city} city={city} rows={rows} onSaved={load} />
      ) : (
        <LoadState
          error={error}
          onRetry={() => {
            setError(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

/**
 * With a city chosen (design 2026-11-15 item 7) only the settings the system reads per city are listed; each shows
 * whether it is inherited from the all-cities value or overridden for this city, and an overridden one can be reset.
 */
function SettingsForm({
  city,
  rows,
  onSaved,
}: {
  city: string;
  rows: AdminSettingRowDto[];
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const c = useTranslations('adminTier2');
  const locale = useLocale();
  const num = (n: number) => new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(n);
  const known = rows.filter(
    (r): r is AdminSettingRowDto & { key: SettingKey } =>
      isSettingKey(r.key) && (!city || !isGlobalOnly(r.key)),
  );
  // What this scope holds now: the city's own value, else (city) the all-cities value, else the default.
  const scoped = (row: AdminSettingRowDto) =>
    city ? ((row.city ?? row.global)?.value ?? row.default) : (row.global?.value ?? row.default);
  const scopedVersion = (row: AdminSettingRowDto) => (city ? row.city?.version : row.global?.version) ?? null;
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(known.map((r) => [r.key, toInput(r.key, scoped(r))])),
  );
  const [errors, setErrors] = useState<Partial<Record<SettingKey, InputProblem>>>({});
  const [status, setStatus] = useState<SaveStatus>('idle');

  async function onReset(key: SettingKey, version: number) {
    setStatus('busy');
    const res = await adminApi(locale, `/admin/settings/${key}/clear`, OkTrue, {
      method: 'POST',
      body: { city, version },
    });
    if (!res.ok) setStatus(commonErrorKey(res.code));
    else {
      setStatus('saved');
      track('admin_site_change', { area: 'settings', action: 'reset', fields: 1 });
    }
    await onSaved();
  }

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextErrors: Partial<Record<SettingKey, InputProblem>> = {};
    const changes: { key: SettingKey; value: number | boolean | null; version: number | null }[] = [];
    for (const row of known) {
      const parsed = fromInput(row.key, draft[row.key] ?? '');
      if (!parsed.ok) {
        nextErrors[row.key] = parsed.problem;
        continue;
      }
      if (parsed.value !== scoped(row))
        changes.push({ key: row.key, value: parsed.value, version: scopedVersion(row) });
    }
    setErrors(nextErrors);
    const first = SETTING_KEYS.find((k) => nextErrors[k]);
    if (first) {
      setStatus('invalid');
      document.getElementById(`api-setting-${first}`)?.focus();
      return;
    }
    setStatus('busy');
    for (const change of changes) {
      const res = await adminApi(locale, `/admin/settings/${change.key}`, SavedVersion, {
        method: 'PUT',
        body: { city: city || null, value: change.value, version: change.version },
      });
      if (!res.ok) {
        setStatus(commonErrorKey(res.code));
        await onSaved();
        return;
      }
    }
    setStatus('saved');
    track('admin_site_change', { area: 'settings', action: 'save', fields: changes.length });
    await onSaved();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className={portalCard}
      noValidate
    >
      {city ? (
        <p role="note" className="mb-4 rounded-tile bg-pill px-4 py-3 text-sm text-ink">
          {c('set_cityNote')}
        </p>
      ) : null}
      <div className="grid gap-5 tab:grid-cols-2">
        {known.map((row) => {
          const key = row.key;
          const unit = settingUnit(key);
          const id = `api-setting-${key}`;
          const problem = errors[key];
          const bounds = settingBounds(key);
          const own = row.city;
          // Inherited or overridden for the chosen city; an override can be reset to the all-cities value.
          const origin = city ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={own ? 'font-bold text-ink' : 'text-muted'}>
                {own ? c('set_overridden') : c('set_inherited')}
              </span>
              {own ? (
                <button
                  type="button"
                  disabled={status === 'busy'}
                  onClick={() => {
                    void onReset(key, own.version);
                  }}
                  className={portalQuiet}
                >
                  {c('set_resetRow')}
                </button>
              ) : null}
            </p>
          ) : null;
          if (unit === 'switch')
            return (
              <div key={key}>
                <label className="flex items-start gap-3 text-sm text-ink">
                  <input
                    id={id}
                    type="checkbox"
                    checked={draft[key] === 'true'}
                    onChange={(e) => {
                      setStatus('idle');
                      setDraft((d) => ({ ...d, [key]: e.target.checked ? 'true' : 'false' }));
                    }}
                    className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
                  />
                  <span>
                    <span className="font-bold">{t(SETTING_LABEL[key])}</span>
                    <span className="block text-xs text-muted">
                      {t('api_set_default', { value: t(row.default === true ? 'notify_on' : 'notify_off') })}
                    </span>
                  </span>
                </label>
                {origin}
              </div>
            );
          return (
            <div key={key}>
              <label htmlFor={id} className="text-sm font-bold text-ink">
                {t(SETTING_LABEL[key])}
              </label>
              <div className="mt-1 flex items-center gap-2">
                {unit === 'rupees' ? (
                  <span aria-hidden="true" className="text-sm font-bold text-muted">
                    ₹
                  </span>
                ) : null}
                <input
                  id={id}
                  inputMode="numeric"
                  value={draft[key] ?? ''}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={`${id}-hint${problem ? ` ${id}-error` : ''}`}
                  onChange={(e) => {
                    setStatus('idle');
                    setDraft((d) => ({ ...d, [key]: e.target.value.replace(/\D/g, '') }));
                  }}
                  className="min-h-11 w-32 rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink"
                />
                {unit === 'rupees' ? null : <span className="text-sm text-muted">{t(UNIT_LABEL[unit])}</span>}
              </div>
              <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
                {bounds ? t('api_set_range', { min: num(bounds[0]), max: num(bounds[1]) }) : null}
                {' · '}
                {t('api_set_default', { value: toInput(key, row.default) || t('api_set_none') })}
                {isNullable(key) ? ` · ${t('api_set_emptyIsNone')}` : null}
              </p>
              {origin}
              {problem ? (
                <p id={`${id}-error`} className="mt-1 text-xs font-bold text-error">
                  {problem === 'guard'
                    ? t('coins_api_err_guard')
                    : bounds
                      ? t('settings_err', { min: num(bounds[0]), max: num(bounds[1]) })
                      : null}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="submit" disabled={status === 'busy'} className={portalPrimary}>
          {t('site_save')}
        </button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}

// ── Site content ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Admin → Site content on the API (spec 08; real sign-in builds). The live text per key and language: saving a
 * changed field writes its draft and publishes it; emptying a field takes the live text down (the default shows).
 */
export function ContentApi({ defaults }: { defaults: ContentDefaults }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [entries, setEntries] = useState<AdminContentEntryDto[] | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/content', AdminContentList);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setEntries(res.data.entries);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="content-title" className="space-y-4">
      <div>
        <h2 id="content-title" className="font-heading text-xl font-extrabold text-ink">
          {t('content_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('content_lead')}</p>
      </div>
      {entries ? (
        <ContentForm entries={entries} defaults={defaults} onSaved={load} />
      ) : (
        <LoadState
          error={error}
          onRetry={() => {
            setError(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

const draftKey = (key: string, lang: 'en' | 'hi') => `${key}|${lang}`;

function ContentForm({
  entries,
  defaults,
  onSaved,
}: {
  entries: AdminContentEntryDto[];
  defaults: ContentDefaults;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const tt = useTranslations('trust');
  const locale = useLocale();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      CONTENT_KEYS.flatMap((key) =>
        (['en', 'hi'] as const).map((lang) => [draftKey(key, lang), contentField(entries, key, lang).text]),
      ),
    ),
  );
  const [status, setStatus] = useState<SaveStatus>('idle');

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('busy');
    let fields = 0;
    for (const key of CONTENT_KEYS)
      for (const lang of ['en', 'hi'] as const) {
        const step = contentStep(contentField(entries, key, lang), draft[draftKey(key, lang)] ?? '');
        if (step.kind === 'none') continue;
        fields += 1;
        const path = `/admin/content/${key}/${lang}`;
        if (step.kind === 'unpublish') {
          const res = await adminApi(locale, `${path}/unpublish`, OkTrue, {
            method: 'POST',
            body: { city: null, version: step.version },
          });
          if (!res.ok) return fail(res.code);
          continue;
        }
        const saved = await adminApi(locale, path, AdminContentSaved, {
          method: 'PUT',
          body: { city: null, value: step.text, version: step.draftVersion },
        });
        if (!saved.ok) return fail(saved.code);
        const live = await adminApi(locale, `${path}/publish`, SavedVersion, {
          method: 'POST',
          body: { city: null, version: saved.data.version },
        });
        if (!live.ok) return fail(live.code);
      }
    setStatus('saved');
    track('admin_site_change', { area: 'content', action: 'save', fields });
    await onSaved();
  }

  async function fail(code: string) {
    setStatus(code === 'CONTENT_EMPTY' ? 'invalid' : commonErrorKey(code));
    await onSaved();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className={portalCard}
      noValidate
    >
      {CONTENT_GROUPS.map((group) => (
        <fieldset key={group.id} className="mt-2 first:mt-0">
          <legend className="font-heading text-lg font-extrabold text-ink">
            {group.id === 'trust' ? tt('group') : t(`content_group_${group.id}`)}
          </legend>
          {group.id === 'trust' ? <p className="mt-1 text-xs text-muted">{tt('hideHint')}</p> : null}
          <div className="mt-3 space-y-5">
            {group.keys.map((key) => {
              const max = contentMax(key);
              const long = max > 120;
              return (
                <div key={key} className="rounded-tile border border-line-card p-4">
                  <p className="text-sm font-bold text-ink">
                    {isTrustKey(key)
                      ? tt(`lineLabel_${trustPlacementOf(key) ?? 'product'}`)
                      : t(CONTENT_LABEL[key])}
                  </p>
                  <div className="mt-2 grid gap-3 tab:grid-cols-2">
                    {(['en', 'hi'] as const).map((lang) => {
                      const inputId = `api-content-${key.replace('.', '_')}-${lang}`;
                      const value = draft[draftKey(key, lang)] ?? '';
                      const common = {
                        id: inputId,
                        value,
                        maxLength: max,
                        lang,
                        placeholder: defaults[key][lang],
                        'aria-describedby': `${inputId}-hint`,
                        className: `${portalField} ${long ? 'min-h-24 py-2' : ''}`,
                      };
                      const set = (next: string) => {
                        setStatus('idle');
                        setDraft((d) => ({ ...d, [draftKey(key, lang)]: next }));
                      };
                      return (
                        <div key={lang}>
                          <label htmlFor={inputId} className="text-xs font-bold text-muted">
                            {t(`content_${lang}`)}
                          </label>
                          {long ? (
                            <textarea
                              {...common}
                              rows={3}
                              onChange={(e) => {
                                set(e.target.value);
                              }}
                            />
                          ) : (
                            <input
                              {...common}
                              onChange={(e) => {
                                set(e.target.value);
                              }}
                            />
                          )}
                          <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted">
                            {value.trim() === TRUST_HIDDEN && isTrustKey(key)
                              ? tt('hidden')
                              : value
                                ? t('content_count', { count: value.length, max })
                                : t('content_usingDefault')}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="submit" disabled={status === 'busy'} className={portalPrimary}>
          {t('api_content_publish')}
        </button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}
