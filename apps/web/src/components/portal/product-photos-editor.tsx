'use client';

import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { PRODUCT_PHOTO_MAX, type AdminProductPhoto } from '@mechdost/shared/product-photos';
import { track } from '@/lib/analytics';
import { photoSrc } from '@/lib/photo-src';
import {
  fetchProductPhotos,
  productPhotoErrorKey,
  removeProductPhoto,
  reorderProductPhotos,
  uploadProductPhoto,
  type PhotoScope,
} from '@/lib/product-photos-api';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

const textOf = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ok'; photos: AdminProductPhoto[]; shopUploadsEnabled: boolean };

/**
 * The photos of one product (spec 02 "Product photos", design 2026-11-15 item 1), for staff (add, reorder, remove,
 * every photo) and for a shop (add while the setting is on, remove its own photo that is still waiting). Up to eight;
 * the first is the cover. Each photo needs a description in English and in Hindi. Reordering uses "earlier" and
 * "later" buttons (reachable by keyboard and touch, no drag needed); every change is announced in the one status line.
 * Previews are the API's signed, short-lived image URLs. Real API mode only.
 */
export function ProductPhotosEditor({ slug, scope }: { slug: string; scope: PhotoScope }) {
  const t = useTranslations('storefront');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);

  const reload = useCallback(async () => {
    const res = await fetchProductPhotos(locale, scope, slug);
    if (!live.current) return;
    setLoad(
      res.ok
        ? { kind: 'ok', photos: res.data.photos, shopUploadsEnabled: res.data.shopUploadsEnabled }
        : { kind: 'error', code: res.code },
    );
  }, [locale, scope, slug]);

  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload]);

  const fail = (code: string) => {
    setStatus({ kind: 'error', text: t(productPhotoErrorKey(code) as 'err_generic') });
  };

  async function onAdd(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      fail('PHOTO_TYPE');
      return;
    }
    setBusy(true);
    setStatus(null);
    const res = await uploadProductPhoto(locale, scope, slug, {
      file,
      alt: textOf(data.get('alt')),
      altHi: textOf(data.get('altHi')),
    });
    setBusy(false);
    if (!res.ok) {
      fail(res.code);
      return;
    }
    track('click', {
      id: scope === 'staff' ? 'product_photo_added_staff' : 'product_photo_added_shop',
      path: window.location.pathname,
    });
    form.reset();
    setStatus({ kind: 'ok', text: t('photosAdded') });
    await reload();
  }

  async function move(photos: AdminProductPhoto[], from: number, to: number) {
    if (busy) return;
    const ids = photos.map((p) => p.id);
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);
    setBusy(true);
    const res = await reorderProductPhotos(locale, slug, ids);
    setBusy(false);
    if (!res.ok) {
      fail(res.code);
      return;
    }
    track('click', { id: 'product_photo_reordered', path: window.location.pathname });
    setStatus({ kind: 'ok', text: t('photosOrderSaved') });
    await reload();
  }

  async function remove(photoId: string) {
    if (busy) return;
    setBusy(true);
    const res = await removeProductPhoto(locale, scope, slug, photoId);
    setBusy(false);
    if (!res.ok) {
      fail(res.code);
      return;
    }
    track('click', { id: 'product_photo_removed', path: window.location.pathname });
    setStatus({ kind: 'ok', text: t('photosRemoved') });
    await reload();
  }

  if (load.kind === 'loading') return <div className="skeleton h-40 rounded-card" aria-hidden="true" />;
  if (load.kind === 'error')
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm font-bold text-error">
          {t('photosLoadFailed')}
        </p>
        <button type="button" className={portalQuiet} onClick={() => void reload()}>
          {t('wishlistRetry')}
        </button>
      </div>
    );

  const { photos, shopUploadsEnabled } = load;
  const full = photos.length >= PRODUCT_PHOTO_MAX;
  const canAdd = !full && (scope === 'staff' || shopUploadsEnabled);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {t('photosLead', { max: PRODUCT_PHOTO_MAX })}{' '}
        {scope === 'staff' ? (shopUploadsEnabled ? t('photosShopsOn') : t('photosShopsOff')) : null}
      </p>
      <p
        role={status?.kind === 'error' ? 'alert' : 'status'}
        className={`min-h-5 text-sm font-bold ${status?.kind === 'error' ? 'text-error' : 'text-success'}`}
      >
        {status?.text ?? ''}
      </p>

      {photos.length === 0 ? (
        <div className={`${portalCard} text-center`}>
          <p className="font-heading text-base font-extrabold text-ink">{t('photosEmpty')}</p>
          <p className="mt-1 text-sm text-muted">{t('photosEmptyHint')}</p>
        </div>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2">
          {photos.map((p, i) => (
            <li key={p.id} className="flex gap-3 rounded-tile border border-line-card bg-surface-alt p-3">
              <div className="relative size-24 shrink-0 overflow-hidden rounded-tile bg-white">
                <Image
                  src={photoSrc(p.previewUrl)}
                  alt={locale === 'hi' ? p.altHi : p.alt}
                  fill
                  sizes="96px"
                  unoptimized
                  className="object-contain"
                  {...(p.lqip ? { placeholder: 'blur' as const, blurDataURL: p.lqip } : {})}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                  {i === 0 ? (
                    <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-accent-soft-text">
                      {t('photosCover')}
                    </span>
                  ) : null}
                  {p.status === 'pending' ? (
                    <span className="rounded-pill bg-pill px-2 py-0.5 text-ink">{t('photosPending')}</span>
                  ) : null}
                </p>
                <p className="line-clamp-2 text-sm text-ink" data-user-content>
                  {locale === 'hi' ? p.altHi : p.alt}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {scope === 'staff' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy || i === 0}
                        aria-label={t('photosMoveUp', { n: i + 1 })}
                        className={`${portalQuiet} !min-h-11 !px-3`}
                        onClick={() => void move(photos, i, i - 1)}
                      >
                        <ArrowUp aria-hidden="true" className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busy || i === photos.length - 1}
                        aria-label={t('photosMoveDown', { n: i + 1 })}
                        className={`${portalQuiet} !min-h-11 !px-3`}
                        onClick={() => void move(photos, i, i + 1)}
                      >
                        <ArrowDown aria-hidden="true" className="size-4" />
                      </button>
                    </>
                  ) : null}
                  {scope === 'staff' || (p.status === 'pending' && p.submittedByShopId !== null) ? (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={t('photosRemove', { n: i + 1 })}
                      className={`${portalQuiet} !min-h-11 !px-3`}
                      onClick={() => void remove(p.id)}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {full ? (
        <p className="text-sm font-bold text-ink">{t('photosFull', { max: PRODUCT_PHOTO_MAX })}</p>
      ) : null}
      {canAdd ? (
        <form onSubmit={(e) => void onAdd(e)} className={`${portalCard} space-y-3`}>
          <label className="block text-sm font-bold text-ink">
            {t('photosFile')}
            <input
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/webp"
              required
              className={portalField}
            />
          </label>
          <label className="block text-sm font-bold text-ink">
            {t('photosAlt')}
            <input
              type="text"
              name="alt"
              required
              minLength={3}
              maxLength={160}
              lang="en"
              className={portalField}
            />
          </label>
          <label className="block text-sm font-bold text-ink">
            {t('photosAltHi')}
            <input
              type="text"
              name="altHi"
              required
              minLength={3}
              maxLength={160}
              lang="hi"
              className={portalField}
            />
          </label>
          <button type="submit" disabled={busy} className={portalPrimary}>
            {busy ? t('photosAdding') : t('photosAdd')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
