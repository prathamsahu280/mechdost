/**
 * Automatic first pass on new content (spec 23 § 13, SR-18, SR-36). STUB from workstream A with the final signature:
 * workstream F implements banned words, scam phrases, PII patterns, pre-moderation of new accounts and the classifier.
 * Posting code in C, D and E calls it before making content visible and stores `held` when it says so. A posting
 * member never learns why beyond "Our team will check it first" (no filter oracle).
 */
import type { Tx } from '../orders';

export type ScreenKind = 'post' | 'story' | 'comment' | 'question' | 'answer' | 'message' | 'job';
export type ScreenOutcome = 'ok' | 'hold' | 'block';

export interface ScreenInput {
  kind: ScreenKind;
  text: string | null;
  mediaIds: readonly string[];
  authorId: string;
}

export async function screenUstaadContent(_tx: Tx, _input: ScreenInput): Promise<ScreenOutcome> {
  return Promise.resolve('ok');
}
