/** Real-API QA pass 2 (2026-11-16) bug fixes: unit and source-level guards, one block per bug. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { avatarMark } from '../src/demo/session-state';
import { razorpayPrefill } from '../src/lib/payments/pay-online';
import { afterPhotoMissing, hourHasStarted, thanksHeadlineShown } from '../src/lib/service-views';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('bug 3: prices follow the shops the portal lists', () => {
  const src = read('components/portal/shop-prices-api.tsx');
  it('reads the shops from /shop/me like the portal header, not the first role', () => {
    expect(src).toMatch(/'\/shop\/me'/);
    expect(src).not.toMatch(/shopIdsOf\(/);
  });
  it('shows one prices block per shop', () => {
    expect(src).toMatch(/shops\?\.map\(/);
  });
});

describe('bug 4: Place order while prices load', () => {
  const src = read('components/commerce/checkout-form.tsx');
  it('is disabled and aria-busy with a visible label while the quote loads', () => {
    expect(src).toMatch(/const checkingPrices = realData && pricing\.status === 'loading'/);
    expect(src).toMatch(/disabled=\{submitting \|\| checkingPrices/);
    expect(src).toMatch(/aria-busy=\{submitting \|\| checkingPrices\}/);
    expect(src).toMatch(/t\('checking'\)/);
  });
  it('has the label in both languages', () => {
    expect(en.checkout.checking).toBeTruthy();
    expect(hi.checkout.checking).toMatch(/[ऀ-ॿ]/);
  });
});

describe('bug 5: past hours', () => {
  // 2026-11-16 10:30 IST = 05:00 UTC
  const now = new Date('2026-11-16T05:00:00Z');
  it('hides hours that started today (IST), like the server', () => {
    expect(hourHasStarted('2026-11-16', 9, now)).toBe(true);
    expect(hourHasStarted('2026-11-16', 10, now)).toBe(true);
    expect(hourHasStarted('2026-11-16', 11, now)).toBe(false);
  });
  it('never hides hours of another day', () => {
    expect(hourHasStarted('2026-11-17', 6, now)).toBe(false);
  });
  it('uses the IST day, not the UTC day', () => {
    // 2026-11-16 23:30 UTC is already 17 Nov 05:00 IST.
    expect(hourHasStarted('2026-11-17', 5, new Date('2026-11-16T23:30:00Z'))).toBe(true);
    expect(hourHasStarted('2026-11-16', 23, new Date('2026-11-16T23:30:00Z'))).toBe(false);
  });
});

describe('bug 6: ready needs an after photo', () => {
  it('is missing only when required and no after photo exists', () => {
    expect(afterPhotoMissing({ required: true, photos: [{ stage: 'before' }] })).toBe(true);
    expect(afterPhotoMissing({ required: true, photos: [{ stage: 'after' }] })).toBe(false);
    expect(afterPhotoMissing({ required: false, photos: [] })).toBe(false);
  });
  it('the button is disabled with the reason shown', () => {
    const src = read('components/portal/workshop-job-api.tsx');
    expect(src).toMatch(/action === 'ready' && needsAfter/);
    expect(src).toMatch(/err_PHOTOS_REQUIRED_after/);
    expect(hi.photos.err_PHOTOS_REQUIRED_after).toMatch(/[ऀ-ॿ]/);
  });
});

describe('bug 7: the "Request sent" headline follows the status', () => {
  it('shows while the request waits for a proposal only', () => {
    expect(thanksHeadlineShown('requested')).toBe(true);
    expect(thanksHeadlineShown('needs_routing')).toBe(true);
    expect(thanksHeadlineShown('awaiting_workshop')).toBe(true);
    expect(thanksHeadlineShown('completed')).toBe(false);
    expect(thanksHeadlineShown('paid')).toBe(false);
    expect(thanksHeadlineShown('cancelled')).toBe(false);
  });
});

describe('bug 8: estimate line description once', () => {
  it('has no second hidden copy of the description in the review form', () => {
    const src = read('components/workshops/service-estimate-api.tsx');
    expect(src).not.toMatch(/<legend className="sr-only"/);
    expect(src).toMatch(/aria-labelledby=\{`\$\{formId\}-\$\{l\.id\}-desc`\}/);
  });
});

describe('bug 9: Razorpay prefill from the account', () => {
  it('carries name, email and contact, leaving out empty parts', () => {
    expect(razorpayPrefill({ name: ' Asha ', email: 'a@b.in', contact: '+919876543210' })).toEqual({
      name: 'Asha',
      email: 'a@b.in',
      contact: '+919876543210',
    });
    expect(razorpayPrefill({ name: '', email: null, contact: '+91' })).toEqual({ contact: '+91' });
  });
  it('is used by checkout, quote and bill payments', () => {
    expect(read('lib/payments/pay-online.ts')).toMatch(/accountPrefill\(\)/);
    expect(read('lib/payments/pay-bill.ts')).toMatch(/prefill,/);
    expect(read('lib/payments/pay-quote.ts')).toMatch(/accountPrefill\(\)/);
  });
});

describe('bug 10: the service page catches up when its tab is shown again', () => {
  it('refreshes on visibilitychange as well as on the poll and live pings', () => {
    const src = read('components/workshops/request-view-api.tsx');
    expect(src).toMatch(/addEventListener\('visibilitychange'/);
    expect(src).toMatch(/useLivePings\(/);
  });
});

describe('bug 11: header avatar without a name', () => {
  it('has an initial for a named account and none for an empty one', () => {
    expect(avatarMark('rakesh sharma')).toEqual({ first: 'rakesh', initial: 'R' });
    expect(avatarMark('')).toEqual({ first: '', initial: null });
    expect(avatarMark('   ')).toEqual({ first: '', initial: null });
  });
});

describe('first-load chunk guards (JS budget, spec 16; 2026-11-16)', () => {
  // Each of these new import edges split the shared first-load chunks: one extra chunk, +0.5 KB gz on every page.
  it('service-views (in the home page graph) does not import the shared IST helpers', () => {
    expect(read('lib/service-views.ts')).not.toMatch(/from '@mechdost\/shared\/time'/);
  });
  it('the header account link takes its avatar helper from session-state, not a module of its own', () => {
    expect(read('components/auth/account-link.tsx')).toMatch(
      /avatarMark, homeFor, useSession \} from '@\/demo\/session-state'/,
    );
  });
});
