import { describe, expect, it } from 'vitest';
import { scrubErrorEvent, scrubErrorText, scrubUrl } from '../src/error-scrub';
import { CONSENT_NOTICE_VERSION, consentAllowsForwarding } from '../src/privacy';

/**
 * Error reports leave our servers (Sentry, decision 2026-11-14), so everything personal is removed before they are
 * sent: request bodies, headers, cookies, query strings, the user, phone numbers, emails, tokens and the SQL plus
 * parameters that database errors embed in their message (security review 2026-11-03: logs never hold messages).
 */
describe('scrubErrorText', () => {
  it('masks phone numbers, emails and tokens', () => {
    expect(scrubErrorText('Customer 98765 43210 not found')).toBe('Customer # not found');
    expect(scrubErrorText('no user ravi.sahu@example.com')).toBe('no user #');
    expect(scrubErrorText('Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl failed')).toBe(
      'Bearer [token] failed',
    );
    expect(scrubErrorText('key phc_abcdefghijklmnopqrstuvwxyz0123456789AB bad')).toBe('key [token] bad');
  });

  it('drops the SQL and parameters of a failed query', () => {
    const msg =
      'Failed query: insert into "addresses" ("contact_phone") values ($1)\nparams: +919876543210,Ravi Sahu';
    expect(scrubErrorText(msg)).toBe('Failed query [redacted]');
  });

  it('keeps ordinary messages and codes', () => {
    expect(scrubErrorText('Cannot read properties of undefined (reading "map")')).toBe(
      'Cannot read properties of undefined (reading "map")',
    );
    expect(scrubErrorText('Order MD-RPR-2026-7K2M9Q not found')).toBe('Order MD-RPR-2026-7K2M9Q not found');
  });
});

describe('scrubUrl', () => {
  it('keeps origin and path, drops query and fragment, redacts secret segments', () => {
    expect(scrubUrl('https://mechdost.com/shop?q=9876543210#top')).toBe('https://mechdost.com/shop');
    expect(scrubUrl('https://mechdost.com/partners/invite/secret-token')).toBe(
      'https://mechdost.com/partners/invite/:token',
    );
    expect(scrubUrl('/orders/98765-43210?x=1')).toBe('/orders/#');
  });
});

describe('scrubErrorEvent', () => {
  it('removes request data, headers, cookies, query strings, the user and the host name', () => {
    const event = scrubErrorEvent({
      message: 'call 9876543210',
      server_name: 'ip-10-0-0-1',
      user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
      request: {
        url: 'https://api.mechdost.com/v1/me?phone=9876543210',
        method: 'POST',
        data: { phone: '+919876543210' },
        headers: { authorization: 'Bearer x', cookie: 'a=b' },
        cookies: { a: 'b' },
        query_string: 'phone=9876543210',
        env: { REMOTE_ADDR: '1.2.3.4' },
      },
      exception: { values: [{ type: 'Error', value: 'mail ravi@example.com bounced' }] },
      breadcrumbs: [
        { category: 'console', message: 'debug 9876543210' },
        { category: 'fetch', data: { url: 'https://api.mechdost.com/v1/x?token=abc', method: 'GET' } },
        { category: 'navigation', data: { from: '/partners/invite/tok', to: '/shop?q=1' } },
        { category: 'ui.click', message: 'button#pay' },
      ],
      extra: { phone: '9876543210', note: 'Ravi', count: 3, nested: { email: 'a@b.co', ok: 'fine' } },
      contexts: { trace: { trace_id: 'abc' } },
      tags: { route: '/v1/me' },
    });
    expect(event.message).toBe('call #');
    expect(event.server_name).toBeUndefined();
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: 'https://api.mechdost.com/v1/me', method: 'POST' });
    expect(event.exception.values[0]?.value).toBe('mail # bounced');
    expect(event.breadcrumbs).toEqual([
      { category: 'fetch', data: { url: 'https://api.mechdost.com/v1/x', method: 'GET' } },
      { category: 'navigation', data: { from: '/partners/invite/:token', to: '/shop' } },
      { category: 'ui.click', message: 'button#pay' },
    ]);
    expect(event.extra).toEqual({
      phone: '[redacted]',
      note: '[redacted]',
      count: 3,
      nested: { email: '[redacted]', ok: 'fine' },
    });
    expect(event.tags).toEqual({ route: '/v1/me' });
    expect(JSON.stringify(event)).not.toMatch(/9876543210|ravi@|a@b\.co|1\.2\.3\.4|Bearer x/);
  });

  it('accepts an event without optional parts', () => {
    expect(scrubErrorEvent({})).toEqual({});
  });
});

describe('consent notice version for forwarding to PostHog', () => {
  it('only consents given on or after the notice that names PostHog allow forwarding', () => {
    expect(consentAllowsForwarding(CONSENT_NOTICE_VERSION)).toBe(true);
    expect(consentAllowsForwarding('2026-12')).toBe(true);
    expect(consentAllowsForwarding('2026-11')).toBe(false);
    expect(consentAllowsForwarding('2026-11-13')).toBe(false);
    expect(consentAllowsForwarding(null)).toBe(false);
    expect(consentAllowsForwarding('')).toBe(false);
    expect(consentAllowsForwarding('garbage')).toBe(false);
  });
});
