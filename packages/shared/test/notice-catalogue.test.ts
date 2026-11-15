import { describe, expect, it } from 'vitest';
import { emailTemplateKeys, EMAIL_TEMPLATES } from '../src/email-templates';
import {
  NOTICE_CATALOGUE,
  NOTICE_FOR_EMAIL,
  NOTICE_LIMITS,
  composeNotice,
  defaultNoticeCopy,
  fillNotice,
  isNoticeKind,
  noticeKinds,
  noticeLink,
  noticeOverrideProblem,
} from '../src/notice-catalogue';

const placeholdersIn = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');
const SAMPLE = {
  orderCode: 'MD-RPR-2026-4K7Q2M',
  requestCode: 'SR-RPR-2026-4M8T2B',
  quoteCode: 'QT-RPR-2026-7H2K9P',
  ticketCode: 'REQ-RPR-2026-9F2KQA',
  workshopName: 'Sharma Garage',
  minutes: '15',
  pincode: '492001',
};

describe('notice catalogue', () => {
  it('every kind has text in both languages that fits and uses only its own placeholders', () => {
    for (const kind of noticeKinds())
      for (const locale of ['en', 'hi'] as const) {
        const copy = defaultNoticeCopy(kind, locale);
        const allowed: readonly string[] = NOTICE_CATALOGUE[kind].text;
        for (const p of [...placeholdersIn(copy.title), ...placeholdersIn(copy.body)])
          expect(allowed, `${kind} ${locale} uses {${p}}`).toContain(p);
        const filled = composeNotice(kind, locale, SAMPLE);
        expect(filled.title.length, `${kind} ${locale} title`).toBeLessThanOrEqual(NOTICE_LIMITS.title);
        expect(filled.body.length, `${kind} ${locale} body`).toBeLessThanOrEqual(NOTICE_LIMITS.body);
        expect(filled.title + filled.body).not.toMatch(/\{\w+\}/);
        if (locale === 'hi') expect(filled.title, kind).toMatch(/[ऀ-ॿ]/);
      }
  });

  it('keeps the lock screen clean: no amount, phone, address or delivery code placeholder anywhere', () => {
    for (const kind of noticeKinds())
      for (const p of NOTICE_CATALOGUE[kind].text)
        expect(['amount', 'phone', 'address', 'deliveryCode', 'total', 'items', 'email']).not.toContain(p);
  });

  it('every link is a path on this site, in both languages', () => {
    for (const kind of noticeKinds())
      for (const locale of ['en', 'hi'] as const) {
        const link = noticeLink(kind, locale, SAMPLE);
        expect(link, kind).toMatch(/^\/[^/\\]/);
        expect(link.startsWith('/hi/') || locale === 'en', kind).toBe(true);
        expect(link).not.toMatch(/https?:|\/\//);
      }
  });

  it('a hostile code cannot leave the site or add a path', () => {
    const link = noticeLink('order.placed', 'en', { orderCode: '../../admin?x=//evil.example' });
    expect(link.startsWith('/orders/')).toBe(true);
    expect(link).not.toContain('//');
    expect(link.slice('/orders/'.length)).not.toMatch(/[/?]/);
  });

  it('every email milestone with a notice maps to a real kind and shows the same page', () => {
    for (const [email, kind] of Object.entries(NOTICE_FOR_EMAIL)) {
      expect(emailTemplateKeys()).toContain(email);
      expect(isNoticeKind(kind), email).toBe(true);
      const key = email as keyof typeof EMAIL_TEMPLATES;
      const button = EMAIL_TEMPLATES[key].button;
      // The email's button and the notice open the same family of page (the order, the request, the ticket…).
      if (button && NOTICE_CATALOGUE[kind].audience === 'customer' && kind !== 'refund.declined')
        expect(noticeLink(kind, 'en', SAMPLE), email).toBe(button(SAMPLE));
    }
  });

  it('fillNotice leaves unknown placeholders alone and strips control characters from values', () => {
    expect(fillNotice('Hi {name} {orderCode}', { orderCode: 'A\nB\u0000C', name: 'x' }, ['orderCode'])).toBe(
      'Hi {name} A B C',
    );
  });

  it('composeNotice cuts an over-long value instead of breaking the push', () => {
    const long = composeNotice('order.confirmed', 'en', { orderCode: 'X'.repeat(500) });
    expect(long.body.length).toBeLessThanOrEqual(NOTICE_LIMITS.body);
    expect(long.body.endsWith('…')).toBe(true);
  });

  it('admin overrides: blank means default; unknown placeholders, markup and long text are refused', () => {
    expect(composeNotice('order.confirmed', 'en', SAMPLE, { title: '  ', body: null }).title).toBe(
      'Order confirmed',
    );
    expect(
      composeNotice('order.confirmed', 'en', SAMPLE, { title: 'Yes {orderCode}', body: null }).title,
    ).toBe(`Yes ${SAMPLE.orderCode}`);
    const p = (title: string | null, body: string | null) =>
      noticeOverrideProblem('order.confirmed', { title, body });
    expect(p('Hi', 'Fine {orderCode}')).toBeNull();
    expect(p(null, 'Total {amount}')).toBe('NOTICE_UNKNOWN_PLACEHOLDER');
    expect(p('<b>x</b>', null)).toBe('NOTICE_HTML');
    expect(p('x'.repeat(NOTICE_LIMITS.title + 1), null)).toBe('NOTICE_TOO_LONG');
    expect(noticeOverrideProblem('nope.nope', { title: null, body: null })).toBe('NOTICE_UNKNOWN_KIND');
  });
});
