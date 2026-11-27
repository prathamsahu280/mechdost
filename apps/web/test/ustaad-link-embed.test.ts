import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/lib/csp';
import { startClock, videoFrameProps } from '../src/components/ustaad/link-embed/model';

const ID = 'dQw4w9WgXcQ';

describe('video-link player (spec 23 § 10b)', () => {
  it('the iframe goes only to youtube-nocookie with autoplay, start and rel=0, sandboxed and lazy', () => {
    const p = videoFrameProps({ provider: 'youtube', videoId: ID, startS: 90 }, 'YouTube video: Clutch');
    expect(p.src).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0&start=90`);
    expect(p.title).toBe('YouTube video: Clutch');
    expect(p.allow).toBe('autoplay; encrypted-media; picture-in-picture; fullscreen');
    expect(p.allowFullScreen).toBe(true);
    expect(p.loading).toBe('lazy');
    expect(p.referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(p.sandbox.split(' ').sort()).toEqual(
      ['allow-presentation', 'allow-same-origin', 'allow-scripts', 'allow-popups'].sort(),
    );
    // The frame host is the one the CSP allows.
    const frame = contentSecurityPolicy({ dev: false, authMode: 'demo' });
    expect(frame).toContain(new URL(p.src).origin);
  });

  it('a forged id never reaches the frame', () => {
    expect(() => videoFrameProps({ provider: 'youtube', videoId: '"><script>', startS: 0 }, 'x')).toThrow();
  });

  it('start clock m:ss / h:mm:ss', () => {
    expect(startClock(0)).toBeNull();
    expect(startClock(90)).toBe('1:30');
    expect(startClock(3723)).toBe('1:02:03');
  });
});
