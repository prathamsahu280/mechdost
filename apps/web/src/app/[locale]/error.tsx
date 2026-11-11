'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Container } from '@/components/ui/page-intro';
import { track } from '@/lib/analytics';

/** Demo data saved in this browser (cart, orders, quotes, demo sign-in); theme and privacy choices are kept. */
function eraseDemoData() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key === 'mechdost-cart' || key.startsWith('mechdost-demo-')) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing saved to erase.
  }
}

/**
 * Any page that fails to render (review 2026-11-11: old or broken saved data used to blank the whole site). The
 * message is focused on arrival; "Try again" is the safe first action; "Reset saved data" asks inline before it
 * erases anything — no dialog, so it never stacks on the consent banner (a11y review 2026-11-11).
 */
export default function LocaleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errorPage');
  const router = useRouter();
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const confirmText = useRef<HTMLParagraphElement>(null);
  const [pending, startRetry] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    heading.current?.focus();
    const node = card.current;
    return () => {
      // A successful retry unmounts this card: keep keyboard users in the page, not back at the top.
      if (node?.contains(document.activeElement)) document.getElementById('content')?.focus();
    };
  }, []);

  useEffect(() => {
    if (confirming) confirmText.current?.focus();
  }, [confirming]);

  function cancel() {
    setConfirming(false);
    resetButton.current?.focus();
  }

  return (
    <Container className="py-10 tab:py-14">
      <div ref={card} className="rounded-card border border-line-card bg-surface p-7 shadow-card">
        <h1 ref={heading} tabIndex={-1} className="max-w-2xl font-heading text-xl font-extrabold text-ink">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">{t('body')}</p>
        <div className="mt-5 flex flex-col items-start gap-3 tab:flex-row">
          <button
            type="button"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (pending) return;
              track('click', { id: 'error_page_retry', path: window.location.pathname });
              // Fetch the server data again, then re-render the segment (Next error-handling guide).
              startRetry(() => {
                router.refresh();
                reset();
              });
            }}
            className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover aria-disabled:opacity-60"
          >
            {t('tryAgain')}
          </button>
          <button
            ref={resetButton}
            type="button"
            aria-expanded={confirming}
            aria-controls="error-reset-confirm"
            onClick={() => {
              setConfirming(true);
            }}
            className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-5 text-sm font-bold text-ink hover:bg-pill"
          >
            {t('reset')}
          </button>
        </div>
        <p role="status" className="sr-only">
          {pending ? t('trying') : ''}
        </p>
        <div
          id="error-reset-confirm"
          hidden={!confirming}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              cancel();
            }
          }}
          className="mt-5 max-w-2xl rounded-lg border border-line-card bg-surface-alt p-4"
        >
          <p ref={confirmText} tabIndex={-1} className="text-sm font-bold text-ink">
            {t('confirm')}
          </p>
          <div className="mt-3 flex flex-col items-start gap-3 tab:flex-row">
            <button
              type="button"
              aria-disabled={erasing || undefined}
              onClick={cancel}
              className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-5 text-sm font-bold text-ink hover:bg-pill"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              aria-disabled={erasing || undefined}
              onClick={() => {
                if (erasing) return;
                setErasing(true);
                track('click', { id: 'error_page_reset_saved_data', path: window.location.pathname });
                eraseDemoData();
                window.location.reload();
              }}
              className="press inline-flex min-h-11 items-center rounded-button border-2 border-error px-5 text-sm font-bold text-error hover:bg-pill aria-disabled:opacity-60"
            >
              {t('erase')}
            </button>
          </div>
        </div>
      </div>
    </Container>
  );
}
