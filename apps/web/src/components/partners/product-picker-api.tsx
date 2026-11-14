'use client';

import { PackageCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';
import { searchCatalogue, type CataloguePick } from '@/lib/catalogue-public-api';
import { track } from '@/lib/analytics';
import type { ProductPickerProps } from './product-picker';

/**
 * "Products you sell" on the live catalogue (real sign-in builds, spec 07 "Real API mode"): the same dialog as the
 * demo, but the products come from `GET /v1/catalogue/products` (live products only, searched by the API with `q`,
 * 24 at a time with "Show more"), so every slug the seller ticks is one the application API accepts. Loaded with
 * `React.lazy` only in that mode (customer page: no `next/dynamic`, L103), so the demo bundle is unchanged.
 */
export function ProductPickerApi({ value, onChange, invalid, describedBy }: ProductPickerProps) {
  const t = useTranslations('apply');
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set(value));
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CataloguePick[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');

  async function load(q: string, cursor: string | null) {
    setState('loading');
    const res = await searchCatalogue({ q, locale, cursor });
    if (!res.ok) {
      setState('error');
      return;
    }
    setItems((prev) => (cursor ? [...prev, ...res.data.items] : res.data.items));
    setNext(res.data.next);
    setState('ok');
  }

  function open() {
    setDraft(new Set(value));
    setQuery('');
    dialog.current?.showModal();
    void load('', null);
    track('click', { id: 'partner_products_opened', path: window.location.pathname });
  }

  function toggle(slug: string, on: boolean) {
    setDraft((prev) => {
      const nextSet = new Set(prev);
      if (on) nextSet.add(slug);
      else nextSet.delete(slug);
      return nextSet;
    });
  }

  /** The dialog sits inside the application form: no nested <form> (it once submitted the application). */
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void load(query, null);
  }

  const categories = [...new Map(items.map((p) => [p.category.slug, p.category.name])).entries()];

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
            <div role="search" className="flex gap-2">
              <label htmlFor="products-search" className="sr-only">
                {t('productsSearch')}
              </label>
              <input
                id="products-search"
                type="search"
                value={query}
                maxLength={120}
                placeholder={t('productsSearch')}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                onKeyDown={onSearchKey}
                className="min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted"
              />
              <button
                type="button"
                onClick={() => void load(query, null)}
                className="press min-h-11 shrink-0 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {t('picker_api_search')}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5" aria-busy={state === 'loading' || undefined}>
            {categories.map(([slug, name]) => (
              <fieldset key={slug} className="mb-4">
                <legend className="text-sm font-bold text-ink">{name}</legend>
                <ul className="mt-2 space-y-1">
                  {items
                    .filter((p) => p.category.slug === slug)
                    .map((p) => (
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
                            <span className="font-bold">
                              {p.brand} {p.name}
                            </span>
                            {p.spec ? <span className="block text-xs text-muted">{p.spec}</span> : null}
                          </span>
                        </label>
                      </li>
                    ))}
                </ul>
              </fieldset>
            ))}
            {state === 'loading' ? (
              <p role="status" className="text-sm text-muted">
                {t('picker_api_loading')}
              </p>
            ) : null}
            {state === 'error' ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-sm font-bold text-error">
                  {t('picker_api_error')}
                </p>
                <button
                  type="button"
                  onClick={() => void load(query, null)}
                  className="press min-h-11 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
                >
                  {t('picker_api_retry')}
                </button>
              </div>
            ) : null}
            {state === 'ok' && items.length === 0 ? (
              <p className="text-sm text-muted">{t('productsNone')}</p>
            ) : null}
            {state === 'ok' && next ? (
              <button
                type="button"
                onClick={() => void load(query, next)}
                className="press min-h-11 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {t('picker_api_more')}
              </button>
            ) : null}
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
