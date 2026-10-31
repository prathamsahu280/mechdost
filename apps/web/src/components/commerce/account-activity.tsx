'use client';

import { ChevronRight, MessagesSquare, Package, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ORDER_STAGES, REQUEST_STAGES, useOrders, useQuotes, useRequests } from '@/demo/store';
import { formatDate, formatPrice } from '@/lib/format';

/** Recent orders and service requests on this device (demo store) — the account API replaces it (spec 01). */
export function AccountActivity() {
  const o = useTranslations('order');
  const r = useTranslations('request');
  const q = useTranslations('quote');
  const quotes = useQuotes();
  const locale = useLocale();
  const orders = useOrders();
  const requests = useRequests();
  const base = locale === 'hi' ? '/hi' : '';

  const row =
    'flex min-h-14 items-center gap-3 rounded-tile border border-line-card bg-surface p-4 shadow-card hover:bg-pill';

  return (
    <div className="grid gap-8 nav:grid-cols-2 xl:grid-cols-3">
      <section aria-labelledby="my-orders">
        <h2 id="my-orders" className="font-heading text-xl font-extrabold text-ink">
          {o('myOrders')}
        </h2>
        {orders.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{o('noOrders')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {orders.slice(0, 5).map((order) => (
              <li key={order.code}>
                <Link href={`${base}/orders/${order.code}`} className={row}>
                  <Package aria-hidden="true" className="size-5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{order.code}</span>
                    <span className="block text-xs text-muted">
                      {formatDate(order.createdAt, locale)} · {formatPrice(order.totalPaise)} ·{' '}
                      {o(`stage_${ORDER_STAGES[order.stage] ?? 'placed'}`)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="my-requests">
        <h2 id="my-requests" className="font-heading text-xl font-extrabold text-ink">
          {r('myRequests')}
        </h2>
        {requests.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{r('noRequests')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {requests.slice(0, 5).map((req) => (
              <li key={req.code}>
                <Link href={`${base}/service/${req.code}`} className={row}>
                  <Wrench aria-hidden="true" className="size-5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{req.code}</span>
                    <span className="block text-xs text-muted">
                      {req.workshopName} · {r(`stage_${REQUEST_STAGES[req.stage] ?? 'requested'}`)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="my-quotes">
        <h2 id="my-quotes" className="font-heading text-xl font-extrabold text-ink">
          {q('myQuotes')}
        </h2>
        {quotes.length === 0 ? (
          <div className="mt-3 text-sm text-muted">
            <p>{q('noQuotes')}</p>
            <Link
              href={`${base}/quotes/new`}
              className="press mt-2 inline-flex min-h-11 items-center rounded-button border border-input-border px-4 font-bold text-ink hover:bg-pill"
            >
              {q('newQuote')}
            </Link>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {quotes.slice(0, 5).map((quote) => (
              <li key={quote.code}>
                <Link href={`${base}/quotes/${quote.code}`} className={row}>
                  <MessagesSquare aria-hidden="true" className="size-5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{quote.code}</span>
                    <span className="block text-xs text-muted">
                      {formatDate(quote.createdAt, locale)} · {q(`status_${quote.status}`)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
