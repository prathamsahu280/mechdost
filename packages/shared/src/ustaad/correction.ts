/**
 * Smart correction contract (spec 23 § 11; SR-27, SR-28). `POST /v1/ustaad/correct` takes typed text and answers with
 * the corrected text, the original, and word-level segments the web highlights ("You wrote / Suggestion"). The diff is
 * computed here so the server and the web agree on what "changed" means.
 */
import { z } from 'zod';
import { USTAAD_CORRECTION_MODES } from './codes';

/** Which engine produced the result (analytics `ustaad_correction_shown.engine`). */
export const CORRECTION_ENGINES = ['llm_anthropic', 'llm_gemini', 'wordlist'] as const;
export type CorrectionEngineId = (typeof CORRECTION_ENGINES)[number];

/** Languages smart correction handles (setting `ustaad.correction.langs.*`). `cg` = Chhattisgarhi. */
export const CORRECTION_LANGS = ['hi', 'en', 'hinglish', 'cg'] as const;
export type CorrectionLang = (typeof CORRECTION_LANGS)[number];

export const CORRECTION_MAX_CHARS = 2000;

/** What the member chose on the suggest card (analytics `ustaad_correction_choice.choice`). */
export const CORRECTION_CHOICES = ['use', 'keep', 'edit'] as const;
export type CorrectionChoice = (typeof CORRECTION_CHOICES)[number];

export const CorrectRequest = z
  .object({
    text: z.string().trim().min(1).max(CORRECTION_MAX_CHARS),
    lang: z.enum(CORRECTION_LANGS).nullable().optional(),
    /** Honoured only when `ustaad.correction.member_can_change` is on; otherwise the network default applies. */
    mode: z.enum(['suggest', 'auto']).optional(),
  })
  .strict();
export type CorrectRequestBody = z.infer<typeof CorrectRequest>;

export const CorrectionSegment = z
  .object({
    kind: z.enum(['same', 'changed']),
    text: z.string(),
    /** For a changed run: the words it replaced (empty when only added). */
    was: z.string().optional(),
  })
  .strict();
export type CorrectionSegmentView = z.infer<typeof CorrectionSegment>;

export const CorrectResponse = z
  .object({
    mode: z.enum(USTAAD_CORRECTION_MODES),
    /** Null when nothing ran (mode off, language switched off). */
    engine: z.enum(CORRECTION_ENGINES).nullable(),
    /** The corrected text (equal to `original` when nothing changed). */
    text: z.string(),
    original: z.string(),
    changed: z.boolean(),
    /** Number of changed runs (analytics `changes`). */
    changes: z.number().int().min(0),
    segments: z.array(CorrectionSegment),
  })
  .strict();
export type CorrectResponseView = z.infer<typeof CorrectResponse>;

/** Splits text into alternating word / whitespace tokens (whitespace kept so line breaks survive). */
function tokens(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t !== '');
}

const isSpace = (t: string) => /^\s+$/.test(t);

/**
 * Word-level diff of `after` against `before` (longest common subsequence on exact words). Segments cover `after` in
 * order; a `changed` segment carries the words of `before` it replaced. Adjacent segments of one kind are merged.
 * Inputs are at most 2,000 characters (≈ 400 words), so the quadratic table stays small.
 */
export function correctionSegments(before: string, after: string): CorrectionSegmentView[] {
  const a = tokens(before).filter((t) => !isSpace(t));
  const outTokens = tokens(after);
  const b = outTokens.filter((t) => !isSpace(t));
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] ?? [];
    const next = lcs[i + 1] ?? [];
    for (let j = m - 1; j >= 0; j--)
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
  }
  // Walk the table: for each word of `after`, whether it is kept and which `before` words were dropped before it.
  const kept: boolean[] = new Array<boolean>(m).fill(false);
  const dropped: string[][] = Array.from({ length: m + 1 }, () => []);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      kept[j] = true;
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      dropped[j]?.push(a[i] ?? '');
      i++;
    } else j++;
  }
  while (i < n) dropped[m]?.push(a[i++] ?? '');

  const segments: CorrectionSegmentView[] = [];
  const push = (kind: 'same' | 'changed', text: string, was?: string) => {
    const last = segments.at(-1);
    if (last?.kind === kind) {
      last.text += text;
      if (was) last.was = last.was ? `${last.was} ${was}` : was;
      return;
    }
    segments.push(was === undefined ? { kind, text } : { kind, text, was });
  };
  let w = 0;
  let pendingWas: string[] = [];
  for (const t of outTokens) {
    if (isSpace(t)) {
      // Whitespace between two changed words stays inside the changed run.
      const last = segments.at(-1);
      push(last?.kind ?? 'same', t);
      continue;
    }
    pendingWas = pendingWas.concat(dropped[w] ?? []);
    if (kept[w]) {
      if (pendingWas.length > 0) {
        // Words removed without a replacement: shown as an empty changed run before the kept word.
        push('changed', '', pendingWas.join(' '));
        pendingWas = [];
      }
      push('same', t);
    } else {
      push('changed', t, pendingWas.length > 0 ? pendingWas.join(' ') : '');
      pendingWas = [];
    }
    w++;
  }
  const tail = pendingWas.concat(dropped[m] ?? []);
  if (tail.length > 0) push('changed', '', tail.join(' '));
  // A changed run never ends in whitespace: move trailing spaces out into a same segment.
  const out: CorrectionSegmentView[] = [];
  for (const s of segments) {
    const trail = s.kind === 'changed' ? (/\s+$/.exec(s.text)?.[0] ?? '') : '';
    const core = trail ? { ...s, text: s.text.slice(0, -trail.length) } : s;
    const prev = out.at(-1);
    if (prev?.kind === 'same' && core.kind === 'same') prev.text += core.text;
    else out.push(core);
    if (trail) out.push({ kind: 'same', text: trail });
  }
  return out.filter((s) => s.text !== '' || (s.kind === 'changed' && (s.was ?? '') !== ''));
}

/** Number of changed runs in a segment list. */
export function countChanges(segments: readonly CorrectionSegmentView[]): number {
  return segments.filter((s) => s.kind === 'changed').length;
}
