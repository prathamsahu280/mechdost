'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { commonErrorKey } from '@/lib/api-error-key';
import {
  productVariants,
  searchCatalogue,
  type CataloguePick,
  type CatalogueVariantPick,
} from '@/lib/catalogue-public-api';
import { formatPrice } from '@/lib/format';
import { portalField, portalQuiet } from './portal-styles';
import { productFullName } from '@/lib/product-name';

export interface SkuChoice {
  sku: string;
  name: string;
  mrpPaise: number;
}

/**
 * Find a live product in the API catalogue and choose one of its packs (SKU). Used by staff adding a product to a
 * shop and by a shop asking to sell a product it does not list yet (real sign-in only; spec 07/08). Search runs
 * on submit (no request per keystroke); `listed` SKUs are shown but cannot be chosen again.
 */
export function CatalogueSkuPicker({
  idPrefix,
  listed,
  onPick,
}: {
  idPrefix: string;
  listed: ReadonlySet<string>;
  onPick: (choice: SkuChoice) => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CataloguePick[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<{ name: string; variants: CatalogueVariantPick[] } | null>(null);

  async function search(cursor: string | null) {
    setBusy(true);
    const res = await searchCatalogue({ q: query, locale, cursor });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    setError(null);
    setItems((prev) => (cursor && prev ? [...prev, ...res.data.items] : res.data.items));
    setNext(res.data.next);
  }

  async function choose(slug: string) {
    setBusy(true);
    const res = await productVariants(slug, locale);
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    setError(null);
    setProduct(res.data);
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setProduct(null);
    void search(null);
  }

  return (
    <div className="space-y-3" aria-busy={busy || undefined}>
      <form noValidate onSubmit={onSubmit} role="search" className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${idPrefix}-q`} className="text-xs font-bold text-muted">
            {t('shops_api_pickSearchLabel')}
          </label>
          <input
            id={`${idPrefix}-q`}
            type="search"
            value={query}
            maxLength={120}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className={portalField}
          />
        </div>
        <button type="submit" disabled={busy} className={portalQuiet}>
          {t('shops_api_pickSearch')}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t(commonErrorKey(error))}
        </p>
      ) : null}

      {product ? (
        <div className="space-y-2 rounded-tile border border-line-card p-3">
          <p className="text-sm font-bold text-ink">{product.name}</p>
          <ul className="space-y-2">
            {product.variants.map((v) => (
              <li key={v.sku} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-ink">
                  {t('shops_api_pickPack', {
                    label: v.label || v.sku,
                    mrp: formatPrice(v.mrpPaise),
                  })}{' '}
                  <span className="text-xs text-muted">{v.sku}</span>
                </span>
                {listed.has(v.sku) ? (
                  <span className="text-xs font-bold text-muted">{t('shops_api_pickListed')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onPick({ sku: v.sku, name: product.name, mrpPaise: v.mrpPaise });
                    }}
                    className={portalQuiet}
                  >
                    {t('shops_api_pickChoose')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setProduct(null);
            }}
            className={portalQuiet}
          >
            {t('shops_api_pickBack')}
          </button>
        </div>
      ) : items ? (
        items.length === 0 ? (
          <p className="text-sm text-muted">{t('shops_api_pickNone')}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((p) => (
              <li
                key={p.slug}
                className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-line-card p-3"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-bold text-ink">{productFullName(p.brand, p.name)}</span>
                  <span className="block text-xs text-muted">
                    {p.category.name}
                    {p.spec ? ` · ${p.spec}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t('shops_api_pickChooseAria', { name: productFullName(p.brand, p.name) })}
                  onClick={() => void choose(p.slug)}
                  className={portalQuiet}
                >
                  {t('shops_api_pickChoose')}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {!product && next ? (
        <button type="button" disabled={busy} onClick={() => void search(next)} className={portalQuiet}>
          {t('api_loadMore')}
        </button>
      ) : null}
    </div>
  );
}
