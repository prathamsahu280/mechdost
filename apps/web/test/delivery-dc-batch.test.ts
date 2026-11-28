/**
 * Delivery + COD QA batch DC (2026-11-27 simulations, docs/qa/qa-backlog-2026-11-27.md). One block per row id. The
 * screens are guarded by source checks (no browser here) plus the pure helpers they use.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { codChoice, isCheckoutBuyer } from '../src/lib/cod-view';

type Ns = Record<string, Record<string, string>>;
const src = (p: string) => readFileSync(p, 'utf8');
const both = [en, hi] as unknown as Ns[];
const admin = () => src('src/components/delivery/admin-delivery.tsx');

describe('DC-P14 / DC-B9 checkout treats every account that may buy as a buyer', () => {
  it('only shop accounts are refused in real data; the demo knows customers only', () => {
    expect(isCheckoutBuyer('workshop', true)).toBe(true);
    expect(isCheckoutBuyer('delivery_agent', true)).toBe(true);
    expect(isCheckoutBuyer('admin', true)).toBe(true);
    expect(isCheckoutBuyer('customer', true)).toBe(true);
    expect(isCheckoutBuyer('shop', true)).toBe(false);
    expect(isCheckoutBuyer(undefined, true)).toBe(false);
    expect(isCheckoutBuyer('workshop', false)).toBe(false);
    expect(isCheckoutBuyer('customer', false)).toBe(true);
    expect(src('src/components/commerce/checkout-form.tsx')).toContain('isCheckoutBuyer(session.role, true)');
  });
});

describe('DC-P6 ask again on a date', () => {
  it('codChoice carries the date only while a turned-down customer waits', () => {
    const quote = (askAgainAt?: string) => ({
      totalPaise: 1000,
      cod: {
        allowed: false,
        reason: null,
        capPaise: 500_000,
        eligibility: {
          eligible: false,
          reason: 'rejected' as const,
          canRequest: false,
          ...(askAgainAt ? { askAgainAt } : {}),
        },
      },
    });
    expect(codChoice(quote('2026-12-04T10:00:00.000Z'), { discountPaise: 0, pieces: 1 }).askAgainAt).toBe(
      '2026-12-04T10:00:00.000Z',
    );
    expect(codChoice(quote(), { discountPaise: 0, pieces: 1 })).not.toHaveProperty('askAgainAt');
    for (const m of both) expect(m.checkout?.codAskAgain).toContain('{date}');
    expect(src('src/components/account/account-payments.tsx')).toContain("c('codAskAgain'");
  });
});

describe('DC-B8 stale COD decision', () => {
  it('the words live in the result region outside the card that refresh removes', () => {
    const s = src('src/components/portal/admin-cod-requests.tsx');
    expect(s).toContain('setStale(true)');
    expect(s).toMatch(/stale\s*\?\s*t\('err_STALE_COD_REQUEST'\)/);
  });
});

describe('DC-B4 invite and revoke confirm inline', () => {
  it('Invite opens a panel with a summary and an email field; Revoke asks first; no WhatsApp claim', () => {
    const s = admin();
    expect(s).toContain("t('inviteConfirm'");
    expect(s).toContain("t('revokeConfirm'");
    expect(s).not.toMatch(/onClick=\{\(\) => void invite\(a\.code\)\}\s*>\s*\{t\('invite'\)\}/);
    for (const m of both) {
      expect(m.deliveryAdmin?.inviteConfirm).toBeTruthy();
      expect(m.deliveryAdmin?.revokeConfirm).toBeTruthy();
      expect(m.deliveryAdmin?.inviteSent).not.toMatch(/WhatsApp|व्हाट्सऐप/);
    }
  });
});

describe('DC-B5 application reject and the vehicle placeholder', () => {
  it('uses the rider reasons with a note and says "Choose a vehicle"', () => {
    const s = admin();
    expect(s).toContain('DELIVERY_APPLICATION_REJECT_REASONS');
    expect(s).toContain("t('vehicleChoose')");
    for (const m of both) expect(m.deliveryAdmin?.vehicleChoose).toBeTruthy();
  });
});

describe('DC-B10 suggestions', () => {
  it('only an eligible agent gets an Offer button; the others say why', () => {
    const s = admin();
    expect(s).toContain('{a.eligible ? (');
    expect(s).toContain("t('suggestionDeclined')");
    for (const m of both) {
      expect(m.deliveryAdmin?.suggestionDeclined).toBeTruthy();
      expect(m.deliveryAdmin?.suggestionBusy).toBeTruthy();
    }
  });
});

describe('DC-B13 / DC-P15 Hindi', () => {
  it('the queue, request list and rider screens pick the Hindi name on /hi', () => {
    expect(admin()).toContain('j.shopNameHi : j.shopName');
    expect(src('src/components/delivery/agent-job.tsx')).toContain('i.nameHi');
    expect(src('src/components/delivery/agent-job.tsx')).toContain('c.areaHi');
    expect(src('src/components/delivery/agent-portal.tsx')).toContain('job.shopAreaHi');
  });

  it('Hindi times are 24-hour (the hi-IN clock prints "pm")', () => {
    const f = new Intl.DateTimeFormat('hi-IN', {
      timeStyle: 'short',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    }).format(new Date('2026-11-27T10:29:00Z'));
    expect(f).not.toMatch(/am|pm/i);
    for (const file of ['admin-delivery', 'agent-portal', 'customer-delivery'])
      expect(src(`src/components/delivery/${file}.tsx`)).toContain("hour12: locale !== 'hi'");
  });

  it('a finished job shows no waiting clock', () => {
    expect(admin()).toContain("t('waitingNone')");
  });
});

describe('DC-F2 verify only after viewing', () => {
  it('the Verify button is aria-disabled until the document was opened', () => {
    expect(admin()).toContain('aria-disabled={view === null}');
    for (const m of both) expect(m.deliveryAdmin?.docViewFirst).toBeTruthy();
  });
});

describe('DC-B14 tries and confirm', () => {
  it('says "n of max tries failed" and confirms retry and send-back inline', () => {
    const s = admin();
    expect(s).toContain("t('triesFailed'");
    expect(s).toContain('decideConfirm_');
    for (const m of both) {
      expect(m.deliveryAdmin?.triesFailed).toContain('{max}');
      expect(m.deliveryAdmin?.decideConfirm_return).toBeTruthy();
    }
  });
});

describe('DC-G1 staff set a shop delivery mode directly', () => {
  it('the admin client calls PUT /admin/shops/{id}/delivery-mode and the Requests tab shows the card', () => {
    const c = src('src/lib/delivery/api-clients.ts');
    expect(c).toContain('/delivery-mode`');
    expect(c).toContain("method: 'PUT'");
    expect(admin()).toContain('<ShopModeSet client={client} />');
  });
});

describe('SIM-LEAD-7 job filters', () => {
  it('are outlined chips with counts, quieter than the section tabs', () => {
    const s = admin();
    expect(s).toContain('counts[v]');
    expect(s).toContain('client.jobCounts()');
    expect(src('src/lib/delivery/api-clients.ts')).toContain('/admin/delivery/job-counts');
  });
});

describe('DC-P12 delivery rating', () => {
  it('keeps the saved rating and its new version, and words a stale save', () => {
    expect(src('src/components/delivery/customer-delivery-api.tsx')).toContain('setSaved(');
    expect(src('src/components/delivery/customer-delivery.tsx')).toContain("'rateStale'");
    for (const m of both) expect(m.deliveryCustomer?.rateStale).toBeTruthy();
  });
});

describe('DC-B12 payout correction', () => {
  it('says "already corrected" in both languages', () => {
    expect(src('src/components/delivery/admin-delivery-payouts.tsx')).toContain('payoutAlreadyCorrected');
    for (const m of both)
      expect(
        m.deliveryAdmin?.payoutAlreadyCorrected ?? m.deliveryPayouts?.payoutAlreadyCorrected,
      ).toBeTruthy();
  });
});

describe('DC-F1 already applied', () => {
  it('the apply form shows the existing reference', () => {
    expect(src('src/components/delivery/agent-apply-form.tsx')).toContain('alreadyBody');
    for (const m of both) expect(m.deliveryApply?.alreadyBody).toContain('{code}');
  });
});
