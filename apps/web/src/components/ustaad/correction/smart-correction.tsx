'use client';

import { useLocale, useTranslations } from 'next-intl';
import { WandSparkles } from 'lucide-react';
import { useState, type RefObject } from 'react';
import type {
  CorrectionChoice,
  CorrectionLang,
  CorrectResponseView,
} from '@mechdost/shared/ustaad/correction';
import { track } from '@/lib/analytics';
import {
  applyChoice,
  correctionErrorKey,
  requestCorrection,
  suggestViewFor,
  type ChoiceOutcome,
} from '@/lib/ustaad/correction';
import { SuggestCard } from './suggest-card';

const quiet =
  'press inline-flex min-h-11 items-center justify-center gap-2 rounded-button border border-input-border bg-surface px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** What a composer stores with the text (spec 23 § 6.3: `body`, `body_original`, `correction`). */
export interface CorrectionMeta {
  correction: 'none' | 'suggested_used' | 'auto';
  original: string | null;
}

interface Status {
  key: 'used' | 'kept' | 'clear' | 'empty' | 'limited' | 'failed';
  undo: string | null;
}

/**
 * Smart correction under a typed-text field (spec 23 § 11). Suggest mode: "Make it clearer" checks the text and shows
 * the suggest card; the choice updates the field and a status line ("Suggestion used. Undo") is announced politely.
 * Auto mode: the note explains that the text is fixed on send — the composer calls `correctForSend` itself and stores
 * the original. The field keeps focus rules: the card never steals focus; "Edit myself" and Undo return focus to the
 * field.
 */
export function SmartCorrection({
  value,
  onChange,
  fieldRef,
  lang = null,
  mode = 'suggest',
}: {
  value: string;
  onChange: (text: string, meta: CorrectionMeta) => void;
  fieldRef?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  lang?: CorrectionLang | null;
  /** The network/member mode the composer already knows (from `/ustaad/me`); `off` renders nothing. */
  mode?: 'suggest' | 'auto' | 'off';
}) {
  const t = useTranslations('ustaad.correction');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CorrectResponseView | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  if (mode === 'off') return null;
  if (mode === 'auto')
    return (
      <p className="flex items-start gap-2 text-sm text-muted">
        <WandSparkles aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-info" />
        <span>{t('autoNote')}</span>
      </p>
    );

  const focusField = () => fieldRef?.current?.focus();

  async function check() {
    setStatus(null);
    if (value.trim() === '') {
      setStatus({ key: 'empty', undo: null });
      return;
    }
    setBusy(true);
    const res = await requestCorrection(locale, { text: value, lang, mode: 'suggest' });
    setBusy(false);
    if (!res.ok) {
      setStatus({ key: correctionErrorKey(res.code), undo: null });
      return;
    }
    const view = suggestViewFor(res.data);
    if (view.kind === 'clear') {
      setStatus({ key: 'clear', undo: null });
      return;
    }
    setResult(res.data);
    if (res.data.engine)
      track('ustaad_correction_shown', {
        engine: res.data.engine,
        mode: 'suggest',
        changes: res.data.changes,
      });
  }

  function choose(choice: CorrectionChoice) {
    if (!result) return;
    const outcome: ChoiceOutcome = applyChoice(choice, result);
    track('ustaad_correction_choice', { choice });
    onChange(outcome.text, { correction: outcome.correction, original: outcome.original });
    setResult(null);
    setStatus(choice === 'use' ? { key: 'used', undo: outcome.undo } : { key: 'kept', undo: null });
    if (choice === 'edit') focusField();
  }

  function undo(previous: string) {
    onChange(previous, { correction: 'none', original: null });
    setStatus(null);
    focusField();
  }

  return (
    <div className="flex flex-col gap-2">
      {result ? (
        <SuggestCard result={result} onChoice={choose} />
      ) : (
        <button type="button" className={`${quiet} self-start`} disabled={busy} onClick={() => void check()}>
          <WandSparkles aria-hidden="true" className="size-[18px]" />
          {busy ? t('checking') : t('check')}
        </button>
      )}
      <p role="status" aria-atomic="true" className="min-h-5 text-sm text-ink">
        {status ? t(status.key) : ''}
        {status?.undo !== null && status?.undo !== undefined ? (
          <>
            {' '}
            <button
              type="button"
              className="min-h-11 font-bold text-info underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={() => {
                if (status.undo !== null) undo(status.undo);
              }}
            >
              {t('undo')}
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Auto mode, on send: returns the text to store and its meta. Any failure sends the member's own words unchanged
 * (correction is a help, never a gate).
 */
export async function correctForSend(
  locale: string,
  text: string,
  lang: CorrectionLang | null = null,
): Promise<{ text: string; meta: CorrectionMeta }> {
  const res = await requestCorrection(locale, { text, lang, mode: 'auto' });
  if (!res.ok || !res.data.changed || res.data.mode !== 'auto')
    return { text, meta: { correction: 'none', original: null } };
  if (res.data.engine)
    track('ustaad_correction_shown', { engine: res.data.engine, mode: 'auto', changes: res.data.changes });
  return { text: res.data.text, meta: { correction: 'auto', original: text } };
}
