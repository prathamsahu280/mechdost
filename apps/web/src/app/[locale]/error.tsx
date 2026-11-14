'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore, useTransition } from 'react';
import { track } from '@/lib/analytics';
import { readErrorCopy, type ErrorCopy } from '@/lib/error-copy';
import { reportClientError } from '@/lib/error-reporting';

const noSubscribe = () => () => undefined;
// useSyncExternalStore needs the same object on every read: parse the data block once.
let cachedCopy: ErrorCopy | null | undefined;
const copySnapshot = () => (cachedCopy ??= readErrorCopy(document));

/**
 * Any page that fails to render (review 2026-11-11). Error boundaries are bundled into every route, so this stays
 * small (JS budget, spec 16): the message is focused on arrival and "Try again" is the one action. Strings come from
 * the layout's JSON data block, read in the browser (no i18n runtime on every page).
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const copy = useSyncExternalStore(noSubscribe, copySnapshot, () => null);
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, startRetry] = useTransition();

  useEffect(() => {
    heading.current?.focus();
  }, [copy]);

  // A caught render error never reaches the window handlers: report it here (Sentry, decision 2026-11-14).
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  if (!copy) return null;
  return (
    <div className="mx-auto w-full max-w-[1600px] px-[5%] py-10 tab:py-14">
      <div className="rounded-card border border-line-card bg-surface p-7 shadow-card">
        <h1 ref={heading} tabIndex={-1} className="max-w-2xl font-heading text-xl font-extrabold text-ink">
          {copy.title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">{copy.body}</p>
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
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover aria-disabled:opacity-60"
        >
          {copy.tryAgain}
        </button>
        <p role="status" className="sr-only">
          {pending ? copy.trying : ''}
        </p>
      </div>
    </div>
  );
}
