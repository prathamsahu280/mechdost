'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdminSettingList,
  OkTrue,
  SavedVersion,
  type AdminSettingRowDto,
} from '@mechdost/shared/admin-config-api';
import { SETTING_KEYS, isGlobalOnly, isSettingKey, type SettingKey } from '@mechdost/shared/settings';
import { adminApi } from '@/lib/admin-api';
import { fromInput, isNullable, settingBounds, settingUnit, toInput } from '@/lib/admin-settings-view';
import { categoryOfKey, riskOfChange } from '@/lib/admin-settings-registry';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { CityPicker } from './admin-city-picker';
import { LoadState } from './admin-site-api';
import {
  ConfirmDialog,
  SettingsWorkbench,
  type SettingItem,
  type SettingsPanel,
  type SettingsStatus,
} from './admin-settings-workbench';
import { PortalNavLink } from './portal-nav-link';
import { portalQuiet } from './portal-styles';

/** Settings that are screens of their own (real sign-in only), shown inside their category. */
const CompanyApi = dynamic(() => import('./admin-company-api').then((m) => m.CompanyApi), {
  ssr: false,
  loading: () => <div className="skeleton h-64 rounded-card" aria-hidden="true" />,
});
const ServiceAreaApi = dynamic(() => import('./admin-pincodes-api').then((m) => m.ServiceAreaApi), {
  ssr: false,
  loading: () => <div className="skeleton h-64 rounded-card" aria-hidden="true" />,
});
const AdminDemandApi = dynamic(() => import('./admin-demand-api').then((m) => m.AdminDemandApi), {
  ssr: false,
  loading: () => <div className="skeleton h-48 rounded-card" aria-hidden="true" />,
});

/** Label per setting key (explicit literals keep next-intl's key checking). */
const SETTING_LABEL = {
  'checkout.cod_cap_paise': 'api_set_checkout_cod_cap_paise',
  'checkout.cod_everyone': 'api_set_checkout_cod_everyone',
  'checkout.cod_approved_customers': 'api_set_checkout_cod_approved_customers',
  'checkout.cod_ustaad_verified': 'api_set_checkout_cod_ustaad_verified',
  'checkout.cod_ustaad_min_level': 'api_set_checkout_cod_ustaad_min_level',
  'checkout.cod_min_order_paise': 'api_set_checkout_cod_min_order_paise',
  'checkout.cod_min_items': 'api_set_checkout_cod_min_items',
  'checkout.cod_request_reapply_days': 'api_set_checkout_cod_request_reapply_days',
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
  'notifications.info_clear_days': 'api_set_notifications_info_clear_days',
  'notifications.push_prompt_snooze_days': 'api_set_notifications_push_prompt_snooze_days',
  'notifications.promo_per_week': 'api_set_notifications_promo_per_week',
  'notifications.offer_expiry_reminder_min': 'api_set_notifications_offer_expiry_reminder_min',
  'quotes.min_units': 'api_set_quotes_min_units',
  'quotes.cod_cap_paise': 'api_set_quotes_cod_cap_paise',
  'catalogue.require_hindi_to_publish': 'api_set_catalogue_require_hindi_to_publish',
  'customers.require_verified_email': 'api_set_customers_require_verified_email',
  'customers.savings_enabled': 'api_set_customers_savings_enabled',
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

/** One-line help per setting key (messages in `adminSettings`; explicit literals keep next-intl's key checking). */
const SETTING_HELP = {
  'checkout.cod_cap_paise': 'help_checkout_cod_cap_paise',
  'checkout.cod_everyone': 'help_checkout_cod_everyone',
  'checkout.cod_approved_customers': 'help_checkout_cod_approved_customers',
  'checkout.cod_ustaad_verified': 'help_checkout_cod_ustaad_verified',
  'checkout.cod_ustaad_min_level': 'help_checkout_cod_ustaad_min_level',
  'checkout.cod_min_order_paise': 'help_checkout_cod_min_order_paise',
  'checkout.cod_min_items': 'help_checkout_cod_min_items',
  'checkout.cod_request_reapply_days': 'help_checkout_cod_request_reapply_days',
  'checkout.cod_fee_paise': 'help_checkout_cod_fee_paise',
  'checkout.free_delivery_min_paise': 'help_checkout_free_delivery_min_paise',
  'checkout.cod_reservation_minutes': 'help_checkout_cod_reservation_minutes',
  'checkout.online_payment_minutes': 'help_checkout_online_payment_minutes',
  'partners.default_shipping_paise': 'help_partners_default_shipping_paise',
  'partners.default_lead_days': 'help_partners_default_lead_days',
  'partners.invite_days': 'help_partners_invite_days',
  'partners.warning_threshold': 'help_partners_warning_threshold',
  'partners.warning_window_days': 'help_partners_warning_window_days',
  'partners.agreement_required': 'help_partners_agreement_required',
  'orders.customer_self_cancel_cod': 'help_orders_customer_self_cancel_cod',
  'orders.customer_self_cancel_online': 'help_orders_customer_self_cancel_online',
  'orders.acceptance_timeout_min': 'help_orders_acceptance_timeout_min',
  'orders.closed_shop_grace_min': 'help_orders_closed_shop_grace_min',
  'refunds.approval_sla_hours': 'help_refunds_approval_sla_hours',
  'notifications.retention_days': 'help_notifications_retention_days',
  'notifications.info_clear_days': 'help_notifications_info_clear_days',
  'notifications.push_prompt_snooze_days': 'help_notifications_push_prompt_snooze_days',
  'notifications.promo_per_week': 'help_notifications_promo_per_week',
  'notifications.offer_expiry_reminder_min': 'help_notifications_offer_expiry_reminder_min',
  'quotes.min_units': 'help_quotes_min_units',
  'quotes.cod_cap_paise': 'help_quotes_cod_cap_paise',
  'catalogue.require_hindi_to_publish': 'help_catalogue_require_hindi_to_publish',
  'customers.require_verified_email': 'help_customers_require_verified_email',
  'customers.savings_enabled': 'help_customers_savings_enabled',
  'support.customer_messages_per_ticket_per_day': 'help_support_customer_messages_per_ticket_per_day',
  'support.hours_start_minute': 'help_support_hours_start_minute',
  'support.hours_end_minute': 'help_support_hours_end_minute',
  'support.first_reply_working_minutes': 'help_support_first_reply_working_minutes',
  'support.auto_close_days': 'help_support_auto_close_days',
  'assistant.daily_messages': 'help_assistant_daily_messages',
  'coins.value_paise': 'help_coins_value_paise',
  'coins.max_redeem_bp': 'help_coins_max_redeem_bp',
  'coins.min_order_paise': 'help_coins_min_order_paise',
  'coins.earn_order_bp': 'help_coins_earn_order_bp',
  'coins.first_order_bonus': 'help_coins_first_order_bonus',
  'coins.workshop_booking_bonus': 'help_coins_workshop_booking_bonus',
  'coins.workshop_reward_min_bill_paise': 'help_coins_workshop_reward_min_bill_paise',
  'coins.workshop_reward_cooldown_days': 'help_coins_workshop_reward_cooldown_days',
  'coins.adjust_daily_cap': 'help_coins_adjust_daily_cap',
  'coins.unlock_days': 'help_coins_unlock_days',
  'coins.expiry_days': 'help_coins_expiry_days',
  'service.labour_promise_enabled': 'help_service_labour_promise_enabled',
  'service.labour_promise_days': 'help_service_labour_promise_days',
  'service.home_fee_max_paise': 'help_service_home_fee_max_paise',
  'service.photos_required': 'help_service_photos_required',
  'service.photos_public': 'help_service_photos_public',
  'service.photos_max_per_stage': 'help_service_photos_max_per_stage',
  'service.acceptance_timeout_min': 'help_service_acceptance_timeout_min',
  'catalogue.shop_photo_uploads': 'help_catalogue_shop_photo_uploads',
  'api.signed_in_per_minute': 'help_api_signed_in_per_minute',
  'api.guest_per_ip_per_minute': 'help_api_guest_per_ip_per_minute',
  'api.ip_flood_per_minute': 'help_api_ip_flood_per_minute',
} as const satisfies Record<SettingKey, string>;

type KnownRow = AdminSettingRowDto & { key: SettingKey };

/** What this scope holds now: the city's own value, else (city) the all-cities value, else the default. */
const scoped = (row: AdminSettingRowDto, city: string) =>
  city ? ((row.city ?? row.global)?.value ?? row.default) : (row.global?.value ?? row.default);
const scopedVersion = (row: AdminSettingRowDto, city: string) =>
  (city ? row.city?.version : row.global?.version) ?? null;

/** With a city chosen only the settings the system reads per city are listed. */
const knownRows = (rows: readonly AdminSettingRowDto[], city: string): KnownRow[] =>
  rows.filter((r): r is KnownRow => isSettingKey(r.key) && (!city || !isGlobalOnly(r.key)));

/**
 * Admin → Settings on the API (spec 08; real sign-in builds). Every operational setting of the registry in its
 * category, with its default; changes are saved as the global value (or the chosen city's), each with
 * compare-and-set. With a city chosen (design 2026-11-15 item 7) only the settings read per city are listed; each
 * shows whether it is inherited from the all-cities value or overridden for this city, and an overridden one can be
 * reset. The screen around the rows is `SettingsWorkbench`; the calls and checks here are unchanged.
 */
export function SettingsApi() {
  const t = useTranslations('portal');
  const a = useTranslations('adminSettings');
  const c = useTranslations('adminTier2');
  const locale = useLocale();
  const num = (n: number) => new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(n);
  const [rows, setRows] = useState<AdminSettingRowDto[] | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);
  // City code, '' = the all-cities values.
  const [city, setCity] = useState('');
  const [pendingCity, setPendingCity] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const loaded = useRef<{ city: string; rows: AdminSettingRowDto[] } | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/settings${city ? `?city=${city}` : ''}`, AdminSettingList);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    const before = loaded.current?.city === city ? loaded.current.rows : null;
    loaded.current = { city, rows: res.data.settings };
    setRows(res.data.settings);
    // An edit the person has not saved stays; every other field follows the server.
    setDraft((d) => {
      const next: Record<string, string> = {};
      for (const row of knownRows(res.data.settings, city)) {
        const old = before?.find((r) => r.key === row.key);
        const mine = d[row.key];
        const wasUntouched = old !== undefined && mine === toInput(row.key, scoped(old, city));
        next[row.key] = mine === undefined || wasUntouched ? toInput(row.key, scoped(row, city)) : mine;
      }
      return next;
    });
  }, [locale, city]);

  useEffect(() => {
    loaded.current = null;
    setRows(null);
    setDraft({});
    setStatus(null);
    void load();
  }, [load]);

  const known = rows ? knownRows(rows, city) : [];
  const dirtyCount = known.filter((r) => draft[r.key] !== toInput(r.key, scoped(r, city))).length;

  async function onReset(key: SettingKey, version: number) {
    setBusy(true);
    const res = await adminApi(locale, `/admin/settings/${key}/clear`, OkTrue, {
      method: 'POST',
      body: { city, version },
    });
    if (!res.ok) setStatus({ tone: 'error', text: t(commonErrorKey(res.code)) });
    else {
      setStatus({ tone: 'ok', text: t('site_saved') });
      track('admin_site_change', { area: 'settings', action: 'reset', fields: 1 });
    }
    await load();
    setBusy(false);
  }

  const parse = (row: KnownRow) => fromInput(row.key, draft[row.key] ?? '');

  async function onSave() {
    const bad = SETTING_KEYS.find((k) => known.some((r) => r.key === k && !parse(r).ok));
    if (bad) {
      setStatus({ tone: 'error', text: t('site_invalid') });
      setFocus({ id: `api-setting-${bad}`, n: (focus?.n ?? 0) + 1 });
      return;
    }
    const changes: { key: SettingKey; value: number | boolean | null; version: number | null }[] = [];
    for (const row of known) {
      const parsed = parse(row);
      if (parsed.ok && parsed.value !== scoped(row, city))
        changes.push({ key: row.key, value: parsed.value, version: scopedVersion(row, city) });
    }
    setBusy(true);
    setStatus(null);
    for (const change of changes) {
      const res = await adminApi(locale, `/admin/settings/${change.key}`, SavedVersion, {
        method: 'PUT',
        body: { city: city || null, value: change.value, version: change.version },
      });
      if (!res.ok) {
        setStatus({ tone: 'error', text: t(commonErrorKey(res.code)) });
        await load();
        setBusy(false);
        return;
      }
    }
    setStatus({ tone: 'ok', text: t('site_saved') });
    track('admin_site_change', { area: 'settings', action: 'save', fields: changes.length });
    await load();
    setBusy(false);
  }

  function onDiscard() {
    setStatus(null);
    setDraft(Object.fromEntries(known.map((r) => [r.key, toInput(r.key, scoped(r, city))])));
  }

  const items: SettingItem[] = known.map((row) => {
    const key = row.key;
    const unit = settingUnit(key);
    const bounds = settingBounds(key);
    const value = draft[key] ?? toInput(key, scoped(row, city));
    const saved = toInput(key, scoped(row, city));
    const parsed = parse(row);
    const dirty = value !== saved;
    const own = row.city;
    const defaultText =
      unit === 'switch'
        ? t(row.default === true ? 'notify_on' : 'notify_off')
        : toInput(key, row.default) || t('api_set_none');
    const hint = [
      bounds ? t('api_set_range', { min: num(bounds[0]), max: num(bounds[1]) }) : null,
      t('api_set_default', { value: defaultText }),
      isNullable(key) ? t('api_set_emptyIsNone') : null,
    ]
      .filter(Boolean)
      .join(' · ');
    let error: string | undefined;
    if (dirty && !parsed.ok)
      error =
        parsed.problem === 'guard'
          ? t('coins_api_err_guard')
          : bounds
            ? t('settings_err', { min: num(bounds[0]), max: num(bounds[1]) })
            : t('site_invalid');
    return {
      id: `api-setting-${key}`,
      category: categoryOfKey(key),
      label: t(SETTING_LABEL[key]),
      help: a(SETTING_HELP[key]),
      kind: unit === 'switch' ? 'switch' : 'number',
      prefix: unit === 'rupees' ? '₹' : undefined,
      unit: unit === 'rupees' || unit === 'switch' ? undefined : t(UNIT_LABEL[unit]),
      value,
      saved,
      placeholder: isNullable(key) ? t('api_set_none') : undefined,
      hint,
      error,
      badges: city
        ? undefined
        : [
            a(isGlobalOnly(key) ? 'badge_global' : 'badge_perCity'),
            a(row.global ? 'badge_custom' : 'badge_default'),
          ],
      extra: city ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className={own ? 'font-bold text-ink' : 'text-muted'}>
            {own ? c('set_overridden') : c('set_inherited')}
          </span>
          {own ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void onReset(key, own.version);
              }}
              className={portalQuiet}
            >
              {c('set_resetRow')}
            </button>
          ) : null}
        </p>
      ) : undefined,
      risk: parsed.ok ? riskOfChange(key, scoped(row, city), parsed.value) : null,
    };
  });

  const panels: SettingsPanel[] = [
    {
      id: 'company',
      category: 'store',
      title: a('panel_company'),
      help: a('panel_company_help'),
      node: <CompanyApi />,
    },
    {
      id: 'area',
      category: 'area',
      title: a('panel_area'),
      help: a('panel_area_help'),
      node: <ServiceAreaApi />,
    },
    {
      id: 'demand',
      category: 'area',
      title: a('panel_demand'),
      help: a('panel_demand_help'),
      node: <AdminDemandApi />,
    },
  ];

  return (
    <>
      <SettingsWorkbench
        title={t('settings_title')}
        lead={t('api_set_lead')}
        toolbar={
          <>
            <CityPicker
              id="settings-city"
              value={city}
              onChange={(code) => {
                if (dirtyCount > 0) setPendingCity(code);
                else setCity(code);
              }}
            />
            {city ? (
              <p role="note" className="rounded-tile bg-pill px-4 py-3 text-sm text-ink">
                {c('set_cityNote')}
              </p>
            ) : null}
          </>
        }
        items={items}
        panels={panels}
        placeholder={
          rows ? null : (
            <LoadState
              error={error}
              onRetry={() => {
                setError(null);
                void load();
              }}
            />
          )
        }
        onChange={(id, value) => {
          setStatus(null);
          setDraft((d) => ({ ...d, [id.replace('api-setting-', '')]: value }));
        }}
        onSave={() => {
          void onSave();
        }}
        onDiscard={onDiscard}
        busy={busy}
        status={status}
        focusRequest={focus}
        footer={
          <PortalNavLink
            href={`${locale === 'hi' ? '/hi' : ''}/admin/audit`}
            className="inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
          >
            {a('link_audit')}
          </PortalNavLink>
        }
      />
      <ConfirmDialog
        open={pendingCity !== null}
        title={a('city_discard_title')}
        lead={a('city_discard_lead')}
        confirmLabel={a('city_discard_confirm')}
        backLabel={a('city_discard_back')}
        onCancel={() => {
          setPendingCity(null);
        }}
        onConfirm={() => {
          if (pendingCity !== null) setCity(pendingCity);
          setPendingCity(null);
        }}
      />
    </>
  );
}
