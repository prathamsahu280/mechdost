/**
 * Ustaad feed contracts (spec 23 § 4 flows 4–6, § 9.5, § 10a; plan task D1/D2): every post kind and template
 * validates its shape, strict bodies (no mass assignment), the curated-tag input pattern after NFC (SR-25), link
 * rules (http/https, ports 80/443, no credentials, registrable-domain display, SR-23 / AT-SSRF-3), and the pure feed
 * score (weights, recency half-life, Wilson lower bound, deterministic order).
 */
import { describe, expect, it } from 'vitest';
import {
  CommentDto,
  CreatePostDto,
  CreateStoryDto,
  FeedQueryDto,
  normaliseTagInput,
} from '../src/ustaad/dto/feed';
import { feedScore, rankFeed, wilsonLowerBound, type FeedWeights } from '../src/ustaad/feed-score';
import { linkDisplayHost, safeLinkUrl } from '../src/ustaad/links';

const idemKey = 'abcdefgh12';
const M1 = '00000000-0000-7000-8000-000000000001';
const M2 = '00000000-0000-7000-8000-000000000002';
const ok = (v: unknown) => CreatePostDto.safeParse(v).success;

describe('CreatePostDto: every kind and template', () => {
  it('text needs a body and no media; voice/photo/video/document/mixed need media', () => {
    expect(ok({ kind: 'text', body: 'Plug saaf karo', idemKey })).toBe(true);
    expect(ok({ kind: 'text', idemKey })).toBe(false);
    expect(ok({ kind: 'text', body: 'x', media: [{ mediaId: M1 }], idemKey })).toBe(false);
    for (const kind of ['voice', 'photo', 'video', 'document', 'mixed']) {
      expect(ok({ kind, media: [{ mediaId: M1 }], idemKey }), kind).toBe(true);
      expect(ok({ kind, idemKey }), `${kind} without media`).toBe(false);
    }
  });

  it('poll needs 2–4 options and only on a poll; link needs a safe URL and only on a link', () => {
    expect(ok({ kind: 'poll', body: 'Kaunsa oil?', poll: { options: ['A', 'B'] }, idemKey })).toBe(true);
    expect(ok({ kind: 'poll', poll: { options: ['A'] }, idemKey })).toBe(false);
    expect(ok({ kind: 'poll', poll: { options: ['A', 'B', 'C', 'D', 'E'] }, idemKey })).toBe(false);
    expect(ok({ kind: 'text', body: 'x', poll: { options: ['A', 'B'] }, idemKey })).toBe(false);
    expect(ok({ kind: 'link', linkUrl: 'https://example.com/a', idemKey })).toBe(true);
    expect(ok({ kind: 'link', linkUrl: 'javascript:alert(1)', idemKey })).toBe(false);
    expect(ok({ kind: 'link', linkUrl: 'https://u:p@example.com/', idemKey })).toBe(false);
    expect(ok({ kind: 'link', linkUrl: 'http://example.com:8080/', idemKey })).toBe(false);
    expect(ok({ kind: 'text', body: 'x', linkUrl: 'https://example.com', idemKey })).toBe(false);
  });

  it('fix log needs symptom and fix; before/after needs photos with a before and an after role', () => {
    expect(
      ok({ kind: 'text', template: 'fix_log', fixSymptom: 'Self nahi', fixFix: 'Brush badla', idemKey }),
    ).toBe(true);
    expect(ok({ kind: 'text', template: 'fix_log', fixSymptom: 'Self nahi', idemKey })).toBe(false);
    expect(ok({ kind: 'text', body: 'x', fixSymptom: 'stray', idemKey })).toBe(false);
    expect(ok({ kind: 'text', template: 'tip', idemKey })).toBe(false);
    const ba = (media: unknown) => ok({ kind: 'photo', template: 'before_after', media, idemKey });
    expect(
      ba([
        { mediaId: M1, role: 'before' },
        { mediaId: M2, role: 'after' },
      ]),
    ).toBe(true);
    expect(ba([{ mediaId: M1, role: 'before' }])).toBe(false);
    expect(ba([{ mediaId: M1 }, { mediaId: M2 }])).toBe(false);
    expect(ok({ kind: 'photo', media: [{ mediaId: M1, role: 'before' }], idemKey })).toBe(false);
  });

  it('strict: status, authorId, contentType and counts are refused; duplicates refused', () => {
    for (const extra of [{ status: 'visible' }, { authorId: M1 }, { contentType: 'sponsored' }, { likes: 9 }])
      expect(ok({ kind: 'text', body: 'x', idemKey, ...extra })).toBe(false);
    expect(
      ok({
        kind: 'photo',
        media: [{ mediaId: M1 }, { mediaId: M1 }],
        idemKey,
      }),
    ).toBe(false);
    expect(ok({ kind: 'text', body: 'x', tags: ['battery', '#Battery'], idemKey })).toBe(false);
  });

  it('bodyOriginal only with a correction; story is not a post kind here', () => {
    expect(ok({ kind: 'text', body: 'kya hai', bodyOriginal: 'kya h', correction: 'auto', idemKey })).toBe(
      true,
    );
    expect(ok({ kind: 'text', body: 'kya hai', bodyOriginal: 'kya h', idemKey })).toBe(false);
    expect(ok({ kind: 'story', media: [{ mediaId: M1 }], idemKey })).toBe(false);
  });
});

describe('tags (SR-25)', () => {
  it('normalises NFC, lower case, strips one #; refuses symbols and over-long input', () => {
    expect(normaliseTagInput('#Battery')).toBe('battery');
    expect(normaliseTagInput('बैटरी')).toBe('बैटरी');
    expect(normaliseTagInput('#selfstart')).toBe('selfstart');
    expect(normaliseTagInput('self start')).toBeNull();
    expect(normaliseTagInput('<script>')).toBeNull();
    expect(normaliseTagInput('#')).toBeNull();
    expect(normaliseTagInput('a'.repeat(41))).toBeNull();
    // NFD input ends up NFC (same bytes as the composed form).
    expect(normaliseTagInput('#café')).toBe('café');
  });

  it('at most 5 tags per post', () => {
    const tags = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'];
    expect(ok({ kind: 'text', body: 'x', tags: tags.slice(0, 5), idemKey })).toBe(true);
    expect(ok({ kind: 'text', body: 'x', tags, idemKey })).toBe(false);
  });
});

describe('stories, comments, feed query', () => {
  it('a story is one media (+ optional poster); a comment needs text or media; one parent', () => {
    expect(CreateStoryDto.safeParse({ mediaId: M1, idemKey }).success).toBe(true);
    expect(CreateStoryDto.safeParse({ idemKey }).success).toBe(false);
    expect(CreateStoryDto.safeParse({ mediaId: M1, idemKey, expiresAt: 'x' }).success).toBe(false);
    expect(CommentDto.safeParse({ body: 'Sahi', idemKey }).success).toBe(true);
    expect(CommentDto.safeParse({ mediaId: M1, parentId: M2, idemKey }).success).toBe(true);
    expect(CommentDto.safeParse({ idemKey }).success).toBe(false);
    expect(CommentDto.safeParse({ body: 'x'.repeat(1001), idemKey }).success).toBe(false);
  });

  it('feed tabs are for_you | following (no trending tab)', () => {
    expect(FeedQueryDto.parse({}).tab).toBe('for_you');
    expect(FeedQueryDto.safeParse({ tab: 'trending' }).success).toBe(false);
  });
});

describe('links (SR-23, AT-SSRF-3)', () => {
  it('shows the registrable domain, never the user-info trick', () => {
    expect(linkDisplayHost('https://mechdost.in@evil.com/')).toBe('evil.com');
    expect(linkDisplayHost('https://www.shop.example.co.in/x')).toBe('example.co.in');
    expect(linkDisplayHost('https://m.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(linkDisplayHost('https://bücher.de/')).toBe('xn--bcher-kva.de');
  });

  it('only http(s) on the default ports, no credentials, no bare IPs in a private range', () => {
    expect(safeLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLinkUrl('ftp://example.com/')).toBeNull();
    expect(safeLinkUrl('https://a:b@example.com/')).toBeNull();
    expect(safeLinkUrl('https://mechdost.in@evil.com/')).toBeNull();
    expect(safeLinkUrl('https://example.com:444/')).toBeNull();
    expect(safeLinkUrl('http://localhost/')).toBeNull();
    expect(safeLinkUrl('not a url')).toBeNull();
  });
});

describe('feed score (§ 9.5)', () => {
  const w: FeedWeights = { follows: 30, city: 25, tag: 20, recency: 15, helpful: 10 };
  const base = {
    followed: false,
    sameCity: false,
    tagMatch: false,
    ageHours: 0,
    likes: 0,
    saves: 0,
    views: 0,
  };

  it('Wilson lower bound: 0 for no data, grows with evidence, below the raw rate', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(1, 1)).toBeLessThan(wilsonLowerBound(10, 10));
    expect(wilsonLowerBound(8, 10)).toBeLessThan(0.8);
  });

  it('weights apply; recency halves every 3 days', () => {
    expect(feedScore({ ...base, followed: true, ageHours: 1e9 }, w)).toBeCloseTo(30);
    expect(feedScore({ ...base, sameCity: true, ageHours: 1e9 }, w)).toBeCloseTo(25);
    expect(feedScore({ ...base, tagMatch: true, ageHours: 1e9 }, w)).toBeCloseTo(20);
    expect(feedScore({ ...base }, w)).toBeCloseTo(15);
    expect(feedScore({ ...base, ageHours: 72 }, w)).toBeCloseTo(7.5);
    const liked = feedScore({ ...base, ageHours: 1e9, likes: 20, saves: 5, views: 25 }, w);
    expect(liked).toBeGreaterThan(5);
    expect(liked).toBeLessThanOrEqual(10);
  });

  it('ranks by score, then newest, then id; caps the list', () => {
    const now = Date.parse('2026-11-26T10:00:00Z');
    const c = (id: string, over: Partial<typeof base>, ageH: number) => ({
      id,
      createdAt: new Date(now - ageH * 3_600_000),
      ...base,
      ...over,
    });
    const ranked = rankFeed(
      [c('a', {}, 100), c('b', { followed: true }, 100), c('c', {}, 1), c('d', {}, 100)],
      w,
      now,
      3,
    );
    expect(ranked).toEqual(['b', 'c', 'd']);
  });
});
