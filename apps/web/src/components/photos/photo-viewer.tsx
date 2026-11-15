'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type CSSProperties } from 'react';
import { photoSrc } from '@/lib/photo-src';

/** What both the strip and the gallery pass in: sizes of the large copy and the API-issued URLs. */
export interface ViewPhoto {
  id: string;
  stage: 'before' | 'after';
  width: number;
  height: number;
  thumbUrl: string;
  largeUrl: string;
}

/**
 * One square thumbnail that opens the viewer. The box is fixed-size (no layout shift while the picture loads); the
 * API serves sized WebP, so `next/image` runs `unoptimized` (no second resize hop) and still lazy-loads.
 */
export function PhotoThumb({
  photo,
  index,
  total,
  onOpen,
}: {
  photo: ViewPhoto;
  index: number;
  total: number;
  onOpen: (index: number) => void;
}) {
  const t = useTranslations('photos');
  const stage = t(`stage_${photo.stage}`);
  return (
    <button
      type="button"
      onClick={() => {
        onOpen(index);
      }}
      aria-label={t('open', { stage, n: index + 1 })}
      className="press relative block size-24 overflow-hidden rounded-lg border border-line-card bg-pill focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Image
        src={photoSrc(photo.thumbUrl)}
        alt={t('thumbAlt', { stage, n: index + 1, total })}
        fill
        sizes="96px"
        unoptimized
        className="object-cover"
      />
    </button>
  );
}

/**
 * Full-size viewer on the native `<dialog>`: focus is trapped and Escape closes it by the browser, focus returns to the
 * thumbnail that opened it. Arrow keys and the two buttons move between photos; one primary action (close).
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: readonly ViewPhoto[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations('photos');
  const ref = useRef<HTMLDialogElement>(null);
  const open = index !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const photo = index === null ? undefined : photos[index];
  const prev = () => {
    if (index !== null && index > 0) onIndex(index - 1);
  };
  const next = () => {
    if (index !== null && index < photos.length - 1) onIndex(index + 1);
  };
  const ratio: CSSProperties | undefined = photo
    ? { aspectRatio: `${String(photo.width)} / ${String(photo.height)}` }
    : undefined;

  return (
    <dialog
      ref={ref}
      aria-label={t('viewerTitle')}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
      }}
      className="m-auto w-[min(96vw,900px)] max-w-none rounded-card bg-surface p-0 text-ink backdrop:bg-black/70"
    >
      {photo && index !== null ? (
        <div className="p-3">
          <div
            className="relative mx-auto max-h-[70dvh] w-full overflow-hidden rounded-lg bg-pill"
            style={ratio}
          >
            <Image
              src={photoSrc(photo.largeUrl)}
              alt={t('thumbAlt', { stage: t(`stage_${photo.stage}`), n: index + 1, total: photos.length })}
              fill
              sizes="(max-width: 900px) 96vw, 900px"
              unoptimized
              className="object-contain"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={index === 0}
              aria-label={t('prev')}
              className="press inline-flex size-11 items-center justify-center rounded-button border border-input-border disabled:opacity-40"
            >
              <ChevronLeft aria-hidden="true" className="size-5 rtl:rotate-180" />
            </button>
            <p role="status" className="text-sm font-bold text-muted">
              {t('position', { n: index + 1, total: photos.length })}
            </p>
            <button
              type="button"
              onClick={next}
              disabled={index === photos.length - 1}
              aria-label={t('next')}
              className="press inline-flex size-11 items-center justify-center rounded-button border border-input-border disabled:opacity-40"
            >
              <ChevronRight aria-hidden="true" className="size-5 rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
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
