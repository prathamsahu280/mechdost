/**
 * Rupee amounts typed by staff (admin quote form; review B4). Accepts what people type — a leading ₹, Indian
 * digit grouping commas, Devanagari digits — and returns integer paise without float maths, or why it failed.
 */
export type RupeeError = 'empty' | 'format' | 'zero';
export type RupeeResult = { ok: true; paise: number } | { ok: false; error: RupeeError };

const DEVANAGARI_ZERO = 0x0966;
const AMOUNT = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

export function parseRupees(raw: string, opts: { allowZero?: boolean } = {}): RupeeResult {
  const value = raw
    .trim()
    .replace(/^₹\s*/, '')
    .replace(/,/g, '')
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO));
  if (value === '') return { ok: false, error: 'empty' };
  const m = AMOUNT.exec(value);
  if (!m) return { ok: false, error: 'format' };
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (paise === 0 && !opts.allowZero) return { ok: false, error: 'zero' };
  return { ok: true, paise };
}
