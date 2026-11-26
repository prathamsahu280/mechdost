'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { VerificationView } from '@mechdost/shared/ustaad/dto/verification';
import { useSession } from '@/demo/session';
import { localePath } from '@/lib/locale-path';
import { statusSteps, type StepState } from '@/lib/ustaad/card';

const STEP_KEYS = ['step_asked', 'step_proof', 'step_review', 'step_done'] as const;
const MARK: Record<StepState, string> = { done: '✓', current: '●', todo: '○', failed: '✕' };

/**
 * Mechanic verification progress on `/partners/status` (spec 23 § 4a): asked → proof (owner confirmed / vouches n of
 * m) → MechDost review → verified, or the reason. Shown only to a signed-in member: anyone else gets 404 from the API
 * (also while the network is not open), and then nothing renders here, so the page stays as it was.
 */
export function UstaadVerificationProgress() {
  const t = useTranslations('ustaad.card');
  const locale = useLocale();
  const session = useSession();
  const [state, setState] = useState<{ v: VerificationView | null } | null>(null);

  useEffect(() => {
    if (!session) return;
    const run = { live: true };
    void (async () => {
      const api = await import('@/lib/ustaad/identity-api');
      const res = await api.fetchVerificationStatus(locale);
      if (run.live && res.ok) setState({ v: res.data.verification });
    })();
    return () => {
      run.live = false;
    };
  }, [locale, session]);

  if (!state) return null;
  const v = state.v;
  return (
    <section
      aria-labelledby="ustaad-verify-progress"
      className="mb-8 grid gap-4 rounded-card border border-line-card bg-surface p-5 shadow-card"
    >
      <h2 id="ustaad-verify-progress" className="font-heading text-xl font-extrabold text-ink">
        {t('status_title')}
      </h2>
      {v ? (
        <>
          <p className="text-base text-ink">{t(`status_${v.status}`)}</p>
          <ol className="grid gap-2 min-[520px]:grid-cols-4">
            {statusSteps(v).map((s, n) => (
              <li
                key={STEP_KEYS[n]}
                aria-current={s === 'current' ? 'step' : undefined}
                className={`flex min-h-12 items-center gap-2 rounded-card border px-3 text-sm font-bold ${
                  s === 'current' ? 'border-accent bg-accent-soft text-ink' : 'border-line-card text-ink'
                }`}
              >
                <span aria-hidden="true">{MARK[s]}</span>
                {t(STEP_KEYS[n] ?? 'step_asked')}
              </li>
            ))}
          </ol>
          <ul className="grid gap-1 text-sm text-ink">
            {v.proofKinds.includes('owner') ? (
              <li>{t('proofOwner', { state: t(`att_${v.attestation ?? 'none'}`) })}</li>
            ) : null}
            {v.proofKinds.includes('vouch') ? (
              <li>{t('proofVouches', { given: v.vouchesGiven, needed: v.vouchesNeeded })}</li>
            ) : null}
          </ul>
          {v.reasonCode && (v.status === 'rejected' || v.status === 'revoked') ? (
            <p className="text-sm font-bold text-ink">{t(`reason_${v.reasonCode}`)}</p>
          ) : null}
        </>
      ) : (
        <p className="text-base text-ink">{t('status_none')}</p>
      )}
      <a
        href={localePath('/ustaad/me', locale)}
        className="press inline-flex min-h-12 items-center justify-center rounded-button bg-accent-button px-5 text-base font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus min-[520px]:justify-self-start"
      >
        {t('openNetwork')}
      </a>
    </section>
  );
}
