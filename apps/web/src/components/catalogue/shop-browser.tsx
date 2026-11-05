'use client';

import { CATEGORY_ICONS, UI_ICONS } from '@/lib/icons';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Bike,
  Car,
  CarFront,
  MessageCircle,
  PlugZap,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  CATEGORY_KEYS,
  CATEGORY_SLUGS,
  categoryFromSlug,
  vehicleFromParam,
  searchProducts,
  type CategoryKey,
  type SortKey,
  type VehicleFilter,
} from '@/demo/catalogue';
import { track } from '@/lib/analytics';
import { whatsappLink } from '@/lib/site';
import { Select, type SelectOption } from '../ui/select';

const SORTS: SortKey[] = ['popular', 'price_asc', 'price_desc'];

/** Live search waits this long after the last keystroke (user 2026-11-02: "search dynamic … with debounce"). */
const SEARCH_DEBOUNCE_MS = 300;

interface State {
  query: string;
  category: CategoryKey | undefined;
  vehicle: VehicleFilter | undefined;
  sort: SortKey;
}

function urlFor(base: string, s: State): string {
  const params = new URLSearchParams();
  if (s.query) params.set('q', s.query);
  if (s.category) params.set('category', CATEGORY_SLUGS[s.category]);
  if (s.vehicle) params.set('vehicle', s.vehicle);
  if (s.sort !== 'popular') params.set('sort', s.sort);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function readUrl(): State {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get('sort');
  return {
    query: (p.get('q') ?? '').trim().slice(0, 120),
    category: categoryFromSlug(p.get('category') ?? undefined),
    vehicle: vehicleFromParam(p.get('vehicle')),
    sort: SORTS.find((s) => s === sort) ?? 'popular',
  };
}

/**
 * Instant catalogue filtering (user, 2026-11-01: switching categories must not reload or jump to the top).
 * Product cards are rendered on the server once and passed in; this island only filters and orders them,
 * keeps the URL in sync with `history.pushState` (shareable, Back works) and never scrolls. Typing filters live
 * after a short debounce and *replaces* the URL entry, so Back does not step through every keystroke; Enter
 * applies at once.
 * Without JavaScript the same form and links still work as normal GET navigations.
 */
export function ShopBrowser({
  basePath,
  initial,
  cards,
  sourcingMessage,
  whatsappNote,
}: {
  basePath: string;
  initial: State;
  cards: Record<string, ReactNode>;
  sourcingMessage: string;
  whatsappNote: string;
}) {
  const c = useTranslations('catalogue');
  const cat = useTranslations('categories');
  const shop = useTranslations('pages.shop');
  const product = useTranslations('product');
  const [state, setState] = useState<State>(initial);
  const [draft, setDraft] = useState(initial.query);
  const stateRef = useRef(state);
  stateRef.current = state;
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const results = useMemo(
    () =>
      searchProducts({
        query: state.query,
        category: state.category,
        vehicle: state.vehicle,
        sort: state.sort,
      }),
    [state],
  );

  // Back/forward restore the filters without a reload.
  useEffect(() => {
    const onPop = () => {
      const next = readUrl();
      setState(next);
      setDraft(next.query);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  function apply(next: State, history: 'push' | 'replace' = 'push') {
    setState(next);
    const url = urlFor(basePath, next);
    if (history === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }

  function applyQuery(raw: string, history: 'push' | 'replace') {
    clearTimeout(debounce.current);
    const query = raw.trim().slice(0, 120);
    if (query === stateRef.current.query) return;
    if (query.length >= 2) track('search', { query, source: 'shop' });
    apply({ ...stateRef.current, query }, history);
  }

  // Live search: apply the query once typing pauses.
  useEffect(() => {
    debounce.current = setTimeout(() => {
      applyQuery(draft, 'replace');
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(debounce.current);
    };
    // applyQuery reads the latest state through stateRef; only typing restarts the timer.
  }, [draft]);

  function onSearch(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    applyQuery(draft, 'push');
  }

  const categoryOptions: SelectOption<string>[] = [
    { value: '', label: cat('all'), icon: UI_ICONS.all },
    ...CATEGORY_KEYS.map((k) => ({ value: CATEGORY_SLUGS[k], label: cat(k), icon: CATEGORY_ICONS[k] })),
  ];
  const vehicleOptions: SelectOption<string>[] = [
    { value: '', label: c('vehicleAny'), icon: CarFront },
    { value: '2W', label: c('vehicle2W'), icon: Bike },
    { value: '4W', label: c('vehicle4W'), icon: Car },
    { value: 'EV', label: c('vehicleEV'), icon: PlugZap },
  ];
  const sortOptions: SelectOption<SortKey>[] = [
    { value: 'popular', label: c('sortPopular'), icon: TrendingUp },
    { value: 'price_asc', label: c('sortPriceAsc'), icon: ArrowUpNarrowWide },
    { value: 'price_desc', label: c('sortPriceDesc'), icon: ArrowDownWideNarrow },
  ];

  const chip = (active: boolean) =>
    `press inline-flex min-h-10 items-center gap-1.5 rounded-pill border px-4 text-[13px] font-bold whitespace-nowrap transition-colors duration-[var(--duration-base)] ${
      active
        ? 'border-accent-soft bg-accent-soft text-accent-soft-text'
        : 'border-line-card bg-surface text-ink hover:bg-pill'
    }`;
  const filtered =
    state.query !== '' ||
    state.category !== undefined ||
    state.vehicle !== undefined ||
    state.sort !== 'popular';

  return (
    <div>
      <form
        role="search"
        action={basePath}
        method="get"
        onSubmit={onSearch}
        className="relative z-20 mt-8 grid gap-3 rounded-card border border-line-card bg-surface p-4 shadow-card tab:grid-cols-2 tab:items-end nav:grid-cols-[1fr_200px_180px_190px]"
      >
        <div>
          <label htmlFor="shop-q" className="text-xs font-bold text-muted">
            {c('searchLabel')}
          </label>
          <div className="relative mt-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted"
            />
            <input
              id="shop-q"
              name="q"
              type="search"
              value={draft}
              maxLength={120}
              autoComplete="off"
              enterKeyHint="search"
              placeholder={c('searchPlaceholder')}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              className="shop-search min-h-11 w-full rounded-input border border-input-border bg-surface pr-11 pl-10 text-[15px] text-ink placeholder:text-muted hover:border-ink"
            />
            {draft ? (
              <button
                type="button"
                aria-label={c('clearSearch')}
                data-track="shop_search_clear"
                onClick={() => {
                  setDraft('');
                  applyQuery('', 'push');
                }}
                className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"
              >
                <X aria-hidden="true" className="size-4" strokeWidth={2.5} />
              </button>
            ) : null}
          </div>
        </div>
        <div>
          <label id="shop-category-label" htmlFor="shop-category" className="text-xs font-bold text-muted">
            {c('categoryLabel')}
          </label>
          <Select
            id="shop-category"
            name="category"
            className="mt-1"
            value={state.category ? CATEGORY_SLUGS[state.category] : ''}
            options={categoryOptions}
            trackPrefix="shop_category_select"
            onChange={(slug) => {
              apply({ ...state, category: categoryFromSlug(slug) });
            }}
          />
        </div>
        <div>
          <label id="shop-vehicle-label" htmlFor="shop-vehicle" className="text-xs font-bold text-muted">
            {c('vehicleLabel')}
          </label>
          <Select
            id="shop-vehicle"
            name="vehicle"
            className="mt-1"
            value={state.vehicle ?? ''}
            options={vehicleOptions}
            trackPrefix="shop_vehicle"
            onChange={(v) => {
              apply({ ...state, vehicle: vehicleFromParam(v) });
            }}
          />
        </div>
        <div>
          <label id="shop-sort-label" htmlFor="shop-sort" className="text-xs font-bold text-muted">
            {c('sortLabel')}
          </label>
          <Select
            id="shop-sort"
            name="sort"
            className="mt-1"
            value={state.sort}
            options={sortOptions}
            trackPrefix="shop_sort"
            onChange={(sort) => {
              apply({ ...state, sort });
            }}
          />
        </div>
      </form>

      <nav aria-label={c('categoryLabel')} className="-mx-[5%] mt-5 overflow-x-auto px-[5%] pb-2">
        <ul className="flex gap-2">
          {[undefined, ...CATEGORY_KEYS].map((k) => {
            const active = state.category === k;
            const next = { ...state, category: k };
            const ChipIcon = k ? CATEGORY_ICONS[k] : UI_ICONS.all;
            return (
              <li key={k ?? 'all'}>
                <a
                  href={urlFor(basePath, next)}
                  aria-current={active ? 'page' : undefined}
                  data-track={`shop_category_${k ? CATEGORY_SLUGS[k] : 'all'}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // allow new-tab
                    e.preventDefault();
                    apply(next);
                  }}
                  className={chip(active)}
                >
                  <ChipIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
                  {k ? cat(k) : cat('all')}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm font-bold text-ink">
          {state.query ? `${shop('searchedFor', { query: state.query })} ` : ''}
          {c('results', { count: results.length })}
        </p>
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setDraft('');
              apply({ query: '', category: undefined, vehicle: undefined, sort: 'popular' });
            }}
            className="min-h-10 text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
          >
            {c('clear')}
          </button>
        ) : null}
      </div>

      {results.length > 0 ? (
        <ul className="mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 tab:grid-cols-3 nav:grid-cols-4">
          {results.map((p) => (
            <li key={p.slug} className="animate-page-in">
              {cards[p.slug]}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-card border border-line-card bg-surface p-7 shadow-card">
          <p className="max-w-2xl text-[15px] text-muted">
            {state.query ? product('noMatch', { query: state.query }) : shop('empty')}
          </p>
          <a
            href={whatsappLink(state.query ? `${sourcingMessage} ${state.query}` : sourcingMessage)}
            target="_blank"
            rel="noopener noreferrer"
            data-track="shop_empty_whatsapp"
            className="press mt-5 inline-flex min-h-11 items-center gap-2 rounded-button bg-whatsapp px-5 text-sm font-bold text-white"
          >
            <MessageCircle aria-hidden="true" className="size-4" />
            {shop('emptyAction')}
            <span className="sr-only"> ({whatsappNote})</span>
          </a>
        </div>
      )}
    </div>
  );
}
