/**
 * Delivery + COD QA batch DC (2026-11-27 simulations, docs/qa/qa-backlog-2026-11-27.md): the shared contract and
 * notice parts. One block per row id.
 */
import { describe, expect, it } from 'vitest';
import {
  DELIVERY_APPLICATION_REJECT_REASONS,
  SHOP_MODE_REASONS_BY_TARGET,
  SHOP_MODE_REQUEST_REASONS,
  shopModeReasonFits,
} from '../src/delivery/codes';
import { AdminJobRow, AgentInviteInput, AgentSuggestion, ShopModeRequestInput } from '../src/delivery/api';
import { CodEligibilityDto } from '../src/cod-api';
import { composeNotice, deliveryNoticeWord, noticeLink } from '../src/notice-catalogue';
import en from '../src/i18n/en.json';
import hi from '../src/i18n/hi.json';

describe('DC-P7 shop mode reasons by direction', () => {
  it('every reason belongs to a direction, and the lists do not mix the two meanings', () => {
    const all = [...SHOP_MODE_REASONS_BY_TARGET.self, ...SHOP_MODE_REASONS_BY_TARGET.agents];
    for (const r of SHOP_MODE_REQUEST_REASONS) expect(all).toContain(r);
    expect(shopModeReasonFits('self', 'own_riders')).toBe(true);
    expect(shopModeReasonFits('agents', 'own_riders')).toBe(false);
    expect(shopModeReasonFits('agents', 'wider_area')).toBe(true);
    expect(shopModeReasonFits('self', 'wider_area')).toBe(false);
    expect(shopModeReasonFits('agents', 'other')).toBe(true);
  });

  it('the request body is refused when the reason is for the other direction, and other still needs a note', () => {
    expect(ShopModeRequestInput.safeParse({ requestedMode: 'agents', reasonCode: 'no_riders' }).success).toBe(
      true,
    );
    expect(ShopModeRequestInput.safeParse({ requestedMode: 'self', reasonCode: 'no_riders' }).success).toBe(
      false,
    );
    expect(ShopModeRequestInput.safeParse({ requestedMode: 'agents', reasonCode: 'other' }).success).toBe(
      false,
    );
  });

  it('every reason has English and Hindi words', () => {
    for (const lang of [en, hi] as unknown as {
      delivery: { shopModeRequestReason: Record<string, string> };
    }[])
      for (const r of SHOP_MODE_REQUEST_REASONS) expect(lang.delivery.shopModeRequestReason[r]).toBeTruthy();
  });
});

describe('DC-B5 / DC-B4 application reject reasons and invite email', () => {
  it('has words for each rider reject reason in both languages', () => {
    for (const lang of [en, hi] as unknown as { portal: Record<string, string> }[])
      for (const r of DELIVERY_APPLICATION_REJECT_REASONS) expect(lang.portal[`appReject_${r}`]).toBeTruthy();
    expect(DELIVERY_APPLICATION_REJECT_REASONS).not.toContain('documents_invalid');
    expect(DELIVERY_APPLICATION_REJECT_REASONS).not.toContain('not_a_business');
  });

  it('an invite from an application may carry an email, and only a valid one', () => {
    const code = 'PA-RPR-2026-ABCDEF';
    expect(AgentInviteInput.safeParse({ applicationCode: code }).success).toBe(true);
    const ok = AgentInviteInput.safeParse({ applicationCode: code, email: ' Raju@Example.com ' });
    expect(ok.success && 'email' in ok.data ? ok.data.email : null).toBe('raju@example.com');
    expect(AgentInviteInput.safeParse({ applicationCode: code, email: 'nope' }).success).toBe(false);
  });
});

describe('DC-B10 / DC-B13 / DC-P15 contract fields', () => {
  it('suggestions default to eligible; the queue row and Hindi fields default to null', () => {
    const s = AgentSuggestion.parse({
      agentId: '0198e0a0-0000-7000-8000-000000000001',
      name: 'Raju',
      vehicleType: 'bike',
      distanceM: null,
      activeJobs: 0,
      acceptanceRateBp: null,
      carriesLoad: true,
      ratingAvgX10: null,
      ratingCount: 0,
    });
    expect(s).toMatchObject({ eligible: true, declinedBefore: false });
    expect(AdminJobRow.shape.shopNameHi).toBeDefined();
  });
});

describe('DC-P6 the COD eligibility answer may carry the date to ask again', () => {
  it('accepts an ISO date, null, or nothing (older servers)', () => {
    const base = { eligible: false, via: null, reason: 'rejected', canRequest: false, capPaise: null };
    expect(CodEligibilityDto.safeParse({ ...base, askAgainAt: '2026-12-04T10:00:00.000Z' }).success).toBe(
      true,
    );
    expect(CodEligibilityDto.safeParse({ ...base, askAgainAt: null }).success).toBe(true);
    expect(CodEligibilityDto.safeParse(base).success).toBe(true);
  });
});

describe('DC-P16 delivery notices say what changed and open the profile', () => {
  it('the status notice names the status in each language', () => {
    expect(deliveryNoticeWord('en', 'agentStatus', 'suspended')).toBe('Suspended');
    expect(deliveryNoticeWord('hi', 'agentStatus', 'suspended')).toBe('निलंबित');
    const copy = composeNotice('delivery.status_changed', 'en', { status: 'Suspended' });
    expect(copy.body).toContain('Suspended');
    const hiCopy = composeNotice('delivery.status_changed', 'hi', { status: 'निलंबित' });
    expect(hiCopy.body).toContain('निलंबित');
  });

  it('the document notice names the document and the result', () => {
    const copy = composeNotice('delivery.document_decided', 'en', {
      document: deliveryNoticeWord('en', 'document.kind', 'pan'),
      result: deliveryNoticeWord('en', 'document.status', 'rejected'),
    });
    expect(copy.body).toContain('PAN card');
    expect(copy.body).toContain('Not accepted');
  });

  it('both notices open the profile page, with the language prefix', () => {
    expect(noticeLink('delivery.status_changed', 'en', {})).toBe('/partner/delivery/profile');
    expect(noticeLink('delivery.document_decided', 'hi', {})).toBe('/hi/partner/delivery/profile');
  });
});
