'use client';

import { appendFresh, withPages } from '@/lib/catalogue/load-more';
import { useCategoryEmoji } from '@/demo/site-config';
import { CATEGORY_EMOJI, UI_EMOJI } from '@/lib/emoji';
import { MessageCircle } from 'lucide-react';
import { matchesRoadsideIntent } from '@mechdost/shared/roadside-intent';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  useTransition,
  type ComponentType,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from 'react';
import type { ListingQuery } from '@/app/[locale]/shop/actions';
import type { ChosenSuggestion, SuggestHandle, SuggestState } from './search-suggest';
import type { smartSearchProducts } from '@/demo/smart-search';
import { DATA_MODE } from '@/lib/data-mode';
import type { ProductHi } from '@/demo/i18n/hi-products';
import {
  CATEGORY_KEYS,
  CATEGORY_SLUGS,
  categoryFromSlug,
  searchProducts,
  type SortKey,
} from '@/demo/catalogue';
import { track } from '@/lib/analytics';
import { shopUrl, type ShopState } from '@/lib/catalogue/shop-state';
import { VEHICLE_LABEL_KEY, VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import { whatsappLink } from '@/lib/site';

const SORTS: SortKey[] = ['popular', 'price_asc', 'price_desc'];

type State = ShopState;
const urlFor = shopUrl;

/**
 * The filters of a server listing, in the shape the URL helpers use. `known` is the state the server rendered: it
 * names a sub-category slug and its parent (the browser cannot look them up).
 */
function listingState(q: ListingQuery, known: State): State {
  const sub = q.category !== null && q.category === known.sub?.slug ? known.sub : undefined;
  return {
    query: q.q,
    category: sub ? known.category : categoryFromSlug(q.category ?? undefined),
    sub,
    sort: q.sort === 'price_asc' || q.sort === 'price_desc' ? q.sort : 'popular',
    vehicle: q.vehicle ?? undefined,
  };
}

function readUrl(known: State): State {
  return stateFrom(new URLSearchParams(window.location.search), known);
}

function stateFrom(p: Pick<URLSearchParams, 'get'>, known: State): State {
  const sort = p.get('sort');
  const slug = p.get('category') ?? undefined;
  const sub = slug !== undefined && slug === known.sub?.slug ? known.sub : undefined;
  return {
    query: (p.get('q') ?? '').trim().slice(0, 120),
    category: sub ? known.category : categoryFromSlug(slug),
    sub,
    sort: SORTS.find((s) => s === sort) ?? 'popular',
    vehicle: VEHICLE_TYPES.find((v) => v === p.get('vehicle')),
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
  /** The query the server rendered; "Load more" continues exactly this list (never the on-screen state). */
  query: ListingQuery;
  /** Pages already rendered by the server (`?pages=N`). */
  pages: number;
  slugs: string[];
  nextCursor: string | null;
  /** The closest name when the search found nothing (spec 02 "Smart search"); null otherwise. */
  didYouMean: string | null;
  loadMore: (
    query: ListingQuery,
    cursor: string,
  ) => Promise<{ cards: { slug: string; node: ReactNode }[]; nextCursor: string | null }>;
}

/** What the lazy suggestion panel takes (its own file exports the full types). */
interface SuggestProps {
  listId: string;
  query: string;
  locale: string;
  api: boolean;
  onState: (s: SuggestState) => void;
  onChoose: (item: ChosenSuggestion) => void;
  handle: Ref<SuggestHandle>;
}

export function ShopBrowser({
  basePath,
  initial,
  cards,
  sourcingMessage,
  whatsappNote,
  server,
  roadside,
}: {
  basePath: string;
  initial: State;
  cards: Record<string, ReactNode>;
  sourcingMessage: string;
  whatsappNote: string;
  server?: ServerListing;
  /** The roadside card (server-rendered), only passed where the city has roadside on; shown for breakdown searches. */
  roadside?: ReactNode;
}) {
  const c = useTranslations('catalogue');
  const cat = useTranslations('categories');
  const emoji = useCategoryEmoji();
  const shop = useTranslations('pages.shop');
  const product = useTranslations('product');
  const locale = useLocale();
  const [state, setState] = useState<State>(initial);
  const [draft, setDraft] = useState(initial.query);
  // A new server render with other filters (header link, Back, a shared URL) resets the controls to match.
  const initialKey = `${initial.query}|${initial.category ?? ''}|${initial.sub?.slug ?? ''}|${initial.sort}|${initial.vehicle ?? ''}`;
  const [shownKey, setShownKey] = useState(initialKey);
  if (shownKey !== initialKey) {
    setShownKey(initialKey);
    setState(initial);
    setDraft(initial.query);
  }
  // Demo mode filters in the browser, so the URL is the source of truth: a header link to /shop or Back to a
  // filtered URL resets the controls even though the server's `initial` did not change (review B13).
  const params = useSearchParams();
  const urlKey = params.toString();
  const [shownUrl, setShownUrl] = useState(urlKey);
  if (!server && shownUrl !== urlKey) {
    setShownUrl(urlKey);
    const fromUrl = stateFrom(params, initial);
    setState(fromUrl);
    setDraft(fromUrl.query);
  }
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  // Cards appended by "Load more", tied to the listing they belong to (a new search starts empty).
  const listingKey = server ? `${server.slugs.join(',')}|${server.nextCursor ?? ''}` : '';
  const [more, setMore] = useState<{
    key: string;
    cards: { slug: string; node: ReactNode }[];
    nextCursor: string | null;
    pages: number;
  } | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [announcement, setAnnouncement] = useState('');
  const firstNew = useRef<HTMLLIElement>(null);
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  const appended = more?.key === listingKey ? more : null;
  // Read after an await: the values of the render that is current then, not of the one that started it.
  const latest = useRef({ listingKey, navigating });
  useEffect(() => {
    latest.current = { listingKey, navigating };
  });
  const nextCursor = appended ? appended.nextCursor : (server?.nextCursor ?? null);

  // The Hindi product text for the demo's in-browser search is its own chunk, fetched right after the page loads
  // (not part of the first load, spec 16 incident 2026-11-22); until it arrives only the English text matches.
  const [hiText, setHiText] = useState<Readonly<Record<string, ProductHi>>>();
  // The smart matcher (query understanding, synonyms, ranking: spec 02 "Smart search") is a lazy chunk too; until it
  // arrives the plain word match answers.
  const [smart, setSmart] = useState<typeof smartSearchProducts>();
  useEffect(() => {
    if (server) return;
    let live = true;
    void import('@/demo/i18n/hi-products').then((m) => {
      if (live) setHiText(m.PRODUCT_HI);
    });
    void import('@/demo/smart-search').then((m) => {
      if (live) setSmart(() => m.smartSearchProducts);
    });
    return () => {
      live = false;
    };
  }, [server]);
  const demoResults = useMemo(
    () =>
      (smart && state.query ? smart : searchProducts)({
        query: state.query,
        category: state.category,
        sort: state.sort,
        vehicle: state.vehicle,
        categoryLabel: (k) => cat(k),
        hi: hiText,
      }),
    [state, cat, hiText, smart],
  );
  const results: { slug: string }[] = server ? server.slugs.map((slug) => ({ slug })) : demoResults;
  const shownCount = results.length + (appended?.cards.length ?? 0);

  // After "Load more", bring the first new card to the top of the screen (below the sticky header, `scroll-padding-top`)
  // and focus it. Leaving the scroll to the browser let scroll anchoring pin the button and footer in place while the new
  // cards appeared above, out of sight (user 2026-11-23: "takes me to the footer and leaves me there"). Layout effect:
  // runs before paint, so there is no jump after the cards show.
  useLayoutEffect(() => {
    const card = firstNew.current;
    if (!focusSlug || !card) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    card.focus({ preventScroll: true });
  }, [focusSlug]);

  // Back/forward restore the filters without a reload.
  useEffect(() => {
    const onPop = () => {
      const next = readUrl(initial);
      setState(next);
      setDraft(next.query);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, [initial]);

  // Suggestions while typing (spec 02 "Smart search"): the panel is a lazy chunk fetched on the first focus.
  const listId = useId();
  const [Suggest, setSuggest] = useState<ComponentType<SuggestProps> | null>(null);
  const [suggestState, setSuggestState] = useState<SuggestState>({ open: false, activeId: undefined });
  const suggestHandle = useRef<SuggestHandle>(null);
  const armSuggest = () => {
    if (Suggest) {
      suggestHandle.current?.reopen();
      return;
    }
    void import('./search-suggest').then((m) => {
      setSuggest(() => m.default);
    });
  };
  const onSuggestState = useCallback((s: SuggestState) => {
    setSuggestState((prev) => (prev.open === s.open && prev.activeId === s.activeId ? prev : s));
  }, []);

  // Nothing found: "did you mean" (the API sends it; the demo works it out here) and the zero-result event.
  const zero = shownCount === 0 && state.query !== '';
  const [demoMean, setDemoMean] = useState<{ query: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!zero) return;
    if (server) {
      track('search_zero_results', {
        query: state.query,
        source: 'shop',
        had_suggestion: server.didYouMean !== null,
      });
      return;
    }
    let live = true;
    void import('@/demo/smart-search').then((m) => {
      if (!live) return;
      const text = m.demoDidYouMean(state.query, (k) => cat(k));
      setDemoMean({ query: state.query, text });
      track('search_zero_results', { query: state.query, source: 'shop', had_suggestion: text !== null });
    });
    return () => {
      live = false;
    };
  }, [zero, state.query, server, cat]);
  const didYouMean = server ? server.didYouMean : demoMean?.query === state.query ? demoMean.text : null;

  function chooseSuggestion(item: ChosenSuggestion) {
    track('search_suggestion_selected', { kind: item.kind, position: item.position });
    if (item.kind === 'product') {
      router.push(`${basePath}/${item.slug}`);
      return;
    }
    const category = item.kind === 'category' ? categoryFromSlug(item.slug) : undefined;
    // A sub-category suggestion filters to it (the server then names its parent); other words become the search.
    const sub =
      item.kind === 'category' && !category && server ? { slug: item.slug, name: item.label } : undefined;
    const query = category || sub ? '' : item.label;
    setDraft(query);
    apply({
      ...state,
      query,
      category: sub ? undefined : (category ?? state.category),
      sub: sub ?? (category ? undefined : state.sub),
    });
  }

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
    if (!server || !nextCursor || loadState === 'loading' || navigating) return;
    setLoadState('loading');
    setAnnouncement('');
    const startedFor = listingKey;
    try {
      const page = await server.loadMore(server.query, nextCursor);
      // A filter or sort chosen while this page was loading wins: drop the late result (review B16).
      if (latest.current.listingKey !== startedFor || latest.current.navigating) {
        setLoadState('idle');
        return;
      }
      const fresh = appendFresh(server.slugs, appended?.cards ?? [], page.cards);
      const pages = (appended?.pages ?? server.pages) + 1;
      // A transition: the new cards are server-rendered and can contain a client part whose code is not loaded yet.
      // Outside a transition React then shows the route's loading screen until it arrives, so the list collapsed to
      // "Loading…" and the page jumped to the footer (user's screen recording 2026-11-23). In a transition the current
      // page stays on screen until the new cards are ready.
      startTransition(() => {
        setMore({
          key: listingKey,
          cards: [...(appended?.cards ?? []), ...fresh],
          nextCursor: page.nextCursor,
          pages,
        });
        setFocusSlug(fresh[0]?.slug ?? null);
      });
      // Only the address changes (shareable; a fresh load of it renders the N pages once): the cards are already
      // here, so no server re-render of the whole list (370 KB at 5 pages, measured 2026-11-22). Built from the
      // listing this page belongs to, never from whatever the address bar shows now.
      window.history.replaceState(
        window.history.state,
        '',
        withPages(urlFor(basePath, listingState(server.query, initial)), pages),
      );
      setLoadState('idle');
      setAnnouncement(c('loadedMore', { count: fresh.length }));
      track('click', { id: 'shop_load_more', path: window.location.pathname });
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
  const filtered =
    state.query !== '' ||
    state.category !== undefined ||
    state.sub !== undefined ||
    state.sort !== 'popular' ||
    state.vehicle !== undefined;

  return (
    <div>
      <form
        role="search"
        action={basePath}
        method="get"
        onSubmit={onSearch}
        className="mt-8 grid gap-3 rounded-card border border-line-card bg-surface p-4 shadow-card tab:grid-cols-3 tab:items-end nav:grid-cols-[1fr_200px_180px_180px_auto]"
      >
        <div>
          <label htmlFor="shop-q" className="text-xs font-bold text-muted">
            {c('searchLabel')}
          </label>
          <div className="relative">
            <input
              id="shop-q"
              name="q"
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestState.open}
              aria-controls={suggestState.open ? listId : undefined}
              aria-activedescendant={suggestState.activeId}
              autoComplete="off"
              value={draft}
              maxLength={120}
              placeholder={c('searchPlaceholder')}
              onFocus={armSuggest}
              onKeyDown={(e) => {
                suggestHandle.current?.onKeyDown(e);
              }}
              onBlur={() => {
                suggestHandle.current?.close();
              }}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              className={field}
            />
            {Suggest ? (
              <Suggest
                listId={listId}
                query={draft}
                locale={locale}
                api={DATA_MODE === 'api'}
                onState={onSuggestState}
                onChoose={chooseSuggestion}
                handle={suggestHandle}
              />
            ) : null}
          </div>
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
              apply({ ...state, category: categoryFromSlug(e.target.value), sub: undefined });
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
          <label htmlFor="shop-vehicle" className="text-xs font-bold text-muted">
            {c('vehicleLabel')}
          </label>
          <select
            id="shop-vehicle"
            name="vehicle"
            value={state.vehicle ?? ''}
            onChange={(e) => {
              const vehicle = VEHICLE_TYPES.find((v) => v === e.target.value);
              track('click', { id: `shop_vehicle_${vehicle ?? 'all'}`, path: window.location.pathname });
              apply({ ...state, vehicle });
            }}
            className={field}
          >
            <option value="">{c('vehicleAll')}</option>
            {VEHICLE_TYPES.map((v) => (
              <option key={v} value={v}>
                {c(VEHICLE_LABEL_KEY[v])}
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
            const next = { ...state, category: k, sub: undefined };
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

      {/* A search that means "stuck on the road" shows the roadside card above the results (spec 22, 2026-11-24). */}
      {roadside && matchesRoadsideIntent(state.query) ? <div className="mt-6">{roadside}</div> : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm font-bold text-ink">
          {state.query ? `${shop('searchedFor', { query: state.query })} ` : ''}
          {nextCursor ? c('resultsShown', { count: shownCount }) : c('results', { count: shownCount })}
        </p>
        {state.sub ? (
          <button
            type="button"
            data-track="shop_sub_category_remove"
            aria-label={c('removeSub', { name: state.sub.name })}
            onClick={() => {
              apply({ ...state, sub: undefined });
            }}
            className={chip(true)}
          >
            {state.sub.name}
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setDraft('');
              apply({ query: '', category: undefined, sub: undefined, sort: 'popular', vehicle: undefined });
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
            aria-busy={navigating || loadState === 'loading' || undefined}
            className="card-grid mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 tab:grid-cols-3 nav:grid-cols-4"
          >
            {[...results.map((p) => ({ slug: p.slug, node: cards[p.slug] })), ...(appended?.cards ?? [])].map(
              (card) => (
                <li
                  key={card.slug}
                  ref={card.slug === focusSlug ? firstNew : undefined}
                  tabIndex={card.slug === focusSlug ? -1 : undefined}
                  className="animate-page-in scroll-mt-[12px]"
                >
                  {card.node}
                </li>
              ),
            )}
          </ul>
          {server ? (
            <div className="mt-6 flex flex-col items-center gap-2">
              <p role="status" className="sr-only">
                {announcement}
              </p>
              {loadState === 'failed' ? (
                <p className="text-sm font-bold text-error">{c('loadMoreFailed')}</p>
              ) : null}
              {!nextCursor && appended ? (
                <p className="text-sm text-muted">{c('endOfList', { count: shownCount })}</p>
              ) : null}
              {nextCursor ? (
                <button
                  type="button"
                  aria-disabled={loadState === 'loading' || navigating || undefined}
                  aria-busy={loadState === 'loading' || undefined}
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
          {state.query && didYouMean ? (
            <p className="mt-3 text-[15px] text-ink">
              <button
                type="button"
                data-track="shop_did_you_mean"
                onClick={() => {
                  setDraft(didYouMean);
                  apply({ ...state, query: didYouMean });
                }}
                className="min-h-11 font-bold text-accent-soft-text underline underline-offset-4"
              >
                {c('didYouMean', { suggestion: didYouMean })}
              </button>
            </p>
          ) : null}
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
