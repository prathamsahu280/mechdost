'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type TouchEvent } from 'react';
import type { CataloguePhoto } from '@mechdost/shared/catalogue';
import { stepIndex, type PhotoMethod } from '@/lib/gallery-nav';
import { productPhotoLoader } from '@/lib/product-photo-loader';

export interface ProductPhotoViewerProps {
  photos: readonly CataloguePhoto[];
  /** Index being shown, or null while closed. */
  index: number | null;
  onIndex: (index: number, method: PhotoMethod) => void;
  onClose: () => void;
}

const SWIPE_PX = 40;

/**
 * Full-view product photos on the native `<dialog>` (same pattern as the job-photo viewer): focus is trapped and
 * Escape closes it by the browser, and focus returns to the picture that opened it. Arrow buttons, arrow keys and a
 * horizontal swipe move between photos. The big copy (1600 px) comes through the shop's image loader. This file is
 * loaded on first open only (spec 16).
 */
export function ProductPhotoViewer({ photos, index, onIndex, onClose }: ProductPhotoViewerProps) {
  const p = useTranslations('photos');
  const ref = useRef<HTMLDialogElement>(null);
  const touchX = useRef<number | null>(null);
  const open = index !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const photo = index === null ? undefined : photos[index];
  const go = (to: number, method: PhotoMethod) => {
    if (to >= 0 && to < photos.length) onIndex(to, method);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    const end = e.changedTouches[0]?.clientX;
    if (start === null || end === undefined || index === null) return;
    if (end - start > SWIPE_PX) go(index - 1, 'swipe');
    else if (start - end > SWIPE_PX) go(index + 1, 'swipe');
  };

  return (
    <dialog
      ref={ref}
      aria-label={p('productViewer')}
      onClose={onClose}
      onKeyDown={(e) => {
        if (index === null) return;
        const to = stepIndex(index, photos.length, e.key);
        if (to !== null) go(to, 'key');
      }}
      className="m-auto w-[min(96vw,900px)] max-w-none rounded-card bg-surface p-0 text-ink backdrop:bg-black/70"
    >
      {photo && index !== null ? (
        <div className="p-3">
          <div
            onTouchStart={(e) => {
              touchX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={onTouchEnd}
            className="relative mx-auto max-h-[70dvh] w-full overflow-hidden rounded-lg bg-white"
            style={{ aspectRatio: `${String(photo.width)} / ${String(photo.height)}` }}
          >
            <Image
              src={photo.path}
              alt={photo.alt}
              fill
              loader={productPhotoLoader}
              sizes="(max-width: 900px) 96vw, 900px"
              className="object-contain"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                go(index - 1, 'arrow');
              }}
              disabled={index === 0}
              aria-label={p('prev')}
              className="press inline-flex size-11 items-center justify-center rounded-button border border-input-border disabled:opacity-40"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <p role="status" className="text-sm font-bold text-muted">
              {p('position', { n: index + 1, total: photos.length })}
            </p>
            <button
              type="button"
              onClick={() => {
                go(index + 1, 'arrow');
              }}
              disabled={index === photos.length - 1}
              aria-label={p('next')}
              className="press inline-flex size-11 items-center justify-center rounded-button border border-input-border disabled:opacity-40"
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={p('close')}
              className="press inline-flex size-11 items-center justify-center rounded-button bg-accent-button text-white hover:bg-accent-button-hover"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
