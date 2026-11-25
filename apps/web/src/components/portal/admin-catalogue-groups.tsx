'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdminGroups,
  AdminGroupSwitched,
  AdminImportStatus,
  type AdminBrandGroup,
  type AdminGroupsDto,
  type AdminRangeGroup,
} from '@mechdost/shared/admin-catalogue';
import { HIDE_REASONS, type HideReason } from '@mechdost/shared/catalogue-groups';
import { adminApi } from '@/lib/admin-api';
import { errorKey } from '@/lib/admin-prices-view';
import { track } from '@/lib/analytics';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

type Kind = 'brand' | 'range';
interface Pending {
  kind: Kind;
  slug: string;
  name: string;
  hide: boolean;
  count: number;
}

/**
 * Admin → Catalogue → Brands and ranges (design 2026-11-22; spec 08, hard rule 8): one switch per brand and per
 * product range. Turning one off asks for a reason and shows how many products will leave the storefront (inline
 * confirm, no dialog); the answer is announced in a live region and focus returns to the switch that was used.
 * Nothing is deleted: turning it back on restores exactly what was on sale. Loaded lazily with the admin editor.
 */
/** Counts of the last real catalogue import: how many products came in, per brand, and why others were left out. */
function ImportStatusPanel() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [run, setRun] = useState<ReturnType<typeof AdminImportStatus.parse>['run'] | undefined>(undefined);
  useEffect(() => {
    void adminApi(locale, '/admin/catalogue/import-status', AdminImportStatus).then((r) => {
      setRun(r.ok ? r.data.run : null);
    });
  }, [locale]);
  if (run === undefined) return null;
  return (
    <details className={adminCard}>
      <summary className="cursor-pointer text-sm font-bold text-ink">{t('imp_title')}</summary>
      {run === null ? (
        <p className="mt-2 text-sm text-muted">{t('imp_none')}</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-muted">
            {t('imp_totals', {
              date: new Date(run.at).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN'),
              products: run.totals.products,
              imported: run.totals.imported + run.totals.updated + run.totals.unchanged,
              skipped: run.totals.skipped,
            })}
          </p>
          <ul>
            {Object.entries(run.brands)
              .filter(([, c]) => c.imported + c.updated + c.unchanged > 0)
              .map(([brand, c]) => (
                <li key={brand} data-user-content>
                  {brand}: {c.imported + c.updated + c.unchanged}
                </li>
              ))}
          </ul>
          <ul>
            {Object.entries(run.reasons).map(([reason, n]) => (
              <li key={reason}>
                {t(`imp_reason_${reason}` as 'imp_reason_invalid')}: {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

export function CatalogueGroups({
  onOpenProducts,
}: {
  onOpenProducts: (filter: { brand?: string; range?: string; missingMrp?: boolean }) => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [data, setData] = useState<AdminGroupsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState<HideReason | ''>('');
  const [busy, setBusy] = useState(false);
  const returnTo = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/catalogue/groups', AdminGroups);
    if (res.ok) {
      setData(res.data);
      setError(null);
    } else setError(errorKey(res.code));
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const focusBack = () => {
    const id = returnTo.current;
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  function open(p: Pending, triggerId: string) {
    returnTo.current = triggerId;
    setReason('');
    setPending(p);
    track('click', {
      id: p.hide ? 'admin_group_hide_open' : 'admin_group_show_open',
      path: window.location.pathname,
    });
  }

  function cancel() {
    setPending(null);
    focusBack();
  }

  async function confirm() {
    if (!pending || !data) return;
    if (pending.hide && reason === '') return;
    const group =
      pending.kind === 'brand'
        ? data.brands.find((b) => b.slug === pending.slug)
        : data.brands.flatMap((b) => b.ranges).find((r) => r.slug === pending.slug);
    if (!group) return;
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/catalogue/${pending.kind}s/${pending.slug}/visibility`,
      AdminGroupSwitched,
      {
        method: 'POST',
        body: { hidden: pending.hide, reasonCode: pending.hide ? reason : null, version: group.version },
      },
    );
    setBusy(false);
    if (!res.ok) {
      setMessage(t(errorKey(res.code) as 'cat_err_generic'));
      if (res.code === 'STALE_GROUP') await load();
      setPending(null);
      focusBack();
      return;
    }
    track('click', {
      id: pending.hide ? 'admin_group_hidden' : 'admin_group_shown',
      path: window.location.pathname,
    });
    setMessage(
      t(pending.hide ? 'grp_done_hidden' : 'grp_done_shown', {
        name: pending.name,
        count: res.data.productsAffected,
      }),
    );
    setPending(null);
    await load();
    focusBack();
  }

  const row = (g: AdminBrandGroup | AdminRangeGroup, kind: Kind) => {
    const triggerId = `grp-${kind}-${g.slug}`;
    const isPending = pending?.slug === g.slug && pending.kind === kind;
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <div className="min-w-0">
          <p className="font-heading font-extrabold text-ink" data-user-content>
            {kind === 'range' && locale === 'hi' && 'nameHi' in g && g.nameHi ? g.nameHi : g.name}
          </p>
          <p className="text-xs text-muted">
            {t('grp_counts', { products: g.products, live: g.liveProducts })}
            {g.hidden
              ? ` · ${t('grp_hidden')}${g.hiddenReason ? ` (${t(`grp_reason_${g.hiddenReason}` as 'grp_reason_other')})` : ''}`
              : ''}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs font-bold text-accent-button underline"
              onClick={() => {
                onOpenProducts(kind === 'brand' ? { brand: g.slug } : { range: g.slug });
              }}
            >
              {t('grp_viewProducts')}
            </button>
            {g.missingMrpPacks > 0 ? (
              <button
                type="button"
                className="text-xs font-bold text-accent-button underline"
                onClick={() => {
                  onOpenProducts(
                    kind === 'brand'
                      ? { brand: g.slug, missingMrp: true }
                      : { range: g.slug, missingMrp: true },
                  );
                }}
              >
                {t('grp_missingMrp', { count: g.missingMrpPacks })}
              </button>
            ) : null}
          </div>
        </div>
        <button
          id={triggerId}
          type="button"
          aria-pressed={!g.hidden}
          disabled={busy || (pending !== null && !isPending)}
          onClick={() => {
            open({ kind, slug: g.slug, name: g.name, hide: !g.hidden, count: g.liveProducts }, triggerId);
          }}
          className={g.hidden ? portalPrimary : portalQuiet}
        >
          {g.hidden ? t('grp_show', { name: g.name }) : t('grp_hide', { name: g.name })}
        </button>
        {pending && isPending ? (
          <div
            className="w-full space-y-2 rounded-xl border border-line bg-accent-soft/40 p-3"
            role="group"
            aria-label={t('grp_confirmTitle', { name: pending.name })}
          >
            <p className="text-sm font-bold text-ink">
              {pending.hide
                ? t('grp_confirmHide', { count: pending.count })
                : t('grp_confirmShow', { count: pending.count })}
            </p>
            {pending.hide ? (
              <div>
                <label htmlFor="grp-reason" className="text-xs font-bold text-muted">
                  {t('grp_reason')}
                </label>
                <select
                  id="grp-reason"
                  autoFocus
                  value={reason}
                  onChange={(e) => {
                    setReason(HIDE_REASONS.find((r) => r === e.target.value) ?? '');
                  }}
                  className={portalField}
                >
                  <option value="">{t('grp_reasonChoose')}</option>
                  {HIDE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`grp_reason_${r}` as 'grp_reason_other')}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || (pending.hide && reason === '')}
                onClick={() => void confirm()}
                className={portalPrimary}
              >
                {pending.hide ? t('grp_confirmHideButton') : t('grp_confirmShowButton')}
              </button>
              <button type="button" onClick={cancel} className={portalQuiet}>
                {t('grp_cancel')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('grp_intro')}</p>
      <ImportStatusPanel />
      <p role="status" aria-live="polite" className="min-h-5 text-sm font-bold text-ink">
        {message}
      </p>
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t(error as 'cat_err_generic')}
        </p>
      ) : null}
      {!data && !error ? <p className="text-sm text-muted">{t('cat_loading')}</p> : null}
      {data?.brands.length === 0 ? <p className="text-sm text-muted">{t('grp_empty')}</p> : null}
      <ul className="space-y-3">
        {data?.brands.map((b) => (
          <li key={b.slug} className={adminCard}>
            {row(b, 'brand')}
            {b.ranges.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-sm font-bold text-ink">
                  {t('grp_ranges', { name: b.name, count: b.ranges.length })}
                </summary>
                <ul className="divide-y divide-line-card pl-3">
                  {b.ranges.map((r) => (
                    <li key={r.slug}>{row(r, 'range')}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
