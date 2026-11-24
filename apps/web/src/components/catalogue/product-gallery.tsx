'use client';

import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import type { CataloguePhoto } from '@mechdost/shared/catalogue';
import { track } from '@/lib/analytics';
import { indexFromScroll, stepIndex, type PhotoMethod } from '@/lib/gallery-nav';
import type { ProductPhotoViewerProps } from './product-photo-viewer';

/** Fades the arrows out on devices that can hover; on touch screens they are always there. */
const ARROWS_FADE =
  '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/gallery:opacity-100 [@media(hover:hover)]:group-focus-within/gallery:opacity-100';

/**
 * The product page's photo area (spec 03, design 2026-11-24). The server renders every picture (`slides` large,
 * `thumbs` small, the first with `priority`) and hands them in as nodes, so this client file carries no image code.
 * The big picture is a CSS scroll-snap track: swiping is the browser's own scrolling, the arrows, thumbnails and
 * arrow keys call `scrollTo`. Opening the full view loads its chunk on first use. Ends are disabled (no wrap-around).
 */
export function ProductGallery({
  photos,
  slides,
  thumbs,
}: {
  photos: readonly CataloguePhoto[];
  slides: readonly ReactNode[];
  thumbs: readonly ReactNode[];
}) {
  const p = useTranslations('photos');
  const total = photos.length;
  const many = total > 1;
  const [active, setActive] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const [Viewer, setViewer] = useState<ComponentType<ProductPhotoViewerProps> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Set while a programmatic scroll is under way, so the scroll handler does not report it again as a swipe.
  const target = useRef<number | null>(null);

  const select = useCallback(
    (index: number, method: PhotoMethod) => {
      if (index < 0 || index >= total) return;
      if (index !== active) track('product_photo_selected', { index, method });
      setActive(index);
      const el = trackRef.current;
      if (!el) return;
      target.current = index;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: index * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    },
    [total, active],
  );

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const index = indexFromScroll(el.scrollLeft, el.clientWidth, total);
    if (index === null) return;
    if (target.current !== null) {
      if (index === target.current) target.current = null;
      return;
    }
    if (index !== active) {
      setActive(index);
      track('product_photo_selected', { index, method: 'swipe' });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!many || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = stepIndex(active, total, e.key);
    if (to === null) return;
    e.preventDefault();
    select(to, 'key');
  };

  const open = () => {
    track('product_photo_viewer_opened', { index: active, count: total });
    setViewing(active);
    if (!Viewer) {
      void import('./product-photo-viewer').then((m) => {
        setViewer(() => m.ProductPhotoViewer);
      });
    }
  };

  return (
    <div
      role="group"
      aria-roledescription={many ? 'carousel' : undefined}
      aria-label={p('productLabel')}
      onKeyDown={onKeyDown}
    >
      <div className="group/gallery relative">
        <div
          ref={trackRef}
          onScroll={onScroll}
          onPointerDown={() => {
            target.current = null;
          }}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-card [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((slide, i) => (
            <div
              key={photos[i]?.path ?? i}
              inert={i !== active}
              className="w-full min-w-full shrink-0 snap-center"
            >
              {/* A click on the picture opens the full view; keyboard and screen-reader users have the enlarge button. */}
              <div className="relative">
                <div onClick={open} className="cursor-zoom-in rounded-card">
                  {slide}
                </div>
                {/* Inside the scrolling track, so the track has something to focus; the other slides are inert. */}
                <button
                  type="button"
                  onClick={open}
                  aria-label={p('productEnlarge', { n: i + 1, total })}
                  className="press absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-full bg-surface/90 text-ink shadow-md"
                >
                  <Maximize2 aria-hidden="true" className="size-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        {many ? (
          <>
            <div
              className={`pointer-events-none absolute inset-0 flex items-center justify-between px-2 ${ARROWS_FADE}`}
            >
              <button
                type="button"
                onClick={() => {
                  select(active - 1, 'arrow');
                }}
                disabled={active === 0}
                aria-label={p('prev')}
                className="press pointer-events-auto inline-flex size-11 items-center justify-center rounded-full bg-surface/90 text-ink shadow-md disabled:opacity-40"
              >
                <ChevronLeft aria-hidden="true" className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  select(active + 1, 'arrow');
                }}
                disabled={active === total - 1}
                aria-label={p('next')}
                className="press pointer-events-auto inline-flex size-11 items-center justify-center rounded-full bg-surface/90 text-ink shadow-md disabled:opacity-40"
              >
                <ChevronRight aria-hidden="true" className="size-5" />
              </button>
            </div>
            <p
              aria-hidden="true"
              className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white"
            >
              {`${String(active + 1)} / ${String(total)}`}
            </p>
            <p role="status" className="sr-only">
              {p('position', { n: active + 1, total })}
            </p>
          </>
        ) : null}
      </div>

      {many ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {thumbs.map((thumb, i) => (
            <li key={photos[i]?.path ?? i}>
              <button
                type="button"
                onClick={() => {
                  select(i, 'thumb');
                }}
                aria-label={p('productShow', { n: i + 1, total })}
                aria-current={i === active ? 'true' : undefined}
                className={`press block size-16 overflow-hidden rounded-tile border tab:size-20 ${
                  i === active ? 'border-accent-button ring-2 ring-accent-button' : 'border-line-card'
                }`}
              >
                {thumb}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {Viewer ? (
        <Viewer
          photos={photos}
          index={viewing}
          onIndex={(index, method) => {
            setViewing(index);
            select(index, method);
          }}
          onClose={() => {
            setViewing(null);
          }}
        />
      ) : null}
    </div>
  );
}
