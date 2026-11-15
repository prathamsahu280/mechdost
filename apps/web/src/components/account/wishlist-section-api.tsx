'use client';

import { Heart, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Wishlist } from '@mechdost/shared/wishlist-api';
import { track } from '@/lib/analytics';
import { productPhotoLoader } from '@/lib/product-photo-loader';
import { fetchWishlist, setWishlisted } from '@/lib/wishlist-store';

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; list: Wishlist };

/**
 * Account → Wishlist (design 2026-11-15 item 5), real sign-in mode only: the products the customer saved, newest first,
 * each linking to its page with a remove button. Names and photo descriptions come from the API in the page language.
 * Empty: one next step, "Browse the shop". Removing is immediate and announced; a failed removal puts the product back.
 */
export function WishlistSectionApi() {
  const t = useTranslations('storefront');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [say, setSay] = useState('');
  const live = useRef(true);

  const reload = useCallback(async () => {
    const res = await fetchWishlist(locale);
    if (!live.current) return;
    setLoad(res.ok ? { kind: 'ok', list: res.data } : { kind: 'error' });
  }, [locale]);
  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload]);

  async function remove(slug: string) {
    const code = await setWishlisted(locale, slug, false);
    if (code !== null) {
      setSay(t('wishlistFailed'));
      return;
    }
    track('wishlist_toggled', { slug, on: false, source: 'account' });
    setSay(t('wishlistRemoved'));
    setLoad((prev) =>
      prev.kind === 'ok'
        ? { kind: 'ok', list: { ...prev.list, items: prev.list.items.filter((i) => i.slug !== slug) } }
        : prev,
    );
  }

  return (
    <section aria-labelledby="wishlist-title" className="space-y-4">
      <div>
        <h2 id="wishlist-title" className="font-heading text-xl font-extrabold text-ink">
          {t('wishlistTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('wishlistLead', { max: 100 })}</p>
      </div>
      <p role="status" className="sr-only">
        {say}
      </p>
      {load.kind === 'loading' ? <div className="skeleton h-48 rounded-card" aria-hidden="true" /> : null}
      {load.kind === 'error' ? (
        <div className="rounded-card border border-line-card bg-surface p-5 shadow-card">
          <p role="alert" className="text-sm font-bold text-error">
            {t('wishlistLoadFailed')}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoad({ kind: 'loading' });
              void reload();
            }}
            className="press mt-3 inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
          >
            {t('wishlistRetry')}
          </button>
        </div>
      ) : null}
      {load.kind === 'ok' && load.list.items.length === 0 ? (
        <div className="rounded-card border border-line-card bg-surface p-8 text-center shadow-card">
          <Heart aria-hidden="true" className="mx-auto size-8 text-accent" />
          <p className="mt-3 font-heading text-lg font-extrabold text-ink">{t('wishlistEmpty')}</p>
          <p className="mt-1 text-sm text-muted">{t('wishlistEmptyHint')}</p>
          <Link
            href={`${prefix}/shop`}
            className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
          >
            {t('wishlistBrowse')}
          </Link>
        </div>
      ) : null}
      {load.kind === 'ok' && load.list.items.length > 0 ? (
        <>
          <p className="text-sm font-bold text-ink">
            {t('wishlistCount', { count: load.list.items.length })}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {load.list.items.map((i) => (
              <li
                key={i.slug}
                className="flex items-center gap-3 rounded-card border border-line-card bg-surface p-3 shadow-card"
              >
                <Link href={`${prefix}/shop/${i.slug}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
                  <span className="relative block size-20 overflow-hidden rounded-tile bg-white">
                    {i.photo ? (
                      <Image
                        loader={productPhotoLoader}
                        src={i.photo.id}
                        alt=""
                        fill
                        sizes="80px"
                        className="object-contain"
                      />
                    ) : null}
                  </span>
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted" data-user-content>
                    {i.brand}
                  </p>
                  <Link
                    href={`${prefix}/shop/${i.slug}`}
                    className="inline-block py-0.5 font-heading text-[15px] leading-snug font-bold text-ink hover:underline"
                    data-user-content
                  >
                    {i.name}
                  </Link>
                </div>
                <button
                  type="button"
                  aria-label={t('wishlistRemove', { name: `${i.brand} ${i.name}` })}
                  onClick={() => void remove(i.slug)}
                  className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-pill"
                >
                  <Trash2 aria-hidden="true" className="size-5" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
