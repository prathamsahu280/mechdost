import { describe, expect, it } from 'vitest';
import type { PostView } from '@mechdost/shared/ustaad/dto/feed';
import { DOUBLE_TAP_MS, doubleTapLike, isDoubleTap, toggleReaction } from '../src/lib/ustaad/reactions';
import { PEHCHAAN_TONES, pehchaanTone } from '../src/components/ustaad/common/pehchaan-tones';

/** U2 (Ustaad UI upgrade 2026-11-27, E6/E12 + founder Q-UI-3): pure parts of the post card's reactions. */
const base = {
  likedByMe: false,
  usefulByMe: false,
  savedByMe: false,
  counts: { likes: 4, useful: 2, comments: 1, saves: null },
} as unknown as PostView;

describe('double tap', () => {
  it('two taps inside the window are a double tap; slower or first taps are not', () => {
    expect(isDoubleTap(null, 1000)).toBe(false);
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS - 1)).toBe(true);
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS + 1)).toBe(false);
    expect(DOUBLE_TAP_MS).toBe(250);
  });

  it('a double tap only ever likes, never unlikes (R15)', () => {
    expect(doubleTapLike({ ...base, likedByMe: false })).toBe(true);
    expect(doubleTapLike({ ...base, likedByMe: true })).toBe(false);
  });
});

describe('optimistic toggle', () => {
  it('like moves the visible count; a hidden count stays hidden', () => {
    const on = toggleReaction(base, 'like', true);
    expect(on.likedByMe).toBe(true);
    expect(on.counts.likes).toBe(5);
    const hidden = toggleReaction({ ...base, counts: { ...base.counts, likes: null } }, 'like', true);
    expect(hidden.counts.likes).toBeNull();
  });

  it('useful is separate from like and never goes below zero', () => {
    const on = toggleReaction(base, 'useful', true);
    expect(on.usefulByMe).toBe(true);
    expect(on.likedByMe).toBe(false);
    expect(on.counts.useful).toBe(3);
    const off = toggleReaction({ ...base, counts: { ...base.counts, useful: 0 } }, 'useful', false);
    expect(off.counts.useful).toBe(0);
  });

  it('save flips the flag only; the input post is never mutated (rollback restores it)', () => {
    const on = toggleReaction(base, 'save', true);
    expect(on.savedByMe).toBe(true);
    expect(base.savedByMe).toBe(false);
    expect(base.counts.likes).toBe(4);
  });
});

describe('Pehchaan tag tones', () => {
  it('every level has a token pair (no raw colours) and an unknown level falls back to the plain pill', () => {
    for (const level of ['apprentice', 'ustaad_pending', 'naya', 'pakka', 'bada', 'master'])
      expect(PEHCHAAN_TONES[level as keyof typeof PEHCHAAN_TONES]).toBeDefined();
    for (const tone of Object.values(PEHCHAAN_TONES)) {
      expect(tone.fill).toMatch(/^[a-z-]+$/);
      expect(tone.edge).toMatch(/^[a-z-]+$/);
      expect(tone.fg).toMatch(/^[a-z-]+$|^#ffffff$/);
    }
    // Grade lines climb with the level (bolt-head marks): 0 for Chhotu up to 4 for Master.
    expect(Object.values(PEHCHAAN_TONES).map((t) => t.lines)).toEqual([0, 0, 1, 2, 3, 4]);
    expect(pehchaanTone('something_new')).toEqual(PEHCHAAN_TONES.apprentice);
  });
});
