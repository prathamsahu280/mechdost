import { describe, expect, it } from 'vitest';
import en from '../src/notify-templates/en.json';
import hi from '../src/notify-templates/hi.json';
import {
  WHATSAPP_TEMPLATES,
  classifyWhatsAppError,
  isWhatsAppTemplateKey,
  placeholderProblem,
  toWhatsAppNumber,
  utilityTemplateProblem,
  whatsAppParamProblem,
} from '../src/whatsapp';

type QuoteEvent = keyof typeof en.quote;

describe('WhatsApp templates (decision 2026-11-02: Meta direct, cheapest)', () => {
  it('every template is utility at launch, with Meta-valid names and listed params', () => {
    for (const [key, t] of Object.entries(WHATSAPP_TEMPLATES)) {
      expect(t.category, key).toBe('utility');
      expect(t.name).toMatch(/^[a-z0-9_]{1,512}$/);
      expect(t.params.length).toBeGreaterThan(0);
      if ('urlParam' in t) expect(t.params).toContain(t.urlParam);
    }
    expect(isWhatsAppTemplateKey('order.confirmed')).toBe(true);
    expect(isWhatsAppTemplateKey('toString')).toBe(false);
  });

  it('has Meta-compliant English and Hindi bodies for the bulk quote events', () => {
    const keys = ['quote.offer_sent', 'quote.message', 'quote.expiring', 'quote.withdrawn'] as const;
    for (const key of keys) {
      const t = WHATSAPP_TEMPLATES[key];
      expect(t.audience).toBe('customer');
      expect(t.params).toEqual(['quoteCode']);
      for (const locale of ['en', 'hi'] as const) {
        const body = (locale === 'en' ? en : hi).quote[key.slice('quote.'.length) as QuoteEvent];
        expect(utilityTemplateProblem(body), `${key} ${locale}`).toBeNull();
        expect(placeholderProblem(body, t.params.length), `${key} ${locale}`).toBeNull();
        // Meta rejects a body that starts or ends with a variable.
        expect(body.trim()).not.toMatch(/^\{\{|\}\}$/);
      }
    }
    expect(WHATSAPP_TEMPLATES['quote.offer_sent'].name).toBe('quote_price_ready');
  });

  it('refuses offer wording in utility templates (Meta would bill them as marketing)', () => {
    expect(utilityTemplateProblem('Your order {{1}} is confirmed and will be shipped.')).toBeNull();
    expect(utilityTemplateProblem('Order {{1}} confirmed! Get 20% off your next order')).toBe(
      'promo_wording',
    );
    expect(utilityTemplateProblem('Order {{1}} confirmed. Use coupon OIL50')).toBe('promo_wording');
    expect(utilityTemplateProblem('आपका ऑर्डर {{1}} पक्का है। अगली बार 10% छूट')).toBe('promo_wording');
    expect(utilityTemplateProblem('x'.repeat(1025))).toBe('too_long');
  });

  it('checks that template placeholders match the params', () => {
    expect(placeholderProblem('Order {{1}} is out for delivery. Code {{2}}.', 2)).toBeNull();
    expect(placeholderProblem('Order {{1}} is out for delivery.', 2)).toBe('missing');
    expect(placeholderProblem('Order {{1}}, code {{2}}, {{3}}', 2)).toBe('unknown');
  });

  it('checks params and numbers', () => {
    expect(whatsAppParamProblem('MD-RPR-2026-7K3QWX')).toBeNull();
    expect(whatsAppParamProblem(' ')).toBe('empty');
    expect(whatsAppParamProblem('a\nb')).toBe('bad_whitespace');
    expect(whatsAppParamProblem('x'.repeat(61))).toBe('too_long');
    expect(toWhatsAppNumber('+919876543210')).toBe('919876543210');
    expect(toWhatsAppNumber('9876543210')).toBeNull();
  });

  it('classifies Meta errors for retry, the 24 h marketing cap and permanent failure', () => {
    expect(classifyWhatsAppError(131049, 400)).toBe('later');
    expect(classifyWhatsAppError(131026, 400)).toBe('permanent'); // not a WhatsApp user → try SMS/email
    expect(classifyWhatsAppError(130429, 400)).toBe('retry');
    expect(classifyWhatsAppError(undefined, 503)).toBe('retry');
    expect(classifyWhatsAppError(undefined, 400)).toBe('permanent');
  });
});
