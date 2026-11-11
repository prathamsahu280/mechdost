/**
 * Plain-text cleaning shared by content and policy texts (review 2026-11-11, low). Control characters become
 * spaces; invisible format characters (bidi overrides, zero-width space, …) are dropped without splitting the
 * word — except ZWNJ/ZWJ (U+200C/U+200D), which Hindi conjuncts need. Whitespace collapses, the result is
 * trimmed and cut to `max` UTF-16 units without splitting a surrogate pair.
 */
const CONTROL = /\p{Cc}/gu;
const FORMAT = /(?![‌‍])\p{Cf}/gu;

export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function cleanLine(value: string, max: number): string {
  return clip(value.replace(CONTROL, ' ').replace(FORMAT, '').replace(/\s+/g, ' ').trim(), max);
}
