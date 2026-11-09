import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/lib/csp';

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(' ') ?? [];

describe('content security policy (ruling 2026-11-09)', () => {
  it('demo build: own origin and the map hosts only; no frames, plugins or eval', () => {
    const p = contentSecurityPolicy({ dev: false, authMode: 'demo' });
    expect(directive(p, 'script-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directive(p, 'connect-src')).toEqual([
      "'self'",
      'https://tiles.openfreemap.org',
      'https://server.arcgisonline.com',
    ]);
    expect(directive(p, 'frame-src')).toEqual(["'none'"]);
    expect(directive(p, 'object-src')).toEqual(["'none'"]);
    expect(directive(p, 'frame-ancestors')).toEqual(["'none'"]);
    expect(p).not.toContain('unsafe-eval');
    expect(p).not.toContain('google');
  });

  it('real sign-in adds exactly Turnstile, reCAPTCHA, Firebase Auth and the API', () => {
    const p = contentSecurityPolicy({
      dev: false,
      authMode: 'firebase',
      apiUrl: 'https://api.mechdost.com/v1',
      firebaseAuthDomain: 'mechdost-prod.firebaseapp.com',
    });
    expect(directive(p, 'script-src')).toEqual(
      expect.arrayContaining(['https://challenges.cloudflare.com', 'https://www.google.com/recaptcha/']),
    );
    expect(directive(p, 'connect-src')).toEqual(
      expect.arrayContaining([
        'https://api.mechdost.com',
        'https://identitytoolkit.googleapis.com',
        'https://securetoken.googleapis.com',
      ]),
    );
    expect(directive(p, 'frame-src')).toEqual(
      expect.arrayContaining(['https://challenges.cloudflare.com', 'https://mechdost-prod.firebaseapp.com']),
    );
    expect(p).not.toContain('http://127.0.0.1');
  });

  it('development allows eval and the dev socket; a bad API URL is ignored, not allowed', () => {
    const p = contentSecurityPolicy({ dev: true, authMode: 'demo', apiUrl: 'not a url' });
    expect(directive(p, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(p, 'connect-src')).toContain('ws:');
    expect(directive(p, 'connect-src')).not.toContain('not');
  });
});
