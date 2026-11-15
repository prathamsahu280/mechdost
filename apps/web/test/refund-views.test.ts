import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { refundErrorKey, refundFailureKey, settleBody } from '../src/lib/refund-views';

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

describe('settling an unsure refund (form to request body)', () => {
  const base = {
    reasonCode: 'dashboard_checked',
    note: 'Checked the Razorpay dashboard',
    providerRefundId: '',
    amount: '',
  } as const;

  it('not refunded needs only a reason and a note of at least ten characters', () => {
    expect(settleBody(3, { ...base, outcome: 'not_refunded' })).toEqual({
      ok: true,
      body: {
        version: 3,
        outcome: 'not_refunded',
        reasonCode: 'dashboard_checked',
        note: 'Checked the Razorpay dashboard',
      },
    });
    expect(settleBody(3, { ...base, outcome: 'not_refunded', note: 'too short' })).toEqual({
      ok: false,
      error: 'note',
    });
  });

  it('refunded in full needs a Razorpay refund id unless we already hold one', () => {
    expect(settleBody(3, { ...base, outcome: 'refunded_full' })).toEqual({
      ok: false,
      error: 'providerRefundId',
    });
    expect(settleBody(3, { ...base, outcome: 'refunded_full', providerRefundId: 'rfnd_bad id' })).toEqual({
      ok: false,
      error: 'providerRefundId',
    });
    expect(settleBody(3, { ...base, outcome: 'refunded_full' }, { hasProviderId: true }).ok).toBe(true);
    const ok = settleBody(3, { ...base, outcome: 'refunded_full', providerRefundId: ' rfnd_Abc123XyZ ' });
    expect(ok).toMatchObject({ ok: true, body: { providerRefundId: 'rfnd_Abc123XyZ' } });
  });

  it('another amount is typed in rupees and sent as integer paise', () => {
    const r = settleBody(3, {
      ...base,
      outcome: 'refunded_other_amount',
      providerRefundId: 'rfnd_Abc123XyZ',
      amount: '₹1,234.50',
    });
    expect(r).toMatchObject({ ok: true, body: { providerAmountPaise: 123450 } });
    expect(
      settleBody(3, {
        ...base,
        outcome: 'refunded_other_amount',
        providerRefundId: 'rfnd_Abc123XyZ',
        amount: 'abc',
      }),
    ).toEqual({
      ok: false,
      error: 'amount',
    });
  });

  it('words the new API codes and never shows a raw code', () => {
    expect(refundErrorKey('PROVIDER_HOLDS_REFUND')).toBe('err_PROVIDER_HOLDS_REFUND');
    expect(refundErrorKey('NOT_UNSURE')).toBe('err_NOT_UNSURE');
    expect(refundErrorKey('AMOUNT_DIFFERS_FROM_REPORT')).toBe('err_AMOUNT_DIFFERS_FROM_REPORT');
    expect(refundFailureKey('settled_by_hand')).toBe('failure_settled_by_hand');
  });

  it.each([
    ['en', en],
    ['hi', hi],
  ] as const)(
    'every settle string exists in %s; Hindi has no Latin words but the brand and codes',
    (name, locale) => {
      const refunds = locale.refunds as Record<string, string>;
      const keys = [
        'settleOpen',
        'settleTitle',
        'settleIntro',
        'settleOutcomeLabel',
        'settleOutcome_refunded_full',
        'settleOutcome_refunded_other_amount',
        'settleOutcome_not_refunded',
        'settleReasonLabel',
        'settleReason_dashboard_checked',
        'settleReason_provider_support_confirmed',
        'settleReason_bank_statement_checked',
        'settleReason_duplicate_found',
        'settleReason_other',
        'settleNoteLabel',
        'settleNoteHint',
        'settleProviderIdLabel',
        'settleProviderIdHint',
        'settleAmountLabel',
        'settleAmountHint',
        'settleConfirm',
        'settleBusy',
        'settleCancel',
        'settled',
        'settleFourEyes',
        'settledBy',
        'creditNote',
        'source_payment_after_close',
        'reason_payment_after_close',
        'failure_settled_by_hand',
        'err_PROVIDER_HOLDS_REFUND',
        'err_PROVIDER_REFUND_ID_REQUIRED',
        'err_PROVIDER_AMOUNT_REQUIRED',
        'err_AMOUNT_DIFFERS_FROM_REPORT',
        'err_AMOUNT_SAME',
        'err_REFUND_EXCEEDS_PAYMENT',
        'err_NOT_UNSURE',
        'err_PROVIDER_ID_DIFFERS',
        'err_SETTLE_NOTE',
        'err_SETTLE_PROVIDER_ID',
        'err_SETTLE_AMOUNT',
      ];
      for (const key of keys) {
        const text = refunds[key];
        expect(text, `${name} ${key}`).toBeTruthy();
        if (name === 'hi')
          expect(text?.replace(/Razorpay|rfnd_|UTR|CN|\{[a-z]+\}/g, '')).not.toMatch(/[A-Za-z]/);
      }
      const portal = locale.portal as Record<string, string>;
      expect(portal.kpi_refundsWaiting).toBeTruthy();
      expect(portal.kpi_refundsChecking).toBeTruthy();
    },
  );
});
