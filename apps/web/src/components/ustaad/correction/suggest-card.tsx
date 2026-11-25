'use client';

import { useTranslations } from 'next-intl';
import { Check, WandSparkles } from 'lucide-react';
import { useId } from 'react';
import type {
  CorrectionChoice,
  CorrectionLang,
  CorrectResponseView,
} from '@mechdost/shared/ustaad/correction';
import { textLang, visibleSegments } from '@/lib/ustaad/correction';

const primary =
  'press inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border bg-surface px-4 text-sm font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Suggest card (spec 23 § 11, suggest mode): "Suggestion: a clearer version" with the changed words marked (a tinted
 * background **and** an underline, so the cue is not colour alone; screen readers hear "changed" after each run),
 * "You wrote" with the member's own text, and one primary action. Inline under the field, never a modal; it does not
 * take focus when it appears. Member text is rendered as text (React escapes it), never as HTML (SR-26).
 */
export function SuggestCard({
  result,
  onChoice,
  hintLang = null,
}: {
  result: CorrectResponseView;
  onChoice: (choice: CorrectionChoice) => void;
  /** The composer's language hint (sets `lang` on Latin-script member text). */
  hintLang?: CorrectionLang | null;
}) {
  const t = useTranslations('ustaad.correction');
  const titleId = useId();
  return (
    <section
      data-slot="correction-suggest"
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-card border-2 border-info bg-surface p-3"
    >
      <h3
        id={titleId}
        className="flex items-center gap-2 text-balance font-heading text-[15px] font-extrabold text-info"
      >
        <WandSparkles aria-hidden="true" className="size-5" />
        {t('title')}
      </h3>
      <p
        data-user-content
        lang={textLang(result.text, hintLang)}
        className="rounded-input bg-info-bg px-3 py-2.5 text-[17px] leading-relaxed font-bold break-words text-ink"
      >
        {visibleSegments(result.segments).map((s, i) =>
          s.kind === 'same' ? (
            <span key={i}>{s.text}</span>
          ) : (
            <mark
              key={i}
              className="rounded-sm bg-warning-bg px-0.5 text-ink underline decoration-2 underline-offset-4"
            >
              {s.text}
              <span className="sr-only"> ({t('changedWord')})</span>
            </mark>
          ),
        )}
      </p>
      <p className="text-xs text-muted">{t('changedHint')}</p>
      <div className="text-sm">
        <p className="font-bold text-muted">{t('youWrote')}</p>
        <p
          data-user-content
          lang={textLang(result.original, hintLang)}
          className="mt-0.5 break-words text-ink"
        >
          {result.original}
        </p>
      </div>
      <p className="text-xs text-muted">{t('note')}</p>
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
        <button
          type="button"
          className={primary}
          onClick={() => {
            onChoice('use');
          }}
        >
          <Check aria-hidden="true" className="size-[18px]" />
          {t('use')}
        </button>
        <button
          type="button"
          className={quiet}
          onClick={() => {
            onChoice('keep');
          }}
        >
          {t('keep')}
        </button>
      </div>
      <button
        type="button"
        className="self-start text-sm font-bold text-info underline underline-offset-4 hover:no-underline min-h-11 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onClick={() => {
          onChoice('edit');
        }}
      >
        {t('edit')}
      </button>
    </section>
  );
}
