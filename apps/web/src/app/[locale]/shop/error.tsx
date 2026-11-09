'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useRef } from 'react';
import { Container } from '@/components/ui/page-intro';

/**
 * The catalogue could not be loaded (data mode `api`: the API is down or slow on a first visit). One message and
 * one action, never an empty list that looks like "no products" (spec 02 edge case, concept retry copy). The
 * message is focused so keyboard and screen-reader users land on it.
 */
export default function ShopError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('catalogue');
  const router = useRouter();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Container className="py-10 tab:py-14">
      <div className="rounded-card border border-line-card bg-surface p-7 shadow-card">
        <h1 ref={ref} tabIndex={-1} className="max-w-2xl font-heading text-xl font-extrabold text-ink">
          {t('loadFailed')}
        </h1>
        <button
          type="button"
          onClick={() => {
            // Fetch the server data again, then re-render the segment (Next error-handling guide).
            startTransition(() => {
              router.refresh();
              reset();
            });
          }}
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('tryAgain')}
        </button>
      </div>
    </Container>
  );
}
