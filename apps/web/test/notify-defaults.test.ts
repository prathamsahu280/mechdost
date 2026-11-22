import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/notify-templates/en.json';
import hi from '../../../packages/shared/src/notify-templates/hi.json';
import { WHATSAPP_EVENTS, bodyProblem, preview } from '../src/demo/notification-settings';

/** The default WhatsApp texts we ship must pass the same checks staff face (utility wording, exact placeholders). */
function lookup(tree: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree);
}

describe('default WhatsApp message texts', () => {
  for (const [locale, messages] of [
    ['en', en],
    ['hi', hi],
  ] as const) {
    it(`are valid utility templates in ${locale}`, () => {
      for (const event of WHATSAPP_EVENTS) {
        const body = lookup(messages, event);
        expect(typeof body, `${locale} ${event}`).toBe('string');
        expect(bodyProblem(event, String(body)), `${locale} ${event}`).toBeNull();
      }
    });
  }

  it('previews fill every placeholder', () => {
    expect(preview('Order {{1}}, code {{2}}', ['MD-RPR-2026-7K3QWX', '4821'])).toBe(
      'Order MD-RPR-2026-7K3QWX, code 4821',
    );
    expect(preview('Order {{1}} {{3}}', ['A'])).toBe('Order A {{3}}');
  });
});
