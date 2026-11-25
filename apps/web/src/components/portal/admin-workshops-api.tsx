'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  AdminWorkshopListDto,
  WorkshopCreatedDto,
  WorkshopMemberAddedDto,
  WorkshopSavedDto,
  WorkshopStandingSavedDto,
  type AdminWorkshop,
} from '@mechdost/shared/service-api';
import { VEHICLE_TYPES, type VehicleType } from '@mechdost/shared/vehicles';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import {
  createBody,
  emptyMenuRow,
  emptyWorkshopForm,
  formFromWorkshop,
  memberPhone,
  updateBody,
  type FormErrors,
  type MenuRow,
  type WorkshopForm,
} from '@/lib/admin-workshop-form';
import { track } from '@/lib/analytics';
import { daysLabel } from '@/lib/service-views';
import { ApiListState } from './api-list-state';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { ServiceApiError } from './service-api-error';
import { StatusBadge, adminCard } from './admin-ui';

type Load =
  { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; workshops: AdminWorkshop[] };
type Open = { kind: 'none' } | { kind: 'create' } | { kind: 'edit'; id: string };
type TextKey = { [K in keyof WorkshopForm]: WorkshopForm[K] extends string ? K : never }[keyof WorkshopForm];
type RowTextKey = { [K in keyof MenuRow]: MenuRow[K] extends string ? K : never }[keyof MenuRow];

/** The city's workshops for the admin screens (shared by the workshop list and request routing). */
export function useAdminWorkshops() {
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const reload = useCallback(async () => {
    const res = await adminApi(locale, '/admin/workshops', AdminWorkshopListDto);
    setLoad(res.ok ? { kind: 'ok', workshops: res.data.workshops } : { kind: 'error', code: res.code });
  }, [locale]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { load, reload };
}

/**
 * Admin → Partners → Workshops on the API (spec 08, real sign-in; Stream E): every workshop in the staff member's
 * cities with its standing, listing state and Hindi gaps; add or edit one (English + Hindi texts, location, hours,
 * menu), publish and verify the location (approval rights), pause / suspend / reactivate with a reason (history
 * kept by the API) and give a signed-up person portal access by phone. One editor open at a time (calm UI).
 */
export function AdminWorkshopsApi() {
  const t = useTranslations('portal');
  const { load, reload } = useAdminWorkshops();
  const [open, setOpen] = useState<Open>({ kind: 'none' });
  const workshops = load.kind === 'ok' ? load.workshops : [];
  const saved = async () => {
    setOpen({ kind: 'none' });
    await reload();
  };

  return (
    <section aria-labelledby="ws-admin-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="ws-admin-title" className="font-heading text-lg font-extrabold text-ink">
            {t('ws_api_adminTitle')}
          </h3>
          <p className="text-sm text-muted">{t('ws_api_adminLead')}</p>
        </div>
        {open.kind === 'none' ? (
          <button
            data-disclosure-trigger="workshop-new"
            type="button"
            onClick={() => {
              setOpen({ kind: 'create' });
            }}
            className={portalPrimary}
          >
            {t('ws_api_add')}
          </button>
        ) : null}
      </div>
      {open.kind === 'create' ? (
        <WorkshopEditor
          original={null}
          onSaved={saved}
          onCancel={() => {
            setOpen({ kind: 'none' });
          }}
        />
      ) : null}
      <ApiListState
        loading={load.kind === 'loading'}
        error={load.kind === 'error' ? load.code : null}
        count={workshops.length}
        empty={t('ws_api_none')}
        onRetry={() => void reload()}
      />
      {workshops.length > 0 ? (
        <ul className="space-y-3">
          {workshops.map((w) => (
            <li key={w.id}>
              {open.kind === 'edit' && open.id === w.id ? (
                <WorkshopEditor
                  original={w}
                  onSaved={saved}
                  onCancel={() => {
                    setOpen({ kind: 'none' });
                  }}
                />
              ) : (
                <WorkshopRow
                  workshop={w}
                  onEdit={
                    open.kind === 'none'
                      ? () => {
                          setOpen({ kind: 'edit', id: w.id });
                        }
                      : null
                  }
                  onChanged={reload}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function WorkshopRow({
  workshop: w,
  onEdit,
  onChanged,
}: {
  workshop: AdminWorkshop;
  onEdit: (() => void) | null;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [panel, setPanel] = useState<'none' | 'standing' | 'member'>('none');
  return (
    <article className={adminCard}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-lg font-extrabold text-ink">
            {locale === 'hi' && w.nameHi ? w.nameHi : w.name}
          </p>
          <p className="text-sm text-muted">
            {locale === 'hi' && w.areaHi ? w.areaHi : w.area} · {w.pincode} · {w.vehicleTypes.join(' · ')} ·{' '}
            {daysLabel(w.hours.days, locale)} {w.hours.open}–{w.hours.close}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
            <StatusBadge as="li" code={w.status}>
              {t(`ws_api_status_${w.status}`)}
            </StatusBadge>
            <StatusBadge as="li" tone={w.published ? 'success' : 'muted'}>
              {w.published ? t('ws_api_published') : t('ws_api_unpublished')}
            </StatusBadge>
            <StatusBadge as="li" tone={w.locationVerified ? 'success' : 'warning'}>
              {w.locationVerified ? t('ws_api_locationVerified') : t('ws_api_locationUnverified')}
            </StatusBadge>
            {w.busy ? (
              <StatusBadge as="li" tone="warning">
                {t('ws_api_busy')}
              </StatusBadge>
            ) : null}
            <StatusBadge as="li" tone="neutral">
              {t('ws_api_menuCount', { count: w.menu.filter((m) => m.active).length })}
            </StatusBadge>
            {w.missingHindi.length > 0 ? (
              <StatusBadge as="li" tone="warning">
                {t('ws_api_missingHindi', { count: w.missingHindi.length })}
              </StatusBadge>
            ) : null}
          </ul>
          {w.statusReason && w.status !== 'approved' ? (
            <p className="mt-2 text-sm text-muted" data-user-content>
              {w.statusReason}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {onEdit ? (
          <button
            data-disclosure-trigger={`workshop-${w.id}`}
            type="button"
            onClick={onEdit}
            className={portalQuiet}
          >
            {t('ws_api_edit')}
          </button>
        ) : null}
        <button
          type="button"
          aria-expanded={panel === 'standing'}
          data-disclosure-trigger={`standing-${w.id}`}
          data-panel-cancel={panel === 'standing' ? `standing-${w.id}` : undefined}
          onClick={() => {
            setPanel(panel === 'standing' ? 'none' : 'standing');
          }}
          className={portalQuiet}
        >
          {t('ws_api_standing')}
        </button>
        <button
          type="button"
          aria-expanded={panel === 'member'}
          data-disclosure-trigger={`member-${w.id}`}
          data-panel-cancel={panel === 'member' ? `member-${w.id}` : undefined}
          onClick={() => {
            setPanel(panel === 'member' ? 'none' : 'member');
          }}
          className={portalQuiet}
        >
          {t('ws_api_addMember')}
        </button>
      </div>
      {panel === 'standing' ? (
        <div data-panel-for={`standing-${w.id}`}>
          <StandingForm
            workshop={w}
            onDone={async () => {
              setPanel('none');
              await onChanged();
            }}
          />
        </div>
      ) : null}
      {panel === 'member' ? (
        <div data-panel-for={`member-${w.id}`}>
          <MemberForm workshop={w} />
        </div>
      ) : null}
    </article>
  );
}

/** Pause, suspend or reactivate with a reason the partner sees (5–300 characters; history kept). */
function StandingForm({ workshop: w, onDone }: { workshop: AdminWorkshop; onDone: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const options = (['approved', 'paused', 'suspended'] as const).filter((s) => s !== w.status);
  const [status, setStatus] = useState<(typeof options)[number] | ''>('');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState<'status' | 'reason' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `ws-standing-${w.id}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!status) {
      setInvalid('status');
      document.getElementById(`${id}-status`)?.focus();
      return;
    }
    if (reason.trim().length < 5) {
      setInvalid('reason');
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/workshops/${w.id}/standing`, WorkshopStandingSavedDto, {
      method: 'POST',
      body: { status, reason: reason.trim(), version: w.version },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: `admin_workshop_${status}`, path: window.location.pathname });
    await onDone();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-3 space-y-2 border-t border-line pt-3"
    >
      <label htmlFor={`${id}-status`} className="text-xs font-bold text-muted">
        {t('ws_api_standingTo')}
      </label>
      <select
        id={`${id}-status`}
        value={status}
        aria-invalid={invalid === 'status' ? true : undefined}
        onChange={(e) => {
          setStatus(options.find((o) => o === e.target.value) ?? '');
          setInvalid(null);
        }}
        className={portalField}
      >
        <option value="">{t('ws_api_reasonChoose')}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {t(`ws_api_standingAction_${o}`)}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-reason`} className="text-xs font-bold text-muted">
        {t('ws_api_standingReason')}
      </label>
      <textarea
        id={`${id}-reason`}
        value={reason}
        maxLength={300}
        rows={2}
        aria-invalid={invalid === 'reason' ? true : undefined}
        onChange={(e) => {
          setReason(e.target.value);
          setInvalid(null);
        }}
        className={`${portalField} py-2`}
      />
      {invalid ? (
        <p className="text-xs font-bold text-error">
          {invalid === 'status' ? t('ws_api_reasonRequired') : t('ws_api_standingReasonShort')}
        </p>
      ) : null}
      {error ? <ServiceApiError code={error} /> : null}
      <button type="submit" disabled={busy} className={portalPrimary}>
        {t('ws_api_standingSave')}
      </button>
    </form>
  );
}

/** Give a person who already signed up (by phone) owner or staff access to this workshop's portal. */
function MemberForm({ workshop: w }: { workshop: AdminWorkshop }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'workshop_owner' | 'workshop_staff' | ''>('');
  const [invalid, setInvalid] = useState<'phone' | 'role' | null>(null);
  const [result, setResult] = useState<{ ok: true } | { ok: false; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `ws-member-${w.id}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const full = memberPhone(phone);
    if (!full) {
      setInvalid('phone');
      document.getElementById(`${id}-phone`)?.focus();
      return;
    }
    if (!role) {
      setInvalid('role');
      document.getElementById(`${id}-role`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/workshops/${w.id}/members`, WorkshopMemberAddedDto, {
      method: 'POST',
      body: { phone: full, role },
    });
    setBusy(false);
    setResult(res.ok ? { ok: true } : { ok: false, code: res.code });
    if (res.ok) {
      setPhone('');
      track('click', { id: 'admin_workshop_member_added', path: window.location.pathname });
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-3 grid gap-2 border-t border-line pt-3 tab:grid-cols-[1fr_1fr_auto] tab:items-end"
    >
      <div>
        <label htmlFor={`${id}-phone`} className="text-xs font-bold text-muted">
          {t('ws_api_memberPhone')}
        </label>
        <input
          id={`${id}-phone`}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          value={phone}
          maxLength={14}
          aria-invalid={invalid === 'phone' ? true : undefined}
          onChange={(e) => {
            setPhone(e.target.value);
            setInvalid(null);
            setResult(null);
          }}
          className={portalField}
        />
      </div>
      <div>
        <label htmlFor={`${id}-role`} className="text-xs font-bold text-muted">
          {t('ws_api_memberRole')}
        </label>
        <select
          id={`${id}-role`}
          value={role}
          aria-invalid={invalid === 'role' ? true : undefined}
          onChange={(e) => {
            const v = e.target.value;
            setRole(v === 'workshop_owner' || v === 'workshop_staff' ? v : '');
            setInvalid(null);
          }}
          className={portalField}
        >
          <option value="">{t('ws_api_reasonChoose')}</option>
          <option value="workshop_owner">{t('ws_api_memberRole_owner')}</option>
          <option value="workshop_staff">{t('ws_api_memberRole_staff')}</option>
        </select>
      </div>
      <button type="submit" disabled={busy} className={portalPrimary}>
        {t('ws_api_memberSave')}
      </button>
      {invalid ? (
        <p className="text-xs font-bold text-error tab:col-span-3">
          {invalid === 'phone' ? t('ws_api_memberPhoneInvalid') : t('ws_api_reasonRequired')}
        </p>
      ) : null}
      {result?.ok ? (
        <p role="status" className="text-sm font-bold text-success tab:col-span-3">
          {t('ws_api_memberAdded')}
        </p>
      ) : null}
      {result && !result.ok ? (
        <div className="tab:col-span-3">
          {result.code === 'NOT_FOUND' ? (
            <p role="alert" className="text-sm font-bold text-error">
              {t('ws_api_memberNotFound')}
            </p>
          ) : (
            <ServiceApiError code={result.code} />
          )}
        </div>
      ) : null}
    </form>
  );
}

const FIELD_ERROR_API: Record<string, string> = {
  SLUG_TAKEN: 'slug',
  PINCODE_NOT_SERVED: 'pincode',
  MENU_KEY_DUPLICATE: 'menu',
  FEE_ABOVE_CAP: 'homeVisitFee',
};

/** Add (original null) or edit a workshop with its menu. */
function WorkshopEditor({
  original,
  onSaved,
  onCancel,
}: {
  original: AdminWorkshop | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('portal');
  const h = useTranslations('homeService');
  const locale = useLocale();
  const [form, setForm] = useState<WorkshopForm>(() =>
    original ? formFromWorkshop(original) : emptyWorkshopForm(),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nothing, setNothing] = useState(false);
  const fid = (k: string) => `ws-${original?.id ?? 'new'}-${k.replace(/\./g, '-')}`;

  const set = <K extends keyof WorkshopForm>(k: K, v: WorkshopForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNothing(false);
  };
  const setRow = (i: number, change: Partial<MenuRow>) => {
    setForm((f) => ({ ...f, menu: f.menu.map((m, j) => (j === i ? { ...m, ...change } : m)) }));
  };

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setApiError(null);
    const built = original ? updateBody(original, form) : createBody(form);
    if (!built.ok) {
      setErrors(built.errors);
      const first = Object.keys(built.errors)[0];
      if (first) document.getElementById(fid(first))?.focus();
      return;
    }
    setErrors({});
    if (original && 'changed' in built && !built.changed) {
      setNothing(true);
      return;
    }
    setBusy(true);
    const res = original
      ? await adminApi(locale, `/admin/workshops/${original.id}`, WorkshopSavedDto, {
          method: 'PATCH',
          body: built.body,
        })
      : await adminApi(locale, '/admin/workshops', WorkshopCreatedDto, { method: 'POST', body: built.body });
    setBusy(false);
    if (!res.ok) {
      const field = FIELD_ERROR_API[res.code];
      if (field) {
        setErrors({ [field]: true });
        document.getElementById(fid(field))?.focus();
      }
      setApiError(res.code);
      return;
    }
    track('click', {
      id: original ? 'admin_workshop_saved' : 'admin_workshop_created',
      path: window.location.pathname,
    });
    await onSaved();
  }

  const bad = (k: string) => errors[k] === true;
  const text = (k: TextKey, label: string, extra: { hint?: string; max?: number } = {}) => (
    <Field id={fid(k)} label={label} invalid={bad(k)} hint={extra.hint} errorText={t('ws_api_fieldInvalid')}>
      <input
        id={fid(k)}
        value={form[k]}
        maxLength={extra.max ?? 200}
        aria-invalid={bad(k) ? true : undefined}
        onChange={(e) => {
          const v = e.target.value;
          setForm((f) => ({ ...f, [k]: v }));
          setNothing(false);
        }}
        className={portalField}
      />
    </Field>
  );
  const check = (
    k: 'evBasic' | 'pickup' | 'locationVerified' | 'published' | 'busy' | 'homeService',
    label: string,
  ) => (
    <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
      <input
        type="checkbox"
        checked={form[k]}
        onChange={(e) => {
          set(k, e.target.checked);
        }}
        className="size-5 shrink-0 accent-[var(--color-accent-button)]"
      />
      {label}
    </label>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className={`${adminCard} space-y-4 border-accent-button/50`}
    >
      <h4 className="font-heading text-lg font-extrabold text-ink">
        {original ? t('ws_api_editTitle') : t('ws_api_addTitle')}
      </h4>
      <div className="grid gap-3 tab:grid-cols-2">
        {original ? null : text('slug', t('ws_api_slug'), { hint: t('ws_api_slugHint'), max: 80 })}
        {text('name', t('ws_api_name'), { max: 80 })}
        {text('nameHi', t('ws_api_nameHi'), { max: 80 })}
        {text('addressLine', t('ws_api_address'))}
        {text('addressLineHi', t('ws_api_addressHi'))}
        {text('area', t('ws_api_area'), { max: 60 })}
        {text('areaHi', t('ws_api_areaHi'), { max: 60 })}
        {text('pincode', t('ws_api_pincode'), { max: 6 })}
        {text('phone', t('ws_api_phone'), { hint: t('ws_api_phoneHint'), max: 14 })}
        {text('lat', t('ws_api_lat'), { max: 20 })}
        {text('lng', t('ws_api_lng'), { hint: t('ws_api_latLngHint'), max: 20 })}
        {text('gstin', t('ws_api_gstin'), { hint: t('ws_api_gstinHint'), max: 15 })}
      </div>

      <fieldset id={fid('vehicleTypes')} tabIndex={-1} aria-invalid={bad('vehicleTypes') || undefined}>
        <legend className="text-xs font-bold text-muted">{t('ws_api_vehicleTypes')}</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {VEHICLE_TYPES.map((v) => (
            <label key={v} className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.vehicleTypes.includes(v)}
                onChange={(e) => {
                  set(
                    'vehicleTypes',
                    e.target.checked
                      ? [...form.vehicleTypes, v]
                      : form.vehicleTypes.filter((x: VehicleType) => x !== v),
                  );
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {v}
            </label>
          ))}
        </div>
        {bad('vehicleTypes') ? (
          <p className="text-xs font-bold text-error">{t('ws_api_fieldInvalid')}</p>
        ) : null}
      </fieldset>

      <fieldset id={fid('hours')} tabIndex={-1} aria-invalid={bad('hours') || undefined}>
        <legend className="text-xs font-bold text-muted">{t('ws_api_hours')}</legend>
        <div className="mt-1 grid grid-cols-2 gap-3 tab:max-w-sm">
          <div>
            <label htmlFor={fid('open')} className="text-xs text-muted">
              {t('ws_api_open')}
            </label>
            <input
              id={fid('open')}
              type="time"
              value={form.open}
              onChange={(e) => {
                set('open', e.target.value);
              }}
              className={portalField}
            />
          </div>
          <div>
            <label htmlFor={fid('close')} className="text-xs text-muted">
              {t('ws_api_close')}
            </label>
            <input
              id={fid('close')}
              type="time"
              value={form.close}
              onChange={(e) => {
                set('close', e.target.value);
              }}
              className={portalField}
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d} className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.days.includes(d)}
                onChange={(e) => {
                  set('days', e.target.checked ? [...form.days, d] : form.days.filter((x) => x !== d));
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {daysLabel([d], locale)}
            </label>
          ))}
        </div>
        {bad('hours') ? <p className="text-xs font-bold text-error">{t('ws_api_hoursInvalid')}</p> : null}
      </fieldset>

      <div className="grid gap-1 tab:grid-cols-2">
        {check('evBasic', t('ws_api_ev'))}
        {check('pickup', t('ws_api_pickup'))}
        {check('locationVerified', t('ws_api_verifyLocation'))}
        {check('published', t('ws_api_publish'))}
        {original ? check('busy', t('ws_api_busyToggle')) : null}
      </div>
      <p className="text-xs text-muted">{t('ws_api_approvalNote')}</p>

      {original ? (
        <fieldset className="space-y-2 rounded-lg border border-line-card p-3">
          <legend className="px-1 font-heading font-bold text-ink">{h('adminHomeTitle')}</legend>
          {check('homeService', h('settingsOn'))}
          <div className="grid gap-3 tab:grid-cols-2">
            {text('homeRadiusKm', h('radiusLabel'), { max: 2 })}
            {text('homeVisitFee', h('feeLabel'), { max: 7 })}
          </div>
        </fieldset>
      ) : null}

      <fieldset id={fid('menu')} tabIndex={-1}>
        <legend className="font-heading font-bold text-ink">{t('ws_api_menu')}</legend>
        {bad('menu') ? <p className="text-xs font-bold text-error">{t('ws_api_menuInvalid')}</p> : null}
        <ol className="mt-2 space-y-3">
          {form.menu.map((m, i) => {
            const p = (k: string) => `menu.${String(i)}.${k}`;
            const cell = (k: RowTextKey, label: string, max = 80, apiKey: string = k) => (
              <Field
                id={fid(p(apiKey))}
                label={label}
                invalid={bad(p(apiKey))}
                errorText={t('ws_api_fieldInvalid')}
              >
                <input
                  id={fid(p(apiKey))}
                  value={m[k]}
                  maxLength={max}
                  aria-invalid={bad(p(apiKey)) ? true : undefined}
                  onChange={(e) => {
                    setRow(i, { [k]: e.target.value });
                  }}
                  className={portalField}
                />
              </Field>
            );
            return (
              <li key={i} className="rounded-lg border border-line-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-extrabold text-ink">{t('lineN', { n: i + 1 })}</p>
                  <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={m.active}
                      onChange={(e) => {
                        setRow(i, { active: e.target.checked });
                      }}
                      className="size-5 accent-[var(--color-accent-button)]"
                    />
                    {t('ws_api_menuActive')}
                  </label>
                  {original ? (
                    <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={m.homeAvailable}
                        onChange={(e) => {
                          setRow(i, { homeAvailable: e.target.checked });
                        }}
                        className="size-5 accent-[var(--color-accent-button)]"
                      />
                      {h('adminHomeServices')}
                    </label>
                  ) : null}
                </div>
                <div className="grid gap-2 tab:grid-cols-2">
                  {cell('key', t('ws_api_menuKey'), 40)}
                  <div>
                    <label htmlFor={fid(p('vehicleType'))} className="text-xs font-bold text-muted">
                      {t('ws_api_menuVehicle')}
                    </label>
                    <select
                      id={fid(p('vehicleType'))}
                      value={m.vehicleType}
                      onChange={(e) => {
                        const v = VEHICLE_TYPES.find((x) => x === e.target.value);
                        setRow(i, { vehicleType: v ?? '' });
                      }}
                      className={portalField}
                    >
                      <option value="">{t('ws_api_menuVehicleAll')}</option>
                      {VEHICLE_TYPES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  {cell('title', t('ws_api_menuTitle'))}
                  {cell('titleHi', t('ws_api_menuTitleHi'))}
                  {cell('included', t('ws_api_menuIncluded'), 300)}
                  {cell('includedHi', t('ws_api_menuIncludedHi'), 300)}
                  {cell('low', t('ws_api_menuLow'), 8, 'lowPaise')}
                  {cell('high', t('ws_api_menuHigh'), 8, 'highPaise')}
                  {cell('minMinutes', t('ws_api_menuMinMinutes'), 5)}
                  {cell('maxMinutes', t('ws_api_menuMaxMinutes'), 5)}
                </div>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={() => {
            setForm((f) => ({ ...f, menu: [...f.menu, emptyMenuRow()] }));
          }}
          className={`${portalQuiet} mt-2`}
        >
          {t('ws_api_menuAdd')}
        </button>
        {original ? <p className="mt-1 text-xs text-muted">{t('ws_api_menuNote')}</p> : null}
      </fieldset>

      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t('ws_api_formInvalid')}
        </p>
      ) : null}
      {nothing ? (
        <p role="status" className="text-sm text-muted">
          {t('ws_api_nothingChanged')}
        </p>
      ) : null}
      {apiError ? <ServiceApiError code={apiError} /> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {original ? t('ws_api_save') : t('ws_api_create')}
        </button>
        <button
          data-panel-cancel={original ? `workshop-${original.id}` : 'workshop-new'}
          type="button"
          onClick={onCancel}
          className={portalQuiet}
        >
          {t('ws_api_cancel')}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  invalid,
  hint,
  errorText,
  children,
}: {
  id: string;
  label: string;
  invalid: boolean;
  hint?: string;
  errorText: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-bold text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      {invalid ? <p className="mt-0.5 text-xs font-bold text-error">{errorText}</p> : null}
    </div>
  );
}
