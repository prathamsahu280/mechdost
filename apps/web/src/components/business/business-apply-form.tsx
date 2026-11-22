'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { TradeStatus } from '@mechdost/shared/business-codes';
import { AUTH_MODE } from '@/lib/auth/mode';
import { loginHref } from '@/lib/record-links';
import { FleetForm } from './fleet-form';
import { TradeForm } from './trade-form';

type Auth = 'checking' | 'in' | 'out';

const panel = 'rounded-lg bg-surface-alt p-5';
const primaryLink =
  'press inline-flex min-h-12 items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Business application page body (audience entry design 2026-11-22, item 3): a trade account application needs a
 * signed-in account (the account is what gets verified); a fleet enquiry can be sent signed out. The result is the
 * application code, shown as text under a heading that takes focus.
 */
export function BusinessApplyForm({ kind }: { kind: 'trade' | 'fleet' }) {
  const t = useTranslations('business');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const [auth, setAuth] = useState<Auth>('checking');
  const [trade, setTrade] = useState<TradeStatus | 'checking'>('checking');
  const [code, setCode] = useState<string | null>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const real = AUTH_MODE === 'firebase';

  useEffect(() => {
    if (!real) return;
    let live = true;
    void import('@/lib/auth/firebase-client')
      .then(({ currentIdToken }) => currentIdToken(locale))
      .catch(() => null)
      .then((token) => {
        if (live) setAuth(token ? 'in' : 'out');
      });
    return () => {
      live = false;
    };
  }, [real, locale]);

  useEffect(() => {
    if (kind !== 'trade' || auth !== 'in') return;
    let live = true;
    void import('@/lib/business-api')
      .then(({ fetchTradeProfile }) => fetchTradeProfile(locale))
      .then((res) => {
        if (live) setTrade(res.ok ? res.data.status : 'none');
      });
    return () => {
      live = false;
    };
  }, [kind, auth, locale]);

  useEffect(() => {
    if (code) successRef.current?.focus();
  }, [code]);

  if (!real)
    return (
      <div className={panel}>
        <h2 className="font-heading text-lg font-extrabold text-ink">{t('unavailableTitle')}</h2>
        <p className="mt-2 text-sm text-ink">{t('unavailableBody')}</p>
      </div>
    );

  if (code)
    return (
      <div className={panel}>
        <h2 ref={successRef} tabIndex={-1} className="font-heading text-xl font-extrabold text-ink">
          {t(`successTitle_${kind}`)}
        </h2>
        <p className="mt-2 text-sm text-ink">{t(`successBody_${kind}`)}</p>
        <CodeLine code={code} />
        <Link href={`${prefix}/shop`} className={`${primaryLink} mt-5`}>
          {t('successNext')}
        </Link>
      </div>
    );

  if (auth === 'checking' || (kind === 'trade' && auth === 'in' && trade === 'checking'))
    return (
      <p role="status" className="text-sm text-muted">
        {t('categoriesLoading')}
      </p>
    );

  if (kind === 'trade' && auth === 'out')
    return (
      <div className={panel}>
        <h2 className="font-heading text-lg font-extrabold text-ink">{t('signinTitle')}</h2>
        <p className="mt-2 text-sm text-ink">{t('signinBody')}</p>
        <Link
          href={loginHref(prefix, `${prefix}/business/apply?kind=trade`)}
          className={`${primaryLink} mt-4`}
        >
          {t('signinLink')}
        </Link>
      </div>
    );

  if (kind === 'trade' && trade === 'verified')
    return (
      <div className={panel}>
        <p className="text-sm font-bold text-ink">{t('alreadyVerified')}</p>
      </div>
    );
  if (kind === 'trade' && trade === 'pending')
    return (
      <div className={panel}>
        <h2 className="font-heading text-lg font-extrabold text-ink">{t('pendingTitle')}</h2>
        <p className="mt-2 text-sm text-ink">{t('pendingBody')}</p>
      </div>
    );

  return kind === 'trade' ? (
    <TradeForm onDone={setCode} />
  ) : (
    <FleetForm signedIn={auth === 'in'} onDone={setCode} />
  );
}

/** The application code as selectable text, with a copy button that announces itself politely. */
function CodeLine({ code }: { code: string }) {
  const t = useTranslations('business');
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4">
      <p className="text-sm text-muted">{t('codeLabel')}</p>
      <p className="flex flex-wrap items-center gap-3">
        <strong data-user-content className="font-heading text-lg font-extrabold tracking-wide text-ink">
          {code}
        </strong>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
            });
          }}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t('copyCode')}
        </button>
        <span role="status" className="text-sm text-muted">
          {copied ? t('copied') : ''}
        </span>
      </p>
    </div>
  );
}
