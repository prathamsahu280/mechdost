'use client';

import { useCallback, useEffect, useState } from 'react';
import { AUTH_MODE } from './mode';

/**
 * Real-mode email verification state for the account area (spec 01: email verified once, needed before the first
 * order). `unknown` until Firebase answers (and always in demo mode, where accounts count as verified); re-checked
 * when the tab becomes visible again, because people open the link on their phone or in another tab. Firebase is
 * loaded on demand, so the account pages do not carry it in demo mode.
 */
export type EmailState = { kind: 'unknown' } | { kind: 'verified' | 'unverified'; email: string };

export function useEmailStatus(locale: string): { state: EmailState; recheck: () => void } {
  const [state, setState] = useState<EmailState>({ kind: 'unknown' });

  const recheck = useCallback(() => {
    if (AUTH_MODE !== 'firebase') return;
    void import('./firebase-client')
      .then((client) => client.emailStatus(locale))
      .then((status) => {
        setState(
          status
            ? { kind: status.verified ? 'verified' : 'unverified', email: status.email }
            : { kind: 'unknown' },
        );
      })
      .catch(() => undefined);
  }, [locale]);

  useEffect(() => {
    recheck();
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [recheck]);

  return { state, recheck };
}
