'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { productPhotoPath, variantForWidth } from '@mechdost/shared/product-photos';
import { SUGGEST_MAX, SUGGEST_QUERY_MIN, type SuggestItemDto } from '@mechdost/shared/search-api';
import type { CategoryKey } from '@/demo/categories';
import { suggestSearch } from '@/lib/catalogue-public-api';
import { photoSrc } from '@/lib/photo-src';

/**
 * Search suggestions under the shop search box (spec 02 "Smart search"). WAI-ARIA combobox (list autocomplete,
 * manual selection): the input keeps focus and owns `role="combobox"`, `aria-controls`, `aria-expanded` and
 * `aria-activedescendant` (the host sets them from `onState`); this panel renders the listbox and a polite live
 * count, and handles ↑ ↓ Enter Esc through `handle.onKeyDown`. Loaded only on the first focus (a lazy chunk,
 * budget incident 2026-11-22, spec 16): demo mode runs the shared parser over the demo catalogue, API mode asks
 * `GET /v1/search/suggest` (cached 60 s). Closable: Esc, a click or Tab away, or an empty query.
 */

export interface SuggestState {
  open: boolean;
  activeId: string | undefined;
}

export interface SuggestHandle {
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  close: () => void;
  reopen: () => void;
}

export interface ChosenSuggestion {
  kind: SuggestItemDto['kind'];
  slug: string;
  label: string;
  position: number;
}

const DEBOUNCE_MS = 150;

export default function SearchSuggest({
  listId,
  query,
  locale,
  api,
  onState,
  onChoose,
  handle,
}: {
  listId: string;
  query: string;
  locale: string;
  api: boolean;
  onState: (s: SuggestState) => void;
  onChoose: (item: ChosenSuggestion) => void;
  handle: Ref<SuggestHandle>;
}) {
  const t = useTranslations('catalogue');
  const cat = useTranslations('categories');
  const prefix = useId();
  const [items, setItems] = useState<SuggestItemDto[]>([]);
  const [loadedFor, setLoadedFor] = useState('');
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const typed = query.trim();
  const long = Array.from(typed).length >= SUGGEST_QUERY_MIN;
  const open = long && !dismissed && items.length > 0 && loadedFor === typed;
  const optionId = (i: number) => `${prefix}-opt-${String(i)}`;

  // A new word reopens the list and starts from the top.
  const [seen, setSeen] = useState(typed);
  if (seen !== typed) {
    setSeen(typed);
    setDismissed(false);
    setActive(-1);
  }

  useEffect(() => {
    if (!long) return;
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
          const label = (k: CategoryKey) => cat(k);
          next = demo.demoSuggestions(typed, label, hi.PRODUCT_HI, locale).map((s) => ({
            kind: s.kind,
            label: s.label,
            slug: s.slug,
            subtitle: s.subtitle,
            photo: null,
          }));
        }
        if (ctl.signal.aborted) return;
        setItems(next.slice(0, SUGGEST_MAX));
        setLoadedFor(typed);
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [typed, long, api, locale, cat]);

  const activeId = open && active >= 0 ? optionId(active) : undefined;
  useEffect(() => {
    onState({ open, activeId });
  }, [open, activeId, onState]);

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    setDismissed(true);
    onChoose({ kind: item.kind, slug: item.slug, label: item.label, position: i + 1 });
  };
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  });

  useImperativeHandle(
    handle,
    () => ({
      close: () => {
        setDismissed(true);
      },
      reopen: () => {
        setDismissed(false);
      },
      onKeyDown: (e) => {
        const count = items.length;
        if (e.key === 'Escape') {
          if (open) {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(true);
          }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (count === 0 || !long) return;
          e.preventDefault();
          if (!open) {
            setDismissed(false);
            return;
          }
          const step = e.key === 'ArrowDown' ? 1 : -1;
          setActive((a) => (a < 0 ? (step === 1 ? 0 : count - 1) : (a + step + count) % count));
          return;
        }
        if (e.key === 'Enter' && open && active >= 0) {
          e.preventDefault();
          chooseRef.current(active);
        }
      },
    }),
    [items.length, open, active, long],
  );

  const count = open ? items.length : long && loadedFor === typed ? items.length : 0;
  const kindLabel = (k: SuggestItemDto['kind']) => t(`suggestKind_${k}`);

  return (
    <>
      <p role="status" className="sr-only">
        {long && loadedFor === typed ? t('suggestCount', { count }) : ''}
      </p>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('suggestLabel')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-[22rem] overflow-y-auto rounded-card border border-line-card bg-surface p-1 shadow-card"
        >
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.slug}`}
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
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-input px-3 py-1.5 text-[14px] text-ink ${
                i === active ? 'bg-pill' : ''
              }`}
            >
              {item.photo ? (
                <img
                  src={photoSrc(productPhotoPath(item.photo.path, variantForWidth(96)))}
                  alt=""
                  width={36}
                  height={36}
                  loading="lazy"
                  decoding="async"
                  className="size-9 shrink-0 rounded-tile bg-white object-contain"
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{item.label}</span>
                {item.subtitle ? (
                  <span className="block truncate text-xs text-muted">{item.subtitle}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs font-bold text-muted">{kindLabel(item.kind)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
