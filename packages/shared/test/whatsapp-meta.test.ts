import { describe, expect, it } from 'vitest';
import { WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from '../src/whatsapp';
import {
  META_TEMPLATE_COPY,
  buildMetaTemplates,
  metaTemplateProblems,
  missingTemplates,
  parseMetaTemplateList,
  statusesByKey,
  whatsAppTemplateApproved,
  type MetaTemplatePayload,
} from '../src/whatsapp-meta';

const keys = Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[];

describe('Meta template payloads built from the catalogue', () => {
  const all = buildMetaTemplates();

  it('builds one payload per catalogue template and language (en + hi)', () => {
    expect(all).toHaveLength(keys.length * 2);
    for (const key of keys) {
      for (const language of ['en', 'hi'] as const) {
        const p = all.find((t) => t.key === key && t.payload.language === language);
        expect(p, `${key}/${language}`).toBeDefined();
        expect(p?.payload.name).toBe(WHATSAPP_TEMPLATES[key].name);
        expect(p?.payload.category).toBe('UTILITY');
      }
    }
  });

  it('every built payload passes Meta rules', () => {
    for (const t of all) {
      expect(metaTemplateProblems(t.payload), `${t.key}/${t.payload.language}`).toEqual([]);
    }
  });

  it('has body examples matching the placeholder count and a URL button where the catalogue has one', () => {
    for (const t of all) {
      const def = WHATSAPP_TEMPLATES[t.key];
      const body = t.payload.components.find((c) => c.type === 'BODY');
      expect(body?.type === 'BODY' && body.example.body_text[0]).toHaveLength(def.params.length);
      const buttons = t.payload.components.find((c) => c.type === 'BUTTONS');
      expect(Boolean(buttons)).toBe('urlParam' in def);
    }
  });

  it('has copy for every catalogue template', () => {
    for (const key of keys) expect(META_TEMPLATE_COPY[key], key).toBeDefined();
  });
});

describe('Meta rule checks', () => {
  const good = (): MetaTemplatePayload => ({
    name: 'order_confirmed',
    language: 'en',
    category: 'UTILITY',
    components: [
      { type: 'BODY', text: 'Your order {{1}} is confirmed.', example: { body_text: [['MD-1']] } },
    ],
  });
  const withBody = (text: string, examples: string[]): MetaTemplatePayload => ({
    ...good(),
    components: [{ type: 'BODY', text, example: { body_text: [examples] } }],
  });

  it('accepts a valid payload', () => {
    expect(metaTemplateProblems(good())).toEqual([]);
  });

  it('rejects a bad name', () => {
    expect(metaTemplateProblems({ ...good(), name: 'Order-Confirmed' })).toContain('name_pattern');
  });

  it('rejects a body over 1024 characters', () => {
    expect(metaTemplateProblems(withBody('a'.repeat(1025), []))).toContain('body_too_long');
  });

  it('rejects placeholders that skip a number', () => {
    expect(metaTemplateProblems(withBody('Order {{1}} and {{3}} done.', ['a', 'b']))).toContain(
      'placeholder_numbering',
    );
  });

  it('rejects a wrong number of examples', () => {
    expect(metaTemplateProblems(withBody('Order {{1}} done.', ['a', 'b']))).toContain('example_count');
  });

  it('rejects a body that starts or ends with a parameter', () => {
    expect(metaTemplateProblems(withBody('{{1}} is confirmed.', ['a']))).toContain('param_at_edge');
    expect(metaTemplateProblems(withBody('Your order is {{1}}', ['a']))).toContain('param_at_edge');
  });

  it('rejects offer wording in a utility template', () => {
    expect(metaTemplateProblems(withBody('Order {{1}} confirmed, enjoy a discount.', ['a']))).toContain(
      'promo_wording',
    );
  });

  it('rejects a long button label and a button URL without its example', () => {
    const p = good();
    p.components.push({
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: 'x'.repeat(26), url: 'https://mechdost.com/orders/{{1}}', example: [] }],
    });
    const problems = metaTemplateProblems(p);
    expect(problems).toContain('button_text_too_long');
    expect(problems).toContain('button_example');
  });
});

describe('Meta template list', () => {
  it('parses a Graph list and finds which templates are missing', () => {
    const list = parseMetaTemplateList({
      data: [
        { name: 'order_confirmed', language: 'en', status: 'APPROVED', category: 'UTILITY', id: '1' },
        { name: 'order_confirmed', language: 'hi', status: 'PENDING', category: 'UTILITY', id: '2' },
        { name: 'mechdost_otp', language: 'en', status: 'APPROVED', category: 'AUTHENTICATION', id: '3' },
      ],
    });
    expect(list.items).toHaveLength(3);
    expect(list.after).toBeNull();
    const paged = parseMetaTemplateList({
      data: [],
      paging: { cursors: { after: 'abc' }, next: 'https://graph.facebook.com/x?access_token=SECRET' },
    });
    // The `next` URL carries the access token, so only the cursor is ever used.
    expect(paged.after).toBe('abc');
    const missing = missingTemplates(buildMetaTemplates(), list.items);
    expect(missing.some((m) => m.key === 'order.confirmed')).toBe(false);
    expect(missing.some((m) => m.key === 'order.routed' && m.payload.language === 'hi')).toBe(true);
  });

  it('rejects a malformed list', () => {
    expect(() => parseMetaTemplateList({ data: [{ name: 1 }] })).toThrow();
  });

  it('maps Meta names back to catalogue keys, ignoring templates the catalogue does not own', () => {
    const map = statusesByKey([
      { name: 'order_confirmed', language: 'en', status: 'APPROVED', category: 'UTILITY' },
      { name: 'mechdost_otp', language: 'en', status: 'APPROVED', category: 'AUTHENTICATION' },
    ]);
    expect(map['order.confirmed']).toEqual({ en: 'approved' });
    expect(Object.keys(map)).toEqual(['order.confirmed']);
  });
});

describe('send gate', () => {
  it('is open before the first sync and only lets approved templates through afterwards', () => {
    expect(whatsAppTemplateApproved(null, 'order.confirmed', 'en')).toBe(true);
    const synced = { 'order.confirmed': { en: 'approved', hi: 'pending' } } as const;
    expect(whatsAppTemplateApproved(synced, 'order.confirmed', 'en')).toBe(true);
    expect(whatsAppTemplateApproved(synced, 'order.confirmed', 'hi')).toBe(false);
    expect(whatsAppTemplateApproved(synced, 'order.routed', 'en')).toBe(false);
  });
});

describe('quote templates reach Meta (2026-11-16 merge: quote catalogue entries had no Meta copy)', () => {
  it('builds every catalogue template with a body, a sample per variable and a button when it links', () => {
    const built = buildMetaTemplates();
    for (const name of ['quote_price_ready', 'quote_reply', 'quote_price_ending', 'quote_closed'])
      for (const language of ['en', 'hi'])
        expect(
          built.some((t) => t.payload.name === name && t.payload.language === language),
          `${name} ${language}`,
        ).toBe(true);
    const ready = built.find((t) => t.payload.name === 'quote_price_ready' && t.payload.language === 'en');
    expect(JSON.stringify(ready)).toContain('QT-RPR-2026');
    expect(JSON.stringify(ready)).toContain('/quotes/{{1}}');
  });
});
