import { describe, expect, it } from 'vitest';
import { CorrectRequest, correctionSegments, countChanges } from '../src/ustaad/correction';

const join = (s: { text: string }[]) => s.map((x) => x.text).join('');

describe('smart correction segments (spec 23 § 11)', () => {
  it('covers the corrected text exactly and marks only changed words', () => {
    const before = 'activa 6g pikup kam h';
    const after = 'Activa 6G ka pickup kam hai.';
    const seg = correctionSegments(before, after);
    expect(join(seg)).toBe(after);
    const changed = seg.filter((s) => s.kind === 'changed');
    expect(changed.map((s) => s.text)).toEqual(['Activa 6G ka pickup', 'hai.']);
    expect(changed[0]?.was).toBe('activa 6g pikup');
    expect(changed[1]?.was).toBe('h');
    expect(countChanges(seg)).toBe(2);
  });

  it('returns one same segment when nothing changed, and keeps line breaks', () => {
    const t = 'Battery new hai.\nSelf start nahi.';
    expect(correctionSegments(t, t)).toEqual([{ kind: 'same', text: t }]);
  });

  it('reports removed words as an empty changed run', () => {
    const seg = correctionSegments('bike bike start nahi', 'bike start nahi');
    expect(join(seg)).toBe('bike start nahi');
    expect(seg.some((s) => s.kind === 'changed' && s.text === '' && s.was === 'bike')).toBe(true);
  });

  it('validates the request strictly (≤ 2,000 chars, no extra fields)', () => {
    expect(CorrectRequest.safeParse({ text: 'ok' }).success).toBe(true);
    expect(CorrectRequest.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
    expect(CorrectRequest.safeParse({ text: '   ' }).success).toBe(false);
    expect(CorrectRequest.safeParse({ text: 'ok', memberId: 'x' }).success).toBe(false);
    expect(CorrectRequest.safeParse({ text: 'ok', mode: 'off' }).success).toBe(false);
  });
});
