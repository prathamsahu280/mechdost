import type { CreatePost } from '@mechdost/shared/ustaad/dto/feed';
import { safeLinkUrl } from '@mechdost/shared/ustaad/links';
import { dmTextCheck } from '@mechdost/shared/ustaad/social-rules';
import type { ApiResult } from '../orders-api';

/**
 * Pure helpers of the Ustaad feed and social screens (workstream D web; tests in `test/ustaad-feed-view.test.ts`).
 * No React and no i18n here: components turn the codes into words.
 */

/** Whole percentages that add up to 100 (largest remainder), so a poll's bars never sum to 99 or 101. */
export function pollShares(votes: readonly number[]): { percents: number[]; total: number } {
  const total = votes.reduce((a, b) => a + b, 0);
  if (total === 0) return { percents: votes.map(() => 0), total };
  const raw = votes.map((v) => (v * 100) / total);
  const percents = raw.map(Math.floor);
  let left = 100 - percents.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest);
  for (const o of order) {
    if (left <= 0) break;
    percents[o.i] = (percents[o.i] ?? 0) + 1;
    left -= 1;
  }
  return { percents, total };
}

/**
 * What the first message (a request, SR-33) would run into before it is sent: a link is refused by the API, and a
 * phone number, email or UPI id would be masked to "#". Shown inline so the member can fix it first.
 */
export function firstMessageProblem(text: string): 'empty' | 'link' | 'number' | null {
  const t = text.trim();
  if (!t) return 'empty';
  const check = dmTextCheck(t, { requested: true });
  if (check.link) return 'link';
  if (check.text !== t) return 'number';
  return null;
}

/** `https://wa.me/?text=…` with the message and the absolute teaser link (Hindi pages keep `/hi`). */
export function whatsappShareUrl(origin: string, path: string, text: string, locale = 'en'): string {
  const link = `${origin}${locale === 'hi' ? '/hi' : ''}${path}`;
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`;
}

export interface StoryPos {
  ring: number;
  story: number;
}

/** The next (+1) or previous (−1) story across rings; null after the very last one. */
export function nextStory(
  rings: readonly { stories: number }[],
  pos: StoryPos,
  dir: 1 | -1,
): StoryPos | null {
  const count = (r: number) => rings[r]?.stories ?? 0;
  if (dir === 1) {
    if (pos.story + 1 < count(pos.ring)) return { ring: pos.ring, story: pos.story + 1 };
    for (let r = pos.ring + 1; r < rings.length; r += 1) if (count(r) > 0) return { ring: r, story: 0 };
    return null;
  }
  if (pos.story > 0) return { ring: pos.ring, story: pos.story - 1 };
  for (let r = pos.ring - 1; r >= 0; r -= 1) if (count(r) > 0) return { ring: r, story: count(r) - 1 };
  return pos;
}

export function durationLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export type ComposerKind = CreatePost['kind'];

export interface PostDraft {
  kind: ComposerKind;
  template?: 'fix_log' | 'tip' | 'before_after';
  body?: string;
  bodyOriginal?: string;
  correction?: CreatePost['correction'];
  fixSymptom?: string;
  fixCause?: string;
  fixFix?: string;
  media?: { mediaId: string; role?: 'before' | 'after' }[];
  pollOptions?: string[];
  linkUrl?: string;
  tags?: string[];
}

export type DraftError =
  | 'body_required'
  | 'fix_required'
  | 'before_after_required'
  | 'poll_options'
  | 'link_invalid'
  | 'media_required';

const MEDIA_KINDS: readonly ComposerKind[] = ['voice', 'photo', 'video', 'document', 'mixed'];
const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  if (!t) return undefined;
  return t;
};

/** The `POST /ustaad/posts` body for a draft, or the first thing to fix (same rules as `CreatePostDto`). */
export function buildPostInput(
  d: PostDraft,
  idemKey: string,
): { ok: true; input: CreatePost } | { ok: false; error: DraftError } {
  const body = clean(d.body);
  const media = d.media ?? [];
  const input: CreatePost = {
    kind: d.kind,
    correction: body ? (d.correction ?? 'none') : 'none',
    media: d.template === 'before_after' ? media : media.map((m) => ({ mediaId: m.mediaId })),
    tags: d.tags ?? [],
    idemKey,
  };
  if (d.template) input.template = d.template;
  if (body) input.body = body;
  const original = clean(d.bodyOriginal);
  if (body && original && input.correction !== 'none' && original !== body) input.bodyOriginal = original;
  else if (input.correction !== 'none' && !original) input.correction = 'none';

  if (MEDIA_KINDS.includes(d.kind) && media.length === 0) return { ok: false, error: 'media_required' };
  if (d.template === 'fix_log') {
    const symptom = clean(d.fixSymptom);
    const fix = clean(d.fixFix);
    if (!symptom || !fix) return { ok: false, error: 'fix_required' };
    input.fixSymptom = symptom;
    input.fixFix = fix;
    const cause = clean(d.fixCause);
    if (cause) input.fixCause = cause;
  }
  if (d.template === 'before_after') {
    const roles = media.map((m) => m.role);
    if (!roles.includes('before') || !roles.includes('after') || roles.includes(undefined))
      return { ok: false, error: 'before_after_required' };
  }
  if (d.kind === 'poll') {
    const options = (d.pollOptions ?? []).map((o) => o.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 4) return { ok: false, error: 'poll_options' };
    input.poll = { options, closesInHours: 24 };
  }
  if (d.kind === 'link') {
    const url = clean(d.linkUrl);
    if (!url || safeLinkUrl(url) === null) return { ok: false, error: 'link_invalid' };
    input.linkUrl = url;
  }
  if ((d.kind === 'text' && d.template !== 'fix_log' && !body) || (d.template === 'tip' && !body))
    return { ok: false, error: 'body_required' };
  return { ok: true, input };
}

/** The For you snapshot ran out (10 min): start the list again from the top (spec 23 § 21d). */
export function feedExpired(r: ApiResult<unknown>): boolean {
  return !r.ok && r.status === 410 && r.code === 'USTAAD_FEED_EXPIRED';
}
