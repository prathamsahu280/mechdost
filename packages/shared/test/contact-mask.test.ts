import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone, redactAuditJson, searchKind } from '../src/contact-mask';

describe('contact masking (spec 13: support sees the last 4 digits)', () => {
  it('keeps only the last 4 digits of a phone number', () => {
    expect(maskPhone('+919876543210')).toBe('••••••3210');
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('123')).toBe('••••');
  });
  it('keeps the first letter and the domain of an email', () => {
    expect(maskEmail('rahul.sharma@example.com')).toBe('r•••@example.com');
    expect(maskEmail('a@b.in')).toBe('a•••@b.in');
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('no-at-sign')).toBe('•••');
  });
});

describe('audit JSON redaction (the viewer never shows contact details)', () => {
  it('masks phone and email keys and hides address and bank keys at any depth', () => {
    const out = redactAuditJson({
      name: 'Asha',
      phone: '+919876543210',
      nested: { email: 'asha@example.com', contactPhone: '+919811111111', line1: '12 MG Road' },
      list: [{ guestPhone: '+919822222222' }, 'plain'],
      destinationEnc: 'xxx',
    });
    expect(out).toEqual({
      name: 'Asha',
      phone: '••••••3210',
      nested: { email: 'a•••@example.com', contactPhone: '••••••1111', line1: '[hidden]' },
      list: [{ guestPhone: '••••••2222' }, 'plain'],
      destinationEnc: '[hidden]',
    });
    expect(redactAuditJson(null)).toBeNull();
    expect(redactAuditJson(7)).toBe(7);
  });
});

describe('search query kind', () => {
  it('classifies code, email, phone and name', () => {
    expect(searchKind('MD-RPR-2026-7K3Q9X')).toEqual({ kind: 'code', value: 'MD-RPR-2026-7K3Q9X' });
    expect(searchKind('MD-RPR-2026-7K3Q9X-2')).toEqual({ kind: 'code', value: 'MD-RPR-2026-7K3Q9X-2' });
    expect(searchKind(' sr-rpr-2026-23456k ')).toEqual({ kind: 'code', value: 'SR-RPR-2026-23456K' });
    expect(searchKind('req-rpr-2026-000z01')).toEqual({ kind: 'code', value: 'REQ-RPR-2026-000Z01' });
    expect(searchKind('Asha@Example.com')).toEqual({ kind: 'email', value: 'asha@example.com' });
    expect(searchKind('+91 98765-43210')).toEqual({ kind: 'phone', value: '9876543210' });
    expect(searchKind('9876543210')).toEqual({ kind: 'phone', value: '9876543210' });
    expect(searchKind('Ash')).toEqual({ kind: 'name', value: 'ash' });
  });
  it('refuses queries that are too short or are partial numbers', () => {
    expect(searchKind('a')).toBeNull();
    expect(searchKind('98765')).toBeNull();
    expect(searchKind('   ')).toBeNull();
    expect(searchKind('x'.repeat(101))).toBeNull();
  });
});
