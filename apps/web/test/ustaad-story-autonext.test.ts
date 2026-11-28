import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { storyAdvance } from '@/lib/ustaad/story-advance';

/**
 * Story advance ruling (lead, 2026-11-28; spec 23 § 21i-L, WCAG 2.2.2): a photo or text story never moves on by itself;
 * a voice note or video that the member played moves to the next story when it ends; a visible switch turns that off;
 * with reduced motion nothing moves on by itself.
 */
const read = (p: string) => readFileSync(new URL(`../src/components/ustaad/${p}`, import.meta.url), 'utf8');

describe('storyAdvance', () => {
  it.each([
    ['photo', false, 'manual'],
    ['text', false, 'manual'],
    ['voice', false, 'on_end'],
    ['video', false, 'on_end'],
    ['photo', true, 'manual'],
    ['voice', true, 'manual'],
    ['video', true, 'manual'],
  ] as const)('%s, reduced=%s is %s', (kind, reduced, mode) => {
    expect(storyAdvance(kind, reduced)).toBe(mode);
  });
});

describe('story viewer wiring', () => {
  const viewer = read('feed/story-viewer.tsx');
  it('has no timer; a played voice note or video moves on through onEnded', () => {
    expect(viewer).not.toMatch(/setInterval/);
    expect(viewer).toMatch(/<VoiceNote[^>]*onEnded=/);
    expect(viewer).toMatch(/<VideoTile[^>]*onEnded=/);
  });
  it('shows a visible auto next switch with its state in words, and tracks it', () => {
    expect(viewer).toMatch(/aria-pressed=\{auto\}/);
    expect(viewer).toContain("autoNextOn'");
    expect(viewer).toContain('ustaad_story_autonext');
  });
  it('the media players report the end of a play the member started', () => {
    expect(read('media/voice-note.tsx')).toMatch(/onEnded/);
    expect(read('feed/post-media.tsx')).toMatch(/onEnded=\{/);
  });
});
