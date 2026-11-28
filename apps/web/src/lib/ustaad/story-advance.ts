/**
 * How a story moves on (spec 23 § 21i-L, lead ruling 2026-11-28 over UI upgrade § 3.3, WCAG 2.2.2): a photo or text story
 * never moves on by itself (the member uses Next); a voice note or video never autoplays, but once the member has
 * played it, it moves to the next story when it ends (a visible switch turns that off); with reduced motion nothing
 * moves on by itself.
 */
export type StoryAdvance = 'on_end' | 'manual';

export function storyAdvance(
  kind: 'photo' | 'text' | 'voice' | 'video',
  reducedMotion: boolean,
): StoryAdvance {
  if (reducedMotion) return 'manual';
  return kind === 'voice' || kind === 'video' ? 'on_end' : 'manual';
}
