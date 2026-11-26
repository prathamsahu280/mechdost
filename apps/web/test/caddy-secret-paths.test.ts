/**
 * Security review 2026-11-26: every path that carries a bearer token in a segment (`SECRET_ROUTES`, redacted in client
 * analytics) must also be redacted in the server access log, in the request URI and in the Referer header
 * (`deploy/Caddyfile`). This reads both Caddy regexps and checks each route, so a new token route cannot miss one.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECRET_ROUTES, redactPath } from '@mechdost/shared/analytics-path';

const caddy = readFileSync(fileURLToPath(new URL('../../../deploy/Caddyfile', import.meta.url)), 'utf8');

/** `request>uri regexp <pattern> <replacement>` → a JS RegExp (the pattern uses the RE2 subset both engines share). */
function filter(field: 'request>uri' | 'request>headers>Referer'): { re: RegExp; replacement: string } {
  const line = caddy.split('\n').find((l) => l.trim().startsWith(`${field} regexp `));
  if (!line) throw new Error(`no ${field} filter in deploy/Caddyfile`);
  const [, pattern, replacement] = /regexp (\S+) (\S+)\s*$/.exec(line.trim()) ?? [];
  if (!pattern || !replacement) throw new Error(`cannot parse ${field}`);
  return { re: new RegExp(pattern, 'g'), replacement: replacement.replace('${1}', '$1') };
}

const SECRET = 'tok3nSecretValue0123456789abcdef';
/** API routes that carry the same tokens in their path (`/v1/...`). */
const API_ROUTES = ['partner-invites', 'ustaad-attest', 'ustaad/s', 'delivery-invites'];

describe('token paths are redacted in the access log', () => {
  for (const field of ['request>uri', 'request>headers>Referer'] as const) {
    const { re, replacement } = filter(field);
    const scrub = (s: string) => s.replace(re, replacement);

    it(`${field}: every web route in SECRET_ROUTES (en + hi)`, () => {
      expect(SECRET_ROUTES.length).toBeGreaterThan(0);
      for (const route of SECRET_ROUTES) {
        for (const path of [`/${route}/${SECRET}`, `/hi/${route}/${SECRET}`]) {
          // The client side redacts it…
          expect(redactPath(path)).not.toContain(SECRET);
          // …and so does the server log, as a full URL in the Referer too.
          expect(scrub(path), `${field} ${path}`).not.toContain(SECRET);
          expect(scrub(`https://mechdost.com${path}`), `${field} ${path}`).not.toContain(SECRET);
        }
      }
    });

    it(`${field}: the API token routes`, () => {
      for (const route of API_ROUTES) expect(scrub(`/v1/${route}/${SECRET}`)).not.toContain(SECRET);
    });
  }
});
