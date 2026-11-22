'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  ADDRESS_LABELS,
  MAX_ACCOUNT_ITEMS,
  VEHICLE_FUELS,
  maxVehicleYear,
  normaliseRegistration,
} from '@mechdost/shared/account';
import type { MyProfile, SavedAddress, SavedVehicle } from '@mechdost/shared/account-api';
import { VEHICLE_ICON, VEHICLE_LABEL_KEY, VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import { updateProfile as updateBrowserProfile } from '@/demo/session';
import * as api from '@/lib/account-api';
import type { ApiResult } from '@/lib/orders-api';

// The map pin step loads MapLibre only when an address form opens (design 2026-11-15: home servicing).
const NotifyMe = lazy(() => import('./notify-me').then((m) => ({ default: m.NotifyMe })));
const SecurityCard = lazy(() => import('./security-card').then((m) => ({ default: m.SecurityCard })));
const AddressPinMap = lazy(() => import('./address-pin-map').then((m) => ({ default: m.AddressPinMap })));

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';
const field =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted';
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill';
const iconButton =
  'press inline-flex size-11 shrink-0 items-center justify-center rounded-button text-muted hover:bg-pill';

/**
 * Account → addresses, vehicles and profile on the API (real sign-in; design 2026-11-15, spec 01). The API holds the
 * only copy: every change is a request, the list shown is what the API answered, and a stale save (another device
 * changed it first) reloads the list and says so. One form at a time (calm UI); empty states offer one next action.
 */

type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T };

function useApiData<T>(fetcher: (locale: string) => Promise<ApiResult<T>>) {
  const locale = useLocale();
  const [loaded, setLoaded] = useState<Load<T>>({ state: 'loading' });
  const load = useCallback(async () => {
    const res = await fetcher(locale);
    setLoaded(res.ok ? { state: 'ready', data: res.data } : { state: 'error' });
  }, [fetcher, locale]);
  useEffect(() => {
    void load();
  }, [load]);
  return { loaded, reload: load };
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('accountApi');
  return (
    <div role="alert" className={card}>
      <p className="text-sm font-bold text-ink">{t('loadError')}</p>
      <button type="button" onClick={onRetry} className={`${quiet} mt-3`}>
        {t('retry')}
      </button>
    </div>
  );
}

const Skeleton = () => <div className="skeleton h-56 rounded-card" aria-hidden="true" />;

/** The message for a failed save; a stale save also reloads the list (the caller does that). */
function useSaveError() {
  const t = useTranslations('accountApi');
  return (code: string) => {
    if (code === 'UNKNOWN_PINCODE') return t('errUnknownPincode');
    if (code === 'LIMIT_REACHED') return t('errLimit', { max: MAX_ACCOUNT_ITEMS });
    if (code === 'DUPLICATE_REGISTRATION') return t('errDuplicateRegistration');
    if (code === 'STALE_VERSION' || code === 'STALE_PROFILE' || code === 'CONFLICT') return t('errStale');
    return t('errGeneric');
  };
}

const isStale = (code: string) => code === 'STALE_VERSION' || code === 'STALE_PROFILE' || code === 'CONFLICT';
const text = (data: FormData, k: string) => {
  const v = data.get(k);
  return typeof v === 'string' ? v.trim() : '';
};
/** `+919811100001` → `9811100001` (the form takes the national number). */
const national = (e164: string) => e164.replace(/^\+91/, '');

// ── Addresses ───────────────────────────────────────────────────────────────────────────────────────────────

export function AddressesApi({ defaults }: { defaults: { name: string; phone: string } }) {
  const t = useTranslations('account');
  const a = useTranslations('accountApi');
  const h = useTranslations('homeService');
  const { loaded, reload } = useApiData(api.fetchAddresses);
  const locale = useLocale();
  const saveError = useSaveError();
  // 'add' = the add form; an address id = that address's edit form; null = just the list.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  if (loaded.state === 'loading') return <Skeleton />;
  if (loaded.state === 'error') return <LoadFailed onRetry={() => void reload()} />;
  const list = loaded.data;
  const view = open === undefined ? (list.length === 0 ? 'add' : null) : open;
  const full = list.length >= MAX_ACCOUNT_ITEMS;

  async function after<T>(pending: Promise<ApiResult<T>>, ok: () => void) {
    const res = await pending;
    if (res.ok) {
      setError(null);
      ok();
      await reload();
      return true;
    }
    setError(saveError(res.code));
    if (isStale(res.code)) await reload();
    return false;
  }

  return (
    <section aria-labelledby="addresses-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="addresses-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_addresses')}
        </h2>
        {view === null && !full ? (
          <button
            type="button"
            data-track="account_address_add"
            data-disclosure-trigger="address-add"
            onClick={() => {
              setOpen('add');
            }}
            className={primary}
          >
            + {t('addAddress')}
          </button>
        ) : null}
      </div>
      {error && view === null ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      {list.length === 0 ? <p className="text-sm text-muted">{t('addressesEmpty')}</p> : null}
      <ul className="grid gap-3 tab:grid-cols-2">
        {list.map((addr) =>
          view === addr.id ? (
            <li key={addr.id} className="tab:col-span-2">
              <AddressForm
                title={t('editItem', { name: a(`label_${addr.label}`) })}
                initial={addr}
                defaults={defaults}
                error={error}
                onCancel={() => {
                  setOpen(null);
                  setError(null);
                }}
                onSave={(body) =>
                  after(api.updateAddress(locale, addr.id, addr.version, body), () => {
                    setOpen(null);
                  })
                }
              />
            </li>
          ) : (
            <li key={addr.id} className={card}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-heading font-extrabold text-ink">
                    <span aria-hidden="true">📍</span>
                    {a(`label_${addr.label}`)}
                    {addr.isDefaultShipping ? (
                      <span className="rounded-pill bg-success-bg px-2 py-0.5 text-[11px] font-extrabold text-success">
                        {t('default')}
                      </span>
                    ) : null}
                  </p>
                  <p data-user-content className="mt-1 text-sm font-bold break-words text-ink">
                    {addr.contactName} · {addr.contactPhone}
                  </p>
                  <p data-user-content className="text-sm break-words text-ink">
                    {[addr.line1, addr.line2].filter((x) => x !== null).join(', ')}
                  </p>
                  {addr.landmark ? (
                    <p data-user-content className="text-sm break-words text-muted">
                      {addr.landmark}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted">
                    {addr.cityName
                      ? a('place', { city: addr.cityName, state: addr.stateName, pincode: addr.pincode })
                      : a('placeNoCity', { state: addr.stateName, pincode: addr.pincode })}
                  </p>
                  {!addr.serviceable ? (
                    <>
                      <p className="mt-1 text-sm font-bold text-warning">{a('notServiceable')}</p>
                      <Suspense fallback={null}>
                        <NotifyMe pincode={addr.pincode} />
                      </Suspense>
                    </>
                  ) : null}
                  <p className="text-xs text-muted">
                    {addr.lat !== null && addr.lng !== null ? h('pinSet') : h('pinNone')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    data-disclosure-trigger={`address-${addr.id}`}
                    onClick={() => {
                      setError(null);
                      setOpen(addr.id);
                    }}
                    aria-label={t('editItem', { name: a(`label_${addr.label}`) })}
                    className={iconButton}
                  >
                    <Pencil aria-hidden="true" className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void after(api.removeAddress(locale, addr.id, addr.version), () => undefined);
                    }}
                    aria-label={t('remove', { name: a(`label_${addr.label}`) })}
                    className={iconButton}
                  >
                    <Trash2 aria-hidden="true" className="size-5" />
                  </button>
                </div>
              </div>
              {!addr.isDefaultShipping ? (
                <button
                  type="button"
                  onClick={() => {
                    void after(api.makeDefaultAddress(locale, addr.id, addr.version), () => undefined);
                  }}
                  className={`${quiet} mt-3`}
                >
                  {t('makeDefault')}
                </button>
              ) : null}
            </li>
          ),
        )}
      </ul>
      {view === 'add' ? (
        <AddressForm
          title={t('addAddress')}
          initial={null}
          defaults={defaults}
          error={error}
          onCancel={
            list.length > 0
              ? () => {
                  setOpen(null);
                  setError(null);
                }
              : null
          }
          onSave={(body) =>
            after(api.createAddress(locale, body), () => {
              setOpen(null);
            })
          }
        />
      ) : null}
    </section>
  );
}

interface AddressBody {
  label: SavedAddress['label'];
  contactName: string;
  contactPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  /** The map pin (both, or both null to remove it; omitted when there is none and never was). */
  lat?: number | null;
  lng?: number | null;
}

function AddressForm({
  title,
  initial,
  defaults,
  error,
  onSave,
  onCancel,
}: {
  title: string;
  initial: SavedAddress | null;
  defaults: { name: string; phone: string };
  error: string | null;
  onSave: (body: AddressBody) => Promise<boolean>;
  onCancel: (() => void) | null;
}) {
  const t = useTranslations('account');
  const a = useTranslations('accountApi');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    initial?.lat !== undefined && initial.lat !== null && initial.lng !== null
      ? { lat: initial.lat, lng: initial.lng }
      : null,
  );
  const idOf = (k: string) => `addr-${initial?.id ?? 'new'}-${k}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const label = ADDRESS_LABELS.find((l) => l === text(data, 'label')) ?? 'home';
    const phone = text(data, 'contactPhone').replace(/[\s-]/g, '');
    const body: AddressBody = {
      label,
      contactName: text(data, 'contactName'),
      contactPhone: `+91${phone}`,
      line1: text(data, 'line1'),
      line2: text(data, 'line2') || null,
      landmark: text(data, 'landmark') || null,
      pincode: text(data, 'pincode'),
      // A removed pin is sent as null/null; a new address without a pin simply has none.
      ...(pin
        ? { lat: Number(pin.lat.toFixed(6)), lng: Number(pin.lng.toFixed(6)) }
        : initial && initial.lat !== null
          ? { lat: null, lng: null }
          : {}),
    };
    if (
      body.contactName.length < 2 ||
      !/^[6-9]\d{9}$/.test(phone) ||
      body.line1.length < 5 ||
      !/^[1-9]\d{5}$/.test(body.pincode)
    ) {
      setLocalError(a('errAddress'));
      return;
    }
    setLocalError(null);
    setBusy(true);
    await onSave(body);
    setBusy(false);
  }

  const shown = localError ?? error;
  return (
    <form
      noValidate
      aria-labelledby={idOf('title')}
      onSubmit={(e) => void onSubmit(e)}
      className={`${card} space-y-4`}
    >
      <h3 id={idOf('title')} className="font-heading text-lg font-extrabold text-ink">
        {title}
      </h3>
      <div className="grid gap-4 tab:grid-cols-2">
        <div>
          <label htmlFor={idOf('label')} className="text-sm font-bold text-ink">
            {a('labelField')}
          </label>
          <select id={idOf('label')} name="label" defaultValue={initial?.label ?? 'home'} className={field}>
            {ADDRESS_LABELS.map((l) => (
              <option key={l} value={l}>
                {a(`label_${l}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={idOf('pincode')} className="text-sm font-bold text-ink">
            {t('pincode')}
          </label>
          <input
            id={idOf('pincode')}
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            defaultValue={initial?.pincode}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={idOf('contactName')} className="text-sm font-bold text-ink">
            {a('contactName')}
          </label>
          <input
            id={idOf('contactName')}
            name="contactName"
            autoComplete="name"
            maxLength={80}
            data-user-content
            defaultValue={initial?.contactName ?? defaults.name}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={idOf('contactPhone')} className="text-sm font-bold text-ink">
            {a('contactPhone')}
          </label>
          <input
            id={idOf('contactPhone')}
            name="contactPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            defaultValue={initial ? national(initial.contactPhone) : defaults.phone}
            className={field}
          />
        </div>
        <div className="tab:col-span-2">
          <label htmlFor={idOf('line1')} className="text-sm font-bold text-ink">
            {t('line1')}
          </label>
          <input
            id={idOf('line1')}
            name="line1"
            autoComplete="address-line1"
            maxLength={200}
            data-user-content
            defaultValue={initial?.line1}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={idOf('line2')} className="text-sm font-bold text-ink">
            {a('line2')}
          </label>
          <input
            id={idOf('line2')}
            name="line2"
            autoComplete="address-line2"
            maxLength={200}
            data-user-content
            defaultValue={initial?.line2 ?? ''}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={idOf('landmark')} className="text-sm font-bold text-ink">
            {t('landmark')}
          </label>
          <input
            id={idOf('landmark')}
            name="landmark"
            maxLength={100}
            data-user-content
            defaultValue={initial?.landmark ?? ''}
            className={field}
          />
        </div>
        <Suspense fallback={<div className="skeleton h-72 rounded-card tab:col-span-2" aria-hidden="true" />}>
          <AddressPinMap value={pin} onChange={setPin} />
        </Suspense>
      </div>
      {shown ? (
        <p role="alert" className="text-sm font-bold text-error">
          {shown}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={primary}>
          {t('save')}
        </button>
        {onCancel ? (
          <button
            type="button"
            data-panel-cancel={initial ? `address-${initial.id}` : 'address-add'}
            onClick={onCancel}
            className={quiet}
          >
            {t('cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── Vehicles ────────────────────────────────────────────────────────────────────────────────────────────────

interface VehicleBody {
  type: SavedVehicle['type'];
  fuel: SavedVehicle['fuel'];
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  registration: string | null;
  odometerKm: number | null;
}

export function VehiclesApi() {
  const t = useTranslations('account');
  const a = useTranslations('accountApi');
  const locale = useLocale();
  const { loaded, reload } = useApiData(api.fetchVehicles);
  const saveError = useSaveError();
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  if (loaded.state === 'loading') return <Skeleton />;
  if (loaded.state === 'error') return <LoadFailed onRetry={() => void reload()} />;
  const list = loaded.data;
  const view = open === undefined ? (list.length === 0 ? 'add' : null) : open;
  const full = list.length >= MAX_ACCOUNT_ITEMS;

  async function after<T>(pending: Promise<ApiResult<T>>, ok: () => void) {
    const res = await pending;
    if (res.ok) {
      setError(null);
      ok();
      await reload();
      return true;
    }
    setError(saveError(res.code));
    if (isStale(res.code)) await reload();
    return false;
  }

  return (
    <section aria-labelledby="vehicles-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="vehicles-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_vehicles')}
        </h2>
        {view === null && !full ? (
          <button
            type="button"
            data-track="account_vehicle_add"
            data-disclosure-trigger="vehicle-add"
            onClick={() => {
              setOpen('add');
            }}
            className={primary}
          >
            + {t('addVehicle')}
          </button>
        ) : null}
      </div>
      {error && view === null ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      {list.length === 0 ? <p className="text-sm text-muted">{t('vehiclesEmpty')}</p> : null}
      <ul className="grid gap-3 tab:grid-cols-2">
        {list.map((v) =>
          view === v.id ? (
            <li key={v.id} className="tab:col-span-2">
              <VehicleFormApi
                title={t('editVehicle')}
                initial={v}
                error={error}
                onCancel={() => {
                  setOpen(null);
                  setError(null);
                }}
                onSave={(body) =>
                  after(api.updateVehicle(locale, v.id, v.version, body), () => {
                    setOpen(null);
                  })
                }
              />
            </li>
          ) : (
            <li key={v.id} className={`${card} flex items-start justify-between gap-3`}>
              <div className="min-w-0">
                <p className="font-heading font-extrabold break-words text-ink">
                  <span aria-hidden="true">{VEHICLE_ICON[v.type]}</span>{' '}
                  <span data-user-content>
                    {[v.make, v.model, v.variant].filter((x) => x !== null).join(' ')}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  {[
                    v.year === null ? null : String(v.year),
                    a(`fuel_${v.fuel}`),
                    v.odometerKm === null ? null : t('odometer', { km: v.odometerKm }),
                  ]
                    .filter((x) => x !== null)
                    .join(' · ')}
                </p>
                {v.registration ? (
                  <p data-user-content className="text-sm font-bold text-ink">
                    {v.registration}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  data-disclosure-trigger={`vehicle-${v.id}`}
                  onClick={() => {
                    setError(null);
                    setOpen(v.id);
                  }}
                  aria-label={t('editItem', { name: `${v.make} ${v.model}` })}
                  className={iconButton}
                >
                  <Pencil aria-hidden="true" className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void after(api.removeVehicle(locale, v.id, v.version), () => undefined);
                  }}
                  aria-label={t('remove', { name: `${v.make} ${v.model}` })}
                  className={iconButton}
                >
                  <Trash2 aria-hidden="true" className="size-5" />
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      {view === 'add' ? (
        <VehicleFormApi
          title={t('addVehicle')}
          initial={null}
          error={error}
          onCancel={
            list.length > 0
              ? () => {
                  setOpen(null);
                  setError(null);
                }
              : null
          }
          onSave={(body) =>
            after(api.createVehicle(locale, body), () => {
              setOpen(null);
            })
          }
        />
      ) : null}
    </section>
  );
}

function VehicleFormApi({
  title,
  initial,
  error,
  onSave,
  onCancel,
}: {
  title: string;
  initial: SavedVehicle | null;
  error: string | null;
  onSave: (body: VehicleBody) => Promise<boolean>;
  onCancel: (() => void) | null;
}) {
  const t = useTranslations('account');
  const a = useTranslations('accountApi');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const newestYear = maxVehicleYear();
  const idOf = (k: string) => `veh-${initial?.id ?? 'new'}-${k}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const year = Number(text(data, 'year'));
    const odometer = text(data, 'odometer');
    const registration = text(data, 'registration');
    if (
      text(data, 'make').length < 2 ||
      text(data, 'model').length < 1 ||
      !(year >= 1980 && year <= newestYear)
    ) {
      setLocalError(a('errVehicle', { year: newestYear }));
      return;
    }
    if (registration !== '' && normaliseRegistration(registration) === null) {
      setLocalError(a('errRegistration'));
      return;
    }
    setLocalError(null);
    setBusy(true);
    await onSave({
      type: VEHICLE_TYPES.find((v) => v === text(data, 'type')) ?? '2W',
      fuel: VEHICLE_FUELS.find((f) => f === text(data, 'fuel')) ?? 'petrol',
      make: text(data, 'make'),
      model: text(data, 'model'),
      variant: text(data, 'variant') || null,
      year,
      registration: registration === '' ? null : registration,
      odometerKm: odometer === '' ? null : Math.max(0, Math.min(999_999, Math.floor(Number(odometer) || 0))),
    });
    setBusy(false);
  }

  const shown = localError ?? error;
  return (
    <form
      noValidate
      aria-labelledby={idOf('title')}
      onSubmit={(e) => void onSubmit(e)}
      className={`${card} space-y-4`}
    >
      <h3 id={idOf('title')} className="font-heading text-lg font-extrabold text-ink">
        {title}
      </h3>
      <fieldset>
        <legend className="text-sm font-bold text-ink">{t('vehicleType')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {VEHICLE_TYPES.map((type, i) => (
            <label
              key={type}
              className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text"
            >
              <input
                type="radio"
                name="type"
                value={type}
                defaultChecked={initial ? initial.type === type : i === 0}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {`${VEHICLE_ICON[type]} ${t(VEHICLE_LABEL_KEY[type])}`}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 tab:grid-cols-2">
        <div>
          <label htmlFor={idOf('make')} className="text-sm font-bold text-ink">
            {t('make')}
          </label>
          <input
            id={idOf('make')}
            name="make"
            maxLength={40}
            data-user-content
            defaultValue={initial?.make}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={idOf('model')} className="text-sm font-bold text-ink">
            {t('model')}
          </label>
          <input
            id={idOf('model')}
            name="model"
            maxLength={60}
            data-user-content
            defaultValue={initial?.model}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={idOf('variant')} className="text-sm font-bold text-ink">
            {a('variant')}
          </label>
          <input
            id={idOf('variant')}
            name="variant"
            maxLength={60}
            data-user-content
            defaultValue={initial?.variant ?? ''}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={idOf('year')} className="text-sm font-bold text-ink">
            {t('year')}
          </label>
          <input
            id={idOf('year')}
            name="year"
            inputMode="numeric"
            maxLength={4}
            defaultValue={initial?.year === null || initial === null ? undefined : String(initial.year)}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={idOf('fuel')} className="text-sm font-bold text-ink">
            {t('fuel')}
          </label>
          <select id={idOf('fuel')} name="fuel" defaultValue={initial?.fuel ?? 'petrol'} className={field}>
            {VEHICLE_FUELS.map((f) => (
              <option key={f} value={f}>
                {a(`fuel_${f}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={idOf('registration')} className="text-sm font-bold text-ink">
            {t('registration')}
          </label>
          <input
            id={idOf('registration')}
            name="registration"
            maxLength={16}
            placeholder={t('registrationHint')}
            defaultValue={initial?.registration ?? ''}
            className={`${field} uppercase`}
          />
        </div>
        <div>
          <label htmlFor={idOf('odometer')} className="text-sm font-bold text-ink">
            {t('odometerLabel')}
          </label>
          <input
            id={idOf('odometer')}
            name="odometer"
            inputMode="numeric"
            maxLength={7}
            defaultValue={
              initial?.odometerKm === null || initial === null ? undefined : String(initial.odometerKm)
            }
            className={field}
          />
        </div>
      </div>
      {shown ? (
        <p role="alert" className="text-sm font-bold text-error">
          {shown}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={primary}>
          {t('save')}
        </button>
        {onCancel ? (
          <button
            type="button"
            data-panel-cancel={initial ? `vehicle-${initial.id}` : 'vehicle-add'}
            onClick={onCancel}
            className={quiet}
          >
            {t('cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────────────────────────────────────

export function ProfileApi({ footer }: { footer: ReactNode }) {
  const t = useTranslations('account');
  const a = useTranslations('accountApi');
  const locale = useLocale();
  const { loaded, reload } = useApiData(api.fetchProfile);
  const saveError = useSaveError();
  const [status, setStatus] = useState<'idle' | 'saved' | { error: string }>('idle');
  const [busy, setBusy] = useState(false);

  if (loaded.state === 'loading') return <Skeleton />;
  if (loaded.state === 'error') return <LoadFailed onRetry={() => void reload()} />;
  const me: MyProfile = loaded.data;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = text(data, 'name').replace(/\s+/g, ' ');
    const language = text(data, 'language') === 'hi' ? 'hi' : 'en';
    if (name.length < 2 || name.length > 60) {
      setStatus({ error: a('errName') });
      return;
    }
    setBusy(true);
    const res = await api.saveProfile(locale, me.version, {
      ...(name === (me.name ?? '') ? {} : { name }),
      ...(language === me.language ? {} : { language }),
    });
    setBusy(false);
    if (!res.ok) {
      setStatus({ error: saveError(res.code) });
      if (isStale(res.code)) await reload();
      return;
    }
    // The name and language also live in the browser account the rest of the screens greet with.
    updateBrowserProfile({ name: res.data.name ?? name, language: res.data.language });
    setStatus('saved');
    await reload();
  }

  return (
    <section aria-labelledby="profile-title" className="space-y-4">
      <h2 id="profile-title" className="font-heading text-xl font-extrabold text-ink">
        {t('profileTitle')}
      </h2>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className={`${card} max-w-xl space-y-4`}>
        <div>
          <label htmlFor="profile-name" className="text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            id="profile-name"
            name="name"
            autoComplete="name"
            maxLength={60}
            data-user-content
            defaultValue={me.name ?? ''}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="profile-language" className="text-sm font-bold text-ink">
            {a('languageLabel')}
          </label>
          <select id="profile-language" name="language" defaultValue={me.language} className={field}>
            <option value="en">{a('language_en')}</option>
            <option value="hi">{a('language_hi')}</option>
          </select>
          <p className="mt-1 text-xs text-muted">{a('languageNote')}</p>
        </div>
        <div>
          <label htmlFor="profile-email" className="text-sm font-bold text-ink">
            {t('email')}
          </label>
          <input id="profile-email" readOnly value={me.email ?? ''} className={`${field} bg-surface-alt`} />
        </div>
        <div>
          <label htmlFor="profile-phone" className="text-sm font-bold text-ink">
            {t('phone')}
          </label>
          <input id="profile-phone" readOnly value={me.phone ?? ''} className={`${field} bg-surface-alt`} />
          <p className="mt-1 text-xs text-muted">{t('phoneNote')}</p>
        </div>
        <p
          role="status"
          className={`text-sm font-bold ${typeof status === 'object' ? 'text-error' : 'text-success'}`}
        >
          {status === 'saved' ? t('saved') : typeof status === 'object' ? status.error : ''}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={primary}>
            {t('save')}
          </button>
          {footer}
        </div>
      </form>
      <Suspense fallback={<Skeleton />}>
        <SecurityCard
          context={{
            ...(me.phone ? { phone: me.phone.replace(/\D/g, '') } : {}),
            ...(me.email ? { email: me.email } : {}),
            ...(me.name ? { name: me.name } : {}),
          }}
        />
      </Suspense>
    </section>
  );
}
