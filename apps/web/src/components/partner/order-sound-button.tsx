'use client';

import { Bell, BellOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NewWorkAlert } from './new-work-alert';

/**
 * The order-sound control under a work list's heading: "Turn on order sound" (48 px, shown only while the browser
 * still needs a tap, decision Q-PP-F3) or a quiet "Sound on · Turn off" line. The live region says the result.
 */
export function OrderSoundButton({ alert }: { alert: NewWorkAlert }) {
  const t = useTranslations('partnerKit');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {alert.needsTap ? (
        <button
          type="button"
          onClick={alert.unlock}
          className="press inline-flex min-h-12 items-center gap-2 rounded-button bg-accent-soft px-4 text-sm font-extrabold text-accent-soft-text focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Bell aria-hidden="true" className="size-4" />
          {t('sound_on')}
        </button>
      ) : (
        <button
          type="button"
          aria-pressed={alert.on}
          onClick={() => {
            alert.setOn(!alert.on);
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-button px-2 text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {alert.on ? (
            <Bell aria-hidden="true" className="size-4" />
          ) : (
            <BellOff aria-hidden="true" className="size-4" />
          )}
          {alert.on ? t('sound_is_on') : t('sound_is_off')}
        </button>
      )}
      <span aria-live="polite" className="sr-only">
        {alert.on && !alert.needsTap ? t('sound_ready') : ''}
      </span>
    </div>
  );
}
