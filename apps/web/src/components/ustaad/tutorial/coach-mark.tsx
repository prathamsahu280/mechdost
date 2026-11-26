'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { CoachmarkTarget } from '@mechdost/shared/ustaad/codes';
import { track } from '@/lib/analytics';

/**
 * A coach-mark (spec 23 flow 15): a small bubble under one control the first time it is seen, dismissed with
 * "Samajh gaya / Got it". It never covers the screen or blocks the control (it sits in the flow below it, not as an
 * overlay), and only one shows at a time: the first target on the page that is not seen yet claims the slot.
 * Text comes from the admin table in the member's language. "Kaise use karein" in Me resets them.
 */
let claimed: CoachmarkTarget | null = null;

export function CoachMark({ target, returnFocusTo }: { target: CoachmarkTarget; returnFocusTo: string }) {
  const t = useTranslations('ustaad.tutorial');
  const locale = useLocale();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const run = { live: true };
    void (async () => {
      const api = await import('@/lib/ustaad/identity-api');
      const [progress, tutorial] = await Promise.all([
        api.fetchOnboarding(locale),
        api.fetchTutorial(locale),
      ]);
      if (!run.live || !progress.ok || !tutorial.ok) return;
      if (progress.data.coachmarksSeen.includes(target)) return;
      const mark = tutorial.data.coachmarks.find((m) => m.target === target);
      if (!mark || (claimed !== null && claimed !== target)) return;
      claimed = target;
      setText(mark.text);
      track('ustaad_coachmark_seen', { target });
    })();
    return () => {
      run.live = false;
      if (claimed === target) claimed = null;
    };
  }, [locale, target]);

  return (
    <div className="mt-3">
      {/* Always mounted so the hint is announced when it appears; the button sits outside the live text. */}
      <p role="status" className={text ? 'sr-only' : 'hidden'}>
        {text ?? ''}
      </p>
      {text ? (
        <div className="relative max-w-xs rounded-card bg-accent-button p-3 text-white shadow-float">
          <span aria-hidden="true" className="absolute -top-1.5 left-6 size-3 rotate-45 bg-accent-button" />
          <p aria-hidden="true" className="text-sm font-bold">
            {text}
          </p>
          <button
            type="button"
            onClick={() => {
              // Focus goes back to the control the hint points at before the bubble goes away.
              document.getElementById(returnFocusTo)?.focus();
              setText(null);
              claimed = null;
              track('ustaad_coachmark_dismissed', { target });
              void import('@/lib/ustaad/identity-api').then((api) =>
                api.saveOnboarding(locale, { event: 'coachmark', target }),
              );
            }}
            className="press mt-2 min-h-12 rounded-button bg-white px-4 text-sm font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {t('gotIt')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
