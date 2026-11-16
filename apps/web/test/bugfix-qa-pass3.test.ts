/** Real-API QA pass 3 (2026-11-16): signed-out record links keep their way back. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { safeNext } from '../src/demo/session';
import { loginHref, orderGroupCode, orderPageCode } from '../src/lib/record-links';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const nextOf = (href: string) => new URL(href, 'http://x').searchParams.get('next');

describe('loginHref', () => {
  it('returns to the same path and query', () => {
    const href = loginHref('/hi', '/hi/account/support?ticket=REQ-RPR-2026-ABC123');
    expect(safeNext(nextOf(href))).toBe('/hi/account/support?ticket=REQ-RPR-2026-ABC123');
  });
  it('is never an open redirect once the login page checks it', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      expect(safeNext(nextOf(loginHref('', bad)))).toBeNull();
    }
  });
});

describe('order page codes', () => {
  it('accepts the order code and the per-shop code', () => {
    expect(orderPageCode('MD-RPR-2026-7K3Q9X')).toBe('MD-RPR-2026-7K3Q9X');
    expect(orderPageCode('MD-RPR-2026-7K3Q9X-1')).toBe('MD-RPR-2026-7K3Q9X-1');
    expect(orderPageCode('MD-RPR-2026-7K3Q9X-123')).toBe('');
    expect(orderPageCode('nope')).toBe('');
  });
  it('maps a per-shop code to its order', () => {
    expect(orderGroupCode('MD-RPR-2026-7K3Q9X-2')).toBe('MD-RPR-2026-7K3Q9X');
    expect(orderGroupCode('MD-RPR-2026-7K3Q9X')).toBe('MD-RPR-2026-7K3Q9X');
  });
});

describe('every signed-out record link uses the shared helper', () => {
  it.each([
    ['components/commerce/order-view-api.tsx'],
    ['components/quotes/quote-thread-api.tsx'],
    ['components/workshops/request-view-api.tsx'],
    ['components/account/account-area.tsx'],
  ])('%s', (file) => {
    const src = read(file);
    expect(src).toMatch(/loginHref\(/);
    expect(src).not.toMatch(/\/login\?next=/);
  });
  it('the order page lets per-shop codes through and the view fetches the order', () => {
    expect(read('app/[locale]/orders/[code]/page.tsx')).toMatch(/orderPageCode\(/);
    expect(read('components/commerce/order-view-api.tsx')).toMatch(/orderGroupCode\(/);
  });
  it('a malformed code is not "not found" for a signed-out visitor', () => {
    for (const f of [
      'components/commerce/order-view-api.tsx',
      'components/quotes/quote-thread-api.tsx',
      'components/workshops/request-view-api.tsx',
    ])
      expect(read(f)).toMatch(/useSignedOut\(/);
  });
  it('the account frame keeps the query (support ticket) on the way back', () => {
    expect(read('components/account/account-area.tsx')).toMatch(/window\.location\.search/);
  });
});

describe('sign-in prompts have copy in both languages', () => {
  it.each(['order', 'quote'] as const)('%s', (ns) => {
    expect(en[ns].api_signIn).toBeTruthy();
    expect(hi[ns].api_signIn).toMatch(/[ऀ-ॿ]/);
  });
});
