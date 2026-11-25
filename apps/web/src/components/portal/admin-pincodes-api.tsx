'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { PINCODE_INACTIVE_REASONS, PINCODE_NOTE_MAX, type PincodeInactiveReason } from '@mechdost/shared/geo';
import { AdminPincodeList, PincodeSaved, type AdminPincodeDto } from '@mechdost/shared/geo-api';
import { adminApi } from '@/lib/admin-api';
import {
  EMPTY_PINCODE_FORM,
  filterPincodes,
  formFromRow,
  pincodeAddBody,
  pincodeEditBody,
  type PincodeField,
  type PincodeForm,
} from '@/lib/admin-pincodes-view';
import { commonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { StatusBadge, adminCard } from './admin-ui';

/**
 * Admin → Settings → Service area on the API (spec 15 "PIN codes", spec 08; real sign-in builds only, loaded with
 * `next/dynamic`). A city's PIN codes with area names, coverage and the free-delivery rule; add a PIN, edit it,
 * switch it off with a reason code or back on. An inactive PIN is refused at checkout and in the workshop search.
 */
type Status = { tone: 'ok' | 'error' | 'muted'; text: string } | null;

const FIELD_ERROR = {
  pincode: 'geo_api_err_pincode',
  lat: 'geo_api_err_lat',
  lng: 'geo_api_err_lng',
  areaEn: 'geo_api_err_areaEn',
  areaHi: 'geo_api_err_areaHi',
  freeDelivery: 'geo_api_err_freeDelivery',
} as const satisfies Record<PincodeField, string>;

const REASON_LABEL = {
  outside_service_area: 'geo_api_reason_outside_service_area',
  not_launched_yet: 'geo_api_reason_not_launched_yet',
  no_partners: 'geo_api_reason_no_partners',
  operational_pause: 'geo_api_reason_operational_pause',
  other: 'geo_api_reason_other',
} as const satisfies Record<PincodeInactiveReason, string>;

/** API error code → this screen's message key (field codes first; the shared ones otherwise). */
const OWN_ERROR: Partial<
  Record<
    string,
    | 'geo_api_err_exists'
    | 'geo_api_err_far'
    | 'geo_api_err_noCentroid'
    | 'geo_api_err_areaHi'
    | 'geo_api_err_pincode'
    | 'geo_api_err_lat'
  >
> = {
  PINCODE_EXISTS: 'geo_api_err_exists',
  PINCODE_FAR_FROM_CITY: 'geo_api_err_far',
  PINCODE_OUTSIDE_INDIA: 'geo_api_err_lat',
  PINCODE_NO_CENTROID: 'geo_api_err_noCentroid',
  PINCODE_AREA: 'geo_api_err_areaHi',
  PINCODE_INVALID: 'geo_api_err_pincode',
};

function useErrorText() {
  const t = useTranslations('portal');
  return useCallback((code: string) => t(OWN_ERROR[code] ?? commonErrorKey(code)), [t]);
}

function StatusLine({ status }: { status: Status }) {
  const tone =
    status?.tone === 'ok' ? 'text-success' : status?.tone === 'error' ? 'text-error' : 'text-muted';
  return (
    <p role="status" className={`text-sm font-bold ${tone}`}>
      {status?.text ?? ''}
    </p>
  );
}

export function ServiceAreaApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [cityInput, setCityInput] = useState('RPR');
  const [city, setCity] = useState('RPR');
  const [data, setData] = useState<{ name: string; rows: AdminPincodeDto[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<{ pincode: string; mode: 'edit' | 'off' } | 'add' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/pincodes?city=${encodeURIComponent(city)}`, AdminPincodeList);
    if (!res.ok) {
      setData(null);
      setLoadError(errorText(res.code));
      return;
    }
    setLoadError(null);
    const name = locale === 'hi' ? (res.data.city.nameHi ?? res.data.city.name) : res.data.city.name;
    setData({ name, rows: res.data.pincodes });
  }, [locale, city, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (text: string) => {
    setOpen(null);
    setStatus({ tone: 'ok', text });
    await load();
  };

  const rows = data ? filterPincodes(data.rows, query) : [];
  const active = data ? data.rows.filter((r) => r.active).length : 0;

  return (
    <section aria-labelledby="service-area-title" className="space-y-4">
      <div>
        <h2 id="service-area-title" className="font-heading text-xl font-extrabold text-ink">
          {t('geo_api_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('geo_api_lead')}</p>
      </div>
      <div className={`${adminCard} space-y-4`}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setStatus(null);
            setCity(cityInput.trim().toUpperCase());
          }}
        >
          <div>
            <label htmlFor="service-area-city" className="text-xs font-bold text-ink">
              {t('geo_api_city')}
            </label>
            <input
              id="service-area-city"
              value={cityInput}
              onChange={(e) => {
                setCityInput(e.target.value);
              }}
              maxLength={3}
              autoCapitalize="characters"
              className={`${portalField} mt-1 block w-24 uppercase`}
            />
          </div>
          <button type="submit" className={portalQuiet}>
            {t('geo_api_show')}
          </button>
          <div className="min-w-48 flex-1">
            <label htmlFor="service-area-search" className="text-xs font-bold text-ink">
              {t('geo_api_search')}
            </label>
            <input
              id="service-area-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className={`${portalField} mt-1 block w-full`}
            />
          </div>
        </form>
        {data ? (
          <p className="text-sm font-bold text-ink">
            {t('geo_api_summary', { city: data.name, total: data.rows.length, active })}
          </p>
        ) : null}
        <StatusLine status={status} />
        {open === 'add' ? (
          <PincodeEditor
            city={city}
            row={null}
            onCancel={() => {
              setOpen(null);
            }}
            onDone={() => done(t('geo_api_saved'))}
          />
        ) : (
          <button
            data-disclosure-trigger="pin-add"
            type="button"
            className={portalPrimary}
            onClick={() => {
              setStatus(null);
              setOpen('add');
            }}
          >
            {t('geo_api_add')}
          </button>
        )}
      </div>
      {data === null ? (
        loadError ? (
          <div role="alert" className={`${adminCard} space-y-3`}>
            <p className="text-sm font-bold text-error">{loadError}</p>
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                setLoadError(null);
                void load();
              }}
            >
              {t('api_common_retry')}
            </button>
          </div>
        ) : (
          <p role="status" className={`${adminCard} text-sm text-muted`}>
            {t('api_common_loading')}
          </p>
        )
      ) : data.rows.length === 0 ? (
        <p className={`${adminCard} text-sm text-muted`}>{t('geo_api_empty')}</p>
      ) : rows.length === 0 ? (
        <p className={`${adminCard} text-sm text-muted`}>{t('geo_api_noMatch')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.pincode} className={adminCard}>
              <PincodeSummary row={row} />
              {open !== null && open !== 'add' && open.pincode === row.pincode ? (
                open.mode === 'edit' ? (
                  <PincodeEditor
                    city={city}
                    row={row}
                    onCancel={() => {
                      setOpen(null);
                    }}
                    onDone={() => done(t('geo_api_saved'))}
                  />
                ) : (
                  <SwitchOffForm
                    city={city}
                    row={row}
                    onCancel={() => {
                      setOpen(null);
                    }}
                    onDone={() => done(t('geo_api_saved'))}
                  />
                )
              ) : (
                <RowActions
                  city={city}
                  row={row}
                  onEdit={() => {
                    setStatus(null);
                    setOpen({ pincode: row.pincode, mode: 'edit' });
                  }}
                  onSwitchOff={() => {
                    setStatus(null);
                    setOpen({ pincode: row.pincode, mode: 'off' });
                  }}
                  onDone={() => done(t('geo_api_saved'))}
                  onError={(text) => {
                    setStatus({ tone: 'error', text });
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PincodeSummary({ row }: { row: AdminPincodeDto }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  // Hindi falls back to English only for rows without names yet (the reference data carries both).
  const area = locale === 'hi' ? (row.areaHi ?? row.areaEn) : row.areaEn;
  const free =
    row.freeDeliveryMinPaise === null
      ? t('geo_api_free_default')
      : row.freeDeliveryMinPaise === 0
        ? t('geo_api_free_always')
        : t('geo_api_free_from', { amount: formatPrice(row.freeDeliveryMinPaise) });
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-heading text-lg font-extrabold text-ink">
          {row.pincode}
          {area ? <span className="ml-2 text-sm font-bold text-muted">{area}</span> : null}
        </p>
        <p className="mt-1 text-xs text-muted">
          {t('geo_api_shops', { count: row.shopsCovering })} · {free}
        </p>
        {!row.active && row.inactiveNote ? (
          <p className="mt-1 text-xs text-muted" data-user-content>
            {row.inactiveNote}
          </p>
        ) : null}
      </div>
      {row.active ? (
        <StatusBadge tone="success">{t('geo_api_active')}</StatusBadge>
      ) : (
        <StatusBadge tone="danger">
          {t('geo_api_off', { reason: t(REASON_LABEL[row.inactiveReason ?? 'other']) })}
        </StatusBadge>
      )}
    </div>
  );
}

function RowActions({
  city,
  row,
  onEdit,
  onSwitchOff,
  onDone,
  onError,
}: {
  city: string;
  row: AdminPincodeDto;
  onEdit: () => void;
  onSwitchOff: () => void;
  onDone: () => Promise<void>;
  onError: (text: string) => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);

  async function switchOn() {
    setBusy(true);
    const res = await adminApi(locale, `/admin/pincodes/${row.pincode}/status`, PincodeSaved, {
      method: 'POST',
      body: { city, version: row.version, active: true },
    });
    setBusy(false);
    if (!res.ok) {
      onError(errorText(res.code));
      return;
    }
    track('admin_pincode_change', { action: 'activated' });
    await onDone();
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        data-disclosure-trigger={`pin-edit-${row.pincode}`}
        type="button"
        className={portalQuiet}
        onClick={onEdit}
      >
        {t('geo_api_edit')}
      </button>
      {row.active ? (
        <button
          data-disclosure-trigger={`pin-off-${row.pincode}`}
          type="button"
          className={portalQuiet}
          onClick={onSwitchOff}
        >
          {t('geo_api_switchOff')}
        </button>
      ) : (
        <button type="button" className={portalQuiet} disabled={busy} onClick={() => void switchOn()}>
          {t('geo_api_switchOn')}
        </button>
      )}
    </div>
  );
}

const FIELDS: { key: PincodeField; inputMode: 'numeric' | 'decimal' | 'text'; max: number }[] = [
  { key: 'pincode', inputMode: 'numeric', max: 6 },
  { key: 'areaEn', inputMode: 'text', max: 80 },
  { key: 'areaHi', inputMode: 'text', max: 80 },
  { key: 'lat', inputMode: 'decimal', max: 12 },
  { key: 'lng', inputMode: 'decimal', max: 12 },
  { key: 'freeDelivery', inputMode: 'decimal', max: 10 },
];

const LABEL = {
  pincode: 'geo_api_pincode',
  areaEn: 'geo_api_areaEn',
  areaHi: 'geo_api_areaHi',
  lat: 'geo_api_lat',
  lng: 'geo_api_lng',
  freeDelivery: 'geo_api_freeDelivery',
} as const satisfies Record<PincodeField, string>;

/** Add (row null) or edit one PIN code; edits send only the changed fields. */
function PincodeEditor({
  city,
  row,
  onCancel,
  onDone,
}: {
  city: string;
  row: AdminPincodeDto | null;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [form, setForm] = useState<PincodeForm>(() => (row ? formFromRow(row) : EMPTY_PINCODE_FORM));
  const [invalid, setInvalid] = useState<PincodeField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prefix = `pincode-${row?.pincode ?? 'new'}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const built = row ? pincodeEditBody(city, row, form) : pincodeAddBody(city, form);
    if (!built.ok) {
      setInvalid(built.field);
      document.getElementById(`${prefix}-${built.field}`)?.focus();
      return;
    }
    setInvalid(null);
    if (built.body === null) {
      setError(t('geo_api_nothing'));
      return;
    }
    setBusy(true);
    const res = row
      ? await adminApi(locale, `/admin/pincodes/${row.pincode}`, PincodeSaved, {
          method: 'PATCH',
          body: built.body,
        })
      : await adminApi(locale, '/admin/pincodes', PincodeSaved, { method: 'POST', body: built.body });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    track('admin_pincode_change', { action: row ? 'edited' : 'added' });
    await onDone();
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-3">
      <div className="grid gap-3 tab:grid-cols-2">
        {FIELDS.filter((f) => !(row && f.key === 'pincode')).map((f) => {
          const id = `${prefix}-${f.key}`;
          const bad = invalid === f.key;
          return (
            <div key={f.key}>
              <label htmlFor={id} className="text-xs font-bold text-ink">
                {t(LABEL[f.key])}
              </label>
              <input
                id={id}
                value={form[f.key]}
                inputMode={f.inputMode}
                maxLength={f.max}
                lang={f.key === 'areaHi' ? 'hi' : undefined}
                aria-invalid={bad ? true : undefined}
                aria-describedby={bad ? `${id}-error` : f.key === 'freeDelivery' ? `${id}-hint` : undefined}
                onChange={(e) => {
                  setForm((v) => ({ ...v, [f.key]: e.target.value }));
                }}
                className={`${portalField} mt-1 block w-full`}
              />
              {f.key === 'freeDelivery' ? (
                <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
                  {t('geo_api_freeHint')}
                </p>
              ) : null}
              {bad ? (
                <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-bold text-error">
                  {t(FIELD_ERROR[f.key])}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">{t('geo_api_coordsHint')}</p>
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('geo_api_save')}
        </button>
        <button
          data-panel-cancel={row ? `pin-edit-${row.pincode}` : 'pin-add'}
          type="button"
          onClick={onCancel}
          className={portalQuiet}
        >
          {t('geo_api_cancel')}
        </button>
      </div>
    </form>
  );
}

function SwitchOffForm({
  city,
  row,
  onCancel,
  onDone,
}: {
  city: string;
  row: AdminPincodeDto;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [reason, setReason] = useState<PincodeInactiveReason | ''>('');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `pincode-off-${row.pincode}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (reason === '') {
      setInvalid(true);
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setInvalid(false);
    setBusy(true);
    const res = await adminApi(locale, `/admin/pincodes/${row.pincode}/status`, PincodeSaved, {
      method: 'POST',
      body: { city, version: row.version, active: false, reason, note: note.trim() || null },
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    track('admin_pincode_change', { action: 'deactivated', reasonCode: reason });
    await onDone();
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-3">
      <div>
        <label htmlFor={`${id}-reason`} className="text-xs font-bold text-ink">
          {t('geo_api_reason')}
        </label>
        <select
          id={`${id}-reason`}
          value={reason}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${id}-reason-error` : undefined}
          onChange={(e) => {
            const v = e.target.value;
            setReason(PINCODE_INACTIVE_REASONS.find((r) => r === v) ?? '');
          }}
          className={`${portalField} mt-1 block w-full`}
        >
          <option value="">{t('geo_api_reasonChoose')}</option>
          {PINCODE_INACTIVE_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(REASON_LABEL[r])}
            </option>
          ))}
        </select>
        {invalid ? (
          <p id={`${id}-reason-error`} role="alert" className="mt-1 text-xs font-bold text-error">
            {t('geo_api_err_reason')}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="text-xs font-bold text-ink">
          {t('geo_api_note')}
        </label>
        <textarea
          id={`${id}-note`}
          rows={2}
          maxLength={PINCODE_NOTE_MAX}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          className={`${portalField} mt-1 block w-full py-2`}
        />
      </div>
      <p className="text-xs text-muted">{t('geo_api_offHint')}</p>
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('geo_api_confirmOff')}
        </button>
        <button
          data-panel-cancel={`pin-off-${row.pincode}`}
          type="button"
          onClick={onCancel}
          className={portalQuiet}
        >
          {t('geo_api_cancel')}
        </button>
      </div>
    </form>
  );
}
