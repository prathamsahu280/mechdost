'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { useQuotes } from '@/demo/quote-store';
import { DATA_MODE } from './data-mode';
import { quoteStatusKey, quoteWaitsForCustomer, type QuoteStatusKey } from './quote-views';

/** One line of the customer's bulk quotes, the same whether it comes from the demo or the API. */
export interface QuoteRow {
  code: string;
  createdAt: string;
  /** `quote` locale key for the status. */
  statusKey: QuoteStatusKey;
  /** An offer waits for the customer's decision (account badge). */
  waiting: boolean;
}

export interface QuoteRows {
  rows: QuoteRow[];
  status: 'ready' | 'loading' | 'error';
}

// Navigation, overview and list all read it on one page: one request serves them for a few seconds.
let shared: { locale: string; at: number; promise: Promise<QuoteRows> } | null = null;

async function loadApiRows(locale: string): Promise<QuoteRows> {
  const { fetchMyQuotes } = await import('./quote-api');
  const res = await fetchMyQuotes(locale);
  // Signed out: nothing to list (the account page shows the sign-in card), not an error.
  if (!res.ok) return { rows: [], status: res.code === 'AUTH_REQUIRED' ? 'ready' : 'error' };
  return {
    status: 'ready',
    rows: res.data.items.map((q) => ({
      code: q.code,
      createdAt: q.createdAt,
      statusKey: quoteStatusKey(q.status),
      waiting: quoteWaitsForCustomer(q),
    })),
  };
}

/**
 * The signed-in customer's bulk quotes, newest first. Demo data mode: the browser store. Real data mode
 * (`NEXT_PUBLIC_DATA_MODE=api`, spec 19): `GET /v1/quotes` (first page of 20).
 */
export function useQuoteRows(): QuoteRows {
  const locale = useLocale();
  const demo = useQuotes();
  const [api, setApi] = useState<QuoteRows>({ rows: [], status: 'loading' });

  useEffect(() => {
    if (DATA_MODE !== 'api') return;
    let live = true;
    if (shared?.locale !== locale || Date.now() - shared.at > 5_000)
      shared = { locale, at: Date.now(), promise: loadApiRows(locale) };
    void shared.promise.then((r) => {
      if (live) setApi(r);
    });
    return () => {
      live = false;
    };
  }, [locale]);

  if (DATA_MODE === 'api') return api;
  return {
    status: 'ready',
    rows: demo.map((q) => ({
      code: q.code,
      createdAt: q.createdAt,
      statusKey: quoteStatusKey(q.status),
      waiting: q.status === 'offered',
    })),
  };
}
