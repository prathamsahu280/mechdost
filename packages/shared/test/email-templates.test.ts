/**
 * Transactional email templates (spec 10, design 2026-11-15): closed placeholder lists, admin text overrides,
 * escaping, the fixed layout (HTML + plain text), both languages for every template.
 */
import { describe, expect, it } from 'vitest';
import {
  EMAIL_TEMPLATES,
  composeEmail,
  emailOverrideProblem,
  emailTemplateKeys,
  sampleEmailParams,
} from '../src/email-templates';
import { renderEmailLayout } from '../src/email-layout';

const ctx = { webBaseUrl: 'https://mechdost.com', grievanceContact: null as string | null };
const DEVANAGARI = /[ऀ-ॿ]/;

describe('catalogue', () => {
  it('has every launch template of the design', () => {
    const keys = emailTemplateKeys();
    for (const k of [
      'order_placed',
      'order_confirmed',
      'order_out_for_delivery',
      'order_delivered',
      'order_cancelled',
      'order_rejected',
      'payment_received',
      'refund_requested',
      'refund_processed',
      'refund_failed',
      'service_request_received',
      'service_proposed',
      'service_confirmed',
      'service_estimate_ready',
      'service_ready',
      'service_bill_ready',
      'service_completed',
      'quote_offer',
      'quote_expiring',
      'ticket_received',
      'ticket_reply',
      'ticket_resolved',
      'partner_invite',
      'application_received',
      'application_approved',
      'application_rejected',
      'trade_application_received',
      'fleet_application_received',
      'trade_account_verified',
      'shop_order_routed',
      'partner_warning_issued',
      'auth_verify_email',
      'auth_password_reset',
      'auth_password_changed',
    ])
      expect(keys).toContain(k);
  });

  it.each(emailTemplateKeys())('%s: both languages, every placeholder known, no stray braces', (key) => {
    const t = EMAIL_TEMPLATES[key];
    for (const locale of ['en', 'hi'] as const) {
      const copy = t[locale];
      expect(copy.subject.length).toBeGreaterThan(0);
      expect(copy.heading.length).toBeGreaterThan(0);
      const used = [
        ...`${copy.subject} ${copy.heading} ${copy.body} ${copy.button ?? ''}`.matchAll(/\{(\w+)\}/g),
      ];
      for (const m of used) expect(t.text).toContain(m[1]);
    }
    expect(DEVANAGARI.test(t.hi.body)).toBe(true);
    expect(DEVANAGARI.test(t.hi.subject)).toBe(true);
    // Hindi copy must not just be the English text.
    expect(t.hi.body).not.toBe(t.en.body);
  });

  it.each(emailTemplateKeys())(
    '%s composes with sample data in en and hi without leftover placeholders',
    (key) => {
      for (const locale of ['en', 'hi'] as const) {
        const e = composeEmail(key, locale, sampleEmailParams(key), { ...ctx });
        expect(`${e.subject}${e.heading}${e.paragraphs.join('')}${e.action?.label ?? ''}`).not.toMatch(
          /\{\w+\}/,
        );
        if (EMAIL_TEMPLATES[key].button) expect(e.action?.url.startsWith('https://mechdost.com')).toBe(true);
      }
    },
  );

  it('never calls a refund done before it is: only refund_processed says processed', () => {
    expect(EMAIL_TEMPLATES.refund_requested.en.body.toLowerCase()).not.toContain('has been refunded');
    expect(EMAIL_TEMPLATES.order_cancelled.en.body.toLowerCase()).not.toContain('has been refunded');
  });

  it('the shop never gets customer contact details', () => {
    expect(EMAIL_TEMPLATES.shop_order_routed.text).not.toContain('email');
    expect(EMAIL_TEMPLATES.shop_order_routed.text).not.toContain('phone');
    expect(EMAIL_TEMPLATES.order_confirmed.text).not.toContain('shopPhone');
  });

  it('the out-for-delivery email carries the code and the share-at-the-door warning', () => {
    const e = composeEmail('order_out_for_delivery', 'en', sampleEmailParams('order_out_for_delivery'), ctx);
    expect(e.paragraphs.join(' ')).toContain(sampleEmailParams('order_out_for_delivery').deliveryCode);
    expect(e.paragraphs.join(' ').toLowerCase()).toContain('only');
  });
});

describe('overrides', () => {
  it('replaces only the fields set, falling back to the default for the rest', () => {
    const base = composeEmail('order_confirmed', 'en', sampleEmailParams('order_confirmed'), ctx);
    const e = composeEmail('order_confirmed', 'en', sampleEmailParams('order_confirmed'), ctx, {
      subject: 'Good news {orderCode}',
      heading: null,
      body: '',
      buttonLabel: 'Open it',
    });
    expect(e.subject).toBe(`Good news ${sampleEmailParams('order_confirmed').orderCode}`);
    expect(e.heading).toBe(base.heading);
    expect(e.paragraphs).toEqual(base.paragraphs);
    expect(e.action?.label).toBe('Open it');
  });

  it('rejects unknown placeholders, HTML, line breaks in the subject and over-long text', () => {
    expect(emailOverrideProblem('order_confirmed', { body: 'Hi {nope}' })).toBe('EMAIL_PLACEHOLDER');
    expect(emailOverrideProblem('order_confirmed', { subject: 'Hi {orderCode}' })).toBeNull();
    expect(emailOverrideProblem('order_confirmed', { body: 'Hello <b>there</b>' })).toBe('EMAIL_HTML');
    expect(emailOverrideProblem('order_confirmed', { subject: 'a\nb' })).toBe('EMAIL_SUBJECT_LINES');
    expect(emailOverrideProblem('order_confirmed', { body: 'x'.repeat(3001) })).toBe('EMAIL_TOO_LONG');
    expect(emailOverrideProblem('order_confirmed', { buttonLabel: 'x'.repeat(41) })).toBe('EMAIL_TOO_LONG');
    expect(emailOverrideProblem('nope', { body: 'x' })).toBe('EMAIL_UNKNOWN_TEMPLATE');
  });

  it('a secret-only param (the invite token) is not an allowed placeholder', () => {
    expect(emailOverrideProblem('partner_invite', { body: 'Use {token}' })).toBe('EMAIL_PLACEHOLDER');
  });

  it('a template without a button ignores a button label', () => {
    const t = EMAIL_TEMPLATES.partner_warning_issued;
    const e = composeEmail('partner_warning_issued', 'en', sampleEmailParams('partner_warning_issued'), ctx, {
      buttonLabel: 'Open',
    });
    expect(Boolean(t.button)).toBe(Boolean(e.action));
  });
});

describe('layout', () => {
  const content = {
    subject: 'Subject',
    heading: 'Your order <is> confirmed',
    paragraphs: ['Hello "Asha" & co', 'Second\nline'],
    action: { label: 'Track order', url: 'https://mechdost.com/orders/MD-1?a=1&b=2' },
  };
  const html = renderEmailLayout(content, { locale: 'en', grievanceContact: null }).html;
  const text = renderEmailLayout(content, { locale: 'en', grievanceContact: null }).text;

  it('escapes every value in the HTML and keeps the plain text raw', () => {
    expect(html).toContain('Your order &lt;is&gt; confirmed');
    expect(html).toContain('Hello &quot;Asha&quot; &amp; co');
    expect(html).not.toContain('<is>');
    expect(html).toContain('a=1&amp;b=2');
    expect(text).toContain('Hello "Asha" & co');
    expect(text).toContain('Track order: https://mechdost.com/orders/MD-1?a=1&b=2');
  });

  it('is table based with inline styles, brand colours, dark-mode hints and no images or trackers', () => {
    expect(html).toContain('<table');
    expect(html).toContain('#101f34');
    expect(html).toContain('#ea5728');
    expect(html).toContain('color-scheme');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).not.toMatch(/<img|<script|<link/i);
  });

  it('has the footer with company and support phone; the grievance contact only once set', () => {
    expect(html).toContain('Shourya Integrated Services Pvt Ltd');
    expect(html).toContain('7978776551');
    expect(text).toContain('7978776551');
    expect(html.toLowerCase()).not.toContain('grievance');
    const set = renderEmailLayout(content, { locale: 'en', grievanceContact: 'grievance@mechdost.com' });
    expect(set.html).toContain('grievance@mechdost.com');
    expect(set.text).toContain('grievance@mechdost.com');
  });

  it('writes the footer and language tag in Hindi', () => {
    const hi = renderEmailLayout(content, { locale: 'hi', grievanceContact: null });
    expect(hi.html).toContain('lang="hi"');
    expect(hi.html).toMatch(/शौर्य/);
  });

  it('has no unsubscribe link for transactional mail', () => {
    expect(html.toLowerCase()).not.toContain('unsubscribe');
  });
});

describe('account emails sent by us (decision 2026-11-24)', () => {
  const params = { mode: 'resetPassword', token: 'abc123_XYZ-0987654321', lang: 'en' };

  it.each([
    ['en', 'https://mechdost.com/auth/action?mode=resetPassword&oobCode=abc123_XYZ-0987654321&lang=en'],
    ['hi', 'https://mechdost.com/hi/auth/action?mode=resetPassword&oobCode=abc123_XYZ-0987654321&lang=hi'],
  ] as const)('the reset button opens our action page in %s', (locale, url) => {
    const e = composeEmail('auth_password_reset', locale, { ...params, lang: locale }, ctx);
    expect(e.action?.url).toBe(url);
    expect(e.purpose).toBe('system');
    expect(e.category).toBe('transactional');
  });

  it('renders the verification mail in English and Hindi, with the link in both the button and the plain text', () => {
    for (const locale of ['en', 'hi'] as const) {
      const p = { mode: 'verifyEmail', token: 'verify-code-0123456789', lang: locale };
      const e = composeEmail('auth_verify_email', locale, p, ctx);
      const { text, html } = renderEmailLayout(e, { locale, grievanceContact: null, trustLine: null });
      const url = e.action?.url ?? '';
      expect(url).toContain('/auth/action?mode=verifyEmail&oobCode=verify-code-0123456789');
      expect(text).toContain(url);
      expect(html).toContain('verify-code-0123456789');
      expect(DEVANAGARI.test(`${e.subject}${e.heading}${e.paragraphs.join('')}`)).toBe(locale === 'hi');
    }
  });

  it('the code never goes into the subject, heading or body text, and there are no placeholders to leak it', () => {
    for (const key of ['auth_verify_email', 'auth_password_reset'] as const) {
      expect(EMAIL_TEMPLATES[key].text).toEqual([]);
      const e = composeEmail(key, 'en', params, ctx);
      expect(`${e.subject}${e.heading}${e.paragraphs.join('')}`).not.toContain(params.token);
      // An admin override cannot bring the code into the text either.
      expect(emailOverrideProblem(key, { body: 'Your code is {token}' })).toBe('EMAIL_PLACEHOLDER');
    }
  });
});

describe('password-changed notice (decision 2026-11-24)', () => {
  it.each(['en', 'hi'] as const)(
    'says what happened and how to react, in %s, with no code or secret',
    (locale) => {
      const e = composeEmail('auth_password_changed', locale, {}, ctx);
      expect(e.purpose).toBe('system');
      expect(e.category).toBe('transactional');
      expect(EMAIL_TEMPLATES.auth_password_changed.params).toEqual([]);
      const text = `${e.subject}${e.heading}${e.paragraphs.join(' ')}`;
      expect(text).toContain('7978776551');
      expect(text).toContain('support@mechdost.com');
      expect(e.action?.url).toBe(`https://mechdost.com${locale === 'hi' ? '/hi' : ''}/login`);
      expect(e.action?.label.length).toBeGreaterThan(0);
    },
  );

  it('is written in Devanagari for Hindi and cannot take placeholders from an admin override', () => {
    expect(DEVANAGARI.test(EMAIL_TEMPLATES.auth_password_changed.hi.body)).toBe(true);
    expect(emailOverrideProblem('auth_password_changed', { body: 'Code {token}' })).toBe('EMAIL_PLACEHOLDER');
  });
});
