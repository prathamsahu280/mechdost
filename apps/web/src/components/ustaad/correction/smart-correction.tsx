'use client';

import { useLocale, useTranslations } from 'next-intl';
import { WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
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
  'press inline-flex min-h-11 items-center justify-center gap-2 rounded-button border border-input-border bg-surface px-4 text-sm font-bold text-ink hover:bg-pill aria-disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** What a composer stores with the text (spec 23 § 6.3: `body`, `body_original`, `correction`). */
export interface CorrectionMeta {
  correction: 'none' | 'suggested_used' | 'auto';
  original: string | null;
}

type StatusKey = 'checking' | 'ready' | 'used' | 'kept' | 'clear' | 'empty' | 'limited' | 'failed';

/**
 * Smart correction under a typed-text field (spec 23 § 11). Suggest mode: "Make it clearer" (always mounted, so focus
 * never falls to the page) checks the text and shows the suggest card below it; the card never takes focus, and the
 * status line (text only, a polite live region) says "Checking…", "A suggestion is ready below", "Suggestion used."
 * After "Use suggestion" focus moves to Undo; after "Keep mine", "Edit myself" or Undo it returns to the field. Auto
 * mode: a note only — the composer calls `correctForSend` on send and stores the original.
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
  fieldRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  lang?: CorrectionLang | null;
  /** The network/member mode the composer already knows (from `/ustaad/me`); `off` renders nothing. */
  mode?: 'suggest' | 'auto' | 'off';
}) {
  const t = useTranslations('ustaad.correction');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CorrectResponseView | null>(null);
  const [status, setStatus] = useState<StatusKey | null>(null);
  const [undoText, setUndoText] = useState<string | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const focusUndo = useRef(false);

  useEffect(() => {
    if (focusUndo.current && undoText !== null) {
      focusUndo.current = false;
      undoRef.current?.focus();
    }
  }, [undoText]);

  if (mode === 'off') return null;
  if (mode === 'auto')
    return (
      <p className="flex items-start gap-2 text-sm text-muted">
        <WandSparkles aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-info" />
        <span>{t('autoNote')}</span>
      </p>
    );

  const focusField = () => fieldRef.current?.focus();

  async function check() {
    if (busy) return;
    setUndoText(null);
    setResult(null);
    if (value.trim() === '') {
      setStatus('empty');
      return;
    }
    setBusy(true);
    setStatus('checking');
    const res = await requestCorrection(locale, { text: value, lang, mode: 'suggest' });
    setBusy(false);
    if (!res.ok) {
      setStatus(correctionErrorKey(res.code));
      return;
    }
    if (suggestViewFor(res.data).kind === 'clear') {
      setStatus('clear');
      return;
    }
    setResult(res.data);
    setStatus('ready');
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
    setStatus(choice === 'use' ? 'used' : 'kept');
    setUndoText(outcome.undo);
    if (choice === 'use') focusUndo.current = true;
    else focusField();
  }

  function undo() {
    if (undoText === null) return;
    onChange(undoText, { correction: 'none', original: null });
    setUndoText(null);
    setStatus(null);
    focusField();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={`${quiet} self-start`}
        aria-disabled={busy}
        onClick={() => void check()}
      >
        <WandSparkles aria-hidden="true" className="size-[18px]" />
        {busy ? t('checking') : t('check')}
      </button>
      {result ? <SuggestCard result={result} onChoice={choose} hintLang={lang} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" aria-atomic="true" className="min-h-5 text-sm text-ink">
          {status ? t(status) : ''}
        </p>
        {undoText !== null ? (
          <button
            ref={undoRef}
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center px-2 text-sm font-bold text-info underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={undo}
          >
            {t('undo')}
          </button>
        ) : null}
      </div>
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
    track('ustaad_correction_shown', {
      engine: res.data.engine,
      mode: 'auto',
      changes: res.data.changes,
    });
  return { text: res.data.text, meta: { correction: 'auto', original: text } };
}
