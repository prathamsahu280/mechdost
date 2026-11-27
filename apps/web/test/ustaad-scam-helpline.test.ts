import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

// QA simulation 2026-11-27 (audit #4): the job scam warning must name India's cyber crime helpline and portal.
describe('Ustaad jobs scam line names the cyber crime helpline', () => {
  it.each([
    ['en', en.ustaad.jobs.scam],
    ['hi', hi.ustaad.jobs.scam],
  ])('%s', (_l, text) => {
    expect(text).toContain('1930');
    expect(text).toContain('cybercrime.gov.in');
  });
});
