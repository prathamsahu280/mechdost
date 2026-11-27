import type { PostView } from '@mechdost/shared/ustaad/dto/feed';

/**
 * Pure parts of the post card's reactions (Ustaad UI upgrade U2, E12; founder Q-UI-3 "Kaam ki baat / Useful"):
 * the double-tap window, the "double tap only ever likes" rule (R15) and the optimistic state change. The card
 * applies `toggleReaction` at once, calls the API and, on failure, puts the post it had before back (rollback).
 */
export const DOUBLE_TAP_MS = 250;

export type Reaction = 'like' | 'useful' | 'save';

export function isDoubleTap(lastTapAt: number | null, now: number): boolean {
  return lastTapAt !== null && now - lastTapAt < DOUBLE_TAP_MS;
}

/** A double tap on a photo likes a post that is not liked yet; it never unlikes. */
export function doubleTapLike(post: Pick<PostView, 'likedByMe'>): boolean {
  return !post.likedByMe;
}

export function toggleReaction(post: PostView, kind: Reaction, on: boolean): PostView {
  if (kind === 'save') return { ...post, savedByMe: on };
  if (kind === 'useful')
    return {
      ...post,
      usefulByMe: on,
      counts: { ...post.counts, useful: Math.max(0, post.counts.useful + (on ? 1 : -1)) },
    };
  return {
    ...post,
    likedByMe: on,
    counts: {
      ...post.counts,
      likes: post.counts.likes === null ? null : Math.max(0, post.counts.likes + (on ? 1 : -1)),
    },
  };
}
