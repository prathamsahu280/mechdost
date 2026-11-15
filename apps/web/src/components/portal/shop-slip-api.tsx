'use client';

import { PackingSlip, type PackingSlipDto } from '@mechdost/shared/shop-tools';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { ApiError } from './api-list-state';
import { portalPrimary, portalQuiet } from './portal-styles';

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; slip: PackingSlipDto };

/** The order code as an inline QR code; the encoder (a few KB) loads only when a slip opens. */
function OrderQr({ code, label }: { code: string; label: string }) {
  const [qr, setQr] = useState<{ d: string; side: number } | null>(null);
  useEffect(() => {
    let live = true;
    void import('@mechdost/shared/qr').then((m) => {
      if (live) setQr(m.qrSvg(code));
    });
    return () => {
      live = false;
    };
  }, [code]);
  if (!qr) return <div className="size-28" aria-hidden="true" />;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(qr.side)} ${String(qr.side)}`}
      className="size-28"
      shapeRendering="crispEdges"
    >
      <rect width={qr.side} height={qr.side} fill="#fff" />
      <path d={qr.d} fill="#000" />
    </svg>
  );
}

/**
 * Printable packing slip (design 2026-11-15, item 5; spec 07): order code and QR, the items and quantities, the delivery
 * PIN and area, the customer's first name and a masked phone. No prices, no street address, no delivery code: it is not
 * a tax invoice (the GST invoice waits on Q97). A5 print layout via `@page`; the page chrome is hidden when printing.
 */
export function PackingSlipApi({ code }: { code: string }) {
  const t = useTranslations('shopTier2');
  const locale = useLocale();
  const base = locale === 'hi' ? '/hi' : '';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void adminApi(locale, `/shop/slip/${encodeURIComponent(code)}`, PackingSlip).then((res) => {
      if (live) setLoad(res.ok ? { kind: 'ok', slip: res.data } : { kind: 'error', code: res.code });
    });
    return () => {
      live = false;
    };
  }, [locale, code]);

  if (load.kind === 'loading')
    return <div className="skeleton h-96 max-w-xl rounded-card" aria-hidden="true" />;
  if (load.kind === 'error')
    return (
      <div className="max-w-xl space-y-3">
        {load.code === 'SLIP_UNAVAILABLE' ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t('slipUnavailable')}
          </p>
        ) : load.code === 'NOT_FOUND' ? (
          <ApiError code="NOT_FOUND" />
        ) : (
          <p role="alert" className="text-sm font-bold text-error">
            {t('slipError')}
          </p>
        )}
        <Link href={`${base}/partner/shop`} className={portalQuiet}>
          {t('slipBack')}
        </Link>
      </div>
    );

  const s = load.slip;
  const hi = locale === 'hi';
  const shopName = hi ? (s.shopNameHi ?? s.shopName) : s.shopName;
  const area = hi ? (s.areaHi ?? s.area) : s.area;
  return (
    <div>
      <style>{`
        @page { size: A5; margin: 8mm; }
        @media print {
          body * { visibility: hidden; }
          .slip-sheet, .slip-sheet * { visibility: visible; }
          .slip-sheet { position: absolute; inset: 0; width: 100%; border: 0; box-shadow: none; padding: 0; color: #000; background: #fff; }
        }
      `}</style>
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          className={portalPrimary}
          onClick={() => {
            track('click', { id: 'shop_slip_print', path: window.location.pathname });
            window.print();
          }}
        >
          {t('slipPrint')}
        </button>
        <Link href={`${base}/partner/shop`} className={portalQuiet}>
          {t('slipBack')}
        </Link>
      </div>
      <article
        aria-labelledby="slip-title"
        className="slip-sheet max-w-[148mm] rounded-card border border-line-card bg-surface p-5 shadow-card"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-card pb-3">
          <div className="min-w-0">
            <h2 id="slip-title" className="font-heading text-lg font-extrabold text-ink">
              {t('slipTitle')}
            </h2>
            <p className="text-xs text-muted">{t('slipOrder')}</p>
            <p className="text-xl font-extrabold tracking-wide break-all text-ink">{s.code}</p>
            <p className="mt-1 text-xs text-muted">
              {t('slipPlaced', { date: formatDate(s.placedAt, locale) })}
            </p>
            <p className="text-xs text-muted" data-user-content>
              {t('slipFrom', { shop: shopName })}
            </p>
          </div>
          <div className="shrink-0 text-center">
            <OrderQr code={s.code} label={t('slipQrLabel', { code: s.code })} />
            <p className="text-[10px] text-muted">{t('slipQrHelp')}</p>
          </div>
        </header>

        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">{t('slipItems')}</caption>
          <thead>
            <tr className="border-b border-line-card text-left text-xs text-muted">
              <th scope="col" className="py-1 font-bold">
                {t('slipItem')}
              </th>
              <th scope="col" className="py-1 text-right font-bold">
                {t('slipQty')}
              </th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.sku} className="border-b border-line-card align-top">
                <td className="py-2 pr-2">
                  <span className="font-bold text-ink">{hi ? (i.titleHi ?? i.title) : i.title}</span>
                  <span className="block text-xs text-muted">{i.sku}</span>
                </td>
                <td className="py-2 text-right text-lg font-extrabold text-ink">{i.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">{t('slipDeliverTo')}</dt>
            <dd className="font-bold text-ink">{t('slipPin', { pin: s.pincode })}</dd>
            {area ? <dd className="text-ink">{area}</dd> : null}
          </div>
          <div>
            <dt className="text-xs text-muted">{t('slipCustomer')}</dt>
            <dd className="font-bold text-ink" data-user-content>
              {s.firstName}
            </dd>
            <dd className="text-ink">
              <span className="text-xs text-muted">{t('slipPhone')}: </span>
              {s.phoneMasked}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[11px] text-muted">{t('slipNotInvoice')}</p>
      </article>
    </div>
  );
}
