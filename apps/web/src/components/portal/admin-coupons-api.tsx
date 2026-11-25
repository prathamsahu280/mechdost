'use client';

import {
  AdminCouponDto,
  AdminCouponListDto,
  CouponCategoryListDto,
  type AdminCoupon,
} from '@mechdost/shared/coupon-api';
import { AdminShopList } from '@mechdost/shared/shop-api';
import { dateToIstLocal, type CouponKind } from '@mechdost/shared/coupon';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { localName } from '@/lib/admin-analytics-view';
import { track } from '@/lib/analytics';
import {
  adminErrorKey,
  type AdminErrorKey,
  conditionLines,
  couponStatus,
  emptyForm,
  formFromCoupon,
  inputFromForm,
  type CouponForm,
  type FormErrorKey,
  type FormField,
} from '@/lib/coupon-view';
import { formatDate, formatPrice } from '@/lib/format';
import { AdminCouponUsage } from './admin-coupon-usage';
import { AdminHeaderActions, ADMIN_PAGE_TITLE_ID } from './admin-page-header';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ok'; coupons: AdminCoupon[]; next: string | null };
interface Shop {
  id: string;
  name: string;
  nameHi: string | null;
}
interface Editing {
  coupon: AdminCoupon | null;
  form: CouponForm;
}

const KINDS: readonly CouponKind[] = ['percent', 'flat', 'free_shipping'];

/**
 * Admin → Coupons (spec 08 "Promotions", 2026-11-15; real sign-in builds). Only staff with `coupons:write` use it; the
 * API checks that again. Create and edit in place (no modal), pause with a reason, resume. Every coupon says who funds
 * it: a shop-funded one waits for its shop to accept the terms in the shop portal, and goes back to waiting when its
 * money terms change. Each save carries the version shown, so two people never overwrite each other.
 */
export function AdminCouponsApi() {
  const t = useTranslations('coupons');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [shops, setShops] = useState<Shop[]>([]);
  const [categories, setCategories] = useState<{ slug: string; name: string }[]>([]);
  const [usageFor, setUsageFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pausing, setPausing] = useState<{ id: string; reason: string } | null>(null);
  const [fieldError, setFieldError] = useState<{ field: FormField; key: FormErrorKey } | null>(null);
  const [error, setError] = useState<AdminErrorKey | 'a_err_reason' | null>(null);
  const [working, setWorking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await adminApi(locale, '/admin/coupons?limit=50', AdminCouponListDto);
    setLoad(
      res.ok
        ? { kind: 'ok', coupons: res.data.coupons, next: res.data.nextCursor }
        : { kind: 'error', code: res.code },
    );
  }, [locale]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    void adminApi(locale, '/admin/shops?status=approved&limit=100', AdminShopList).then((res) => {
      if (res.ok) setShops(res.data.items.map((s) => ({ id: s.id, name: s.name, nameHi: s.nameHi })));
    });
  }, [locale]);

  useEffect(() => {
    // The public category list (the same names the shop shows); the form names the category by slug.
    void adminApi(
      locale,
      `/catalogue/categories?locale=${locale === 'hi' ? 'hi' : 'en'}`,
      CouponCategoryListDto,
    ).then((res) => {
      if (res.ok) setCategories(res.data.categories.map((c) => ({ slug: c.slug, name: c.name })));
    });
  }, [locale]);

  async function more() {
    if (load.kind !== 'ok' || !load.next) return;
    const res = await adminApi(
      locale,
      `/admin/coupons?limit=50&cursor=${encodeURIComponent(load.next)}`,
      AdminCouponListDto,
    );
    if (res.ok)
      setLoad({ kind: 'ok', coupons: [...load.coupons, ...res.data.coupons], next: res.data.nextCursor });
  }

  async function onSave(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const parsed = inputFromForm(editing.form);
    if (!parsed.ok) {
      setFieldError({ field: parsed.field, key: parsed.error });
      document.getElementById(`coupon-${parsed.field}`)?.focus();
      return;
    }
    setFieldError(null);
    setWorking(true);
    const res = editing.coupon
      ? await adminApi(locale, `/admin/coupons/${editing.coupon.id}`, AdminCouponDto, {
          method: 'PUT',
          body: { version: editing.coupon.version, coupon: parsed.input },
        })
      : await adminApi(locale, '/admin/coupons', AdminCouponDto, { method: 'POST', body: parsed.input });
    setWorking(false);
    if (!res.ok) {
      setError(adminErrorKey(res.code));
      // A stale form is reloaded so the next save starts from what is stored.
      if (res.code === 'STALE_COUPON') void reload();
      return;
    }
    track('click', {
      id: editing.coupon ? 'admin_coupon_updated' : 'admin_coupon_created',
      path: window.location.pathname,
    });
    setSaved(res.data.code);
    setEditing(null);
    await reload();
  }

  async function onPause(c: AdminCoupon, paused: boolean) {
    if (paused && (!pausing || pausing.reason.trim().length < 3)) {
      setError('a_err_reason');
      document.getElementById(`coupon-pause-${c.id}`)?.focus();
      return;
    }
    setWorking(true);
    setError(null);
    const res = await adminApi(locale, `/admin/coupons/${c.id}/pause`, AdminCouponDto, {
      method: 'POST',
      body: { paused, reason: paused ? (pausing?.reason.trim() ?? null) : null, version: c.version },
    });
    setWorking(false);
    if (!res.ok) {
      setError(adminErrorKey(res.code));
      if (res.code === 'STALE_COUPON') void reload();
      return;
    }
    track('click', {
      id: paused ? 'admin_coupon_paused' : 'admin_coupon_resumed',
      path: window.location.pathname,
    });
    setPausing(null);
    setSaved(null);
    await reload();
  }

  const set = <K extends keyof CouponForm>(k: K, v: CouponForm[K]) => {
    setEditing((cur) => (cur ? { ...cur, form: { ...cur.form, [k]: v } } : cur));
  };
  const now = new Date();

  return (
    <section aria-labelledby={ADMIN_PAGE_TITLE_ID} className="space-y-4">
      {!editing ? (
        <AdminHeaderActions>
          <button
            data-disclosure-trigger="coupon-new"
            type="button"
            className={portalPrimary}
            onClick={() => {
              setSaved(null);
              setError(null);
              setEditing({ coupon: null, form: emptyForm(dateToIstLocal(new Date())) });
            }}
          >
            {t('a_new')}
          </button>
        </AdminHeaderActions>
      ) : null}

      {saved ? (
        <p role="status" className="rounded-card bg-success-bg px-3 py-2 text-sm font-bold text-success">
          {t('a_saved', { code: saved })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-card bg-error-bg px-3 py-2 text-sm font-bold text-error">
          {t(error)}
        </p>
      ) : null}

      {editing ? (
        <form
          onSubmit={(e) => void onSave(e)}
          noValidate
          className={`${adminCard} space-y-4`}
          aria-label={t('a_form')}
        >
          <h3 className="font-heading text-lg font-extrabold text-ink">
            {editing.coupon ? t('a_edit', { code: editing.coupon.code }) : t('a_new')}
          </h3>
          <div className="grid gap-4 min-[700px]:grid-cols-2">
            <Field
              id="code"
              label={t('f_code')}
              hint={t('f_code_hint')}
              error={errorFor(fieldError, 'code', t)}
            >
              <input
                id="coupon-code"
                value={editing.form.code}
                onChange={(e) => {
                  set('code', e.target.value.toUpperCase());
                }}
                maxLength={20}
                autoComplete="off"
                className={portalField}
              />
            </Field>
            <Field id="kind" label={t('f_kind')}>
              <select
                id="coupon-kind"
                value={editing.form.kind}
                onChange={(e) => {
                  set('kind', e.target.value as CouponKind);
                }}
                disabled={(editing.coupon?.usedCount ?? 0) > 0}
                className={portalField}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind_${k}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="title" label={t('f_title')} error={errorFor(fieldError, 'title', t)}>
              <input
                id="coupon-title"
                value={editing.form.title}
                onChange={(e) => {
                  set('title', e.target.value);
                }}
                maxLength={80}
                className={portalField}
              />
            </Field>
            <Field id="titleHi" label={t('f_title_hi')} error={errorFor(fieldError, 'titleHi', t)}>
              <input
                id="coupon-titleHi"
                lang="hi"
                value={editing.form.titleHi}
                onChange={(e) => {
                  set('titleHi', e.target.value);
                }}
                maxLength={120}
                className={portalField}
              />
            </Field>
            <Field
              id="terms"
              label={t('f_terms')}
              hint={t('f_terms_hint')}
              error={errorFor(fieldError, 'terms', t)}
            >
              <textarea
                id="coupon-terms"
                value={editing.form.terms}
                onChange={(e) => {
                  set('terms', e.target.value);
                }}
                maxLength={400}
                rows={2}
                className={portalField}
              />
            </Field>
            <Field id="termsHi" label={t('f_terms_hi')}>
              <textarea
                id="coupon-termsHi"
                lang="hi"
                value={editing.form.termsHi}
                onChange={(e) => {
                  set('termsHi', e.target.value);
                }}
                maxLength={600}
                rows={2}
                className={portalField}
              />
            </Field>
            {editing.form.kind !== 'free_shipping' ? (
              <Field
                id="value"
                label={editing.form.kind === 'percent' ? t('f_value_percent') : t('f_value_rupees')}
                error={errorFor(fieldError, 'value', t)}
              >
                <input
                  id="coupon-value"
                  inputMode="decimal"
                  value={editing.form.value}
                  onChange={(e) => {
                    set('value', e.target.value);
                  }}
                  className={portalField}
                />
              </Field>
            ) : null}
            {editing.form.kind === 'percent' ? (
              <Field
                id="capRupees"
                label={t('f_cap')}
                hint={t('f_cap_hint')}
                error={errorFor(fieldError, 'capRupees', t)}
              >
                <input
                  id="coupon-capRupees"
                  inputMode="decimal"
                  value={editing.form.capRupees}
                  onChange={(e) => {
                    set('capRupees', e.target.value);
                  }}
                  className={portalField}
                />
              </Field>
            ) : null}
            <Field
              id="minRupees"
              label={t('f_min')}
              hint={t('f_min_hint')}
              error={errorFor(fieldError, 'minRupees', t)}
            >
              <input
                id="coupon-minRupees"
                inputMode="decimal"
                value={editing.form.minRupees}
                onChange={(e) => {
                  set('minRupees', e.target.value);
                }}
                className={portalField}
              />
            </Field>
            <Field
              id="startsAtIst"
              label={t('f_starts')}
              hint={t('f_ist')}
              error={errorFor(fieldError, 'startsAtIst', t)}
            >
              <input
                id="coupon-startsAtIst"
                type="datetime-local"
                value={editing.form.startsAtIst}
                onChange={(e) => {
                  set('startsAtIst', e.target.value);
                }}
                className={portalField}
              />
            </Field>
            <Field
              id="endsAtIst"
              label={t('f_ends')}
              hint={t('f_ends_hint')}
              error={errorFor(fieldError, 'endsAtIst', t)}
            >
              <input
                id="coupon-endsAtIst"
                type="datetime-local"
                value={editing.form.endsAtIst}
                onChange={(e) => {
                  set('endsAtIst', e.target.value);
                }}
                className={portalField}
              />
            </Field>
            <Field
              id="usageLimitTotal"
              label={t('f_limit_total')}
              hint={t('f_limit_total_hint')}
              error={errorFor(fieldError, 'usageLimitTotal', t)}
            >
              <input
                id="coupon-usageLimitTotal"
                inputMode="numeric"
                value={editing.form.usageLimitTotal}
                onChange={(e) => {
                  set('usageLimitTotal', e.target.value);
                }}
                className={portalField}
              />
            </Field>
            <Field
              id="usageLimitPerUser"
              label={t('f_limit_user')}
              error={errorFor(fieldError, 'usageLimitPerUser', t)}
            >
              <input
                id="coupon-usageLimitPerUser"
                inputMode="numeric"
                value={editing.form.usageLimitPerUser}
                onChange={(e) => {
                  set('usageLimitPerUser', e.target.value);
                }}
                className={portalField}
              />
            </Field>
            <Field id="city" label={t('f_city')} hint={t('f_city_hint')}>
              <input
                id="coupon-city"
                value={editing.form.city}
                onChange={(e) => {
                  set('city', e.target.value.toUpperCase());
                }}
                maxLength={3}
                placeholder="RPR"
                className={portalField}
              />
            </Field>
            <Field id="funder" label={t('f_funder')} hint={t('f_funder_hint')}>
              <select
                id="coupon-funder"
                value={editing.form.funder}
                onChange={(e) => {
                  set('funder', e.target.value === 'shop' ? 'shop' : 'mechdost');
                }}
                disabled={(editing.coupon?.usedCount ?? 0) > 0}
                className={portalField}
              >
                <option value="mechdost">{t('funder_mechdost')}</option>
                <option value="shop" disabled={editing.form.kind === 'free_shipping'}>
                  {t('funder_shop')}
                </option>
              </select>
            </Field>
            {editing.form.funder === 'shop' ? (
              <Field
                id="shopId"
                label={t('f_shop')}
                hint={t('f_shop_hint')}
                error={errorFor(fieldError, 'shopId', t)}
              >
                <select
                  id="coupon-shopId"
                  value={editing.form.shopId}
                  onChange={(e) => {
                    set('shopId', e.target.value);
                  }}
                  disabled={(editing.coupon?.usedCount ?? 0) > 0}
                  className={portalField}
                >
                  <option value="">{t('f_shop_pick')}</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {localName(s, locale)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {editing.form.kind !== 'free_shipping' ? (
              <Field id="categorySlug" label={t('f_category')} hint={t('f_category_hint')}>
                <select
                  id="coupon-categorySlug"
                  value={editing.form.categorySlug}
                  onChange={(e) => {
                    set('categorySlug', e.target.value);
                  }}
                  className={portalField}
                >
                  <option value="">{t('f_category_any')}</option>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              id="coupon-isPublic"
              type="checkbox"
              checked={editing.form.isPublic}
              onChange={(e) => {
                set('isPublic', e.target.checked);
              }}
              className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
            />
            <span>
              {t('f_public')}
              <span className="block text-xs text-muted">{t('f_public_hint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              id="coupon-autoApply"
              type="checkbox"
              checked={editing.form.autoApply}
              disabled={editing.form.funder === 'shop'}
              aria-invalid={fieldError?.field === 'autoApply'}
              onChange={(e) => {
                set('autoApply', e.target.checked);
              }}
              className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
            />
            <span>
              {t('f_auto')}
              <span className="block text-xs text-muted">{t('f_auto_hint')}</span>
              {errorFor(fieldError, 'autoApply', t) ? (
                <span role="alert" className="block text-xs font-bold text-error">
                  {errorFor(fieldError, 'autoApply', t)}
                </span>
              ) : null}
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={editing.form.firstOrderOnly}
              onChange={(e) => {
                set('firstOrderOnly', e.target.checked);
                if (e.target.checked) set('usageLimitPerUser', '1');
              }}
              className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
            />
            <span>{t('f_first')}</span>
          </label>
          {editing.coupon?.funder === 'shop' ? (
            <p className="rounded-card bg-warning-bg px-3 py-2 text-sm text-warning">{t('a_reask')}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={working} className={portalPrimary}>
              {working ? t('a_saving') : t('a_save')}
            </button>
            <button
              data-panel-cancel={editing.coupon ? `coupon-${editing.coupon.id}` : 'coupon-new'}
              type="button"
              className={portalQuiet}
              onClick={() => {
                setEditing(null);
                setFieldError(null);
                setError(null);
              }}
            >
              {t('a_cancel')}
            </button>
          </div>
        </form>
      ) : null}

      {load.kind === 'loading' ? <p className="text-sm text-muted">{t('a_loading')}</p> : null}
      {load.kind === 'error' ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t(adminErrorKey(load.code))}
        </p>
      ) : null}
      {load.kind === 'ok' && load.coupons.length === 0 && !editing ? (
        <div className={`${adminCard} text-center`}>
          <p className="font-heading text-lg font-extrabold text-ink">{t('a_empty_title')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted">{t('a_empty')}</p>
        </div>
      ) : null}
      {load.kind === 'ok' ? (
        <ul className="space-y-3">
          {load.coupons.map((c) => {
            const status = couponStatus(c, now);
            return (
              <li key={c.id} className={adminCard}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-heading text-lg font-extrabold text-ink">
                      <span className="font-mono">{c.code}</span>
                      <span className="ml-2 rounded-pill bg-pill px-2 py-0.5 text-xs font-bold text-ink">
                        {t(`status_${status}`)}
                      </span>
                    </p>
                    <p className="text-sm text-muted">{locale === 'hi' && c.titleHi ? c.titleHi : c.title}</p>
                  </div>
                  <p className="text-sm text-ink">
                    {c.funder === 'shop' && c.shop
                      ? t('funder_shop_named', { shop: localName(c.shop, locale) })
                      : t('funder_mechdost')}
                  </p>
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
                  {conditionLines({ ...c, endsAt: c.endsAt }).map((line) => (
                    <li key={line.key}>
                      {t(line.key, {
                        value: line.key === 'cond_percent' ? (line.value ?? 0) : formatPrice(line.value ?? 0),
                        date: line.at ? formatDate(line.at, locale) : '',
                      })}
                    </li>
                  ))}
                  <li>
                    {t('a_uses', {
                      used: c.usedCount,
                      total: c.usageLimitTotal === null ? '∞' : String(c.usageLimitTotal),
                    })}
                  </li>
                  <li>{t('a_per_user', { n: c.usageLimitPerUser })}</li>
                  <li>{c.cityCode ?? t('a_all_cities')}</li>
                  {c.isPublic ? <li>{t('badge_public')}</li> : null}
                  {c.autoApply ? <li>{t('badge_auto')}</li> : null}
                  {c.category ? (
                    <li>{t('badge_category', { name: localName(c.category, locale) })}</li>
                  ) : null}
                </ul>
                {c.pausedReason ? (
                  <p className="mt-2 text-sm text-muted">
                    {t('a_paused_why')} <span data-user-content>{c.pausedReason}</span>
                  </p>
                ) : null}
                {pausing?.id === c.id ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`coupon-pause-${c.id}`} className="text-sm font-bold text-ink">
                        {t('a_pause_reason')}
                      </label>
                      <input
                        id={`coupon-pause-${c.id}`}
                        value={pausing.reason}
                        onChange={(e) => {
                          setPausing({ id: c.id, reason: e.target.value });
                        }}
                        maxLength={300}
                        className={portalField}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={working}
                      className={portalPrimary}
                      onClick={() => void onPause(c, true)}
                    >
                      {t('a_pause_confirm')}
                    </button>
                    <button
                      data-panel-cancel={`pause-${c.id}`}
                      type="button"
                      className={portalQuiet}
                      onClick={() => {
                        setPausing(null);
                      }}
                    >
                      {t('a_cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      data-disclosure-trigger={`coupon-${c.id}`}
                      type="button"
                      className={portalQuiet}
                      onClick={() => {
                        setSaved(null);
                        setError(null);
                        setEditing({ coupon: c, form: formFromCoupon(c) });
                      }}
                    >
                      {t('a_edit_btn')}
                    </button>
                    <button
                      data-disclosure-trigger={`usage-${c.id}`}
                      type="button"
                      aria-expanded={usageFor === c.id}
                      className={portalQuiet}
                      onClick={() => {
                        setUsageFor(usageFor === c.id ? null : c.id);
                      }}
                    >
                      {t('u_open')}
                    </button>
                    {c.active ? (
                      <button
                        data-disclosure-trigger={`pause-${c.id}`}
                        type="button"
                        className={portalQuiet}
                        onClick={() => {
                          setPausing({ id: c.id, reason: '' });
                        }}
                      >
                        {t('a_pause')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={working}
                        className={portalQuiet}
                        onClick={() => void onPause(c, false)}
                      >
                        {t('a_resume')}
                      </button>
                    )}
                  </div>
                )}
                {usageFor === c.id ? (
                  <AdminCouponUsage
                    couponId={c.id}
                    onClose={() => {
                      setUsageFor(null);
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {load.kind === 'ok' && load.next ? (
        <button type="button" className={portalQuiet} onClick={() => void more()}>
          {t('a_more')}
        </button>
      ) : null}
    </section>
  );
}

function errorFor(
  e: { field: FormField; key: FormErrorKey } | null,
  field: FormField,
  t: (k: FormErrorKey) => string,
): string | null {
  return e?.field === field ? t(e.key) : null;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={`coupon-${id}`} className="block text-sm font-bold text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-bold text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
