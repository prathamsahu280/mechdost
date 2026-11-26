'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { FeedTab, PostView } from '@mechdost/shared/ustaad/dto/feed';
import type { ServedPromotion } from '@mechdost/shared/ustaad/dto/promotions';
import { PROMOTION_HIDE_REASONS } from '@mechdost/shared/ustaad/codes';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { feedExpired } from '@/lib/ustaad/feed-view';
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
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const client = useSocialAction();
  const [asking, setAsking] = useState(false);
  const seen = useRef(false);
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
        <fieldset className="grid gap-2">
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
      <p role="status" className="text-sm font-bold text-ink empty:sr-only">
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
  return (
    <PostList
      listKey={`feed-${tab}`}
      load={(c, cursor) => c.feed(tab, cursor)}
      empty={empty}
      promo={tab === 'for_you'}
      first
    />
  );
}
