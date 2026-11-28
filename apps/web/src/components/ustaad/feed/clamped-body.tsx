'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactNode } from 'react';

/** Posts longer than this many characters are clamped in a list (about eight lines at 390 px). */
export const CLAMP_FROM_CHARS = 320;

/**
 * SIM-P25: a long post body is cut to eight lines in a feed card with a "Read more" button, so a 2,000-character post
 * is not a 1,400 px card. The text stays in the page (clamped with CSS, so search-in-page and screen readers still
 * reach all of it); the button only opens the full text and goes away, so its name never changes while it is
 * pressed. Focus moves to the text when it opens. Short text and the post's own page are never clamped.
 * Every panel opened in place can be closed (no-reload rule): "Show less" (`data-panel-cancel`, Escape through
 * `PanelDismiss`) clamps the text again and gives focus back to "Read more".
 */
export function ClampedBody({
  chars,
  clamp,
  className,
  children,
}: {
  chars: number;
  clamp: boolean;
  className: string;
  children: ReactNode;
}) {
  const t = useTranslations('ustaad.feed');
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const long = clamp && chars > CLAMP_FROM_CHARS;
  const clipped = long && !open;
  return (
    <div className={className}>
      <div
        ref={box}
        id={id}
        tabIndex={-1}
        data-post-body
        className={`text-[16px] leading-relaxed text-ink focus-visible:outline-3 focus-visible:outline-focus ${clipped ? 'line-clamp-8' : ''}`}
      >
        {children}
      </div>
      {clipped ? (
        <button
          ref={opener}
          type="button"
          aria-expanded="false"
          aria-controls={id}
          data-disclosure-trigger={id}
          data-track="ustaad_post_read_more"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => box.current?.focus());
          }}
          className="press mt-1 inline-flex min-h-11 items-center rounded text-sm font-bold text-accent-soft-text hover:underline focus-visible:outline-3 focus-visible:outline-focus"
        >
          {t('readMore')}
        </button>
      ) : null}
      {long && open ? (
        <button
          type="button"
          aria-controls={id}
          data-panel-cancel={id}
          data-track="ustaad_post_read_less"
          onClick={() => {
            setOpen(false);
            requestAnimationFrame(() => opener.current?.focus());
          }}
          className="press mt-1 inline-flex min-h-11 items-center rounded text-sm font-bold text-accent-soft-text hover:underline focus-visible:outline-3 focus-visible:outline-focus"
        >
          {t('readLess')}
        </button>
      ) : null}
    </div>
  );
}
