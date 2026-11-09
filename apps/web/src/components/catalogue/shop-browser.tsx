'use client';

import { useCategoryEmoji } from '@/demo/site-config';
import { CATEGORY_EMOJI, UI_EMOJI } from '@/lib/emoji';
import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import type { ListingQuery } from '@/app/[locale]/shop/actions';
import {
  CATEGORY_KEYS,
  CATEGORY_SLUGS,
  categoryFromSlug,
  searchProducts,
  type CategoryKey,
  type SortKey,
} from '@/demo/catalogue';
import { track } from '@/lib/analytics';
import type { Locale } from '@/i18n/routing';
import { whatsappLink } from '@/lib/site';

const SORTS: SortKey[] = ['popular', 'price_asc', 'price_desc'];

interface State {
  query: string;
  category: CategoryKey | undefined;
  sort: SortKey;
}

function urlFor(base: string, s: State): string {
  const params = new URLSearchParams();
  if (s.query) params.set('q', s.query);
  if (s.category) params.set('category', CATEGORY_SLUGS[s.category]);
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
    sort: SORTS.find((s) => s === sort) ?? 'popular',
  };
}

/**
 * Instant catalogue filtering (user, 2026-11-01: switching categories must not reload or jump to the top).
 * Product cards are rendered on the server once and passed in; this island only filters and orders them,
 * keeps the URL in sync with `history.pushState` (shareable, Back works) and never scrolls.
 * Without JavaScript the same form and links still work as normal GET navigations.
 *
 * Data mode `api` (`server` set): the server already filtered, so changing a filter navigates (the URL is the
 * query; `scroll: false`, focus stays on the control) and the page re-renders with the API's results; "Load
 * more" appends the next page from a server function, moves focus to the first new card and announces it.
 */
export interface ServerListing {
  locale: Locale;
  slugs: string[];
  nextCursor: string | null;
  loadMore: (
    query: ListingQuery,
    cursor: string,
  ) => Promise<{ cards: { slug: string; node: ReactNode }[]; nextCursor: string | null }>;
}

/** The API's sort for the shop's sort key: "popular" has no API ranking yet (search uses relevance). */
function apiSort(sort: SortKey): ListingQuery['sort'] {
  return sort === 'popular' ? null : sort;
}

export function ShopBrowser({
  basePath,
  initial,
  cards,
  sourcingMessage,
  whatsappNote,
  server,
}: {
  basePath: string;
  initial: State;
  cards: Record<string, ReactNode>;
  sourcingMessage: string;
  whatsappNote: string;
  server?: ServerListing;
}) {
  const c = useTranslations('catalogue');
  const cat = useTranslations('categories');
  const emoji = useCategoryEmoji();
  const shop = useTranslations('pages.shop');
  const product = useTranslations('product');
  const [state, setState] = useState<State>(initial);
  const [draft, setDraft] = useState(initial.query);
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  // Cards appended by "Load more", tied to the listing they belong to (a new search starts empty).
  const listingKey = server ? `${server.slugs.join(',')}|${server.nextCursor ?? ''}` : '';
  const [more, setMore] = useState<{
    key: string;
    cards: { slug: string; node: ReactNode }[];
    nextCursor: string | null;
  } | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [announcement, setAnnouncement] = useState('');
  const firstNew = useRef<HTMLLIElement>(null);
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  const appended = more?.key === listingKey ? more : null;
  const nextCursor = appended ? appended.nextCursor : (server?.nextCursor ?? null);

  const demoResults = useMemo(
    () =>
      searchProducts({
        query: state.query,
        category: state.category,
        sort: state.sort,
        categoryLabel: (k) => cat(k),
      }),
    [state, cat],
  );
  const results: { slug: string }[] = server ? server.slugs.map((slug) => ({ slug })) : demoResults;
  const shownCount = results.length + (appended?.cards.length ?? 0);

  // After "Load more", focus the first new card (it is in the DOM once this render commits).
  useEffect(() => {
    if (focusSlug) firstNew.current?.focus();
  }, [focusSlug]);

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

  function apply(next: State) {
    setState(next);
    if (server) {
      startNavigation(() => {
        router.push(urlFor(basePath, next), { scroll: false });
      });
      return;
    }
    window.history.pushState(null, '', urlFor(basePath, next));
  }

  async function loadMore() {
    if (!server || !nextCursor || loadState === 'loading') return;
    setLoadState('loading');
    setAnnouncement('');
    try {
      const page = await server.loadMore(
        {
          locale: server.locale,
          q: state.query,
          category: state.category ? CATEGORY_SLUGS[state.category] : null,
          sort: apiSort(state.sort),
        },
        nextCursor,
      );
      setMore({
        key: listingKey,
        cards: [...(appended?.cards ?? []), ...page.cards],
        nextCursor: page.nextCursor,
      });
      setLoadState('idle');
      setAnnouncement(c('loadedMore', { count: page.cards.length }));
      track('click', { id: 'shop_load_more', path: window.location.pathname });
      setFocusSlug(page.cards[0]?.slug ?? null);
    } catch {
      setLoadState('failed');
      setAnnouncement(c('loadMoreFailed'));
    }
  }

  function onSearch(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const query = draft.trim().slice(0, 120);
    if (query) track('search', { query, source: 'shop' });
    apply({ ...state, query });
  }

  const chip = (active: boolean) =>
    `press inline-flex min-h-10 items-center gap-1.5 rounded-pill border px-4 text-[13px] font-bold whitespace-nowrap transition-colors duration-[var(--duration-base)] ${
      active
        ? 'border-accent-soft bg-accent-soft text-accent-soft-text'
        : 'border-line-card bg-surface text-ink hover:bg-pill'
    }`;
  const field =
    'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted';
  const filtered = state.query !== '' || state.category !== undefined || state.sort !== 'popular';

  return (
    <div>
      <form
        role="search"
        action={basePath}
        method="get"
        onSubmit={onSearch}
        className="mt-8 grid gap-3 rounded-card border border-line-card bg-surface p-4 shadow-card tab:grid-cols-[1fr_220px_200px_auto] tab:items-end"
      >
        <div>
          <label htmlFor="shop-q" className="text-xs font-bold text-muted">
            {c('searchLabel')}
          </label>
          <input
            id="shop-q"
            name="q"
            type="search"
            value={draft}
            maxLength={120}
            placeholder={c('searchPlaceholder')}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="shop-category" className="text-xs font-bold text-muted">
            {c('categoryLabel')}
          </label>
          <select
            id="shop-category"
            name="category"
            value={state.category ? CATEGORY_SLUGS[state.category] : ''}
            onChange={(e) => {
              apply({ ...state, category: categoryFromSlug(e.target.value) });
            }}
            className={field}
          >
            <option value="">{cat('all')}</option>
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={CATEGORY_SLUGS[k]}>
                {cat(k)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="shop-sort" className="text-xs font-bold text-muted">
            {c('sortLabel')}
          </label>
          <select
            id="shop-sort"
            name="sort"
            value={state.sort}
            onChange={(e) => {
              apply({ ...state, sort: SORTS.find((s) => s === e.target.value) ?? 'popular' });
            }}
            className={field}
          >
            <option value="popular">{c('sortPopular')}</option>
            <option value="price_asc">{c('sortPriceAsc')}</option>
            <option value="price_desc">{c('sortPriceDesc')}</option>
          </select>
        </div>
        <button
          type="submit"
          className="press min-h-11 rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {c('searchSubmit')}
        </button>
      </form>

      <nav aria-label={c('categoryLabel')} className="-mx-[5%] mt-5 overflow-x-auto px-[5%] pb-2">
        <ul className="flex gap-2">
          {[undefined, ...CATEGORY_KEYS].map((k) => {
            const active = state.category === k;
            const next = { ...state, category: k };
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
                  <span aria-hidden="true" className="text-[15px] leading-none">
                    {k ? emoji(k, CATEGORY_EMOJI[k]) : UI_EMOJI.all}
                  </span>
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
          {nextCursor ? c('resultsShown', { count: shownCount }) : c('results', { count: shownCount })}
        </p>
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setDraft('');
              apply({ query: '', category: undefined, sort: 'popular' });
            }}
            className="min-h-10 text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
          >
            {c('clear')}
          </button>
        ) : null}
      </div>

      {shownCount > 0 ? (
        <>
          <ul
            aria-busy={navigating || undefined}
            className="mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 tab:grid-cols-3 nav:grid-cols-4"
          >
            {results.map((p) => (
              <li key={p.slug} className="animate-page-in">
                {cards[p.slug]}
              </li>
            ))}
            {appended?.cards.map((card) => (
              <li
                key={card.slug}
                ref={card.slug === focusSlug ? firstNew : undefined}
                tabIndex={card.slug === focusSlug ? -1 : undefined}
                className="animate-page-in"
              >
                {card.node}
              </li>
            ))}
          </ul>
          {server ? (
            <div className="mt-6 flex flex-col items-center gap-2">
              <p role="status" className="sr-only">
                {announcement}
              </p>
              {loadState === 'failed' ? (
                <p className="text-sm font-bold text-error">{c('loadMoreFailed')}</p>
              ) : null}
              {nextCursor ? (
                <button
                  type="button"
                  aria-disabled={loadState === 'loading' || undefined}
                  onClick={() => {
                    void loadMore();
                  }}
                  className="press inline-flex min-h-11 items-center rounded-button border border-input-border bg-surface px-5 text-sm font-bold text-ink hover:bg-pill aria-disabled:cursor-wait aria-disabled:opacity-70"
                >
                  {loadState === 'loading' ? c('loadingMore') : c('loadMore')}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
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
