/**
 * Forms of the Admin → Ustaad lists (task G1): one field model for levels, badges, hashtags, words, reasons, cities,
 * promotions, tutorial cards and coach-marks; the form text ⇄ request body conversion, the same bounds the API's
 * DTOs check (`@mechdost/shared/ustaad/dto/admin`), and the error code → message key mapping. Pure, unit-tested.
 */
export type TableField =
  | { name: string; kind: 'text'; max: number; optional?: boolean; pattern?: string; label?: string }
  | { name: string; kind: 'number'; min: number; max: number; optional?: boolean; label?: string }
  | { name: string; kind: 'bool'; label?: string }
  | {
      name: string;
      kind: 'select';
      options: readonly string[];
      group: string;
      optional?: boolean;
      label?: string;
    }
  | { name: string; kind: 'datetime'; label?: string }
  /** Comma-separated words (hashtag aliases). */
  | { name: string; kind: 'list'; max: number; optional?: boolean; label?: string };

export type TableRow = Record<string, unknown>;
export type TableForm = Record<string, string>;
export type FormProblem = { kind: 'type' } | { kind: 'range'; min: number; max: number };

export function emptyForm(fields: readonly TableField[]): TableForm {
  return Object.fromEntries(fields.map((f) => [f.name, f.kind === 'bool' ? 'true' : '']));
}

/** `2026-12-01T00:00:00.000Z` → `2026-12-01T05:30` (the datetime-local input shows IST). */
export function isoToLocalIst(iso: string): string {
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
}

/** `2026-12-01T05:30` (IST) → `2026-12-01T00:00:00.000Z`; `null` when it is not a date and time. */
export function localIstToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00.000Z`) - 330 * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function formFromRow(fields: readonly TableField[], row: TableRow): TableForm {
  const out: TableForm = {};
  for (const f of fields) {
    const v = row[f.name];
    if (f.kind === 'bool') out[f.name] = v === true ? 'true' : 'false';
    else if (f.kind === 'list') out[f.name] = Array.isArray(v) ? v.join(', ') : '';
    else if (f.kind === 'datetime') out[f.name] = typeof v === 'string' ? isoToLocalIst(v) : '';
    else out[f.name] = typeof v === 'number' || typeof v === 'string' ? String(v) : '';
  }
  return out;
}

export function formProblems(fields: readonly TableField[], form: TableForm): Record<string, FormProblem> {
  const out: Record<string, FormProblem> = {};
  for (const f of fields) {
    const v = (form[f.name] ?? '').trim();
    if (f.kind === 'bool') continue;
    const optional = 'optional' in f && f.optional === true;
    if (v === '') {
      if (!optional) out[f.name] = { kind: 'type' };
      continue;
    }
    if (f.kind === 'text') {
      if (v.length > f.max || (f.pattern !== undefined && !new RegExp(f.pattern).test(v)))
        out[f.name] = { kind: 'type' };
    } else if (f.kind === 'number') {
      if (!/^\d{1,6}$/.test(v)) out[f.name] = { kind: 'type' };
      else if (Number(v) < f.min || Number(v) > f.max)
        out[f.name] = { kind: 'range', min: f.min, max: f.max };
    } else if (f.kind === 'select') {
      if (!f.options.includes(v)) out[f.name] = { kind: 'type' };
    } else if (f.kind === 'datetime') {
      if (localIstToIso(v) === null) out[f.name] = { kind: 'type' };
    } else if (v.split(',').some((a) => a.trim().length > f.max)) out[f.name] = { kind: 'type' };
  }
  return out;
}

/**
 * The request body for a form (field kinds converted; badges get their typed `rule`; promotions no `label`). On an
 * edit, `row` carries over what the form does not show (a promotion's cities and segments), so a save never wipes it.
 */
export function bodyFromForm(
  table: string,
  fields: readonly TableField[],
  form: TableForm,
  row?: TableRow,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = (form[f.name] ?? '').trim();
    if (f.kind === 'bool') out[f.name] = v === 'true';
    else if (f.kind === 'number') {
      if (v !== '') out[f.name] = Number(v);
    } else if (f.kind === 'list')
      out[f.name] =
        v === ''
          ? []
          : v
              .split(',')
              .map((a) => a.trim())
              .filter((a) => a !== '');
    else if (f.kind === 'datetime') out[f.name] = localIstToIso(v);
    else if (v !== '' || ('optional' in f && f.optional === true)) out[f.name] = v;
  }
  if (table === 'badges') {
    const { ruleKind, ruleTag, ruleSegment, ruleCount, ...rest } = out;
    return {
      ...rest,
      rule: {
        schema_version: 1,
        kind: ruleKind,
        ...(typeof ruleTag === 'string' && ruleTag !== '' ? { tag: ruleTag } : {}),
        ...(typeof ruleSegment === 'string' && ruleSegment !== '' ? { segment: ruleSegment } : {}),
        ...(typeof ruleCount === 'number' ? { count: ruleCount } : {}),
      },
    };
  }
  if (table === 'promotions') {
    const keep = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return { ...out, cityIds: keep(row?.cityIds), segmentCodes: keep(row?.segmentCodes) };
  }
  if (table.startsWith('words_') && out.replacement === '') {
    const { replacement: _r, ...rest } = out;
    return rest;
  }
  return out;
}

/** An API error of a list save → the message key in `ustaad.admin`. */
export function tableErrorMessage(code: string, details: unknown): string {
  const key =
    typeof details === 'object' && details !== null && 'key' in details && typeof details.key === 'string'
      ? details.key
      : '';
  if (code === 'DUPLICATE') return 't_err_duplicate';
  if (code === 'STALE' || code.startsWith('STALE_') || code === 'CONFLICT') return 't_err_stale';
  if (code === 'TAG_MERGE') return 't_err_tag_merge';
  if (code === 'BAD_MOVE') return 't_err_bad_move';
  if (code === 'SETTING_INVARIANT') {
    if (key === 'needsStaffReview') return 't_err_staff_review';
    if (key === 'other') return 't_err_other_reason';
    if (key === 'ustaad.correction.default_mode') return 't_err_last_protected';
    if (key === 'ustaad.promo.label') return 't_err_label';
  }
  if (code === 'VALIDATION') return 't_err_invalid';
  return 't_err_generic';
}

/**
 * The name a row is read out by ("Edit …", "Merge #…"): its Hindi text on /hi when the row has one (`nameEn` →
 * `nameHi`, `titleEn` → `titleHi`, `labelEn` → `labelHi`, `textEn` → `textHi`; the reach cities' `name` →
 * `nameHi`), else the text staff typed. `localized` = the row has a text per language; otherwise (word-list phrases,
 * hashtag slugs, codes) the name is user content and is marked as such (hard rule 10, Hindi gate).
 */
export function rowName(
  config: { nameField: string },
  row: TableRow,
  locale: string,
): { text: string; localized: boolean } {
  const field = config.nameField;
  const hiField = field.endsWith('En') ? `${field.slice(0, -2)}Hi` : field === 'name' ? 'nameHi' : null;
  const own = typeof row[field] === 'string' ? row[field] : '';
  if (!hiField) return { text: own, localized: false };
  const hi = row[hiField];
  return { text: locale === 'hi' && typeof hi === 'string' && hi.trim() !== '' ? hi : own, localized: true };
}

/**
 * A translated sentence around a name, split where the name goes so the name alone can be wrapped (as user content)
 * without changing the language's word order: `splitAroundName((n) => t('t_edit_row', { name: n }))`.
 */
export function splitAroundName(message: (name: string) => string): { before: string; after: string } {
  const mark = '\u0000';
  const text = message(mark);
  const at = text.indexOf(mark);
  return at < 0 ? { before: text, after: '' } : { before: text.slice(0, at), after: text.slice(at + 1) };
}
