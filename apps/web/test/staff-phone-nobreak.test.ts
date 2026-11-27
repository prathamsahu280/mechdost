import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';

// SIM-LEAD-4 (live QA 2026-11-27): on the staff two-step the phone broke between "+91" and "••••••0005". The country
// code and the number are joined by a no-break space in both languages.
describe('staff two-step phone never breaks after +91 (SIM-LEAD-4)', () => {
  it.each([
    ['en', en],
    ['hi', hi],
  ])('%s', (_l, m) => {
    const lead = (m as { auth?: { staffLead?: string } }).auth?.staffLead ?? '';
    expect(lead).toContain('+91 {phone}');
    expect(lead).not.toContain('+91 {phone}');
  });
});
