'use client';

import { ShopOfferSaved } from '@mechdost/shared/order-views';
import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { stockStepError, stockStepTarget, type StockStepErrorKey } from '@/lib/shop-stock';

const stepButton =
  'press inline-flex min-h-11 min-w-11 items-center justify-center rounded-button border border-input-border bg-surface text-ink hover:bg-pill disabled:opacity-40 aria-disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Per-row stock − / + on "Your prices" (design 2026-11-27 § 5.3). One tap asks the existing versioned inventory route
 * for the next absolute stock (`PATCH /v1/shops/{shopId}/inventory/{sku}` with the version the row was loaded at; the
 * server refuses a stale version and anything below the units held for open orders). Nothing is shown before the
 * server answers: the number on screen is always the loaded one, and `onChanged` loads the row again afterwards.
 * While a tap is being saved the buttons are inert (aria-disabled keeps keyboard focus on the button).
 */
export function ShopStockStepper({
  shopId,
  sku,
  product,
  onHand,
  reserved,
  version,
  onChanged,
}: {
  shopId: string;
  sku: string;
  product: string;
  onHand: number;
  reserved: number;
  version: number;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('partnerShop');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StockStepErrorKey | null>(null);
  const down = stockStepTarget(onHand, reserved, -1);
  const up = stockStepTarget(onHand, reserved, 1);

  async function step(direction: 1 | -1) {
    const target = direction === 1 ? up : down;
    if (busy || target === null) return;
    setBusy(true);
    setError(null);
    const res = await adminApi(locale, `/shops/${shopId}/inventory/${sku}`, ShopOfferSaved, {
      method: 'PATCH',
      body: { version, onHand: target },
    });
    track('partner_stock_stepped', {
      portal: 'shop',
      direction: direction === 1 ? 'up' : 'down',
      result: res.ok ? 'saved' : 'refused',
    });
    if (!res.ok) {
      const failure = stockStepError(res.code);
      setError(failure.key);
      if (failure.reload) await onChanged();
      setBusy(false);
      return;
    }
    await onChanged();
    setBusy(false);
  }

  return (
    <div className="mt-3">
      <p id={`stock-${sku}`} className="text-xs font-bold text-ink">
        {t('stock_label')}
      </p>
      <div
        role="group"
        aria-labelledby={`stock-${sku}`}
        aria-busy={busy}
        className="mt-1 flex items-center gap-2"
      >
        <button
          type="button"
          aria-disabled={busy || down === null}
          aria-label={t('stock_minus', { product })}
          onClick={() => void step(-1)}
          className={stepButton}
        >
          <Minus aria-hidden="true" className="size-5" />
        </button>
        <output
          aria-live="polite"
          className="min-w-12 text-center font-heading text-lg font-extrabold text-ink tabular-nums"
        >
          {onHand}
        </output>
        <button
          type="button"
          aria-disabled={busy || up === null}
          aria-label={t('stock_plus', { product })}
          onClick={() => void step(1)}
          className={stepButton}
        >
          <Plus aria-hidden="true" className="size-5" />
        </button>
        {busy ? <span className="text-xs text-muted">{t('stock_saving')}</span> : null}
      </div>
      {reserved > 0 ? (
        <p className="mt-1 text-xs text-muted">{t('stock_reserved', { n: reserved })}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-bold text-error">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
