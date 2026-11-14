'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import {
  acceptAgreement,
  currentAgreement,
  publishAgreement,
  shopAgreementStatus,
  useAgreementsVersion,
} from '@/demo/agreements';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { formatDate } from '@/lib/format';
import { GenuineClauseButton } from './genuine-clause';
import { portalCard, portalField, portalPrimary } from './portal-guard';

/** Real sign-in builds: the same cards on the API (`/v1/admin/agreements`, `/v1/shop-onboarding/{shopId}/agreement`). */
const AgreementApi = dynamic(() => import('./admin-onboarding-api').then((m) => m.AgreementApi), {
  ssr: false,
});
const ShopAgreementApi = dynamic(() => import('./shop-onboarding-api').then((m) => m.ShopAgreementApi), {
  ssr: false,
});

export function AdminAgreement() {
  return AUTH_MODE === 'firebase' ? <AgreementApi /> : <DemoAdminAgreement />;
}

export function ShopAgreement({ shopSlug }: { shopSlug: string }) {
  return AUTH_MODE === 'firebase' ? <ShopAgreementApi /> : <DemoShopAgreement shopSlug={shopSlug} />;
}

/**
 * Admin: publish the seller agreement (user 2026-11-13; text from the user later, Q77). Every version is kept;
 * publishing a new one asks every shop to accept again. Both languages are required (hard rule 10).
 */
function DemoAdminAgreement() {
  const t = useTranslations('portal');
  useAgreementsVersion();
  const current = typeof window === 'undefined' ? null : currentAgreement();
  const [invalid, setInvalid] = useState(false);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v : '';
    };
    const result = publishAgreement({ textEn: text('textEn'), textHi: text('textHi') });
    if ('error' in result) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    form.reset();
    track('click', { id: 'admin_agreement_published', path: window.location.pathname });
  }

  return (
    <section aria-labelledby="agreement-admin-title" className={portalCard}>
      <h3 id="agreement-admin-title" className="font-heading text-lg font-extrabold text-ink">
        {t('agreementTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">
        {current ? t('agreementCurrent', { version: current.version }) : t('agreementNone')}
      </p>
      <form noValidate onSubmit={onSubmit} className="mt-4 space-y-3">
        {(['textEn', 'textHi'] as const).map((k) => (
          <div key={k}>
            <label htmlFor={`agreement-${k}`} className="text-sm font-bold text-ink">
              {k === 'textEn' ? t('agreementTextEn') : t('agreementTextHi')}
            </label>
            <textarea
              id={`agreement-${k}`}
              name={k}
              rows={5}
              maxLength={50_000}
              lang={k === 'textEn' ? 'en' : 'hi'}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? 'agreement-error' : undefined}
              className={`${portalField} mt-1 block w-full py-2`}
            />
          </div>
        ))}
        <GenuineClauseButton />
        {invalid ? (
          <p id="agreement-error" className="text-xs font-bold text-error">
            {t('agreementErrText')}
          </p>
        ) : null}
        <button type="submit" className={portalPrimary}>
          {t('agreementPublish')}
        </button>
      </form>
    </section>
  );
}

/** Shop: read and accept the current agreement. Hidden until MechDost publishes one. */
function DemoShopAgreement({ shopSlug }: { shopSlug: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  useAgreementsVersion();
  const [ticked, setTicked] = useState(false);
  const [missing, setMissing] = useState(false);
  const [outdated, setOutdated] = useState(false);
  if (typeof window === 'undefined') return null;
  const current = currentAgreement();
  const status = shopAgreementStatus(shopSlug);
  if (!current || status.status === 'none') return null;

  function accept(agreementVersion: number) {
    if (!ticked) {
      setMissing(true);
      document.getElementById('agreement-consent')?.focus();
      return;
    }
    const ok = acceptAgreement(shopSlug, agreementVersion);
    setOutdated(!ok);
    if (ok) track('click', { id: 'shop_agreement_accepted', path: window.location.pathname });
  }

  return (
    <section aria-labelledby="agreement-shop-title" className={portalCard}>
      <h2 id="agreement-shop-title" className="font-heading text-xl font-extrabold text-ink">
        {t('agreementTitle')}
      </h2>
      <div
        lang={locale === 'hi' ? 'hi' : 'en'}
        className="mt-3 max-h-64 overflow-y-auto rounded-lg bg-surface-alt p-3 text-sm whitespace-pre-line text-ink"
      >
        {locale === 'hi' ? current.textHi : current.textEn}
      </div>
      {status.status === 'accepted' ? (
        <p className="mt-3 text-sm font-bold text-ink" role="status">
          {t('agreementAccepted', { version: status.version, date: formatDate(status.acceptedAt, locale) })}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted">{t('agreementAsk', { version: status.version })}</p>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              id="agreement-consent"
              type="checkbox"
              checked={ticked}
              aria-invalid={missing ? true : undefined}
              aria-describedby={missing ? 'agreement-consent-error' : undefined}
              onChange={(e) => {
                setTicked(e.target.checked);
                setMissing(false);
              }}
              className="mt-0.5 size-5 accent-[var(--color-accent-button)]"
            />
            <span>{t('agreementConsent')}</span>
          </label>
          {missing ? (
            <p id="agreement-consent-error" className="text-xs font-bold text-error">
              {t('agreementErrConsent')}
            </p>
          ) : null}
          {outdated ? (
            <p role="alert" className="text-xs font-bold text-error">
              {t('agreementOutdated')}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              accept(status.version);
            }}
            className={portalPrimary}
          >
            {t('agreementAccept')}
          </button>
        </div>
      )}
    </section>
  );
}
