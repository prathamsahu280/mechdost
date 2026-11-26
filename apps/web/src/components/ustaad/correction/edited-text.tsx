'use client';

import { useTranslations } from 'next-intl';
import { WandSparkles } from 'lucide-react';
import { useState } from 'react';
import type { CorrectionLang } from '@mechdost/shared/ustaad/correction';
import { shownText, textLang } from '@/lib/ustaad/correction-text';

/**
 * Member text that smart correction changed (spec 23 § 11, auto mode or a used suggestion): shows the corrected text
 * and an "Edited · see original" toggle (a real button, 44 px high, whose label says what it will show next; no `aria-pressed` because the label changes) that swaps in the original as
 * written. Without an original it is plain text and no toggle. Text is rendered as text, never as HTML (SR-26).
 */
export function EditedText({
  body,
  bodyOriginal,
  className = '',
  lang = null,
}: {
  body: string;
  bodyOriginal: string | null;
  className?: string;
  /** The post's language hint, for `lang` on Latin-script text. */
  lang?: CorrectionLang | null;
}) {
  const t = useTranslations('ustaad.correction');
  const [showOriginal, setShowOriginal] = useState(false);
  const text = shownText({ body, bodyOriginal }, showOriginal);
  return (
    <div data-slot="edited-text" className="flex flex-col gap-1">
      <p
        data-user-content
        lang={textLang(text, lang)}
        className={`whitespace-pre-line break-words ${className}`}
      >
        {text}
      </p>
      {bodyOriginal !== null && bodyOriginal !== body ? (
        <button
          type="button"
          onClick={() => {
            setShowOriginal((v) => !v);
          }}
          className="press inline-flex min-h-11 items-center gap-1.5 self-start rounded-pill bg-info-bg px-3 text-[13px] font-bold text-info hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <WandSparkles aria-hidden="true" className="size-4" />
          {showOriginal ? t('seeFixed') : t('edited')}
        </button>
      ) : null}
    </div>
  );
}
