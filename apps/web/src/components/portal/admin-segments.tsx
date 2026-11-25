'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { AdminSegmentSchema, AdminSegmentsSchema } from '@mechdost/shared/vehicle-segments-api';
import type { AdminSegment } from '@mechdost/shared/vehicle-segments-api';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { saveDemoSegments, useDemoSegments, type DemoSegmentRow } from '@/demo/segments';
import { ApiListState } from './api-list-state';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

const BASE = '/admin/catalogue/segments';

/** One row as the form edits it (the same shape for the live API and the demo store). */
interface Row {
  code: AdminSegment['code'];
  nameEn: string;
  nameHi: string;
  descriptionEn: string;
  descriptionHi: string;
  sort: number;
  active: boolean;
  /** The compare-and-set token (live only; the demo has none). */
  version: number;
  /** Live products with it (live only). */
  products: number | null;
}

const fromApi = (r: AdminSegment): Row => ({
  code: r.code,
  nameEn: r.nameEn,
  nameHi: r.nameHi,
  descriptionEn: r.descriptionEn ?? '',
  descriptionHi: r.descriptionHi ?? '',
  sort: r.sort,
  active: r.active,
  version: r.version,
  products: r.products,
});

const fromDemo = (r: DemoSegmentRow): Row => ({ ...r, version: 0, products: null });

/**
 * Admin → Catalogue → Vehicle segments (design 2026-11-25, spec 08, hard rule 8): rename (English and Hindi), describe,
 * reorder and switch off the vehicle types the shop filters by. Live: saved through the API per segment (compare-and-set
 * on `version`, audited). Demo: kept in this browser and applied to the shop's chips only (`demo/segments.ts`). A closable
 * panel, one list, one save per row (no stacked modals).
 */
export function AdminSegments() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const live = AUTH_MODE === 'firebase';
  const demoRows = useDemoSegments();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminApi(locale, BASE, AdminSegmentsSchema);
    setLoading(false);
    if (res.ok) setRows(res.data.segments.map(fromApi));
    else setError(res.code);
  }, [locale]);

  useEffect(() => {
    if (!open) return;
    if (live) {
      if (rows.length === 0) void load();
    } else if (rows.length === 0) {
      setRows([...demoRows].sort((a, b) => a.sort - b.sort).map(fromDemo));
    }
  }, [open, live, rows.length, load, demoRows]);

  const patch = (code: Row['code'], change: Partial<Row>) => {
    setRows((list) => list.map((r) => (r.code === code ? { ...r, ...change } : r)));
  };

  async function save(e: SyntheticEvent<HTMLFormElement>, row: Row) {
    e.preventDefault();
    if (busy) return;
    setBusy(row.code);
    setMessage(null);
    if (!live) {
      const ok = saveDemoSegments(rows);
      setBusy(null);
      setMessage({ ok, text: ok ? t('seg_saved') : t('seg_err_generic') });
      if (ok) track('admin_site_change', { area: 'segments', action: 'save', fields: 1 });
      return;
    }
    const res = await adminApi(locale, `${BASE}/${row.code}`, AdminSegmentSchema, {
      method: 'PATCH',
      body: {
        version: row.version,
        nameEn: row.nameEn,
        nameHi: row.nameHi,
        descriptionEn: row.descriptionEn.trim() === '' ? null : row.descriptionEn,
        descriptionHi: row.descriptionHi.trim() === '' ? null : row.descriptionHi,
        sort: row.sort,
        active: row.active,
      },
    });
    setBusy(null);
    if (!res.ok) {
      const stale = res.code === 'STALE_SEGMENT';
      setMessage({
        ok: false,
        text: stale ? t('seg_err_stale') : t(commonErrorKey(res.code)),
      });
      if (stale) void load();
      return;
    }
    track('admin_site_change', { area: 'segments', action: 'save', fields: 1 });
    patch(row.code, fromApi(res.data));
    setMessage({ ok: true, text: t('seg_saved') });
  }

  return (
    <section aria-labelledby="seg-title" className={`${adminCard} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="seg-title" className="font-heading text-lg font-extrabold text-ink">
            {t('seg_title')}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('seg_intro')}</p>
          {live ? null : <p className="mt-1 max-w-2xl text-sm font-bold text-ink">{t('seg_demoNote')}</p>}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="seg-panel"
          onClick={() => {
            setOpen(!open);
          }}
          className={portalQuiet}
        >
          {open ? t('seg_close') : t('seg_open')}
        </button>
      </div>
      {open ? (
        <div id="seg-panel" className="space-y-4">
          <p
            role="status"
            className={`min-h-5 text-sm font-bold ${message?.ok === false ? 'text-error' : 'text-ink'}`}
          >
            {message?.text ?? ''}
          </p>
          <ApiListState
            loading={loading}
            error={error}
            count={rows.length}
            empty={t('seg_empty')}
            onRetry={() => void load()}
          />
          <ul className="divide-y divide-line-card">
            {rows.map((r) => (
              <li key={r.code} className="py-4">
                <form
                  onSubmit={(e) => void save(e, r)}
                  aria-label={r.nameEn}
                  className="grid gap-3 tab:grid-cols-2 nav:grid-cols-4"
                >
                  <div>
                    <label htmlFor={`seg-en-${r.code}`} className="text-xs font-bold text-muted">
                      {t('seg_nameEn')}
                    </label>
                    <input
                      id={`seg-en-${r.code}`}
                      required
                      maxLength={60}
                      value={r.nameEn}
                      onChange={(e) => {
                        patch(r.code, { nameEn: e.target.value });
                      }}
                      className={portalField}
                    />
                  </div>
                  <div>
                    <label htmlFor={`seg-hi-${r.code}`} className="text-xs font-bold text-muted">
                      {t('seg_nameHi')}
                    </label>
                    <input
                      id={`seg-hi-${r.code}`}
                      required
                      lang="hi"
                      maxLength={60}
                      value={r.nameHi}
                      onChange={(e) => {
                        patch(r.code, { nameHi: e.target.value });
                      }}
                      className={portalField}
                    />
                  </div>
                  <div>
                    <label htmlFor={`seg-den-${r.code}`} className="text-xs font-bold text-muted">
                      {t('seg_descEn')}
                    </label>
                    <input
                      id={`seg-den-${r.code}`}
                      maxLength={120}
                      value={r.descriptionEn}
                      onChange={(e) => {
                        patch(r.code, { descriptionEn: e.target.value });
                      }}
                      className={portalField}
                    />
                  </div>
                  <div>
                    <label htmlFor={`seg-dhi-${r.code}`} className="text-xs font-bold text-muted">
                      {t('seg_descHi')}
                    </label>
                    <input
                      id={`seg-dhi-${r.code}`}
                      lang="hi"
                      maxLength={120}
                      value={r.descriptionHi}
                      onChange={(e) => {
                        patch(r.code, { descriptionHi: e.target.value });
                      }}
                      className={portalField}
                    />
                  </div>
                  <div>
                    <label htmlFor={`seg-sort-${r.code}`} className="text-xs font-bold text-muted">
                      {t('seg_sort')}
                    </label>
                    <input
                      id={`seg-sort-${r.code}`}
                      type="number"
                      min={0}
                      max={1000}
                      value={r.sort}
                      onChange={(e) => {
                        patch(r.code, {
                          sort: Math.min(1000, Math.max(0, Math.trunc(Number(e.target.value)) || 0)),
                        });
                      }}
                      className={portalField}
                    />
                  </div>
                  <label className="inline-flex min-h-11 items-center gap-2 self-end text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={r.active}
                      onChange={(e) => {
                        patch(r.code, { active: e.currentTarget.checked });
                      }}
                      className="size-5"
                    />
                    {t('seg_active')}
                  </label>
                  <p className="self-end text-xs text-muted">
                    {r.products === null ? '' : t('seg_products', { count: r.products })}
                  </p>
                  <button type="submit" disabled={busy !== null} className={`${portalPrimary} self-end`}>
                    {t('seg_save')}
                    <span className="sr-only"> {r.nameEn}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
