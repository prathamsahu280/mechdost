'use client';

import type { CodEligibility, CodRequestState } from '@mechdost/shared/cod-eligibility';
import type { MyCod } from '@mechdost/shared/cod-api';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { codNextAction } from '@/lib/cod-view';
import { DATA_MODE } from '@/lib/data-mode';
import { formatPrice } from '@/lib/format';
import { demoCodEligibility, demoCodRequestsOf, useDemoCod, withdrawDemoCod } from '@/demo/cod';
import type { DemoAccount } from '@/demo/session';

const CodRequestPanel = lazy(() => import('../commerce/cod-request-panel'));
const REAL = DATA_MODE === 'api' && AUTH_MODE === 'firebase';
const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';

interface RequestRow {
  id: string;
  status: CodRequestState;
  decisionReasonCode: string | null;
  revokeReasonCode: string | null;
  capPaise: number | null;
  expiresAt: string | null;
  createdAt: string;
  version: number;
}

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; eligibility: CodEligibility; requests: RequestRow[] };

const WHY = new Set([
  'insufficient_history',
  'unverified_details',
  'rto_history',
  'area_not_supported',
  'risk_signals',
  'cod_refused',
  'misuse',
  'customer_request',
  'other',
]);
type Why =
  | 'insufficient_history'
  | 'unverified_details'
  | 'rto_history'
  | 'area_not_supported'
  | 'risk_signals'
  | 'cod_refused'
  | 'misuse'
  | 'customer_request'
  | 'other';
const isWhy = (v: string | null): v is Why => v !== null && WHY.has(v);

/**
 * Account → Payments (founder ruling 2026-11-26; spec 03 § Cash-on-delivery eligibility): online payment is always
 * there; cash on delivery shows whether it is the customer's (and why not), the one next action, and the history of
 * their requests with "Withdraw request" on a pending one. Real sign-in reads `GET /v1/me/cod`; the demo its store.
 */
export default function AccountPayments({ account }: { account: DemoAccount }) {
  const t = useTranslations('accountPayments');
  const c = useTranslations('checkout');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const home = account.addresses.find((a) => a.isDefault) ?? account.addresses[0] ?? null;
  const pincode = home?.pincode ?? '492001';
  const demo = useDemoCod();
  const [real, setReal] = useState<Load>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!REAL) return;
    let live = true;
    void import('@/lib/cod-api').then(async ({ fetchMyCod }) => {
      const res = await fetchMyCod(locale, pincode);
      if (!live) return;
      setReal(res.ok ? { state: 'ready', ...toLoad(res.data) } : { state: 'error' });
    });
    return () => {
      live = false;
    };
  }, [locale, pincode, reload]);

  const load: Load = REAL
    ? real
    : {
        state: 'ready',
        eligibility: demoCodEligibility(demo, account.id),
        requests: demoCodRequestsOf(demo, account.id),
      };
  const eligibility = load.state === 'ready' ? load.eligibility : null;
  const shown = eligibility && !eligibility.eligible ? eligibility.reason : null;
  const action =
    eligibility && !eligibility.eligible ? codNextAction(eligibility.reason, eligibility.canRequest) : null;
  useEffect(() => {
    if (shown)
      track('checkout_cod_unavailable_shown', {
        surface: 'account',
        reason: shown,
        canRequest: action === 'request',
      });
  }, [shown, action]);

  const refresh = useCallback(() => {
    setReload((n) => n + 1);
  }, []);

  async function withdraw(r: RequestRow) {
    setBusy(r.id);
    if (REAL) {
      const { withdrawCodRequest } = await import('@/lib/cod-api');
      await withdrawCodRequest(locale, r.id, r.version);
    } else withdrawDemoCod(r.id, r.version);
    setBusy(null);
    refresh();
  }

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      dateStyle: 'medium',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <section className={card} aria-labelledby="payments-title">
        <h2 id="payments-title" className="font-heading text-xl font-extrabold text-ink">
          {t('title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('intro')}</p>
        <div className="mt-4 rounded-tile border border-line-card p-4">
          <h3 className="text-sm font-bold text-ink">{t('onlineTitle')}</h3>
          <p className="mt-1 text-sm text-muted">{t('onlineBody')}</p>
        </div>
        <div className="mt-3 rounded-tile border border-line-card p-4">
          <h3 className="text-sm font-bold text-ink">{t('codTitle')}</h3>
          {load.state === 'loading' ? (
            <p role="status" className="mt-1 text-sm text-muted">
              {t('loading')}
            </p>
          ) : load.state === 'error' ? (
            <div className="mt-1">
              <p role="alert" className="text-sm font-bold text-error">
                {t('error')}
              </p>
              <button
                type="button"
                onClick={refresh}
                className="press mt-2 min-h-11 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {t('retry')}
              </button>
            </div>
          ) : load.eligibility.eligible ? (
            <div className="mt-1 text-sm text-ink">
              <p>{t(`codYes_${load.eligibility.via ?? 'everyone'}`)}</p>
              {load.eligibility.capPaise !== null ? (
                <p className="mt-1 text-muted">
                  {t('codCap', { amount: formatPrice(load.eligibility.capPaise) })}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-1">
              <p id="payments-cod-reason" className="text-sm text-ink">
                {c(`codNot_${load.eligibility.reason ?? 'disabled'}`)}
              </p>
              <p className="mt-1 text-xs text-muted">{t('pincodeHint', { pincode })}</p>
              {action === 'request' && !panel ? (
                <button
                  type="button"
                  data-disclosure-trigger="cod-request"
                  aria-expanded="false"
                  onClick={() => {
                    setPanel(true);
                  }}
                  className="press mt-3 min-h-11 rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
                >
                  {c('codAction_request')}
                </button>
              ) : null}
              {action === 'ustaad_verify' || action === 'ustaad_join' ? (
                <Link
                  href={`${prefix}${action === 'ustaad_verify' ? '/ustaad/me' : '/ustaad/join'}`}
                  className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline underline-offset-2"
                >
                  {c(action === 'ustaad_verify' ? 'codAction_ustaad_verify' : 'codAction_ustaad_join')}
                </Link>
              ) : null}
              {panel ? (
                <Suspense fallback={<div className="skeleton mt-3 h-40 rounded-card" aria-hidden="true" />}>
                  <CodRequestPanel
                    surface="account"
                    pincode={pincode}
                    accountId={account.id}
                    onClose={() => {
                      setPanel(false);
                    }}
                    onSent={refresh}
                  />
                </Suspense>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {load.state === 'ready' && load.requests.length > 0 ? (
        <section className={card} aria-labelledby="payments-history">
          <h2 id="payments-history" className="font-heading text-lg font-extrabold text-ink">
            {t('historyTitle')}
          </h2>
          <ul className="mt-3 space-y-3">
            {load.requests.map((r) => {
              const why = isWhy(r.decisionReasonCode)
                ? r.decisionReasonCode
                : isWhy(r.revokeReasonCode)
                  ? r.revokeReasonCode
                  : null;
              return (
                <li key={r.id} className="rounded-tile border border-line-card p-4 text-sm">
                  <p className="font-bold text-ink">{t(`state_${r.status}`)}</p>
                  <p className="text-muted">{t('asked', { date: date(r.createdAt) })}</p>
                  {why && (r.status === 'rejected' || r.status === 'revoked') ? (
                    <p className="mt-1 text-ink">{t(`why_${why}`)}</p>
                  ) : null}
                  {r.status === 'approved' && r.capPaise !== null ? (
                    <p className="mt-1 text-ink">{t('codCap', { amount: formatPrice(r.capPaise) })}</p>
                  ) : null}
                  {r.status === 'approved' && r.expiresAt ? (
                    <p className="mt-1 text-ink">{t('codUntil', { date: date(r.expiresAt) })}</p>
                  ) : null}
                  {r.status === 'pending' ? (
                    <button
                      type="button"
                      disabled={busy === r.id}
                      aria-busy={busy === r.id}
                      onClick={() => void withdraw(r)}
                      className="press mt-2 min-h-11 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-70"
                    >
                      {busy === r.id ? t('withdrawing') : t('withdraw')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function toLoad(d: MyCod): { eligibility: CodEligibility; requests: RequestRow[] } {
  return {
    eligibility: d.eligibility,
    requests: d.requests.map((r) => ({
      id: r.id,
      status: r.status,
      decisionReasonCode: r.decisionReasonCode,
      revokeReasonCode: r.revokeReasonCode,
      capPaise: r.capPaise,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      version: r.version,
    })),
  };
}
