'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { NoticePreferences } from '@mechdost/shared/notice-api';
import { fetchNoticePreferences, saveNoticePreferences } from '@/lib/notices-api';
import { PushDevice } from './push-card';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card';

type Status = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Notification choices (spec 10, design 2026-11-15): the push device card, "Order, booking and support updates" on
 * push (the bell itself always shows them), and, for customers only, "Offers and promotions", which records or
 * withdraws the marketing consent (DPDP, notice version). Saves on each change.
 */
export function NoticeSettings({ role }: { role: string }) {
  const t = useTranslations('bell');
  const locale = useLocale();
  const [prefs, setPrefs] = useState<NoticePreferences | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const introId = useId();

  useEffect(() => {
    let alive = true;
    void fetchNoticePreferences(locale).then((res) => {
      if (!alive) return;
      if (res.ok)
        setPrefs({ pushTransactional: res.data.pushTransactional, promotions: res.data.promotions });
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [locale]);

  async function change(next: Partial<NoticePreferences>) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, ...next });
    setStatus('saving');
    const res = await saveNoticePreferences(locale, next);
    if (res.ok) {
      setPrefs({ pushTransactional: res.data.pushTransactional, promotions: res.data.promotions });
      setStatus('saved');
    } else {
      setPrefs(before);
      setStatus('error');
    }
  }

  const box = 'mt-0.5 size-5 shrink-0 accent-[var(--color-accent-button)]';
  return (
    <div className="space-y-6">
      <PushDevice />
      <section aria-labelledby={introId} className={`${card} space-y-4`}>
        <div>
          <h2 id={introId} className="font-heading text-base font-extrabold text-ink">
            {t('prefsTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('prefsIntro')}</p>
        </div>
        {failed ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t('loadError')}
          </p>
        ) : null}
        {!prefs && !failed ? (
          <div className="skeleton h-24 rounded-card" aria-hidden="true" />
        ) : prefs ? (
          <div className="space-y-4">
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                className={box}
                checked={prefs.pushTransactional}
                onChange={(e) => void change({ pushTransactional: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-bold text-ink">{t('prefsTransactional')}</span>
                <span className="block text-[13px] text-muted">{t('prefsTransactionalHelp')}</span>
              </span>
            </label>
            {role === 'customer' ? (
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className={box}
                  checked={prefs.promotions}
                  onChange={(e) => void change({ promotions: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-bold text-ink">{t('prefsPromo')}</span>
                  <span className="block text-[13px] text-muted">{t('prefsPromoHelp')}</span>
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">
          {status === 'saved' ? t('prefsSaved') : status === 'error' ? t('prefsError') : ''}
        </p>
      </section>
    </div>
  );
}
