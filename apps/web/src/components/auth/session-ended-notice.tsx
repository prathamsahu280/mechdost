'use client';

import { useTranslations } from 'next-intl';
import { useSessionEnded } from '@/lib/auth/session-ended-flag';

/**
 * "You were signed out on this device. Sign in again to continue." (bug 2026-11-28). Shown above a sign-in card after
 * the site session was cleared because Firebase ended the sign-in elsewhere; gone with the next sign-in. A polite
 * status, not an alert: the card below already carries the one action.
 */
export function SessionEndedNotice() {
  const t = useTranslations('auth');
  const ended = useSessionEnded();
  if (!ended) return null;
  return (
    <p
      role="status"
      className="mb-4 rounded-button border border-line-card bg-pill px-4 py-3 text-sm font-bold text-ink"
    >
      {t('sessionEndedNotice')}
    </p>
  );
}
