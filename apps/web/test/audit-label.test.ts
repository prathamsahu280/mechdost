import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { ACTION_CODES, ENTITY_CODES, auditLabel, type AuditDict } from '../src/lib/audit-label';

const dict = (locale: typeof en): AuditDict => ({
  word: (t) => (locale.adminPeople.auditWord as Record<string, string>)[t] ?? null,
  action: (k) => (locale.adminPeople.auditAction as Record<string, string>)[k] ?? null,
});

describe('audit code labels', () => {
  it('words an action code token by token, first letter capital', () => {
    expect(auditLabel('role.granted', dict(en))).toEqual({ text: 'Role granted', known: true });
    expect(auditLabel('setting.saved', dict(hi))).toEqual({ text: 'सेटिंग सहेजा गया', known: true });
  });

  it('prefers a whole-code wording over the token-by-token one', () => {
    expect(auditLabel('order.given_up_by_shop', dict(en)).text).toBe('Order given back by the shop');
  });

  it('shows an unknown code as typed and says so', () => {
    expect(auditLabel('mystery.thing', dict(hi))).toEqual({ text: 'mystery.thing', known: false });
  });

  it.each([
    ['en', en],
    ['hi', hi],
  ] as const)('every known entity and action has a %s label', (_n, locale) => {
    for (const code of [...ENTITY_CODES, ...ACTION_CODES]) {
      expect(auditLabel(code, dict(locale)).known, code).toBe(true);
    }
  });

  it('Hindi labels hold no Latin letters except CSV', () => {
    for (const code of [...ENTITY_CODES, ...ACTION_CODES]) {
      const { text } = auditLabel(code, dict(hi));
      expect(text.replace(/CSV/g, ''), code).not.toMatch(/[A-Za-z]/);
    }
  });
});
