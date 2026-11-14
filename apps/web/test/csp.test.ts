import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { contentSecurityPolicy } from '../src/lib/csp';
import { SITE_LAYOUT_SCRIPT } from '../src/lib/site-layout';
import { THEME_INIT_SCRIPT } from '../src/lib/theme';

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
        // Web push (spec 10): the browser registers its token with these two.
        'https://fcmregistrations.googleapis.com',
        'https://firebaseinstallations.googleapis.com',
      ]),
    );
    // Demo builds never talk to Firebase push.
    expect(directive(contentSecurityPolicy({ dev: false, authMode: 'demo' }), 'connect-src')).not.toContain(
      'https://fcmregistrations.googleapis.com',
    );
    expect(directive(p, 'frame-src')).toEqual(
      expect.arrayContaining(['https://challenges.cloudflare.com', 'https://mechdost-prod.firebaseapp.com']),
    );
    expect(p).not.toContain('http://127.0.0.1');
  });

  it('Sentry: only the ingest host of the configured DSN (EU region), only when a DSN is set', () => {
    const dsn =
      'https://0123456789abcdef0123456789abcdef@o4500000000000000.ingest.de.sentry.io/4500000000000001';
    const p = contentSecurityPolicy({ dev: false, authMode: 'demo', sentryDsn: dsn });
    expect(directive(p, 'connect-src')).toContain('https://o4500000000000000.ingest.de.sentry.io');
    expect(p).not.toContain('0123456789abcdef0123456789abcdef');
    expect(contentSecurityPolicy({ dev: false, authMode: 'demo' })).not.toContain('sentry');
    for (const bad of [
      '',
      'not a dsn',
      'http://k@o1.ingest.de.sentry.io/1',
      'https://k@evil.example.com/1',
    ]) {
      expect(contentSecurityPolicy({ dev: false, authMode: 'demo', sentryDsn: bad })).not.toMatch(
        /sentry|evil/u,
      );
    }
  });

  it('development allows eval and the dev socket; a bad API URL is ignored, not allowed', () => {
    const p = contentSecurityPolicy({ dev: true, authMode: 'demo', apiUrl: 'not a url' });
    expect(directive(p, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(p, 'connect-src')).toContain('ws:');
    expect(directive(p, 'connect-src')).not.toContain('not');
  });

  it('with a nonce (the /login page in real mode): nonce + strict-dynamic; inline only as an old-browser fallback', () => {
    const p = contentSecurityPolicy({ dev: false, authMode: 'firebase', nonce: 'bm9uY2UtMTIz' });
    const script = directive(p, 'script-src');
    expect(script.slice(0, 3)).toEqual(["'self'", "'nonce-bm9uY2UtMTIz'", "'strict-dynamic'"]);
    // CSP2+ browsers ignore 'unsafe-inline' once a nonce is present; it only keeps CSP1 browsers working.
    expect(script).toContain("'unsafe-inline'");
    // The layout's two fixed inline scripts carry no nonce: they are allowed by their exact hash.
    for (const source of [THEME_INIT_SCRIPT, SITE_LAYOUT_SCRIPT])
      expect(script).toContain(`'sha256-${createHash('sha256').update(source).digest('base64')}'`);
    expect(directive(p, 'object-src')).toEqual(["'none'"]);
  });
});
