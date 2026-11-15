'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { STAFF_STANDING_REASONS, type PartnerStandingReason } from '@mechdost/shared/partner-codes';
import { ShopOffers, type ShopOfferDto } from '@mechdost/shared/partner-api';
import {
  AdminShopDetail,
  AdminShopList,
  ShopMemberAdded,
  ShopStandingSaved,
  ShopVersion,
  SHOP_STATUSES,
  type AdminShopDetailDto,
  type AdminShopRowDto,
  type ShopStatus,
} from '@mechdost/shared/shop-api';
import { istStartOfDay } from '@mechdost/shared/time';
import { adminApi } from '@/lib/admin-api';
import {
  coverageBody,
  emptyCoverageRow,
  formFromShop,
  rowsFromCoverage,
  shopErrorKey,
  shopPatch,
  standingTargets,
  istDayTime,
  type CoverageProblem,
  type CoverageRow,
  type ShopField,
  type ShopForm,
} from '@/lib/admin-shop-form';
import { memberPhone } from '@/lib/admin-workshop-form';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { ApiListState, LoadMore } from './api-list-state';
import { CatalogueSkuPicker, type SkuChoice } from './catalogue-sku-picker';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';
import { PausePrompt, useShopWarnings, WarningsPanel } from './admin-shop-warnings';
import { ShopHoursFields } from './shop-hours-fields';
import { useApiList } from './use-api-list';

const PILL: Record<ShopStatus, string> = {
  pending: 'bg-pill text-ink',
  approved: 'bg-success-bg text-success',
  paused: 'bg-warning-bg text-warning',
  suspended: 'bg-pill text-error',
};
type Panel = 'profile' | 'coverage' | 'products' | 'standing' | 'warnings' | 'members';
const PANELS: readonly Panel[] = ['profile', 'coverage', 'products', 'standing', 'warnings', 'members'];

function ShopError({ code }: { code: string }) {
  const t = useTranslations('portal');
  return (
    <p role="alert" className="text-sm font-bold text-error">
      {t(shopErrorKey(code) as 'api_common_err_generic')}
    </p>
  );
}

/**
 * Admin → Partners → Shops on the API (specs 07/08 "Real API mode", real sign-in only; loaded with `next/dynamic`
 * by `admin-partners.tsx`). Every shop in the staff member's cities, by name, with its standing, hours, coverage and
 * offers on sale; one shop open at a time with its profile (English + Hindi, GSTIN, acceptance time, free delivery,
 * hours), delivery PIN codes, products, standing (reason code + note, history) and portal access. Every change
 * sends the shop's `version`; a stale save reloads and says so.
 */
export function AdminShopsApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [status, setStatus] = useState<ShopStatus | ''>('');
  const [open, setOpen] = useState<string | null>(null);
  const page = useCallback(
    async (cursor: string | null) => {
      const q = new URLSearchParams({ limit: '50' });
      if (status) q.set('status', status);
      if (cursor) q.set('cursor', cursor);
      const res = await adminApi(locale, `/admin/shops?${q.toString()}`, AdminShopList);
      return res.ok ? { ok: true as const, data: { items: res.data.items, next: res.data.nextCursor } } : res;
    },
    [locale, status],
  );
  const list = useApiList(page);

  return (
    <section aria-labelledby="shops-admin-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="shops-admin-title" className="font-heading text-lg font-extrabold text-ink">
            {t('shops_api_title')}
          </h3>
          <p className="text-sm text-muted">{t('shops_api_lead')}</p>
        </div>
        <div>
          <label htmlFor="shops-status" className="text-xs font-bold text-muted">
            {t('shops_api_filter')}
          </label>
          <select
            id="shops-status"
            value={status}
            onChange={(e) => {
              setStatus(SHOP_STATUSES.find((s) => s === e.target.value) ?? '');
              setOpen(null);
            }}
            className={portalField}
          >
            <option value="">{t('shops_api_filterAll')}</option>
            {SHOP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`shops_api_status_${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ApiListState
        loading={list.loading}
        error={list.error}
        count={list.items.length}
        empty={t('shops_api_none')}
        onRetry={() => void list.reload()}
      />
      {list.items.length > 0 ? (
        <ul className="space-y-3">
          {list.items.map((s) => (
            <li key={s.id}>
              <ShopRow
                shop={s}
                expanded={open === s.id}
                onToggle={() => {
                  setOpen(open === s.id ? null : s.id);
                }}
                onChanged={list.reload}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <LoadMore show={Boolean(list.next)} onClick={() => void list.loadMore()} />
    </section>
  );
}

function ShopRow({
  shop: s,
  expanded,
  onToggle,
  onChanged,
}: {
  shop: AdminShopRowDto;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  return (
    <article className={portalCard}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-lg font-extrabold text-ink">
            {locale === 'hi' && s.nameHi ? s.nameHi : s.name}
          </p>
          <p className="text-sm text-muted">
            {locale === 'hi' && s.addressLineHi ? s.addressLineHi : s.addressLine} · {s.pincode}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
            <li className={`rounded-pill px-3 py-1 ${PILL[s.status]}`}>
              {t(`shops_api_status_${s.status}`)}
            </li>
            <li
              className={`rounded-pill px-3 py-1 ${s.openNow ? 'bg-success-bg text-success' : 'bg-pill text-muted'}`}
            >
              {s.openNow ? t('shops_api_openNow') : t('shops_api_closedNow')}
            </li>
            {s.busy ? (
              <li className="rounded-pill bg-warning-bg px-3 py-1 text-warning">
                {s.busyUntil
                  ? `${t('shops_api_busy')} · ${istDayTime(s.busyUntil, locale)}`
                  : t('shops_api_busy')}
              </li>
            ) : null}
            {s.gstStatus !== 'registered' ? (
              <li className="rounded-pill bg-warning-bg px-3 py-1 text-warning">
                {t('shops_api_gstEnrolled')}
              </li>
            ) : null}
            <li className="rounded-pill bg-pill px-3 py-1 text-ink">
              {t('shops_api_pinCount', { count: s.coveragePincodes })}
            </li>
            <li className="rounded-pill bg-pill px-3 py-1 text-ink">
              {t('shops_api_onSale', { count: s.offersOnSale })}
            </li>
            {s.missingHindi.length > 0 ? (
              <li className="rounded-pill bg-warning-bg px-3 py-1 text-warning">
                {t('shops_api_missingHindi', { count: s.missingHindi.length })}
              </li>
            ) : null}
          </ul>
          {s.status === 'pending' ? (
            <p className="mt-2 text-sm text-muted">{t('shops_api_pendingNote')}</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          data-disclosure-trigger={`shop-${s.id}`}
          data-panel-cancel={expanded ? `shop-${s.id}` : undefined}
          onClick={onToggle}
          className={portalQuiet}
        >
          {expanded ? t('shops_api_close') : t('shops_api_manage')}
        </button>
      </div>
      {expanded ? (
        <div data-panel-for={`shop-${s.id}`}>
          <ShopManager shopId={s.id} onChanged={onChanged} />
        </div>
      ) : null}
    </article>
  );
}

/** One shop's detail with one panel open at a time (calm UI). */
function ShopManager({ shopId, onChanged }: { shopId: string; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [detail, setDetail] = useState<AdminShopDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('profile');
  const w = useShopWarnings(shopId);
  const tw = useTranslations('shopGiveUp');
  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/shops/${shopId}`, AdminShopDetail);
    if (res.ok) {
      setDetail(res.data);
      setError(null);
    } else setError(res.code);
  }, [locale, shopId]);
  useEffect(() => {
    void load();
  }, [load]);
  const saved = async () => {
    await Promise.all([load(), onChanged()]);
  };

  if (error && !detail)
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ShopError code={error} />
        <button type="button" onClick={() => void load()} className={portalQuiet}>
          {t('api_retry')}
        </button>
      </div>
    );
  if (!detail)
    return (
      <p role="status" className="mt-3 text-sm text-muted">
        {t('api_loading')}
      </p>
    );
  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      <PausePrompt
        warnings={w.warnings}
        onReview={() => {
          setPanel('standing');
        }}
      />
      <div role="tablist" aria-label={t('shops_api_sections')} className="flex flex-wrap gap-2">
        {PANELS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            id={`shop-${shopId}-tab-${p}`}
            aria-selected={panel === p}
            aria-controls={`shop-${shopId}-panel`}
            onClick={() => {
              setPanel(p);
            }}
            className={`press inline-flex min-h-11 items-center rounded-pill px-4 text-sm font-bold ${
              panel === p
                ? 'bg-accent-soft text-accent-soft-text'
                : 'border border-line-card text-ink hover:bg-pill'
            }`}
          >
            {p === 'warnings' ? tw('a_tab') : t(`shops_api_tab_${p}`)}
          </button>
        ))}
      </div>
      <div id={`shop-${shopId}-panel`} role="tabpanel" aria-labelledby={`shop-${shopId}-tab-${panel}`}>
        {panel === 'profile' ? (
          <ProfileForm key={detail.version} shop={detail} onSaved={saved} onStale={load} />
        ) : null}
        {panel === 'coverage' ? <CoverageForm key={detail.version} shop={detail} onSaved={saved} /> : null}
        {panel === 'products' ? <ProductsPanel shop={detail} onChanged={saved} /> : null}
        {panel === 'standing' ? <StandingPanel shop={detail} onSaved={saved} /> : null}
        {panel === 'warnings' ? (
          <WarningsPanel
            shopId={shopId}
            warnings={w.warnings}
            onChanged={w.set}
            onReviewStanding={() => {
              setPanel('standing');
            }}
          />
        ) : null}
        {panel === 'members' ? <MembersPanel shop={detail} onSaved={saved} /> : null}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  invalid,
  error,
  children,
  hint,
}: {
  id: string;
  label: string;
  invalid: boolean;
  error: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-bold text-muted">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-bold text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const FIELD_ORDER: readonly ShopField[] = [
  'name',
  'nameHi',
  'legalName',
  'addressLine',
  'addressLineHi',
  'phone',
  'email',
  'gstin',
  'timeout',
  'freeDelivery',
  'open',
  'close',
  'days',
];

function ProfileForm({
  shop,
  onSaved,
  onStale,
}: {
  shop: AdminShopDetailDto;
  onSaved: () => Promise<void>;
  onStale: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [form, setForm] = useState<ShopForm>(() => formFromShop(shop));
  const [invalid, setInvalid] = useState<Partial<Record<ShopField, true>>>({});
  const [result, setResult] = useState<{ ok: true } | { ok: false; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `shop-${shop.id}`;
  const set = (k: keyof ShopForm, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setInvalid((i) => ({ ...i, [k]: undefined }));
    setResult(null);
  };
  const input = (
    k: Exclude<ShopField, 'days'>,
    extra: { type?: string; inputMode?: 'numeric' | 'decimal' } = {},
  ) => (
    <input
      id={`${id}-${k}`}
      type={extra.type ?? 'text'}
      inputMode={extra.inputMode}
      value={form[k]}
      aria-invalid={invalid[k] ? true : undefined}
      aria-describedby={invalid[k] ? `${id}-${k}-error` : undefined}
      onChange={(e) => {
        set(k, e.target.value);
      }}
      className={portalField}
    />
  );

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = shopPatch(shop, form);
    if (!r.ok) {
      setInvalid(r.errors);
      const first = FIELD_ORDER.find((f) => r.errors[f]);
      if (first) document.getElementById(`${id}-${first === 'days' ? 'open' : first}`)?.focus();
      return;
    }
    if (!r.body) {
      setResult({ ok: false, code: 'EMPTY_PATCH' });
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/shops/${shop.id}`, ShopVersion, {
      method: 'PATCH',
      body: r.body,
    });
    setBusy(false);
    if (!res.ok) {
      setResult({ ok: false, code: res.code });
      if (res.code === 'STALE_SHOP') await onStale();
      return;
    }
    track('click', { id: 'admin_shop_saved', path: window.location.pathname });
    setResult({ ok: true });
    await onSaved();
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} aria-busy={busy || undefined} className="space-y-3">
      <div className="grid gap-3 min-[600px]:grid-cols-2">
        <Field
          id={`${id}-name`}
          label={t('shops_api_fName')}
          invalid={Boolean(invalid.name)}
          error={t('shops_api_errName')}
        >
          {input('name')}
        </Field>
        <Field
          id={`${id}-nameHi`}
          label={t('shops_api_fNameHi')}
          invalid={Boolean(invalid.nameHi)}
          error={t('shops_api_errName')}
        >
          {input('nameHi')}
        </Field>
        <Field
          id={`${id}-addressLine`}
          label={t('shops_api_fAddress')}
          invalid={Boolean(invalid.addressLine)}
          error={t('shops_api_errAddress')}
        >
          {input('addressLine')}
        </Field>
        <Field
          id={`${id}-addressLineHi`}
          label={t('shops_api_fAddressHi')}
          invalid={Boolean(invalid.addressLineHi)}
          error={t('shops_api_errAddress')}
        >
          {input('addressLineHi')}
        </Field>
        <Field
          id={`${id}-legalName`}
          label={t('shops_api_fLegalName')}
          invalid={Boolean(invalid.legalName)}
          error={t('shops_api_errName')}
        >
          {input('legalName')}
        </Field>
        <Field
          id={`${id}-phone`}
          label={t('shops_api_fPhone')}
          invalid={Boolean(invalid.phone)}
          error={t('shops_api_errPhone')}
        >
          {input('phone', { type: 'tel', inputMode: 'numeric' })}
        </Field>
        <Field
          id={`${id}-email`}
          label={t('shops_api_fEmail')}
          invalid={Boolean(invalid.email)}
          error={t('shops_api_errEmail')}
        >
          {input('email', { type: 'email' })}
        </Field>
        <Field
          id={`${id}-gstin`}
          label={t('shops_api_fGstin')}
          invalid={Boolean(invalid.gstin)}
          error={t('shops_api_errGstin')}
          hint={t('shops_api_fGstinHint')}
        >
          {input('gstin')}
        </Field>
        <Field
          id={`${id}-timeout`}
          label={t('shops_api_fTimeout')}
          invalid={Boolean(invalid.timeout)}
          error={t('shops_api_errTimeout')}
          hint={t('shops_api_fTimeoutHint')}
        >
          {input('timeout', { inputMode: 'numeric' })}
        </Field>
        <Field
          id={`${id}-freeDelivery`}
          label={t('shops_api_fFreeDelivery')}
          invalid={Boolean(invalid.freeDelivery)}
          error={t('shops_api_errFreeDelivery')}
          hint={t('shops_api_fFreeDeliveryHint')}
        >
          {input('freeDelivery', { inputMode: 'decimal' })}
        </Field>
      </div>
      <ShopHoursFields
        idPrefix={id}
        open={form.open}
        close={form.close}
        days={form.days}
        invalid={{ open: invalid.open, close: invalid.close, days: invalid.days }}
        onChange={(h) => {
          setForm((f) => ({ ...f, ...h }));
          setInvalid((i) => ({ ...i, open: undefined, close: undefined, days: undefined }));
          setResult(null);
        }}
      />
      {result?.ok === false ? <ShopError code={result.code} /> : null}
      {result?.ok ? (
        <p role="status" className="text-sm font-bold text-success">
          {t('shops_api_saved')}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={portalPrimary}>
        {t('shops_api_saveProfile')}
      </button>
    </form>
  );
}

const PROBLEM_KEY: Record<CoverageProblem, string> = {
  pincode: 'shops_api_covErrPin',
  duplicate: 'shops_api_covErrDuplicate',
  charge: 'shops_api_covErrCharge',
  days: 'shops_api_covErrDays',
};

function CoverageForm({ shop, onSaved }: { shop: AdminShopDetailDto; onSaved: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [rows, setRows] = useState<CoverageRow[]>(() => rowsFromCoverage(shop.coverage));
  const [problems, setProblems] = useState<Record<number, CoverageProblem>>({});
  const [result, setResult] = useState<{ ok: true } | { ok: false; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `cov-${shop.id}`;
  const update = (i: number, patch: Partial<CoverageRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setProblems((p) => ({ ...p, [i]: undefined }) as Record<number, CoverageProblem>);
    setResult(null);
  };

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = coverageBody(shop, rows);
    if (!r.ok) {
      setProblems(r.errors);
      const first = Object.keys(r.errors)
        .map(Number)
        .sort((a, b) => a - b)[0];
      if (first !== undefined) document.getElementById(`${id}-${String(first)}-pin`)?.focus();
      return;
    }
    if (!r.body) {
      setResult({ ok: false, code: 'EMPTY_PATCH' });
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/shops/${shop.id}/coverage`, ShopVersion, {
      method: 'PUT',
      body: r.body,
    });
    setBusy(false);
    if (!res.ok) {
      setResult({ ok: false, code: res.code });
      return;
    }
    track('click', { id: 'admin_shop_coverage_saved', path: window.location.pathname });
    setResult({ ok: true });
    await onSaved();
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} aria-busy={busy || undefined} className="space-y-3">
      <p className="text-sm text-muted">{t('shops_api_covLead')}</p>
      {shop.status === 'pending' ? (
        <p role="note" className="rounded-lg bg-warning-bg p-3 text-sm text-warning">
          {t('shops_api_publishWarn')}
        </p>
      ) : null}
      {rows.length === 0 ? <p className="text-sm text-muted">{t('shops_api_covEmpty')}</p> : null}
      <ul className="space-y-2">
        {rows.map((r, i) => {
          const problem = problems[i];
          const rid = `${id}-${String(i)}`;
          return (
            <li
              key={`${r.pincode}-${String(i)}`}
              className={`grid gap-2 rounded-tile border border-line-card p-3 min-[600px]:grid-cols-[1fr_1fr_1fr_auto_auto] min-[600px]:items-end ${
                r.remove ? 'opacity-60' : ''
              }`}
            >
              <div>
                <label htmlFor={`${rid}-pin`} className="text-xs font-bold text-muted">
                  {t('shops_api_covPin')}
                </label>
                <input
                  id={`${rid}-pin`}
                  inputMode="numeric"
                  maxLength={6}
                  readOnly={!r.isNew}
                  value={r.pincode}
                  aria-invalid={problem === 'pincode' || problem === 'duplicate' ? true : undefined}
                  aria-describedby={problem ? `${rid}-error` : undefined}
                  onChange={(e) => {
                    update(i, { pincode: e.target.value.replace(/\D/g, '') });
                  }}
                  className={portalField}
                />
              </div>
              <div>
                <label htmlFor={`${rid}-charge`} className="text-xs font-bold text-muted">
                  {t('shops_api_covCharge')}
                </label>
                <input
                  id={`${rid}-charge`}
                  inputMode="decimal"
                  value={r.charge}
                  aria-invalid={problem === 'charge' ? true : undefined}
                  onChange={(e) => {
                    update(i, { charge: e.target.value });
                  }}
                  className={portalField}
                />
              </div>
              <div>
                <label htmlFor={`${rid}-days`} className="text-xs font-bold text-muted">
                  {t('shops_api_covDays')}
                </label>
                <input
                  id={`${rid}-days`}
                  inputMode="numeric"
                  value={r.days}
                  aria-invalid={problem === 'days' ? true : undefined}
                  onChange={(e) => {
                    update(i, { days: e.target.value });
                  }}
                  className={portalField}
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={r.active}
                  onChange={(e) => {
                    update(i, { active: e.target.checked });
                  }}
                  className="size-5 accent-[var(--color-accent-button)]"
                />
                {t('shops_api_covActive')}
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={r.remove}
                  onChange={(e) => {
                    update(i, { remove: e.target.checked });
                  }}
                  className="size-5 accent-[var(--color-accent-button)]"
                />
                {t('shops_api_covRemove')}
              </label>
              {problem ? (
                <p id={`${rid}-error`} className="text-xs font-bold text-error min-[600px]:col-span-5">
                  {t(PROBLEM_KEY[problem] as 'shops_api_covErrPin')}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          setRows((rs) => [...rs, emptyCoverageRow()]);
          setResult(null);
        }}
        className={portalQuiet}
      >
        {t('shops_api_covAdd')}
      </button>
      {result?.ok === false ? <ShopError code={result.code} /> : null}
      {result?.ok ? (
        <p role="status" className="text-sm font-bold text-success">
          {t('shops_api_saved')}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('shops_api_covSave')}
        </button>
      </div>
    </form>
  );
}

/** The shop's offers (staff set price, stock and on/off directly; decision "admin sets prices per shop"). */
function ProductsPanel({ shop, onChanged }: { shop: AdminShopDetailDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [offers, setOffers] = useState<ShopOfferDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    const res = await adminApi(
      locale,
      `/admin/shops/${shop.id}/inventory?locale=${locale === 'hi' ? 'hi' : 'en'}`,
      ShopOffers,
    );
    if (res.ok) {
      setOffers(res.data.offers);
      setError(null);
    } else setError(res.code);
  }, [locale, shop.id]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      {shop.status === 'pending' ? (
        <p role="note" className="rounded-lg bg-warning-bg p-3 text-sm text-warning">
          {t('shops_api_publishWarn')}
        </p>
      ) : null}
      <ApiListState
        loading={offers === null && error === null}
        error={error}
        count={offers?.length ?? 0}
        empty={t('shops_api_prodEmpty')}
        onRetry={() => void load()}
      />
      {offers && offers.length > 0 ? (
        <ul className="space-y-2">
          {offers.map((o) => (
            <li key={o.sku}>
              <OfferRow shopId={shop.id} offer={o} onSaved={load} />
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <AddOffer
          shopId={shop.id}
          listed={new Set((offers ?? []).map((o) => o.sku))}
          onDone={async () => {
            setAdding(false);
            await Promise.all([load(), onChanged()]);
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      ) : (
        <button
          data-disclosure-trigger={`offer-add-${shop.id}`}
          type="button"
          onClick={() => {
            setAdding(true);
          }}
          className={portalPrimary}
        >
          {t('shops_api_prodAdd')}
        </button>
      )}
    </div>
  );
}

function OfferRow({
  shopId,
  offer,
  onSaved,
}: {
  shopId: string;
  offer: ShopOfferDto;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [price, setPrice] = useState(String(offer.sellingPaise / 100));
  const [stock, setStock] = useState(String(offer.onHand));
  const [active, setActive] = useState(offer.active);
  const [problem, setProblem] = useState<'price' | 'stock' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `offer-${shopId}-${offer.sku}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = parseRupees(price);
    if (!p.ok || p.paise > offer.mrpPaise) {
      setProblem('price');
      return;
    }
    const n = Number(stock.trim());
    if (stock.trim() === '' || !Number.isInteger(n) || n < 0 || n > 100_000) {
      setProblem('stock');
      return;
    }
    const body: Record<string, unknown> = { version: offer.version };
    if (p.paise !== offer.sellingPaise) body.sellingPaise = p.paise;
    if (n !== offer.onHand) body.onHand = n;
    if (active !== offer.active) body.active = active;
    if (Object.keys(body).length === 1) {
      setError('EMPTY_PATCH');
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/shops/${shopId}/inventory/${offer.sku}`, ShopVersion, {
      method: 'PATCH',
      body,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      if (res.code === 'STALE_OFFER') await onSaved();
      return;
    }
    track('click', { id: 'admin_shop_offer_saved', path: window.location.pathname });
    setError(null);
    await onSaved();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="grid gap-2 rounded-tile border border-line-card p-3 min-[600px]:grid-cols-[2fr_1fr_1fr_auto_auto] min-[600px]:items-end"
    >
      <p className="text-sm">
        <span className="font-bold text-ink">{offer.product}</span>
        <span className="block text-xs text-muted">
          {offer.sku} · {t('shops_api_prodMrp', { mrp: formatPrice(offer.mrpPaise) })} ·{' '}
          {t('shops_api_prodReserved', { count: offer.reserved })}
        </span>
      </p>
      <div>
        <label htmlFor={`${id}-price`} className="text-xs font-bold text-muted">
          {t('shops_api_prodPrice')}
        </label>
        <input
          id={`${id}-price`}
          inputMode="decimal"
          value={price}
          aria-invalid={problem === 'price' ? true : undefined}
          aria-describedby={problem === 'price' ? `${id}-problem` : undefined}
          onChange={(e) => {
            setPrice(e.target.value);
            setProblem(null);
          }}
          className={portalField}
        />
      </div>
      <div>
        <label htmlFor={`${id}-stock`} className="text-xs font-bold text-muted">
          {t('shops_api_prodStock')}
        </label>
        <input
          id={`${id}-stock`}
          inputMode="numeric"
          value={stock}
          aria-invalid={problem === 'stock' ? true : undefined}
          aria-describedby={problem === 'stock' ? `${id}-problem` : undefined}
          onChange={(e) => {
            setStock(e.target.value);
            setProblem(null);
          }}
          className={portalField}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => {
            setActive(e.target.checked);
          }}
          className="size-5 accent-[var(--color-accent-button)]"
        />
        {t('shops_api_prodActive')}
      </label>
      <button type="submit" disabled={busy} className={portalQuiet}>
        {t('shops_api_prodSave')}
      </button>
      {problem ? (
        <p id={`${id}-problem`} className="text-xs font-bold text-error min-[600px]:col-span-5">
          {problem === 'price'
            ? t('shops_api_prodErrPrice', { mrp: formatPrice(offer.mrpPaise) })
            : t('shops_api_prodErrStock')}
        </p>
      ) : null}
      {error ? (
        <div className="min-[600px]:col-span-5">
          <ShopError code={error} />
        </div>
      ) : null}
    </form>
  );
}

function AddOffer({
  shopId,
  listed,
  onDone,
  onCancel,
}: {
  shopId: string;
  listed: ReadonlySet<string>;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [choice, setChoice] = useState<SkuChoice | null>(null);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [active, setActive] = useState(true);
  const [problem, setProblem] = useState<'price' | 'stock' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `add-offer-${shopId}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!choice) return;
    const p = parseRupees(price);
    if (!p.ok || p.paise > choice.mrpPaise) {
      setProblem('price');
      document.getElementById(`${id}-price`)?.focus();
      return;
    }
    const n = Number(stock.trim());
    if (stock.trim() === '' || !Number.isInteger(n) || n < 0 || n > 100_000) {
      setProblem('stock');
      document.getElementById(`${id}-stock`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/shops/${shopId}/inventory`, ShopVersion, {
      method: 'POST',
      body: { sku: choice.sku, sellingPaise: p.paise, onHand: n, active },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: 'admin_shop_offer_added', path: window.location.pathname });
    await onDone();
  }

  return (
    <div className="space-y-3 rounded-tile border border-accent-button/40 p-3">
      <p className="text-sm font-bold text-ink">{t('shops_api_prodAddTitle')}</p>
      {choice ? (
        <form
          noValidate
          onSubmit={(e) => void onSubmit(e)}
          aria-busy={busy || undefined}
          className="space-y-2"
        >
          <p className="text-sm text-ink">
            <span className="font-bold">{choice.name}</span> · {choice.sku} ·{' '}
            {t('shops_api_prodMrp', { mrp: formatPrice(choice.mrpPaise) })}
          </p>
          <div className="grid gap-2 min-[600px]:grid-cols-[1fr_1fr_auto] min-[600px]:items-end">
            <div>
              <label htmlFor={`${id}-price`} className="text-xs font-bold text-muted">
                {t('shops_api_prodPrice')}
              </label>
              <input
                id={`${id}-price`}
                inputMode="decimal"
                value={price}
                aria-invalid={problem === 'price' ? true : undefined}
                aria-describedby={problem === 'price' ? `${id}-problem` : undefined}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setProblem(null);
                }}
                className={portalField}
              />
            </div>
            <div>
              <label htmlFor={`${id}-stock`} className="text-xs font-bold text-muted">
                {t('shops_api_prodStock')}
              </label>
              <input
                id={`${id}-stock`}
                inputMode="numeric"
                value={stock}
                aria-invalid={problem === 'stock' ? true : undefined}
                aria-describedby={problem === 'stock' ? `${id}-problem` : undefined}
                onChange={(e) => {
                  setStock(e.target.value);
                  setProblem(null);
                }}
                className={portalField}
              />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => {
                  setActive(e.target.checked);
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {t('shops_api_prodActive')}
            </label>
          </div>
          {problem ? (
            <p id={`${id}-problem`} className="text-xs font-bold text-error">
              {problem === 'price'
                ? t('shops_api_prodErrPrice', { mrp: formatPrice(choice.mrpPaise) })
                : t('shops_api_prodErrStock')}
            </p>
          ) : null}
          {error ? <ShopError code={error} /> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={portalPrimary}>
              {t('shops_api_prodAddSave')}
            </button>
            <button
              type="button"
              onClick={() => {
                setChoice(null);
              }}
              className={portalQuiet}
            >
              {t('shops_api_pickBack')}
            </button>
          </div>
        </form>
      ) : (
        <CatalogueSkuPicker idPrefix={id} listed={listed} onPick={setChoice} />
      )}
      <button
        type="button"
        data-panel-cancel={`offer-add-${shopId}`}
        onClick={onCancel}
        className={portalQuiet}
      >
        {t('shops_api_cancel')}
      </button>
    </div>
  );
}

function StandingPanel({ shop, onSaved }: { shop: AdminShopDetailDto; onSaved: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const targets = standingTargets(shop.status);
  const [to, setTo] = useState<(typeof targets)[number] | ''>('');
  const [reason, setReason] = useState<PartnerStandingReason | ''>('');
  const [note, setNote] = useState('');
  const [until, setUntil] = useState('');
  const [invalid, setInvalid] = useState<'to' | 'reason' | 'note' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `standing-${shop.id}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const missing = !to ? 'to' : !reason ? 'reason' : note.trim().length < 5 ? 'note' : null;
    if (missing) {
      setInvalid(missing);
      document.getElementById(`${id}-${missing}`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/shops/${shop.id}/standing`, ShopStandingSaved, {
      method: 'POST',
      body: {
        status: to,
        reasonCode: reason,
        note: note.trim(),
        version: shop.version,
        ...(to === 'paused' && until ? { pausedUntil: istStartOfDay(until).toISOString() } : {}),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: `admin_shop_${to}`, path: window.location.pathname });
    await onSaved();
  }

  return (
    <div className="space-y-4">
      {shop.status === 'paused' || shop.status === 'suspended' ? (
        <p className="rounded-lg bg-warning-bg p-3 text-sm text-warning">
          <span className="font-bold">
            {shop.statusReasonCode
              ? t(`shops_api_reason_${shop.statusReasonCode}`)
              : t(`shops_api_status_${shop.status}`)}
          </span>
          {shop.statusReason ? (
            <>
              {' · '}
              <span data-user-content>{shop.statusReason}</span>
            </>
          ) : null}
          {shop.pausedUntil
            ? ` · ${t('shops_api_until', { date: formatDate(shop.pausedUntil, locale) })}`
            : null}
        </p>
      ) : null}
      {targets.length === 0 ? (
        <p className="text-sm text-muted">{t('shops_api_pendingNote')}</p>
      ) : (
        <form
          noValidate
          onSubmit={(e) => void onSubmit(e)}
          aria-busy={busy || undefined}
          className="space-y-2"
        >
          <label htmlFor={`${id}-to`} className="text-xs font-bold text-muted">
            {t('shops_api_standingTo')}
          </label>
          <select
            id={`${id}-to`}
            value={to}
            aria-invalid={invalid === 'to' ? true : undefined}
            onChange={(e) => {
              setTo(targets.find((x) => x === e.target.value) ?? '');
              setInvalid(null);
            }}
            className={portalField}
          >
            <option value="">{t('shops_api_choose')}</option>
            {targets.map((s) => (
              <option key={s} value={s}>
                {t(`shops_api_standingAction_${s}`)}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-reason`} className="text-xs font-bold text-muted">
            {t('shops_api_standingReason')}
          </label>
          <select
            id={`${id}-reason`}
            value={reason}
            aria-invalid={invalid === 'reason' ? true : undefined}
            onChange={(e) => {
              setReason(STAFF_STANDING_REASONS.find((r) => r === e.target.value) ?? '');
              setInvalid(null);
            }}
            className={portalField}
          >
            <option value="">{t('shops_api_choose')}</option>
            {STAFF_STANDING_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`shops_api_reason_${r}`)}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-note`} className="text-xs font-bold text-muted">
            {t('shops_api_standingNote')}
          </label>
          <textarea
            id={`${id}-note`}
            value={note}
            maxLength={300}
            rows={2}
            aria-invalid={invalid === 'note' ? true : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setInvalid(null);
            }}
            className={`${portalField} py-2`}
          />
          {to === 'paused' ? (
            <>
              <label htmlFor={`${id}-until`} className="text-xs font-bold text-muted">
                {t('shops_api_standingUntil')}
              </label>
              <input
                id={`${id}-until`}
                type="date"
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value);
                }}
                className={portalField}
              />
            </>
          ) : null}
          {invalid ? (
            <p role="alert" className="text-xs font-bold text-error">
              {invalid === 'note' ? t('shops_api_errNote') : t('shops_api_errChoose')}
            </p>
          ) : null}
          {error ? <ShopError code={error} /> : null}
          <button type="submit" disabled={busy} className={portalPrimary}>
            {t('shops_api_standingSave')}
          </button>
        </form>
      )}
      <section aria-labelledby={`${id}-history`}>
        <h4 id={`${id}-history`} className="text-sm font-extrabold text-ink">
          {t('shops_api_history')}
        </h4>
        {shop.history.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{t('shops_api_historyEmpty')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {shop.history.map((h) => (
              <li key={`${h.at}-${h.to}`} className="py-2 text-sm text-ink">
                <span className="font-bold">{formatDate(h.at, locale)}</span> ·{' '}
                {t(`shops_api_status_${h.to as ShopStatus}`)}
                {h.reasonCode ? ` · ${t(`shops_api_reason_${h.reasonCode}`)}` : ''} ·{' '}
                <span data-user-content>{h.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MembersPanel({ shop, onSaved }: { shop: AdminShopDetailDto; onSaved: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'seller_owner' | 'seller_staff' | ''>('');
  const [invalid, setInvalid] = useState<'phone' | 'role' | null>(null);
  const [result, setResult] = useState<{ ok: true } | { ok: false; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `member-${shop.id}`;

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
    const res = await adminApi(locale, `/admin/shops/${shop.id}/members`, ShopMemberAdded, {
      method: 'POST',
      body: { phone: full, role },
    });
    setBusy(false);
    setResult(res.ok ? { ok: true } : { ok: false, code: res.code });
    if (res.ok) {
      setPhone('');
      track('click', { id: 'admin_shop_member_added', path: window.location.pathname });
      await onSaved();
    }
  }

  return (
    <div className="space-y-3">
      {shop.members.length === 0 ? (
        <p className="text-sm text-muted">{t('shops_api_membersEmpty')}</p>
      ) : (
        <ul className="space-y-1 text-sm text-ink">
          {shop.members.map((m) => (
            <li key={`${m.userId}-${m.role}`}>
              {t(m.role === 'seller_owner' ? 'shops_api_roleOwner' : 'shops_api_roleStaff')} ·{' '}
              {m.phoneLast4 ? `••••••${m.phoneLast4}` : '—'}
            </li>
          ))}
        </ul>
      )}
      <form
        noValidate
        onSubmit={(e) => void onSubmit(e)}
        aria-busy={busy || undefined}
        className="grid gap-2 border-t border-line pt-3 min-[600px]:grid-cols-[1fr_1fr_auto] min-[600px]:items-end"
      >
        <div>
          <label htmlFor={`${id}-phone`} className="text-xs font-bold text-muted">
            {t('shops_api_memberPhone')}
          </label>
          <input
            id={`${id}-phone`}
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            value={phone}
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
            {t('shops_api_memberRole')}
          </label>
          <select
            id={`${id}-role`}
            value={role}
            aria-invalid={invalid === 'role' ? true : undefined}
            onChange={(e) => {
              const v = e.target.value;
              setRole(v === 'seller_owner' || v === 'seller_staff' ? v : '');
              setInvalid(null);
            }}
            className={portalField}
          >
            <option value="">{t('shops_api_choose')}</option>
            <option value="seller_owner">{t('shops_api_roleOwner')}</option>
            <option value="seller_staff">{t('shops_api_roleStaff')}</option>
          </select>
        </div>
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('shops_api_memberSave')}
        </button>
        {invalid ? (
          <p role="alert" className="text-xs font-bold text-error min-[600px]:col-span-3">
            {invalid === 'phone' ? t('shops_api_errPhone') : t('shops_api_errChoose')}
          </p>
        ) : null}
        {result?.ok === false ? (
          <div className="min-[600px]:col-span-3">
            {result.code === 'NOT_FOUND' ? (
              <p role="alert" className="text-sm font-bold text-error">
                {t('shops_api_memberNoAccount')}
              </p>
            ) : (
              <ShopError code={result.code} />
            )}
          </div>
        ) : null}
        {result?.ok ? (
          <p role="status" className="text-sm font-bold text-success min-[600px]:col-span-3">
            {t('shops_api_memberDone')}
          </p>
        ) : null}
      </form>
    </div>
  );
}
