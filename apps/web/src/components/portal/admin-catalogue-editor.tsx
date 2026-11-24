'use client';

import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  AdminBulkMrpResult,
  AdminNetQuantitySaved,
  AdminPriceBoard,
  AdminPriceSaved,
  AdminProductDetail,
  AdminProductList,
  AdminTextsSaved,
  AdminVehicleTypesSaved,
  NoContent,
  type AdminProductDetailDto,
  type AdminProductDto,
} from '@mechdost/shared/admin-catalogue';
import { NET_UNITS } from '@mechdost/shared/product-attributes';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import { DEMO_CITY } from '@/demo/city';
import { localName } from '@/lib/admin-analytics-view';
import { adminApi } from '@/lib/admin-api';
import {
  cityFloorPaise,
  errorKey,
  pinView,
  readPriceInput,
  type BoardVariant,
  type PriceBoard,
} from '@/lib/admin-prices-view';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { AddProductForm, ImportCsv } from './admin-catalogue-add';
import { BulkBar } from './admin-catalogue-bulk';
import { PhotoQueueApi } from './photo-queue-api';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';
import { ProductPhotosEditor } from './product-photos-editor';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

/** Brands and ranges (design 2026-11-22) load only when that view is opened. */
const CatalogueGroups = dynamic(() => import('./admin-catalogue-groups').then((m) => m.CatalogueGroups), {
  ssr: false,
});

interface ListFilter {
  missingHindi: boolean;
  missingMrp: boolean;
  brand: string | null;
  range: string | null;
}
const NO_FILTER: ListFilter = { missingHindi: false, missingMrp: false, brand: null, range: null };

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={`text-sm font-bold ${notice.kind === 'error' ? 'text-error' : 'text-success'}`}
    >
      {notice.text}
    </p>
  );
}

/** List of products (with missing Hindi) → the editor of one product. Real API only (see admin-catalogue.tsx). */
export function CatalogueEditor() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [view, setView] = useState<'products' | 'groups'>('products');
  const [filter, setFilter] = useState<ListFilter>(NO_FILTER);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [announce, setAnnounce] = useState('');
  const [items, setItems] = useState<AdminProductDto[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<'product' | 'import' | null>(null);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      const q = new URLSearchParams();
      if (filter.missingHindi) q.set('missingHindi', 'true');
      if (filter.missingMrp) q.set('missingMrp', 'true');
      if (filter.brand) q.set('brand', filter.brand);
      if (filter.range) q.set('range', filter.range);
      if (after) q.set('after', after);
      const res = await adminApi(locale, `/admin/catalogue/products?${q.toString()}`, AdminProductList);
      setLoading(false);
      if (!res.ok) {
        setError(errorKey(res.code));
        return;
      }
      setError(null);
      setItems((prev) => (after ? [...prev, ...res.data.items] : res.data.items));
      setNext(res.data.next);
    },
    [locale, filter],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const slugs = useMemo(() => [...selected], [selected]);
  const toggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  if (adding && !editing)
    return (
      <div className="space-y-4">
        <button
          data-panel-cancel="catalogue-add"
          type="button"
          onClick={() => {
            setAdding(null);
            void load(null);
          }}
          className={portalQuiet}
        >
          {t('cat_back')}
        </button>
        {adding === 'product' ? (
          <AddProductForm
            onCreated={(slug) => {
              setAdding(null);
              setEditing(slug);
            }}
          />
        ) : (
          <ImportCsv onImported={() => void load(null)} />
        )}
      </div>
    );

  if (editing)
    return (
      <ProductEditor
        slug={editing}
        onBack={() => {
          setEditing(null);
          void load(null);
        }}
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          data-disclosure-trigger="catalogue-add"
          type="button"
          onClick={() => {
            setAdding('product');
          }}
          className={portalPrimary}
        >
          {t('cat_add_open')}
        </button>
        <button
          data-disclosure-trigger="catalogue-add"
          type="button"
          onClick={() => {
            setAdding('import');
          }}
          className={portalQuiet}
        >
          {t('cat_import_open')}
        </button>
      </div>
      <div role="tablist" aria-label={t('cat_title')} className="flex flex-wrap gap-2">
        {(['products', 'groups'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`cat-view-${k}`}
            aria-selected={view === k}
            onClick={() => {
              setView(k);
            }}
            className={`${portalQuiet} aria-selected:border-accent-button aria-selected:bg-accent-soft`}
          >
            {t(k === 'products' ? 'grp_tab_products' : 'grp_tab_groups')}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm font-bold text-ink">
        {announce}
      </p>
      {view === 'groups' ? (
        <CatalogueGroups
          onOpenProducts={(f) => {
            setFilter({
              ...NO_FILTER,
              brand: f.brand ?? null,
              range: f.range ?? null,
              missingMrp: f.missingMrp === true,
            });
            setSelected(new Set());
            setView('products');
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', t('cat_filterAll'), !filter.missingHindi && !filter.missingMrp],
                ['hindi', t('cat_filterMissingHindi'), filter.missingHindi],
                ['mrp', t('cat_filterMissingMrp'), filter.missingMrp],
              ] as const
            ).map(([k, label, on]) => (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setFilter((f) => ({ ...f, missingHindi: k === 'hindi', missingMrp: k === 'mrp' }));
                  setSelected(new Set());
                }}
                className={`${portalQuiet} aria-pressed:border-accent-button aria-pressed:bg-accent-soft`}
              >
                {label}
              </button>
            ))}
            {filter.brand || filter.range ? (
              <button
                type="button"
                onClick={() => {
                  setFilter((f) => ({ ...f, brand: null, range: null }));
                }}
                className={portalQuiet}
              >
                {t('grp_clearFilter', { name: filter.range ?? filter.brand ?? '' })}
              </button>
            ) : null}
          </div>
          <PhotoQueueApi />
          {error ? <NoticeLine notice={{ kind: 'error', text: t(error as 'cat_err_generic') }} /> : null}
          {!loading && items.length === 0 && !error ? (
            <p className="text-sm text-muted">{t('cat_empty')}</p>
          ) : null}
          {slugs.length > 0 ? (
            <BulkBar
              slugs={slugs}
              announce={setAnnounce}
              onClear={() => {
                setSelected(new Set());
              }}
              onChanged={() => {
                setSelected(new Set());
                void load(null);
              }}
            />
          ) : null}
          {items.length > 0 ? (
            <label className="flex items-center gap-2 text-sm font-bold text-ink">
              <input
                type="checkbox"
                checked={items.length > 0 && items.every((p) => selected.has(p.slug))}
                onChange={(e) => {
                  setSelected(e.target.checked ? new Set(items.map((p) => p.slug)) : new Set());
                }}
              />
              {t('cat_select_all')}
            </label>
          ) : null}
          <ul className={`divide-y divide-line-card ${portalCard}`}>
            {items.map((p) => (
              <li key={p.slug} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <input
                  type="checkbox"
                  aria-label={t('cat_select_row', { name: `${p.brand} ${localName(p, locale)}` })}
                  checked={selected.has(p.slug)}
                  onChange={() => {
                    toggle(p.slug);
                  }}
                />
                <div className="min-w-0 flex-[1_1_10rem]">
                  <p className="font-heading font-extrabold text-ink" data-user-content>
                    {p.brand} {localName(p, locale)}
                  </p>
                  <p className="text-xs text-muted">
                    {t(`cat_status_${p.status}` as 'cat_status_live')}
                    {p.missingHindi.length > 0
                      ? ` · ${t('cat_missingHindi', { count: p.missingHindi.length })}`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(p.slug);
                  }}
                  className={portalQuiet}
                >
                  {t('cat_edit', { name: localName(p, locale) })}
                </button>
              </li>
            ))}
          </ul>
          {loading ? <p className="text-sm text-muted">{t('cat_loading')}</p> : null}
          {next && !loading ? (
            <button type="button" onClick={() => void load(next)} className={portalQuiet}>
              {t('cat_more')}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

const TABS = ['texts', 'specs', 'photos', 'prices'] as const;
type Tab = (typeof TABS)[number];

function ProductEditor({ slug, onBack }: { slug: string; onBack: () => void }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [detail, setDetail] = useState<AdminProductDetailDto | null>(null);
  const [tab, setTab] = useState<Tab>('texts');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await adminApi(locale, `/admin/catalogue/products/${slug}`, AdminProductDetail);
    if (res.ok) setDetail(res.data);
    else setError(errorKey(res.code));
  }, [locale, slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={portalQuiet}>
        {t('cat_back')}
      </button>
      {error ? <NoticeLine notice={{ kind: 'error', text: t(error as 'cat_err_generic') }} /> : null}
      {detail ? (
        <>
          <h3 className="font-heading text-lg font-extrabold text-ink" data-user-content>
            {detail.brand} {localName(detail, locale)}
          </h3>
          <div role="tablist" aria-label={t('cat_title')} className="flex flex-wrap gap-2">
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`cat-tab-${k}`}
                aria-selected={tab === k}
                aria-controls={`cat-panel-${k}`}
                onClick={() => {
                  setTab(k);
                }}
                className={`${portalQuiet} aria-selected:border-accent-button aria-selected:bg-accent-soft`}
              >
                {t(`cat_tab_${k}`)}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`cat-panel-${tab}`}
            aria-labelledby={`cat-tab-${tab}`}
            className={portalCard}
          >
            {tab === 'texts' ? <TextsTab key={detail.version} detail={detail} onSaved={reload} /> : null}
            {tab === 'specs' ? <SpecsTab detail={detail} onSaved={reload} /> : null}
            {tab === 'photos' ? <ProductPhotosEditor slug={slug} scope="staff" /> : null}
            {tab === 'prices' ? <PricesTab slug={slug} /> : null}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">{t('cat_loading')}</p>
      )}
    </div>
  );
}

/** Set or change the MRP of one pack (design 2026-11-22); never below a price already set, the API says so. */
function MrpEdit({ sku, mrp, onSaved }: { sku: string; mrp: number | null; onSaved: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [notice, setNotice] = useState<Notice>(null);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = new FormData(e.currentTarget).get('mrp');
    const parsed = parseRupees(typeof raw === 'string' ? raw : '');
    if (!parsed.ok) {
      setNotice({ kind: 'error', text: t(errorKey(parsed.error) as 'cat_err_generic') });
      return;
    }
    const res = await adminApi(locale, '/admin/catalogue/mrps', AdminBulkMrpResult, {
      method: 'PUT',
      body: { items: [{ sku, mrpPaise: parsed.paise }] },
    });
    if (!res.ok) {
      setNotice({ kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') });
      return;
    }
    const skipped = res.data.skipped[0];
    if (skipped) {
      setNotice({ kind: 'error', text: t(`cat_err_${skipped.reason}` as 'cat_err_generic') });
      return;
    }
    track('click', { id: 'admin_mrp_saved', path: window.location.pathname });
    setNotice({ kind: 'ok', text: t('cat_saved') });
    await onSaved();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={`mrp-${sku}`} className="text-xs font-bold text-muted">
          {t('cat_mrp_label')}
        </label>
        <input
          id={`mrp-${sku}`}
          name="mrp"
          inputMode="decimal"
          defaultValue={mrp === null ? '' : String(mrp / 100)}
          className={portalField}
        />
      </div>
      <button type="submit" className={portalQuiet}>
        {t('cat_mrp_set')}
      </button>
      <NoticeLine notice={notice} />
    </form>
  );
}

const TEXT_FIELDS = [
  'name',
  'nameHi',
  'specSummary',
  'specSummaryHi',
  'compatibility',
  'compatibilityHi',
  'description',
  'descriptionHi',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const LONG: ReadonlySet<TextField> = new Set(['description', 'descriptionHi']);

function TextsTab({ detail, onSaved }: { detail: AdminProductDetailDto; onSaved: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [notice, setNotice] = useState<Notice>(null);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    // Only fields that changed are sent (an empty optional text clears it).
    const patch: Partial<Record<TextField, string | null>> = {};
    for (const f of TEXT_FIELDS) {
      const raw = data.get(f);
      const value = typeof raw === 'string' ? raw.trim() : '';
      const before = detail[f] ?? '';
      if (value !== before) patch[f] = f === 'name' ? value : value || null;
    }
    const res = await adminApi(locale, `/admin/catalogue/products/${detail.slug}`, AdminTextsSaved, {
      method: 'PATCH',
      body: { version: detail.version, ...patch },
    });
    if (!res.ok) {
      setNotice({ kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') });
      if (errorKey(res.code) === 'cat_err_STALE') await onSaved();
      return;
    }
    track('click', { id: 'admin_catalogue_texts_saved', path: window.location.pathname });
    setNotice({ kind: 'ok', text: t('cat_saved') });
    await onSaved();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-3 nav:grid-cols-2">
      {TEXT_FIELDS.map((f) => (
        <div key={f} className={LONG.has(f) ? 'nav:col-span-2' : undefined}>
          <label htmlFor={`cat-${f}`} className="text-xs font-bold text-muted">
            {t(`cat_field_${f}`)}
          </label>
          {LONG.has(f) ? (
            <textarea
              id={`cat-${f}`}
              name={f}
              rows={4}
              maxLength={4000}
              defaultValue={detail[f] ?? ''}
              lang={f.endsWith('Hi') ? 'hi' : 'en'}
              className={`${portalField} py-2`}
            />
          ) : (
            <input
              id={`cat-${f}`}
              name={f}
              maxLength={f.startsWith('compatibility') ? 300 : f.startsWith('spec') ? 200 : 160}
              defaultValue={detail[f] ?? ''}
              lang={f.endsWith('Hi') ? 'hi' : 'en'}
              className={portalField}
            />
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 nav:col-span-2">
        <button type="submit" className={portalPrimary}>
          {t('cat_save')}
        </button>
        <NoticeLine notice={notice} />
      </div>
    </form>
  );
}

function SpecsTab({ detail, onSaved }: { detail: AdminProductDetailDto; onSaved: () => Promise<void> }) {
  const t = useTranslations('portal');
  const c = useTranslations('catalogue');
  const locale = useLocale();
  const [types, setTypes] = useState<string[]>(detail.vehicleTypes);
  const [notice, setNotice] = useState<Notice>(null);
  const label = { '2W': c('twoWheeler'), '3W': c('threeWheeler'), '4W': c('fourWheeler') } as const;

  async function saveTypes() {
    const res = await adminApi(
      locale,
      `/admin/catalogue/products/${detail.slug}/vehicle-types`,
      AdminVehicleTypesSaved,
      { method: 'PUT', body: { version: detail.version, vehicleTypes: types } },
    );
    setNotice(
      res.ok
        ? { kind: 'ok', text: t('cat_saved') }
        : { kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') },
    );
    await onSaved();
  }

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-sm font-extrabold text-ink">{t('cat_vehicleTypes')}</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {VEHICLE_TYPES.map((v) => (
            <label key={v} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={types.includes(v)}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setTypes((prev) => (on ? [...prev, v] : prev.filter((x) => x !== v)));
                }}
                className="size-5"
              />
              {label[v]}
            </label>
          ))}
        </div>
        <button type="button" onClick={() => void saveTypes()} className={`${portalPrimary} mt-2`}>
          {t('cat_saveVehicleTypes')}
        </button>
      </fieldset>
      <NoticeLine notice={notice} />
      {detail.variants.map((v) => (
        <PackForm key={v.sku} sku={v.sku} initial={v.netQuantity} onSaved={onSaved} />
      ))}
      <div>
        <h4 className="text-sm font-extrabold text-ink">{t('cat_attributes')}</h4>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {Object.entries(detail.attributes).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="text-ink">{String(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">{t('cat_attributesNote')}</p>
      </div>
    </div>
  );
}

function PackForm({
  sku,
  initial,
  onSaved,
}: {
  sku: string;
  initial: { qty: number; unit: (typeof NET_UNITS)[number] } | null;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [notice, setNotice] = useState<Notice>(null);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const qtyRaw = data.get('qty');
    const unit = NET_UNITS.find((u) => u === data.get('unit'));
    const qtyText = typeof qtyRaw === 'string' ? qtyRaw.trim() : '';
    if (qtyText !== '' && !/^\d{1,7}$/.test(qtyText)) {
      setNotice({ kind: 'error', text: t('cat_err_NET_QUANTITY') });
      return;
    }
    const netQuantity = qtyText === '' || !unit ? null : { qty: Number(qtyText), unit };
    const res = await adminApi(
      locale,
      `/admin/catalogue/variants/${sku}/net-quantity`,
      AdminNetQuantitySaved,
      {
        method: 'PUT',
        body: { netQuantity },
      },
    );
    setNotice(
      res.ok
        ? { kind: 'ok', text: t('cat_saved') }
        : { kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') },
    );
    if (res.ok) await onSaved();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-2">
      <h4 className="text-sm font-extrabold text-ink">{t('cat_pack', { sku })}</h4>
      <div className="grid max-w-md grid-cols-2 gap-3">
        <div>
          <label htmlFor={`pack-qty-${sku}`} className="text-xs font-bold text-muted">
            {t('cat_packQty')}
          </label>
          <input
            id={`pack-qty-${sku}`}
            name="qty"
            inputMode="numeric"
            defaultValue={initial ? String(initial.qty) : ''}
            className={portalField}
          />
        </div>
        <div>
          <label htmlFor={`pack-unit-${sku}`} className="text-xs font-bold text-muted">
            {t('cat_packUnit')}
          </label>
          <select
            id={`pack-unit-${sku}`}
            name="unit"
            defaultValue={initial?.unit ?? ''}
            className={portalField}
          >
            <option value="">{t('cat_packNone')}</option>
            {NET_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`cat_add_unit_${u}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={portalQuiet}>
          {t('cat_savePack')}
        </button>
        <NoticeLine notice={notice} />
      </div>
    </form>
  );
}

function PricesTab({ slug }: { slug: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [city, setCity] = useState<string>(DEMO_CITY.code);
  const [board, setBoard] = useState<PriceBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!/^[A-Z]{3}$/.test(city)) return;
    const res = await adminApi(locale, `/admin/prices/products/${slug}?city=${city}`, AdminPriceBoard);
    if (res.ok) {
      setBoard(res.data);
      setError(null);
    } else setError(errorKey(res.code));
  }, [city, locale, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="max-w-40">
        <label htmlFor="cat-city" className="text-xs font-bold text-muted">
          {t('cat_city', { city })}
        </label>
        <input
          id="cat-city"
          value={city}
          maxLength={3}
          onChange={(e) => {
            setCity(e.currentTarget.value.toUpperCase());
          }}
          className={portalField}
        />
      </div>
      {error ? <NoticeLine notice={{ kind: 'error', text: t(error as 'cat_err_generic') }} /> : null}
      {board?.variants.map((v) => (
        <VariantPrices key={v.sku} variant={v} city={city} onSaved={load} />
      ))}
    </div>
  );
}

function VariantPrices({
  variant: v,
  city,
  onSaved,
}: {
  variant: BoardVariant;
  city: string;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [notice, setNotice] = useState<Notice>(null);
  const floor = cityFloorPaise(v);
  const mrp = v.mrpPaise;

  async function save(raw: string, pincode: string | null, version: number | null, lowest: number | null) {
    if (mrp === null) {
      setNotice({ kind: 'error', text: t('cat_err_MRP_MISSING') });
      return;
    }
    const read = readPriceInput(raw, { mrpPaise: mrp, lowestShopPaise: lowest });
    if (!read.ok) {
      setNotice({ kind: 'error', text: t(errorKey(read.issue) as 'cat_err_generic') });
      return;
    }
    const res = await adminApi(locale, `/admin/prices/${v.sku}`, AdminPriceSaved, {
      method: 'PUT',
      body: { city, pincode, pricePaise: read.paise, version },
    });
    setNotice(
      res.ok
        ? { kind: 'ok', text: t('cat_saved') }
        : { kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') },
    );
    if (res.ok) track('click', { id: 'admin_price_saved', path: window.location.pathname });
    await onSaved();
  }

  async function clearPin(pincode: string, version: number) {
    const res = await adminApi(
      locale,
      `/admin/prices/${v.sku}/pins/${pincode}?city=${city}&version=${String(version)}`,
      NoContent,
      { method: 'DELETE' },
    );
    setNotice(
      res.ok
        ? { kind: 'ok', text: t('cat_saved') }
        : { kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') },
    );
    await onSaved();
  }

  return (
    <section
      aria-labelledby={`price-${v.sku}`}
      className="space-y-3 border-t border-line pt-4 first:border-0 first:pt-0"
    >
      <h4 id={`price-${v.sku}`} className="text-sm font-extrabold text-ink">
        {v.sku} · MRP {mrp === null ? t('cat_mrpNone') : formatPrice(mrp)}
      </h4>
      {mrp === null ? <p className="text-xs text-muted">{t('cat_err_MRP_MISSING')}</p> : null}
      <MrpEdit sku={v.sku} mrp={mrp} onSaved={onSaved} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const raw = new FormData(e.currentTarget).get('price');
          void save(typeof raw === 'string' ? raw : '', null, v.city?.version ?? null, floor);
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div>
          <label htmlFor={`city-price-${v.sku}`} className="text-xs font-bold text-muted">
            {t('cat_city', { city })}
          </label>
          <input
            id={`city-price-${v.sku}`}
            name="price"
            inputMode="decimal"
            defaultValue={v.city ? String(v.city.pricePaise / 100) : ''}
            className={portalField}
          />
        </div>
        <button type="submit" className={portalPrimary}>
          {t('cat_setCity')}
        </button>
      </form>
      <p className="text-xs text-muted">
        {floor === null
          ? t('cat_cityNoShop')
          : t('cat_cityHint', {
              floor: formatPrice(floor),
              mrp: mrp === null ? t('cat_mrpNone') : formatPrice(mrp),
            })}
      </p>
      <NoticeLine notice={notice} />
      <ul className="space-y-3">
        {v.pins.map((p) => {
          const view = pinView(p, v.city);
          const inputId = `pin-price-${v.sku}-${p.pincode}`;
          return (
            <li key={p.pincode} className="rounded-lg border border-line-card p-3 text-sm">
              <p className="font-bold text-ink">{t('cat_pin', { pin: p.pincode })}</p>
              <p className="text-muted">
                {view.customerPaise === null
                  ? t('cat_source_none')
                  : `${t('cat_customerPays', { price: formatPrice(view.customerPaise) })} · ${t(`cat_source_${view.source}`)}`}
                {view.marginPaise === null
                  ? ''
                  : ` · ${t('cat_margin', { margin: formatPrice(view.marginPaise) })}`}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const raw = new FormData(e.currentTarget).get('price');
                  void save(
                    typeof raw === 'string' ? raw : '',
                    p.pincode,
                    p.override?.version ?? null,
                    p.lowestShopPaise,
                  );
                }}
                className="mt-2 flex flex-wrap items-end gap-2"
              >
                <div>
                  <label htmlFor={inputId} className="text-xs font-bold text-muted">
                    {t('cat_pinPrice', { pin: p.pincode })}
                  </label>
                  <input
                    id={inputId}
                    name="price"
                    inputMode="decimal"
                    defaultValue={p.override ? String(p.override.pricePaise / 100) : ''}
                    className={portalField}
                  />
                </div>
                <button type="submit" className={portalQuiet}>
                  {t('cat_setPin')}
                </button>
                {p.override ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (p.override) void clearPin(p.pincode, p.override.version);
                    }}
                    className={portalQuiet}
                  >
                    {t('cat_clearPin')}
                  </button>
                ) : null}
              </form>
              {view.suggestions.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {view.suggestions.map((s) => (
                    <button
                      key={s.kind}
                      type="button"
                      onClick={() => {
                        const input = document.getElementById(inputId);
                        if (input instanceof HTMLInputElement) {
                          input.value = String(s.paise / 100);
                          input.focus();
                        }
                      }}
                      className="inline-flex min-h-11 items-center rounded-pill bg-pill px-3 text-xs font-bold text-ink"
                    >
                      {t(`cat_suggest_${s.kind}`, { price: formatPrice(s.paise) })}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
