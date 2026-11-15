'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { fetchWaitlist, joinWaitlist, leaveWaitlist } from '@/lib/waitlist-api';

const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-60';

type State = 'idle' | 'waiting' | 'saving' | 'full' | 'error';

/**
 * "Tell me when MechDost reaches this PIN code" (spec 15 waitlist, design 2026-11-15 item 7), shown under an address
 * the service area does not cover. One button, no form: the notice goes to the signed-in account, so no email or phone
 * is typed. It looks up once whether this PIN is already waited for, so a second visit shows the real state. Loaded
 * lazily (it adds nothing to the checkout or address bundles until an unserved PIN is shown).
 */
export function NotifyMe({ pincode }: { pincode: string }) {
  const t = useTranslations('accountApi');
  const locale = useLocale();
  const [state, setState] = useState<State>('idle');

  useEffect(() => {
    let live = true;
    void fetchWaitlist(locale).then((res) => {
      if (live && res.ok && res.data.entries.some((e) => e.pincode === pincode && e.status === 'waiting'))
        setState('waiting');
    });
    return () => {
      live = false;
    };
  }, [locale, pincode]);

  async function join() {
    setState('saving');
    const res = await joinWaitlist(locale, pincode);
    if (res.ok) setState('waiting');
    else setState(res.code === 'WAITLIST_FULL' ? 'full' : 'error');
  }

  async function leave() {
    setState('saving');
    const res = await leaveWaitlist(locale, pincode);
    setState(res.ok ? 'idle' : 'error');
  }

  return (
    <div className="mt-2">
      {state === 'waiting' ? (
        <>
          <p role="status" className="text-sm font-bold text-success">
            {t('notifyDone', { pincode })}
          </p>
          <button type="button" onClick={() => void leave()} className={`${quiet} mt-2`}>
            {t('notifyStop')}
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={state === 'saving'}
          data-track="waitlist_join_click"
          onClick={() => void join()}
          className={quiet}
        >
          {t('notifyMe')}
        </button>
      )}
      <p role="alert" className="text-sm font-bold text-error">
        {state === 'full' ? t('notifyFull') : state === 'error' ? t('notifyError') : ''}
      </p>
    </div>
  );
}
