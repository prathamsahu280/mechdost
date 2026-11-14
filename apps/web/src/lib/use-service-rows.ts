'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { workshopNameFor } from '@/demo/i18n/localize';
import { REQUEST_STAGES, requestStage, useRequests } from '@/demo/store';
import { DATA_MODE } from './data-mode';
import { requestStatusKey } from './service-views';

/** One line of the customer's service requests, the same whether it comes from the demo or the API. */
export interface ServiceRow {
  code: string;
  /** Workshop name in the page language; null while MechDost is choosing one (API only). */
  workshop: string | null;
  /** `request` locale key for the status. */
  statusKey: string;
  /** A proposal or an estimate waits for the customer (account badge). */
  waiting: boolean;
}

export interface ServiceRows {
  rows: ServiceRow[];
  status: 'ready' | 'loading' | 'error';
}

// Navigation, overview and list all read it on one page: one request serves them for a few seconds.
let shared: { locale: string; at: number; promise: Promise<ServiceRows> } | null = null;

async function loadApiRows(locale: string): Promise<ServiceRows> {
  const { fetchMyServiceRequests } = await import('./service-api');
  const res = await fetchMyServiceRequests(locale);
  if (!res.ok) return { rows: [], status: 'error' };
  return {
    status: 'ready',
    rows: res.data.items.map((r) => ({
      code: r.code,
      workshop: r.workshop?.name ?? null,
      statusKey: requestStatusKey(r.status),
      waiting: r.waitingForCustomer,
    })),
  };
}

/**
 * The signed-in customer's service requests, newest first. Demo data mode: the browser store. Real data mode
 * (`NEXT_PUBLIC_DATA_MODE=api`, Stream E): `GET /v1/service-requests` (first page of 20).
 */
export function useServiceRows(): ServiceRows {
  const locale = useLocale();
  const demo = useRequests();
  const [api, setApi] = useState<ServiceRows>({ rows: [], status: 'loading' });

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
    rows: demo.map((x) => {
      const stage = requestStage(x);
      return {
        code: x.code,
        workshop: workshopNameFor(x.workshopSlug, x.workshopName, locale),
        statusKey: `stage_${REQUEST_STAGES[x.stage] ?? 'requested'}`,
        waiting: !x.cancellation && (stage === 'proposed' || stage === 'estimate_sent'),
      };
    }),
  };
}
