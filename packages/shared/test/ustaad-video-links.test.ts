import { describe, expect, it } from 'vitest';
import {
  parseVideoLink,
  youtubeEmbedUrl,
  youtubeOEmbedUrl,
  youtubeThumbUrl,
  youtubeWatchUrl,
} from '../src/ustaad/video-links';

const ID = 'dQw4w9WgXcQ';

describe('parseVideoLink (spec 23 § 10b)', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, 0],
    [`https://youtube.com/watch?v=${ID}&list=PL1`, 0],
    [`https://m.youtube.com/watch?v=${ID}`, 0],
    [`https://youtu.be/${ID}`, 0],
    [`https://youtu.be/${ID}?si=abc`, 0],
    [`https://www.youtube.com/shorts/${ID}`, 0],
    [`https://www.youtube.com/live/${ID}`, 0],
    [`https://www.youtube.com/embed/${ID}`, 0],
    [`https://www.youtube-nocookie.com/embed/${ID}?start=12`, 12],
    [`https://youtu.be/${ID}?t=90`, 90],
    [`https://youtu.be/${ID}?t=90s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`, 3723],
    [`https://www.youtube.com/watch?v=${ID}#t=45`, 45],
  ])('recognises %s', (url, start) => {
    expect(parseVideoLink(url)).toEqual({ provider: 'youtube', videoId: ID, startS: start });
  });

  it.each([
    `https://youtube.com.evil.com/watch?v=${ID}`,
    `https://evil.com/youtube.com/watch?v=${ID}`,
    `https://evil.com/?u=https://youtu.be/${ID}`,
    `https://www.youtube.com@evil.com/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=dQw4w9WgXc`, // 10 chars
    `https://www.youtube.com/watch?v=dQw4w9WgXcQQ`, // 12 chars
    `https://www.youtube.com/watch?v=dQw4w9WgX%3C`,
    `https://youtu.be/${ID}/extra`,
    `https://www.youtube.com/channel/UC123`,
    `https://www.youtube.com/`,
    `javascript:alert(1)//youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
    `https://youtu.be:8080/${ID}`,
    `https://vimeo.com/123456`,
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseVideoLink(url)).toBeNull();
  });

  it('ignores a malformed or absurd start time', () => {
    expect(parseVideoLink(`https://youtu.be/${ID}?t=abc`)?.startS).toBe(0);
    expect(parseVideoLink(`https://youtu.be/${ID}?t=-5`)?.startS).toBe(0);
    expect(parseVideoLink(`https://youtu.be/${ID}?t=999999`)?.startS).toBe(0);
  });
});

describe('YouTube URLs built only from the validated id', () => {
  it('canonical watch URL (what the blocked-sites list and the cache see)', () => {
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
  it('privacy-enhanced embed with autoplay, start and rel=0', () => {
    expect(youtubeEmbedUrl(ID, 90)).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0&start=90`,
    );
    expect(youtubeEmbedUrl(ID, 0)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0`);
  });
  it('thumbnail on i.ytimg.com', () => {
    expect(youtubeThumbUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });
  it('oEmbed URL on the fixed host', () => {
    expect(youtubeOEmbedUrl(ID)).toBe(
      `https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${ID}`,
    );
  });
  it('refuses to build from an invalid id', () => {
    expect(() => youtubeEmbedUrl('../../x', 0)).toThrow();
  });
});
