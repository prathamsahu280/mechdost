'use client';

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCT_PHOTO_REJECT_REASONS, type ProductPhotoRejectReason } from '@mechdost/shared/product-photos';
import { track } from '@/lib/analytics';
import { photoSrc } from '@/lib/photo-src';
import { approvePhoto, fetchPhotoQueue, productPhotoErrorKey, rejectPhoto } from '@/lib/product-photos-api';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

interface Item {
  photoId: string;
  productSlug: string;
  productName: string;
  alt: string;
  altHi: string;
  width: number;
  height: number;
  lqip: string | null;
  shopName: string | null;
  previewUrl: string;
}
type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; items: Item[] };

/**
 * Admin → Catalogue → "Photos waiting for approval" (spec 02, design 2026-11-15 item 1): the photos shops added to
 * products they sell, oldest first, each with the shop's name. Approve makes it public; refusing needs a reason (a
 * code) and removes it. Only staff with publish rights see data here (the API answers 403 to the rest, and the card
 * then stays out of the way). Real API mode only.
 */
export function PhotoQueueApi() {
  const t = useTranslations('storefront');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState<ProductPhotoRejectReason>('not_this_product');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);

  const reload = useCallback(async () => {
    const res = await fetchPhotoQueue(locale);
    if (!live.current) return;
    setLoad(res.ok ? { kind: 'ok', items: res.data.items } : { kind: 'error' });
  }, [locale]);
  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload]);

  async function decide(item: Item, decision: 'approve' | 'reject') {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    const res =
      decision === 'approve'
        ? await approvePhoto(locale, item.photoId)
        : await rejectPhoto(locale, item.photoId, reason);
    setBusy(false);
    if (!res.ok) {
      setStatus({ kind: 'error', text: t(productPhotoErrorKey(res.code) as 'err_generic') });
      return;
    }
    track('click', {
      id: decision === 'approve' ? 'product_photo_approved' : 'product_photo_rejected',
      path: window.location.pathname,
    });
    setRejecting(null);
    setStatus({ kind: 'ok', text: t(decision === 'approve' ? 'photoApproved' : 'photoRejected') });
    await reload();
  }

  // No heading for people without access or a failed load: this card is an extra, never a blocker.
  if (load.kind === 'loading' || load.kind === 'error') return null;

  return (
    <section aria-labelledby="photo-queue-title" className={`${portalCard} space-y-3`}>
      <h3 id="photo-queue-title" className="font-heading text-lg font-extrabold text-ink">
        {t('photoQueueTitle')}
      </h3>
      <p
        role={status?.kind === 'error' ? 'alert' : 'status'}
        className={`min-h-5 text-sm font-bold ${status?.kind === 'error' ? 'text-error' : 'text-success'}`}
      >
        {status?.text ?? ''}
      </p>
      {load.items.length === 0 ? (
        <div>
          <p className="font-heading text-base font-extrabold text-ink">{t('photoQueueEmpty')}</p>
          <p className="mt-1 text-sm text-muted">{t('photoQueueEmptyHint')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {load.items.map((i) => (
            <li
              key={i.photoId}
              className="flex flex-wrap gap-3 rounded-tile border border-line-card bg-surface-alt p-3"
            >
              <div className="relative size-28 shrink-0 overflow-hidden rounded-tile bg-white">
                <Image
                  src={photoSrc(i.previewUrl)}
                  alt={locale === 'hi' ? i.altHi : i.alt}
                  fill
                  sizes="112px"
                  unoptimized
                  className="object-contain"
                  {...(i.lqip ? { placeholder: 'blur' as const, blurDataURL: i.lqip } : {})}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-bold text-ink" data-user-content>
                  {i.productName}
                </p>
                {i.shopName ? (
                  <p className="text-sm text-muted" data-user-content>
                    {t('photoFromShop', { shop: i.shopName })}
                  </p>
                ) : null}
                <p className="text-sm text-ink" data-user-content>
                  {locale === 'hi' ? i.altHi : i.alt}
                </p>
                {rejecting === i.photoId ? (
                  <div className="flex flex-wrap items-end gap-2 pt-1">
                    <label className="text-sm font-bold text-ink">
                      {t('photoRejectWhy')}
                      <select
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value as ProductPhotoRejectReason);
                        }}
                        className={portalField}
                      >
                        {PRODUCT_PHOTO_REJECT_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {t(`reason_${r}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      className={portalPrimary}
                      onClick={() => void decide(i, 'reject')}
                    >
                      {t('photoReject')}
                    </button>
                    <button
                      type="button"
                      className={portalQuiet}
                      onClick={() => {
                        setRejecting(null);
                      }}
                    >
                      {t('photoCancel')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      disabled={busy}
                      className={portalPrimary}
                      onClick={() => void decide(i, 'approve')}
                    >
                      {t('photoApprove')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className={portalQuiet}
                      onClick={() => {
                        setRejecting(i.photoId);
                      }}
                    >
                      {t('photoReject')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
