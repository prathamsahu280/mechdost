'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { FeedTab, PostView } from '@mechdost/shared/ustaad/dto/feed';
import type { ServedPromotion } from '@mechdost/shared/ustaad/dto/promotions';
import { PROMOTION_HIDE_REASONS } from '@mechdost/shared/ustaad/codes';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { feedExpired } from '@/lib/ustaad/feed-format';
import type { ApiResult } from '@/lib/orders-api';
import type { SocialClient } from '@/lib/ustaad/social-client';
import { btnPrimary, btnQuiet, card, LoadFailed, LoadingBlock, SampleNote } from '../common';
import { UstaadIcon } from '../shell/icons';
import { PostCard, type PostGone } from './post-card';
import { useSocial, useSocialAction, useSocialError } from './social-common';

/** Where the one promotion sits in a page of posts (after the third card; § 9.5 spacing is the server's job later). */
const PROMO_AFTER = 3;

/**
 * MechDost's own promotion in the feed (spec 23 § 15, SR-41): the locked label "Sponsored / प्रायोजित" is the card's
 * first line, the link is a MechDost page (built on the server), and "Hide this" asks why (reason codes). The
 * impression is counted once when the card is shown.
 */
function PromoCard({ promo, onHidden }: { promo: ServedPromotion; onHidden: () => void }) {
  const reasons = useRef<HTMLFieldSetElement>(null);
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const client = useSocialAction();
  const [asking, setAsking] = useState(false);
  const seen = useRef(false);
  useEffect(() => {
    if (asking) reasons.current?.querySelector('button')?.focus();
  }, [asking]);
  useEffect(() => {
    if (seen.current) return;
    seen.current = true;
    track('ustaad_promo_impression', { promo: promo.id, slot: 'feed' });
  }, [promo.id]);
  const hi = locale === 'hi';
  async function hide(reason: (typeof PROMOTION_HIDE_REASONS)[number]) {
    const r = await (await client()).promoHide(promo.id, reason);
    if (r.ok) {
      track('ustaad_promo_hidden', { reason });
      onHidden();
    }
  }
  return (
    <aside aria-label={hi ? promo.label.hi : promo.label.en} className={`${card} grid gap-3`}>
      <p className="text-xs font-extrabold text-warning">{hi ? promo.label.hi : promo.label.en}</p>
      <p className="font-heading text-lg font-extrabold text-ink">{hi ? promo.titleHi : promo.titleEn}</p>
      <p className="text-[15px] leading-relaxed text-muted">{hi ? promo.bodyHi : promo.bodyEn}</p>
      {asking ? (
        <fieldset ref={reasons} className="grid gap-2">
          <legend className="text-[15px] font-bold text-ink">{t('promoWhy')}</legend>
          <div className="flex flex-wrap gap-2">
            {PROMOTION_HIDE_REASONS.map((r) => (
              <button key={r} type="button" className={btnQuiet} onClick={() => void hide(r)}>
                {t(`promoReason_${r}`)}
              </button>
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Link
            href={localePath(promo.href, locale)}
            onClick={() => {
              track('ustaad_promo_click', { promo: promo.id });
              void client().then((c) => c.promoClick(promo.id));
            }}
            className={btnPrimary}
          >
            {t('promoOpen')}
          </Link>
          <button
            type="button"
            className={btnQuiet}
            onClick={() => {
              setAsking(true);
            }}
          >
            {t('promoHide')}
          </button>
        </div>
      )}
    </aside>
  );
}

export interface ListPage {
  items: PostView[];
  nextCursor: string | null;
}

/**
 * A list of post cards with "Show more" (keyset or snapshot cursor), used by Home (For you / Following), Saved, a
 * tag page and a profile. Removing a card (hide, mute, block, delete) drops it — and, for mute and block, every other
 * card by the same member — and says so in the live region. On Home's For you tab an expired snapshot (410) starts
 * the list again from the top without an error.
 */
export function PostList({
  load,
  listKey,
  empty,
  promo = false,
  first = false,
}: {
  load: (c: SocialClient, cursor: string | null) => Promise<ApiResult<ListPage>>;
  listKey: string;
  empty: React.ReactNode;
  promo?: boolean;
  first?: boolean;
}) {
  const t = useTranslations('ustaad.feed');
  const client = useSocialAction();
  const errorText = useSocialError('feed');
  const { loaded, reload, sample } = useSocial((c) => load(c, null), listKey);
  const [items, setItems] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState('');
  const [ad, setAd] = useState<ServedPromotion | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  /** A removed card takes the focus with it: put it on the status line that says what happened. */
  const focusStatus = () => {
    window.setTimeout(() => statusRef.current?.focus(), 150);
  };
  useEffect(() => {
    if (loaded.state === 'error' && feedExpired({ ok: false, status: loaded.status, code: loaded.code })) {
      reload();
      return;
    }
    if (loaded.state !== 'ok') return;
    setItems(loaded.data.items);
    setCursor(loaded.data.nextCursor);
  }, [loaded]);
  useEffect(() => {
    if (!promo) return;
    let live = true;
    void client()
      .then((c) => c.promotion('feed'))
      .then((r) => {
        if (live && r.ok) setAd(r.data);
      });
    return () => {
      live = false;
    };
  }, [promo, client]);

  async function loadMore() {
    if (!cursor || more) return;
    setMore(true);
    const r = await load(await client(), cursor);
    setMore(false);
    if (feedExpired(r)) {
      reload();
      return;
    }
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    setItems((xs) => [...xs, ...r.data.items.filter((p) => !xs.some((x) => x.id === p.id))]);
    setCursor(r.data.nextCursor);
  }

  function gone(id: string, why: PostGone, authorId: string) {
    setItems((xs) =>
      xs.filter((p) => p.id !== id && !((why === 'muted' || why === 'blocked') && p.author.id === authorId)),
    );
    setStatus(
      why === 'hidden'
        ? t('hiddenDone')
        : why === 'deleted'
          ? t('deleteDone')
          : why === 'muted'
            ? t('muteDone')
            : t('blockDone'),
    );
    focusStatus();
  }

  if (loaded.state === 'loading') return <LoadingBlock />;
  if (loaded.state === 'error')
    return feedExpired({ ok: false, status: loaded.status, code: loaded.code }) ? (
      <LoadingBlock />
    ) : (
      <LoadFailed message={errorText(loaded.code)} onRetry={reload} />
    );
  return (
    <div className="grid gap-4">
      <SampleNote show={sample} />
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="text-sm font-bold text-ink empty:sr-only focus-visible:outline-3 focus-visible:outline-focus"
      >
        {status}
      </p>
      {items.length === 0 ? empty : null}
      <ul className="grid gap-4">
        {items.map((p, i) => (
          <li key={p.id} className="grid gap-4">
            <PostCard
              post={p}
              eager={first && i === 0}
              onChange={(next) => {
                setItems((xs) => xs.map((x) => (x.id === next.id ? next : x)));
              }}
              onGone={gone}
            />
            {ad && i === Math.min(PROMO_AFTER, items.length) - 1 ? (
              <PromoCard
                promo={ad}
                onHidden={() => {
                  setAd(null);
                  setStatus(t('promoHidden'));
                  focusStatus();
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {cursor ? (
        <button
          type="button"
          className={`${btnQuiet} justify-self-center`}
          aria-disabled={more}
          onClick={() => void loadMore()}
        >
          {t('loadMore')}
        </button>
      ) : items.length > 0 ? (
        <p className="text-center text-sm text-muted">{t('feedEnd')}</p>
      ) : null}
    </div>
  );
}

/** Home's feed with its two tabs (links, so Back and shared links keep the tab). */
export function HomeFeed({ tab }: { tab: FeedTab }) {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (viewed.current === tab) return;
    viewed.current = tab;
    track('ustaad_feed_viewed', { tab });
  }, [tab]);
  const empty =
    tab === 'following' ? (
      <div className={`${card} grid justify-items-center gap-3 text-center`}>
        <p className="text-[15px] text-muted">{t('followingEmpty')}</p>
        <Link href={localePath('/ustaad/discover', locale)} className={btnPrimary}>
          <UstaadIcon name="discover" />
          {t('findUstaads')}
        </Link>
      </div>
    ) : (
      <div className={`${card} grid justify-items-center gap-2 text-center`}>
        <p className="font-heading text-lg font-extrabold text-ink">{t('emptyTitle')}</p>
        <p className="max-w-sm text-[15px] text-muted">{t('emptyBody')}</p>
        <Link href={localePath('/ustaad/create', locale)} className={`${btnPrimary} mt-2`}>
          {t('emptyCta')}
        </Link>
      </div>
    );
  const fresh = useFreshPosts(tab);
  useTabScrollMemory(tab);
  return (
    <>
      <NewPostsPill count={fresh.count} onShow={fresh.show} />
      <PostList
        key={fresh.generation}
        listKey={`feed-${tab}-${String(fresh.generation)}`}
        load={(c, cursor) => c.feed(tab, cursor)}
        empty={empty}
        promo={tab === 'for_you'}
        first
      />
    </>
  );
}

/**
 * "See new posts" (UI upgrade U1, design § 3.1; closes SIM-F4 "an open Home never refreshes"): every 90 s while the
 * page is visible and data saver is off, ask how many feed posts arrived since this list was loaded. A tap scrolls to
 * the top and loads page 1 again (a new snapshot). The pill floats (fixed), so nothing in the page moves.
 */
function useFreshPosts(tab: FeedTab) {
  const client = useSocialAction();
  const [count, setCount] = useState(0);
  const [generation, setGeneration] = useState(0);
  const since = useRef(new Date().toISOString());
  useEffect(() => {
    since.current = new Date().toISOString();
    setCount(0);
    const saveData =
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    let live = true;
    const check = async () => {
      if (!shouldPollFresh({ hidden: document.hidden, saveData })) return;
      const r = await (await client()).fresh(tab, since.current);
      if (live && r.ok) setCount(r.data.count);
    };
    const id = window.setInterval(() => void check().catch(() => undefined), FRESH_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [tab, generation, client]);
  const show = () => {
    track('ustaad_feed_new_pill_tapped', {});
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    setGeneration((g) => g + 1);
  };
  return { count, generation, show };
}

function NewPostsPill({ count, onShow }: { count: number; onShow: () => void }) {
  const t = useTranslations('ustaad.home');
  const shown = useRef(false);
  useEffect(() => {
    if (count > 0 && !shown.current) {
      shown.current = true;
      track('ustaad_feed_new_pill_shown', {});
    }
    if (count === 0) shown.current = false;
  }, [count]);
  return (
    <>
      {/* Mounted empty first, so the announcement is heard when the text arrives (learning L-B2). */}
      <p role="status" className="sr-only">
        {count > 0 ? t('newPostsSr') : ''}
      </p>
      {count > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 top-[68px] z-30 flex justify-center">
          <button type="button" onClick={onShow} data-track="ustaad_feed_new_pill" className={NEW_POSTS_PILL}>
            <UstaadIcon name="chevronLeft" size={18} />
            {t('newPosts')}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** One class constant for the pill (the visual-language pass restyles it here). Arrow icon rotated to point up. */
const NEW_POSTS_PILL =
  'new-posts-pill press pointer-events-auto inline-flex min-h-11 items-center gap-1.5 rounded-pill bg-navy px-4 text-[14px] font-bold text-white shadow-float focus-visible:outline-3 focus-visible:outline-focus [&>svg]:rotate-90';

/** Each feed tab keeps its scroll position for the session (no reload feel when switching tabs). */
function useTabScrollMemory(tab: FeedTab) {
  useEffect(() => {
    const store = safeSession();
    if (!store) return;
    const y = recallScroll(store, tab);
    if (y > 0) {
      // Wait two frames for the list to paint before restoring.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y })));
      return () => {
        cancelAnimationFrame(id);
        rememberScroll(store, tab, window.scrollY);
      };
    }
    return () => {
      rememberScroll(store, tab, window.scrollY);
    };
  }, [tab]);
}

function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
