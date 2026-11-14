import { describe, expect, it } from 'vitest';
import { formatDateTimeIst, peopleErrorKey, statusOf } from '../src/lib/admin-people-view';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

describe('admin people helpers', () => {
  it('maps the API codes of the three screens to their own messages, others to null', () => {
    expect(peopleErrorKey('STAFF_SELF_CHANGE')).toBe('err_selfChange');
    expect(peopleErrorKey('LAST_SUPER_ADMIN')).toBe('err_lastSuperAdmin');
    expect(peopleErrorKey('SEARCH_QUERY')).toBe('err_search');
    expect(peopleErrorKey('INVALID_CURSOR')).toBe('err_cursor');
    expect(peopleErrorKey('RATE_LIMITED')).toBeNull();
  });

  it('every mapped error key exists in both languages', () => {
    for (const code of [
      'STAFF_SELF_CHANGE',
      'ROLE_SUPER_ADMIN_ONLY',
      'LAST_SUPER_ADMIN',
      'ROLE_ALREADY_HELD',
      'ROLE_SCOPE',
      'ROLE_NOT_STAFF',
      'PHONE_INVALID',
      'REASON_REQUIRED',
      'NOT_FOUND',
      'VALIDATION',
      'SEARCH_QUERY',
      'AUDIT_CODE',
      'AUDIT_DATE',
      'AUDIT_FILTER',
      'INVALID_CURSOR',
    ]) {
      const key = peopleErrorKey(code);
      expect(key, code).not.toBeNull();
      if (key) {
        expect(Object.hasOwn(en.adminPeople, key), `${key} en`).toBe(true);
        expect(Object.hasOwn(hi.adminPeople, key), `${key} hi`).toBe(true);
      }
    }
  });

  it('keeps the two namespaces in step', () => {
    expect(Object.keys(hi.adminPeople).sort()).toEqual(Object.keys(en.adminPeople).sort());
  });

  it('narrows a value to a list member only', () => {
    expect(statusOf(['a', 'b'] as const, 'a')).toBe('a');
    expect(statusOf(['a', 'b'] as const, 'zzz')).toBeUndefined();
  });

  it('formats a date-time in Indian time', () => {
    expect(formatDateTimeIst('2026-01-01T20:00:00Z', 'en')).toMatch(/2 Jan 2026/);
  });
});
