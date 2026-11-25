'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  AdminBulkMrpResult,
  AdminBulkStatusResult,
  AdminProductDetail,
  type AdminProductDetailDto,
} from '@mechdost/shared/admin-catalogue';
import { adminApi } from '@/lib/admin-api';
import { errorKey } from '@/lib/admin-prices-view';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';
import { productFullName } from '@/lib/product-name';

/** Most products the MRP panel opens at once (it loads each product's packs). The API accepts up to 500 packs. */
export const MRP_PANEL_MAX = 25;

/**
 * Bulk bar of the admin product list (design 2026-11-22): publish or unpublish the selected products, or set the
 * MRP of their packs. One audited batch per action (the API caps it at 500); products that cannot move are
 * reported, never forced. The result is announced in a live region and focus returns to the bar.
 */
export function BulkBar({
  slugs,
  onChanged,
  onClear,
  announce,
}: {
  slugs: readonly string[];
  onChanged: () => void;
  onClear: () => void;
  announce: (text: string) => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [mrpOpen, setMrpOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  async function status(action: 'publish' | 'unpublish') {
    setBusy(true);
    const res = await adminApi(locale, '/admin/catalogue/products/bulk-status', AdminBulkStatusResult, {
      method: 'POST',
      body: { slugs, action },
    });
    setBusy(false);
    if (!res.ok) {
      announce(t(errorKey(res.code) as 'cat_err_generic'));
      return;
    }
    track('click', { id: `admin_bulk_${action}`, path: window.location.pathname });
    announce(t('cat_bulk_result', { changed: res.data.changed.length, skipped: res.data.skipped.length }));
    onChanged();
    barRef.current?.focus();
  }

  return (
    <div
      ref={barRef}
      tabIndex={-1}
      className={`${adminCard} space-y-3`}
      aria-label={t('cat_bulk_label')}
      role="region"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-ink">{t('cat_selected', { count: slugs.length })}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void status('publish')}
          className={portalPrimary}
        >
          {t('cat_bulk_publish')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void status('unpublish')}
          className={portalQuiet}
        >
          {t('cat_bulk_unpublish')}
        </button>
        <button
          type="button"
          disabled={busy || slugs.length > MRP_PANEL_MAX}
          aria-expanded={mrpOpen}
          onClick={() => {
            setMrpOpen((v) => !v);
          }}
          className={portalQuiet}
        >
          {t('cat_bulk_mrp')}
        </button>
        <button type="button" onClick={onClear} className={portalQuiet}>
          {t('cat_bulk_clear')}
        </button>
      </div>
      {slugs.length > MRP_PANEL_MAX ? (
        <p className="text-xs text-muted">{t('cat_mrp_tooMany', { max: MRP_PANEL_MAX })}</p>
      ) : null}
      {mrpOpen && slugs.length <= MRP_PANEL_MAX ? (
        <MrpPanel
          slugs={slugs}
          announce={announce}
          onSaved={() => {
            setMrpOpen(false);
            onChanged();
            barRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function MrpPanel({
  slugs,
  announce,
  onSaved,
}: {
  slugs: readonly string[];
  announce: (text: string) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [details, setDetails] = useState<AdminProductDetailDto[] | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = slugs.join(',');
  useEffect(() => {
    let live = true;
    void Promise.all(
      key.split(',').map((s) => adminApi(locale, `/admin/catalogue/products/${s}`, AdminProductDetail)),
    ).then((all) => {
      if (!live) return;
      setDetails(all.flatMap((r) => (r.ok ? [r.data] : [])));
    });
    return () => {
      live = false;
    };
  }, [locale, key]);

  const packs = (details ?? []).flatMap((d) =>
    d.variants.filter((v) => !onlyMissing || v.mrpPaise === null).map((v) => ({ ...v, product: d })),
  );

  async function save() {
    const items: { sku: string; mrpPaise: number }[] = [];
    for (const [sku, raw] of Object.entries(values)) {
      if (raw.trim() === '') continue;
      const parsed = parseRupees(raw);
      if (!parsed.ok) {
        setError(t('cat_err_format'));
        return;
      }
      items.push({ sku, mrpPaise: parsed.paise });
    }
    if (items.length === 0) {
      setError(t('cat_err_empty'));
      return;
    }
    setError(null);
    setBusy(true);
    const res = await adminApi(locale, '/admin/catalogue/mrps', AdminBulkMrpResult, {
      method: 'PUT',
      body: { items },
    });
    setBusy(false);
    if (!res.ok) {
      setError(t(errorKey(res.code) as 'cat_err_generic'));
      return;
    }
    track('click', { id: 'admin_bulk_mrp_saved', path: window.location.pathname });
    announce(t('cat_mrp_saved', { count: res.data.updated.length, skipped: res.data.skipped.length }));
    onSaved();
  }

  if (!details) return <p className="text-sm text-muted">{t('cat_loading')}</p>;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-bold text-ink">
        <input
          type="checkbox"
          checked={onlyMissing}
          onChange={(e) => {
            setOnlyMissing(e.target.checked);
          }}
        />
        {t('cat_mrp_onlyMissing')}
      </label>
      {packs.length === 0 ? <p className="text-sm text-muted">{t('cat_mrp_none')}</p> : null}
      <ul className="divide-y divide-line-card">
        {packs.map((p) => (
          <li key={p.sku} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink" data-user-content>
                {productFullName(p.product.brand, p.product.name)}
              </p>
              <p className="text-xs text-muted">
                {p.sku} · {p.mrpPaise === null ? t('cat_mrpNone') : formatPrice(p.mrpPaise)}
              </p>
            </div>
            <div>
              <label htmlFor={`mrp-${p.sku}`} className="sr-only">
                {t('cat_mrp_input', { sku: p.sku })}
              </label>
              <input
                id={`mrp-${p.sku}`}
                inputMode="decimal"
                value={values[p.sku] ?? ''}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [p.sku]: e.target.value }));
                }}
                placeholder="₹"
                className={`${portalField} w-28`}
              />
            </div>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy || packs.length === 0}
        onClick={() => void save()}
        className={portalPrimary}
      >
        {t('cat_mrp_save')}
      </button>
    </div>
  );
}
