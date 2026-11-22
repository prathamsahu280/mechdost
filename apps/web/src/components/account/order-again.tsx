'use client';

import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { joinSentences, type ReorderOutcome } from '@/lib/order-again-core';

/**
 * "Order again" on a past order (audience entry 2026-11-22, item 4; accessibility requirements item 4). One press adds
 * the same products and quantities to the cart, re-priced at checkout, and says what was added and what was not. Only
 * the account orders list and the order page render it (spec 16 budget), and the add-to-cart logic is fetched with
 * `import()` on the press, so this file holds no cart, API or demo-store code. A native button: `aria-busy` and
 * `disabled` with visible "Adding…" text while it works (one press = one request), its name carries the order code
 * (visually hidden), the result goes to a polite status region AND a visible closable panel (Cancel contract:
 * `data-panel-cancel`, Escape, focus back to the button), with a "Go to cart" link.
 */
export function OrderAgain({ code, source }: { code: string; source: 'list' | 'page' }) {
  const t = useTranslations('order');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const key = `order-again-${code}`;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReorderOutcome | 'error' | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  async function press() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    track('order_again_clicked', { code, source });
    try {
      const { orderAgain } = await import('@/lib/order-again');
      setResult((await orderAgain(locale, code)) ?? 'error');
    } catch {
      setResult('error');
    } finally {
      setBusy(false);
      // A disabled button drops focus: put it back so keyboard and screen-reader users stay where they were.
      requestAnimationFrame(() => button.current?.focus());
    }
  }

  const ok = result !== null && result !== 'error' ? result : null;
  const headline = ok
    ? ok.added > 0
      ? t('againAdded', { count: ok.added })
      : t('againNone')
    : t('againError');
  const announce = ok
    ? joinSentences(
        [
          headline,
          ok.already > 0 ? t('againAlready', { count: ok.already }) : '',
          ok.missing.length > 0
            ? `${t('againMissingTitle')}: ${ok.missing.map((m) => `${m.name} (${t(`againReason_${m.reason}`)})`).join(', ')}`
            : '',
        ],
        locale,
      )
    : result === 'error'
      ? headline
      : '';

  return (
    <div className="min-w-0">
      <button
        ref={button}
        type="button"
        data-disclosure-trigger={key}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void press()}
        className="press inline-flex min-h-11 items-center justify-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:cursor-progress disabled:opacity-70"
      >
        <RotateCcw aria-hidden="true" className="size-4" />
        {busy ? t('againBusy') : t('again')}
        <span className="sr-only">: {code}</span>
      </button>
      <p role="status" className="sr-only">
        {announce}
      </p>
      {result !== null ? (
        <section
          aria-labelledby={`${key}-title`}
          data-panel-for={key}
          className="mt-3 rounded-tile border border-line-card bg-surface p-4 text-sm"
        >
          <h3 id={`${key}-title`} className="font-heading font-extrabold text-ink">
            {t('againTitle')}
          </h3>
          <p className="mt-1 text-ink">{headline}</p>
          {ok && ok.already > 0 ? (
            <p className="mt-1 text-muted">{t('againAlready', { count: ok.already })}</p>
          ) : null}
          {ok && ok.missing.length > 0 ? (
            <>
              <p className="mt-3 font-bold text-ink">{t('againMissingTitle')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-ink">
                {ok.missing.map((m) => (
                  <li key={m.name}>
                    <span data-user-content>{m.name}</span> — {t(`againReason_${m.reason}`)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ok && ok.added + ok.already > 0 ? (
              <Link
                href={`${prefix}/cart`}
                data-track="order_again_cart"
                className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
              >
                {t('againCart')}
              </Link>
            ) : null}
            <button
              type="button"
              data-panel-cancel={key}
              onClick={() => {
                setResult(null);
              }}
              className="press inline-flex min-h-11 items-center rounded-button px-3 text-sm font-bold text-ink underline hover:bg-pill"
            >
              {t('againClose')}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
