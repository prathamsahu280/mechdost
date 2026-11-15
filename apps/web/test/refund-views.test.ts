import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { refundFailureKey } from '../src/lib/refund-views';

describe('refund failure wording', () => {
  it('words the codes MechDost and Razorpay send, in any letter case', () => {
    expect(refundFailureKey('BAD_REQUEST_ERROR')).toBe('failure_bad_request_error');
    expect(refundFailureKey('razorpay_failed')).toBe('failure_razorpay_failed');
    expect(refundFailureKey('dispatch_exhausted')).toBe('failure_dispatch_exhausted');
  });

  it('falls back to one general wording, never the raw code', () => {
    expect(refundFailureKey('SOMETHING_NEW')).toBe('failure_other');
    expect(refundFailureKey('')).toBe('failure_other');
  });

  it.each([
    ['en', en],
    ['hi', hi],
  ] as const)('every key exists in %s and Hindi has no Latin words', (name, locale) => {
    const refunds = locale.refunds as Record<string, string>;
    for (const code of [
      'bad_request_error',
      'gateway_error',
      'server_error',
      'razorpay_failed',
      'dispatch_exhausted',
      'provider_amount_mismatch',
      'payment_not_captured',
      'other',
    ]) {
      const text = refunds[`failure_${code}`];
      expect(text, `${name} ${code}`).toBeTruthy();
      if (name === 'hi') expect(text?.replace(/Razorpay/g, '')).not.toMatch(/[A-Za-z]/);
    }
    expect(refunds.reconcileNote).toContain('{reason}');
    expect(refunds.failureNote).toContain('{reason}');
  });
});
