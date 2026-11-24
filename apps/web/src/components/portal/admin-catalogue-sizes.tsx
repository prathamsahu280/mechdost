'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { AdminVariantSaved, type AdminProductDetailDto } from '@mechdost/shared/admin-catalogue';
import { adminApi } from '@/lib/admin-api';
import { errorKey } from '@/lib/admin-prices-view';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';

type Variant = AdminProductDetailDto['variants'][number];
type Notice = { kind: 'ok' | 'error'; text: string } | null;

/** The option key a size's label is typed into: `size` for sizes, else the key the importer used (`label`, `model`). */
export function labelKeyOf(options: Record<string, unknown>): 'size' | 'label' | 'model' {
  if (typeof options.size === 'string') return 'size';
  if (typeof options.label === 'string') return 'label';
  if (typeof options.model === 'string') return 'model';
  return 'size';
}

function Line({ notice }: { notice: Notice }) {
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

/** "" = price on request (null); otherwise rupees to paise, or an error code. */
function mrpFrom(raw: string): { ok: true; paise: number | null } | { ok: false; code: string } {
  if (raw.trim() === '') return { ok: true, paise: null };
  const parsed = parseRupees(raw);
  return parsed.ok ? { ok: true, paise: parsed.paise } : { ok: false, code: parsed.error };
}

/**
 * The Sizes tab of the catalogue editor (user 2026-11-24): each size of the product with its label, MRP (empty =
 * price on request), barcode and status, plus "Add a size". Every save sends the size's version (a stale save is
 * refused and the latest is reloaded). Archiving a size hides it from the product page; its offers and stock stay.
 */
export function SizesTab({
  detail,
  onSaved,
}: {
  detail: AdminProductDetailDto;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-lg font-extrabold text-ink">{t('cat_sizes_title')}</h3>
        <p className="mt-1 text-sm text-muted">{t('cat_sizes_intro')}</p>
      </div>
      <ul className="space-y-4">
        {detail.variants.map((v) => (
          <li key={`${v.sku}-${String(v.version)}`} className="rounded-tile border border-line-card p-4">
            <SizeRow variant={v} onSaved={onSaved} />
          </li>
        ))}
      </ul>
      <AddSize slug={detail.slug} onSaved={onSaved} />
    </div>
  );
}

function SizeRow({ variant, onSaved }: { variant: Variant; onSaved: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [notice, setNotice] = useState<Notice>(null);
  const key = labelKeyOf(variant.options);
  const archived = variant.status === 'archived';
  const id = `size-${variant.sku}`;

  async function send(body: Record<string, unknown>, event: string) {
    const res = await adminApi(locale, `/admin/catalogue/variants/${variant.sku}`, AdminVariantSaved, {
      method: 'PATCH',
      body: { version: variant.version, ...body },
    });
    if (!res.ok) {
      setNotice({ kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') });
      // A stale save: load the latest so the next try starts from it.
      if (res.code === 'STALE_VARIANT') await onSaved();
      return;
    }
    track('click', { id: event, path: window.location.pathname });
    setNotice({ kind: 'ok', text: t('cat_saved') });
    await onSaved();
  }

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (name: string) => {
      const v = data.get(name);
      return typeof v === 'string' ? v.trim() : '';
    };
    const mrp = mrpFrom(text('mrp'));
    if (!mrp.ok) {
      setNotice({ kind: 'error', text: t(errorKey(mrp.code) as 'cat_err_generic') });
      return;
    }
    await send(
      {
        options: { [key]: text('label') },
        mrpPaise: mrp.paise,
        barcode: text('barcode') === '' ? null : text('barcode'),
      },
      'admin_size_saved',
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-extrabold text-ink" data-user-content>
          {variant.label}
        </h4>
        <p className="text-xs text-muted">
          <span>{variant.sku}</span>
          {archived ? <span className="ml-2 font-bold text-warning">{t('cat_size_archived')}</span> : null}
          {variant.mrpPaise !== null ? <span className="ml-2">{formatPrice(variant.mrpPaise)}</span> : null}
        </p>
      </div>
      <div className="grid gap-3 tab:grid-cols-3">
        <div>
          <label htmlFor={`${id}-label`} className="text-xs font-bold text-muted">
            {t('cat_size_label')}
          </label>
          <input
            id={`${id}-label`}
            name="label"
            defaultValue={typeof variant.options[key] === 'string' ? variant.options[key] : ''}
            maxLength={60}
            className={portalField}
          />
        </div>
        <div>
          <label htmlFor={`${id}-mrp`} className="text-xs font-bold text-muted">
            {t('cat_size_mrp')}
          </label>
          <input
            id={`${id}-mrp`}
            name="mrp"
            inputMode="decimal"
            defaultValue={variant.mrpPaise === null ? '' : String(variant.mrpPaise / 100)}
            className={portalField}
          />
        </div>
        <div>
          <label htmlFor={`${id}-barcode`} className="text-xs font-bold text-muted">
            {t('cat_size_barcode')}
          </label>
          <input
            id={`${id}-barcode`}
            name="barcode"
            defaultValue={variant.barcode ?? ''}
            maxLength={32}
            className={portalField}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={portalQuiet}>
          {t('cat_size_save')}
        </button>
        <button
          type="button"
          onClick={() => {
            void send(
              { status: archived ? 'active' : 'archived' },
              archived ? 'admin_size_restored' : 'admin_size_archived',
            );
          }}
          className={portalQuiet}
        >
          {archived ? t('cat_size_restore') : t('cat_size_archive')}
        </button>
        <Line notice={notice} />
      </div>
    </form>
  );
}

function AddSize({ slug, onSaved }: { slug: string; onSaved: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [notice, setNotice] = useState<Notice>(null);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const v = data.get(name);
      return typeof v === 'string' ? v.trim() : '';
    };
    const mrp = mrpFrom(text('mrp'));
    if (!mrp.ok) {
      setNotice({ kind: 'error', text: t(errorKey(mrp.code) as 'cat_err_generic') });
      return;
    }
    const res = await adminApi(locale, `/admin/catalogue/products/${slug}/variants`, AdminVariantSaved, {
      method: 'POST',
      body: {
        sku: text('sku').toUpperCase(),
        options: { size: text('label') },
        mrpPaise: mrp.paise,
        ...(text('barcode') === '' ? {} : { barcode: text('barcode') }),
      },
    });
    if (!res.ok) {
      setNotice({ kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') });
      return;
    }
    track('click', { id: 'admin_size_added', path: window.location.pathname });
    form.reset();
    setNotice({ kind: 'ok', text: t('cat_size_added') });
    await onSaved();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3 border-t border-line-card pt-5">
      <h4 className="text-sm font-extrabold text-ink">{t('cat_size_add')}</h4>
      <div className="grid gap-3 tab:grid-cols-2">
        <div>
          <label htmlFor="size-new-sku" className="text-xs font-bold text-muted">
            {t('cat_size_sku')}
          </label>
          <input id="size-new-sku" name="sku" required maxLength={64} className={portalField} />
        </div>
        <div>
          <label htmlFor="size-new-label" className="text-xs font-bold text-muted">
            {t('cat_size_label')}
          </label>
          <input id="size-new-label" name="label" required maxLength={60} className={portalField} />
        </div>
        <div>
          <label htmlFor="size-new-mrp" className="text-xs font-bold text-muted">
            {t('cat_size_mrp')}
          </label>
          <input id="size-new-mrp" name="mrp" inputMode="decimal" className={portalField} />
        </div>
        <div>
          <label htmlFor="size-new-barcode" className="text-xs font-bold text-muted">
            {t('cat_size_barcode')}
          </label>
          <input id="size-new-barcode" name="barcode" maxLength={32} className={portalField} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={portalPrimary}>
          {t('cat_size_add_btn')}
        </button>
        <Line notice={notice} />
      </div>
    </form>
  );
}
