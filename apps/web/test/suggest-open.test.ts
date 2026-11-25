import { describe, expect, it } from 'vitest';
import { isSuggestOpen } from '@/components/catalogue/suggest-open';

/** The shop suggestion list closes for the words it was closed at (bug 2026-11-25: it stayed open after a pick). */
const base = { typed: 'servo', long: true, itemCount: 4, loadedFor: 'servo', closedAt: null };

describe('isSuggestOpen', () => {
  it('opens for loaded items on long enough words', () => {
    expect(isSuggestOpen(base)).toBe(true);
  });
  it('stays closed for the words it was closed at (a pick, Enter, Esc, blur)', () => {
    expect(isSuggestOpen({ ...base, closedAt: 'servo' })).toBe(false);
  });
  it('a pick that fills the box with its label stays closed once the new words load', () => {
    expect(isSuggestOpen({ ...base, typed: 'Servo', loadedFor: 'Servo', closedAt: 'Servo' })).toBe(false);
  });
  it('opens again when different words are typed', () => {
    expect(isSuggestOpen({ ...base, typed: 'servo p', loadedFor: 'servo p', closedAt: 'servo' })).toBe(true);
  });
  it('is closed while the list for the typed words has not loaded, with no items, or too short', () => {
    expect(isSuggestOpen({ ...base, loadedFor: 'serv' })).toBe(false);
    expect(isSuggestOpen({ ...base, itemCount: 0 })).toBe(false);
    expect(isSuggestOpen({ ...base, long: false })).toBe(false);
  });
});
