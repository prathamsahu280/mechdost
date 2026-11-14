'use client';

import { PackageCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { CATEGORY_KEYS, DEMO_PRODUCTS } from '@/demo/catalogue';
import { localizeProduct } from '@/demo/i18n/localize';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';

export interface ProductPickerProps {
  value: readonly string[];
  onChange: (slugs: string[]) => void;
  invalid?: boolean;
  describedBy?: string;
}

/** Real sign-in builds post the application to the API, so they pick from the live catalogue (spec 07). */
const ProductPickerApi = lazy(() =>
  import('./product-picker-api').then((m) => ({ default: m.ProductPickerApi })),
);

/**
 * "Products you sell" (user 2026-11-13: a tick-list instead of free text). The catalogue grouped by category with
 * a search box; the seller ticks what they stock. Prices are asked after approval, one request per product.
 * Real sign-in builds (`AUTH_MODE === 'firebase'`, the mode in which the form posts to the API) use the live
 * catalogue (`product-picker-api.tsx`, loaded on demand); the demo keeps the demo catalogue.
 */
export function ProductPicker(props: ProductPickerProps) {
  if (AUTH_MODE === 'firebase')
    return (
      <Suspense fallback={<div className="skeleton h-11 w-48 rounded-button" aria-hidden="true" />}>
        <ProductPickerApi {...props} />
      </Suspense>
    );
  return <DemoProductPicker {...props} />;
}

function DemoProductPicker({ value, onChange, invalid, describedBy }: ProductPickerProps) {
  const t = useTranslations('apply');
  const cat = useTranslations('categories');
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set(value));
  const [query, setQuery] = useState('');

  const products = useMemo(
    () =>
      DEMO_PRODUCTS.map((p) => {
        const l = localizeProduct(p, locale);
        return { slug: p.slug, category: p.category, label: `${l.brand} ${l.name}`, spec: l.spec };
      }),
    [locale],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? products.filter((p) => `${p.label} ${p.spec}`.toLowerCase().includes(q)) : products;

  function open() {
    setDraft(new Set(value));
    setQuery('');
    dialog.current?.showModal();
    track('click', { id: 'partner_products_opened', path: window.location.pathname });
  }

  function toggle(slug: string, on: boolean) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={open}
        aria-invalid={invalid === true ? true : undefined}
        aria-describedby={describedBy}
        className="press inline-flex min-h-11 items-center gap-2 rounded-button border border-input-border bg-surface px-4 text-sm font-bold text-ink hover:bg-pill"
      >
        <PackageCheck aria-hidden="true" className="size-4" />
        {value.length > 0 ? t('productsChange') : t('productsButton')}
      </button>
      {value.length > 0 ? (
        <p className="mt-2 text-sm text-ink" role="status">
          {t('productsChosen', { count: value.length })}
        </p>
      ) : null}

      <dialog
        ref={dialog}
        aria-labelledby="products-dialog-title"
        className="m-auto w-[min(100%-2rem,42rem)] rounded-dialog border border-line-card bg-surface p-0 text-ink shadow-dialog"
      >
        <div className="flex max-h-[85dvh] flex-col">
          <div className="space-y-3 border-b border-line-card p-5">
            <h2 id="products-dialog-title" className="font-heading text-lg font-extrabold">
              {t('productsDialogTitle')}
            </h2>
            <label htmlFor="products-search" className="sr-only">
              {t('productsSearch')}
            </label>
            <input
              id="products-search"
              type="search"
              value={query}
              placeholder={t('productsSearch')}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className="min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {CATEGORY_KEYS.map((key) => {
              const items = shown.filter((p) => p.category === key);
              if (items.length === 0) return null;
              return (
                <fieldset key={key} className="mb-4">
                  <legend className="text-sm font-bold text-ink">{cat(key)}</legend>
                  <ul className="mt-2 space-y-1">
                    {items.map((p) => (
                      <li key={p.slug}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-pill">
                          <input
                            type="checkbox"
                            checked={draft.has(p.slug)}
                            onChange={(e) => {
                              toggle(p.slug, e.target.checked);
                            }}
                            className="size-5 accent-[var(--color-accent-button)]"
                          />
                          <span className="text-sm">
                            <span className="font-bold">{p.label}</span>
                            <span className="block text-xs text-muted">{p.spec}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })}
            {shown.length === 0 ? <p className="text-sm text-muted">{t('productsNone')}</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-card p-5">
            <p className="text-sm text-muted" aria-live="polite">
              {t('productsChosen', { count: draft.size })}
            </p>
            <button
              type="button"
              onClick={() => {
                onChange([...draft]);
                dialog.current?.close();
              }}
              className="press min-h-11 rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover"
            >
              {t('productsDone')}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
