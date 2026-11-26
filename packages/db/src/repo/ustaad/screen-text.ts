/**
 * What gets screened before Ustaad text is stored (security review 2026-11-26). Members can open "see original"
 * on corrected text, so the client-supplied original is screened with everything else, and it is kept only when
 * a correction was actually applied.
 */
import type { CORRECTION_APPLIED } from '@mechdost/shared/ustaad/codes';

type CorrectionApplied = (typeof CORRECTION_APPLIED)[number];

export function ustaadScreenText(input: {
  parts: readonly (string | null | undefined)[];
  original: string | null | undefined;
  correction: CorrectionApplied;
}): string | null {
  const text = [...input.parts, input.original]
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .join('\n');
  return text === '' ? null : text;
}

export function ustaadStoredOriginal(
  original: string | null | undefined,
  correction: CorrectionApplied,
): string | null {
  return correction === 'none' ? null : (original ?? null);
}
