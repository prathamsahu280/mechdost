'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';

/**
 * The only client code of the public offers page (spec 03 "Public offers", 2026-11-16): a copy button per code and one
 * "the page was seen" ping. Everything else on the page is server-rendered, so the page adds no JS to the shop,
 * home or product first loads (spec 16 budget). The copy falls back to selecting the text when the clipboard API is
 * missing (older browsers, an insecure context): the code is also shown as plain text, so nothing depends on it.
 */
export function CopyCodeButton({ code, kind }: { code: string; kind: 'percent' | 'flat' | 'free_shipping' }) {
  const t = useTranslations('offers');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // The code is on screen as text: the person can still select and copy it.
      return;
    }
    track('offer_code_copied', { kind });
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={t('copyAria', { code })}
      className="press inline-flex min-h-11 items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
      ) : (
        <Copy aria-hidden="true" className="size-4" strokeWidth={2.5} />
      )}
      <span aria-live="polite">{copied ? t('copied') : t('copy')}</span>
    </button>
  );
}

/** One `offers_viewed` event per visit of the page (how many offers were listed). Renders nothing. */
export function OffersViewedPing({ count }: { count: number }) {
  useEffect(() => {
    track('offers_viewed', { count });
  }, [count]);
  return null;
}
