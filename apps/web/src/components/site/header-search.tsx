'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Siren, X } from 'lucide-react';
import { matchesRoadsideIntent } from '@mechdost/shared/roadside-intent';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { SUGGEST_MAX, SUGGEST_QUERY_MIN, type SuggestItemDto } from '@mechdost/shared/search-api';
import type { CategoryKey } from '@/demo/categories';
import { track } from '@/lib/analytics';
import { suggestSearch } from '@/lib/catalogue-public-api';
import type { SearchPanelProps } from './search-data';

/**
 * The search palette behind the header's search pill (v4, decision 2026-11-23). A modal dialog with a WAI-ARIA
 * combobox (list autocomplete, manual selection): ↑ ↓ move through the suggestions, Enter opens the chosen one or
 * searches the words typed (`/shop?q=…`), Esc, the close button or a tap on the dimmed page closes it. Before two
 * letters are typed it offers popular searches and categories. Suggestions: real mode asks `GET /v1/search/suggest`
 * (cached 60 s), the demo build runs the shared parser over the demo catalogue (both as in the shop's own box).
 * Loaded only on first use (lazy chunk, spec 16), so every string and link arrives as a prop.
 */

const DEBOUNCE_MS = 150;

interface Row {
  key: string;
  label: string;
  subtitle: string | null;
  kind: SuggestItemDto['kind'] | 'all' | 'roadside';
  href: string;
  /** The SKU of the size the words named (a product found by its size); null otherwise. */
  sizeSku?: string | null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled])';

export default function HeaderSearch({ data, onClose }: SearchPanelProps) {
  const { copy, prefix, api, locale } = data;
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SuggestItemDto[]>([]);
  const [loadedFor, setLoadedFor] = useState('');
  const [active, setActive] = useState(-1);
  const typed = query.trim().slice(0, 80);
  const long = Array.from(typed).length >= SUGGEST_QUERY_MIN;

  useEffect(() => {
    input.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!long) return undefined;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        let next: SuggestItemDto[] = [];
        if (api) {
          const res = await suggestSearch(typed, locale, ctl.signal);
          if (res.ok) next = res.data.items;
        } else {
          const [demo, hi] = await Promise.all([
            import('@/demo/smart-search'),
            import('@/demo/i18n/hi-products'),
          ]);
          const label = (k: CategoryKey) => data.categoryLabels[k] ?? k;
          next = demo.demoSuggestions(typed, label, hi.PRODUCT_HI, locale).map((s) => ({
            kind: s.kind,
            label: s.label,
            slug: s.slug,
            subtitle: s.subtitle,
            photo: null,
            matchedSize: null,
          }));
        }
        if (ctl.signal.aborted) return;
        setItems(next.slice(0, SUGGEST_MAX));
        setLoadedFor(typed);
        setActive(-1);
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [typed, long, api, locale, data.categoryLabels]);

  const shopHref = (q: string) => `${prefix}/shop?q=${encodeURIComponent(q)}`;
  const hrefFor = (item: SuggestItemDto) =>
    item.kind === 'product'
      ? `${prefix}/shop/${item.slug}${item.matchedSize ? `?size=${encodeURIComponent(item.matchedSize.sku)}` : ''}`
      : item.kind === 'category'
        ? `${prefix}/shop?category=${encodeURIComponent(item.slug)}`
        : shopHref(item.label);

  // The first row is always "see all results for the words typed", so Enter on an arrow-less list still searches.
  const fresh = long && loadedFor === typed;
  // A breakdown search ("puncture", "tow", "battery dead") gets "Roadside help" above everything (spec 22).
  const roadside = data.roadside && long && matchesRoadsideIntent(typed) ? data.roadside : null;
  const rows: Row[] = long
    ? [
        ...(roadside
          ? [
              {
                key: 'roadside',
                label: roadside.title,
                subtitle: roadside.body,
                kind: 'roadside' as const,
                href: roadside.href,
              },
            ]
          : []),
        {
          key: 'all',
          label: copy.seeAll.replace('{query}', typed),
          subtitle: null,
          kind: 'all',
          href: shopHref(typed),
        },
        ...(fresh
          ? items.map((item) => ({
              key: `${item.kind}:${item.slug}`,
              label: item.label,
              subtitle:
                [
                  item.subtitle,
                  item.matchedSize ? copy.sizeAvailable.replace('{size}', item.matchedSize.label) : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || null,
              kind: item.kind,
              href: hrefFor(item),
              sizeSku: item.matchedSize?.sku ?? null,
            }))
          : []),
      ]
    : [];
  const optionId = (i: number) => `${listId}-opt-${String(i)}`;
  const activeId = active >= 0 && active < rows.length ? optionId(active) : undefined;

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function choose(i: number) {
    const row = rows[i];
    if (!row) return;
    if (row.kind === 'all') track('search', { query: typed, source: 'header' });
    else if (row.kind === 'roadside')
      track('click', { id: 'header_search_roadside', path: window.location.pathname });
    else {
      track('search_suggestion_selected', { kind: row.kind, position: Math.min(Math.max(i, 1), 8) });
      if (row.kind === 'product' && row.sizeSku)
        track('search_size_match_clicked', {
          slug: row.key.slice('product:'.length),
          sku: row.sizeSku,
          source: 'suggest',
        });
    }
    go(row.href);
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (rows.length === 0) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a < 0 ? (step === 1 ? 0 : rows.length - 1) : (a + step + rows.length) % rows.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) choose(active);
      else if (typed) {
        track('search', { query: typed, source: 'header' });
        go(shopHref(typed));
      }
    }
  }

  function onDialogKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    const nodes = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const chip =
    'press m-1 inline-flex min-h-11 items-center gap-1.5 rounded-pill bg-pill px-3.5 text-[13px] font-semibold text-ink hover:bg-line';

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-navy/45 px-3 pt-[10vh] backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onKeyDown={onDialogKey}
        className="max-h-[78vh] w-[min(640px,100%)] overflow-y-auto rounded-[18px] bg-surface shadow-dialog"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search aria-hidden="true" className="size-5 shrink-0 text-muted" />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded={long && rows.length > 0}
            aria-controls={long ? listId : undefined}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={copy.title}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={80}
            placeholder={copy.placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
            }}
            onKeyDown={onInputKey}
            className="min-h-11 min-w-0 flex-1 appearance-none rounded-lg border-0 bg-transparent px-1 text-base font-semibold text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd
            aria-hidden="true"
            lang="en"
            className="hidden rounded-md bg-pill px-1.5 py-0.5 font-sans text-[11px] font-bold text-muted min-[560px]:inline"
          >
            {copy.esc}
          </kbd>
          <button
            type="button"
            aria-label={copy.close}
            data-track="header_search_close"
            onClick={onClose}
            className="press grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-pill hover:text-ink"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <p role="status" className="sr-only">
          {fresh ? copy.count.replace('{count}', String(items.length)) : ''}
        </p>

        {long ? (
          <ul id={listId} role="listbox" aria-label={copy.suggestions} className="p-2">
            {rows.map((row, i) => (
              <li
                key={row.key}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                }}
                onClick={() => {
                  choose(i);
                }}
                onMouseMove={() => {
                  if (active !== i) setActive(i);
                }}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-1.5 text-sm text-ink ${
                  i === active ? 'bg-pill' : ''
                }`}
              >
                {row.kind === 'all' ? (
                  <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
                ) : row.kind === 'roadside' ? (
                  <Siren aria-hidden="true" className="size-4 shrink-0 text-accent-soft-text" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${row.kind === 'all' ? 'font-semibold' : 'font-bold'}`}>
                    {row.label}
                  </span>
                  {row.subtitle ? (
                    <span className="block truncate text-xs text-muted">{row.subtitle}</span>
                  ) : null}
                </span>
                {row.kind === 'all' ? null : (
                  <span className="shrink-0 text-xs font-bold text-muted">
                    {row.kind === 'roadside' ? (roadside?.kind ?? '') : copy.kind[row.kind]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <section aria-label={copy.popular} className="p-2">
              <h2 className="px-3 py-1.5 text-[12.5px] font-bold text-muted">{copy.popular}</h2>
              <ul className="flex flex-wrap">
                {data.popular.map((text) => (
                  <li key={text}>
                    <Link
                      href={shopHref(text)}
                      data-track="header_search_popular"
                      onClick={() => {
                        track('search', { query: text, source: 'header' });
                        onClose();
                      }}
                      className={chip}
                    >
                      {text}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label={copy.categories} className="p-2 pt-0">
              <h2 className="px-3 py-1.5 text-[12.5px] font-bold text-muted">{copy.categories}</h2>
              <ul className="flex flex-wrap">
                {data.categories.map((c) => (
                  <li key={c.href}>
                    <Link
                      href={c.href}
                      data-track="header_search_category"
                      onClick={onClose}
                      className={chip}
                    >
                      {c.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <p className="px-5 pb-4 text-xs text-muted">{copy.hint}</p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
