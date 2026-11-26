/**
 * Pure helpers of the Ustaad feed and social screens (workstream D web, spec 23 § 4 flows 4–8, § 5): poll shares,
 * the first-message rule shown before sending (SR-33: no links, numbers masked), the WhatsApp teaser link, story
 * stepping, media labels, the composer's post body and the For you snapshot expiry.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { SPONSORED_LABEL } from '@mechdost/shared/ustaad/social-rules';
import {
  buildPostInput,
  durationLabel,
  feedExpired,
  firstMessageProblem,
  nextStory,
  pollShares,
  sizeLabel,
  whatsappShareUrl,
} from '../src/lib/ustaad/feed-view';

describe('poll shares', () => {
  it('whole percentages that add up to 100 (largest remainder)', () => {
    const s = pollShares([1, 1, 1]);
    expect(s.percents.reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.total).toBe(3);
  });
  it('no votes yet: every option at 0', () => {
    expect(pollShares([0, 0]).percents).toEqual([0, 0]);
  });
});

describe('first message rule (SR-33)', () => {
  it('refuses a link in the first message', () => {
    expect(firstMessageProblem('dekho www.example.com')).toBe('link');
  });
  it('flags a phone number (it would be masked)', () => {
    expect(firstMessageProblem('call karo 98765 43210')).toBe('number');
  });
  it('a plain greeting is fine; blank is empty', () => {
    expect(firstMessageProblem('Namaste bhai, Splendor ka kaam hai')).toBeNull();
    expect(firstMessageProblem('   ')).toBe('empty');
  });
});

describe('WhatsApp share', () => {
  it('builds a wa.me link with the text and the absolute teaser link', () => {
    const url = whatsappShareUrl('https://mechdost.in', '/ustaad/s/abc.def', 'Dekho yeh post');
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe(
      'Dekho yeh post https://mechdost.in/ustaad/s/abc.def',
    );
  });
  it('keeps the Hindi prefix of the page in the link', () => {
    const url = whatsappShareUrl('https://mechdost.in', '/ustaad/s/abc', 'x', 'hi');
    expect(decodeURIComponent(url)).toContain('https://mechdost.in/hi/ustaad/s/abc');
  });
});

describe('story stepping', () => {
  const rings = [{ stories: 2 }, { stories: 1 }];
  it('moves inside a ring, then to the next ring, then ends', () => {
    expect(nextStory(rings, { ring: 0, story: 0 }, 1)).toEqual({ ring: 0, story: 1 });
    expect(nextStory(rings, { ring: 0, story: 1 }, 1)).toEqual({ ring: 1, story: 0 });
    expect(nextStory(rings, { ring: 1, story: 0 }, 1)).toBeNull();
  });
  it('goes back to the last story of the ring before; stays at the very first', () => {
    expect(nextStory(rings, { ring: 1, story: 0 }, -1)).toEqual({ ring: 0, story: 1 });
    expect(nextStory(rings, { ring: 0, story: 0 }, -1)).toEqual({ ring: 0, story: 0 });
  });
});

describe('media labels', () => {
  it('duration as m:ss and size in MB or KB', () => {
    expect(durationLabel(42_000)).toBe('0:42');
    expect(durationLabel(125_400)).toBe('2:05');
    expect(sizeLabel(1_572_864)).toBe('1.5 MB');
    expect(sizeLabel(300_000)).toBe('293 KB');
  });
});

describe('composer body', () => {
  it('a text post with tags', () => {
    const r = buildPostInput({ kind: 'text', body: ' Clutch badla ', tags: ['splendor'] }, 'k12345678');
    expect(r).toEqual({
      ok: true,
      input: {
        kind: 'text',
        body: 'Clutch badla',
        correction: 'none',
        media: [],
        tags: ['splendor'],
        idemKey: 'k12345678',
      },
    });
  });
  it('a fix log needs the problem and the fix', () => {
    expect(
      buildPostInput({ kind: 'text', template: 'fix_log', fixSymptom: 'Self nahi' }, 'k12345678'),
    ).toEqual({ ok: false, error: 'fix_required' });
  });
  it('before/after needs one photo of each', () => {
    expect(
      buildPostInput(
        { kind: 'photo', template: 'before_after', media: [{ mediaId: 'a', role: 'before' }] },
        'k12345678',
      ),
    ).toEqual({ ok: false, error: 'before_after_required' });
  });
  it('a poll needs two to four filled options; a link needs a safe address', () => {
    expect(buildPostInput({ kind: 'poll', body: 'Kaunsa?', pollOptions: ['A', ' '] }, 'k12345678')).toEqual({
      ok: false,
      error: 'poll_options',
    });
    expect(buildPostInput({ kind: 'link', linkUrl: 'http://127.0.0.1/x' }, 'k12345678')).toEqual({
      ok: false,
      error: 'link_invalid',
    });
  });
  it('a media post without media is refused', () => {
    expect(buildPostInput({ kind: 'voice' }, 'k12345678')).toEqual({ ok: false, error: 'media_required' });
  });
  it('keeps the original only when the correction was used', () => {
    const r = buildPostInput(
      { kind: 'text', body: 'Self nahi chal raha', bodyOriginal: 'self nhi chl rha', correction: 'auto' },
      'k12345678',
    );
    expect(r.ok && r.input.bodyOriginal).toBe('self nhi chl rha');
  });
});

describe('feed snapshot', () => {
  it('410 USTAAD_FEED_EXPIRED means start the list again', () => {
    expect(feedExpired({ ok: false, status: 410, code: 'USTAAD_FEED_EXPIRED' })).toBe(true);
    expect(feedExpired({ ok: false, status: 500, code: 'HTTP_500' })).toBe(false);
  });
});

describe('Home stays light (spec 23 § 17)', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
  it('the cards and lists never import the composer rules or the correction schemas (Zod)', () => {
    for (const f of ['post-card', 'post-media', 'feed-list', 'story-row', 'story-viewer', 'social-common']) {
      const s = src(`components/ustaad/feed/${f}.tsx`);
      expect(s, f).not.toMatch(
        /lib\/ustaad\/feed-view'|shared\/ustaad\/social-rules'|lib\/ustaad\/correction'/,
      );
    }
    expect(src('components/ustaad/correction/edited-text.tsx')).not.toMatch(/lib\/ustaad\/correction'/);
  });
  it('the Sponsored words in the locale files are the locked label (SR-41)', () => {
    expect(en.ustaad.feed.sponsored).toBe(SPONSORED_LABEL.en);
    expect(hi.ustaad.feed.sponsored).toBe(SPONSORED_LABEL.hi);
  });
});
