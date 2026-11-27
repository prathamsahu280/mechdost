/**
 * How a story moves on (UI upgrade U1, design § 3.3): photos and text after a timer; voice and video never autoplay,
 * so they wait for a tap and move on when they end; with reduced motion nothing moves on by itself (WCAG 2.2.2), the
 * member uses Next.
 */
export type StoryAdvance = 'timer' | 'on_end' | 'manual';

export const STORY_PHOTO_MS = 6_000;

export function storyAdvance(
  kind: 'photo' | 'text' | 'voice' | 'video',
  reducedMotion: boolean,
): StoryAdvance {
  if (reducedMotion) return 'manual';
  return kind === 'voice' || kind === 'video' ? 'on_end' : 'timer';
}
