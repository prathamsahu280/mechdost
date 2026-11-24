import { describe, expect, it } from 'vitest';
import {
  RSA_DEFAULT_ADVANCE_PAISE,
  defaultRsaSettings,
  rsaBalancePaise,
  rsaLineTotalPaise,
  rsaOpenAt,
  rsaOverpaidPaise,
} from '../src/rsa';
import { CreateRsaRequestBody, RsaBillBody, RsaCodeParam, RsaSettingsInput } from '../src/rsa-api';
import { REFUND_REASONS, REFUND_SOURCES, RSA_STATES, rsaMachine, rsaOfferMachine } from '../src/state';
import { publicCode } from '../src/ids';
import { EMAIL_TEMPLATES, composeEmail, sampleEmailParams } from '../src/email-templates';
import { WHATSAPP_TEMPLATES, placeholderProblem, utilityTemplateProblem } from '../src/whatsapp';
import { buildMetaTemplates, whatsAppBodyText } from '../src/whatsapp-meta';

const create = {
  vehicleType: '2W',
  fuel: 'petrol',
  lat: 21.25,
  lng: 81.63,
  pincode: '492001',
};

describe('rsaMachine', () => {
  it('walks the happy path with the right actors', () => {
    const path = [
      ['awaiting_payment', 'requested', 'system'],
      ['requested', 'offered', 'admin'],
      ['offered', 'accepted', 'workshop'],
      ['accepted', 'en_route', 'workshop'],
      ['en_route', 'arrived', 'workshop'],
      ['arrived', 'in_progress', 'workshop'],
      ['in_progress', 'billed', 'workshop'],
      ['billed', 'completed', 'system'],
    ] as const;
    for (const [from, to, actor] of path) expect(rsaMachine.canActor(from, to, actor)).toBe(true);
  });

  it('lets only an admin cancel, and only before anyone accepted', () => {
    expect(rsaMachine.canActor('requested', 'cancelled', 'admin')).toBe(true);
    expect(rsaMachine.canActor('offered', 'cancelled', 'admin')).toBe(true);
    expect(rsaMachine.canActor('requested', 'cancelled', 'customer')).toBe(false);
    for (const from of ['accepted', 'en_route', 'arrived', 'in_progress', 'billed'] as const)
      expect(rsaMachine.can(from, 'cancelled')).toBe(false);
  });

  it('never pays or bills out of order and never leaves a terminal state', () => {
    expect(rsaMachine.can('awaiting_payment', 'offered')).toBe(false);
    expect(rsaMachine.can('requested', 'accepted')).toBe(false);
    expect(rsaMachine.can('in_progress', 'completed')).toBe(false);
    for (const t of ['completed', 'cancelled'] as const) expect(rsaMachine.next(t)).toEqual([]);
    expect(rsaMachine.canActor('arrived', 'in_progress', 'customer')).toBe(false);
  });

  it('knows every status', () => {
    expect(RSA_STATES).toHaveLength(10);
  });
});

describe('rsaOfferMachine', () => {
  it('lets the responder answer once and the system expire it', () => {
    expect(rsaOfferMachine.canActor('offered', 'accepted', 'workshop')).toBe(true);
    expect(rsaOfferMachine.canActor('offered', 'expired', 'system')).toBe(true);
    expect(rsaOfferMachine.canActor('offered', 'expired', 'workshop')).toBe(false);
    expect(rsaOfferMachine.can('declined', 'accepted')).toBe(false);
  });
});

describe('money', () => {
  it('computes the balance as total minus advance, never below zero', () => {
    expect(rsaBalancePaise(180_000, 50_000)).toBe(130_000);
    expect(rsaBalancePaise(50_000, 50_000)).toBe(0);
    expect(rsaBalancePaise(30_000, 50_000)).toBe(0);
    expect(rsaOverpaidPaise(30_000, 50_000)).toBe(20_000);
    expect(rsaOverpaidPaise(50_000, 50_000)).toBe(0);
    expect(rsaOverpaidPaise(180_000, 50_000)).toBe(0);
    expect(rsaLineTotalPaise(3, 12_500)).toBe(37_500);
  });
});

describe('hours', () => {
  const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 24, h, m) - 330 * 60_000);
  it('is open all day when 24x7', () => {
    expect(rsaOpenAt({ alwaysOpen: true, opensAtMinute: 0, closesAtMinute: 0 }, at(3, 0))).toBe(true);
  });
  it('honours a day window in IST and a window past midnight', () => {
    const day = { alwaysOpen: false, opensAtMinute: 8 * 60, closesAtMinute: 20 * 60 };
    expect(rsaOpenAt(day, at(8, 0))).toBe(true);
    expect(rsaOpenAt(day, at(19, 59))).toBe(true);
    expect(rsaOpenAt(day, at(20, 0))).toBe(false);
    const night = { alwaysOpen: false, opensAtMinute: 20 * 60, closesAtMinute: 6 * 60 };
    expect(rsaOpenAt(night, at(23, 0))).toBe(true);
    expect(rsaOpenAt(night, at(5, 59))).toBe(true);
    expect(rsaOpenAt(night, at(12, 0))).toBe(false);
  });
});

describe('settings', () => {
  const ok = { ...defaultRsaSettings(), enabled: true, pincodes: ['492001'] };
  it('defaults to 2W and 4W with a 500 rupee advance, 3W not offered', () => {
    const d = defaultRsaSettings();
    expect(d.vehicleTypes).toEqual(['2W', '4W']);
    expect(d.advancePaise).toEqual({ '2W': RSA_DEFAULT_ADVANCE_PAISE, '4W': 50_000 });
    expect(d.advancePaise['3W']).toBeUndefined();
    expect(d.routingMode).toBe('manual');
  });
  it('defaults the bill limit to 25,000 rupees (at most 1,00,000) and the bill question to off', () => {
    const d = defaultRsaSettings();
    expect(d.maxBillPaise).toBe(2_500_000);
    expect(d.billDisputeEnabled).toBe(false);
    const ok = { ...d, enabled: true, pincodes: ['492001'] };
    expect(
      RsaSettingsInput.safeParse({ ...ok, maxBillPaise: 10_000_000, billDisputeEnabled: true }).success,
    ).toBe(true);
    expect(RsaSettingsInput.safeParse({ ...ok, maxBillPaise: 10_000_001 }).success).toBe(false);
    expect(RsaSettingsInput.safeParse({ ...ok, maxBillPaise: 50_000 }).success).toBe(false);
    expect(RsaSettingsInput.safeParse({ ...ok, billDisputeEnabled: 'yes' }).success).toBe(false);
  });
  it('accepts the defaults and a later 3W', () => {
    expect(RsaSettingsInput.safeParse(ok).success).toBe(true);
    const withThree = {
      ...ok,
      vehicleTypes: ['2W', '3W', '4W'],
      advancePaise: { '2W': 50_000, '3W': 50_000, '4W': 50_000 },
    };
    expect(RsaSettingsInput.safeParse(withThree).success).toBe(true);
  });
  it('rejects an advance for a type not offered, a missing advance and unknown keys', () => {
    expect(
      RsaSettingsInput.safeParse({ ...ok, advancePaise: { '2W': 50_000, '4W': 50_000, '3W': 50_000 } })
        .success,
    ).toBe(false);
    expect(RsaSettingsInput.safeParse({ ...ok, advancePaise: { '2W': 50_000 } }).success).toBe(false);
    expect(RsaSettingsInput.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(RsaSettingsInput.safeParse({ ...ok, advancePaise: { '2W': 0, '4W': 50_000 } }).success).toBe(
      false,
    );
  });
  it('rejects duplicate pincodes, an empty window and a bad SOS phone', () => {
    expect(RsaSettingsInput.safeParse({ ...ok, pincodes: ['492001', '492001'] }).success).toBe(false);
    expect(
      RsaSettingsInput.safeParse({ ...ok, alwaysOpen: false, opensAtMinute: 60, closesAtMinute: 60 }).success,
    ).toBe(false);
    expect(RsaSettingsInput.safeParse({ ...ok, sosPhone: '7978776551' }).success).toBe(false);
    expect(RsaSettingsInput.safeParse({ ...ok, sosPhone: '+917978776551' }).success).toBe(true);
  });
});

describe('customer request', () => {
  it('needs only vehicle, fuel and place: the problem type is optional and may be unknown', () => {
    expect(CreateRsaRequestBody.safeParse(create).success).toBe(true);
    expect(CreateRsaRequestBody.safeParse({ ...create, problemType: 'unknown' }).success).toBe(true);
    expect(CreateRsaRequestBody.safeParse({ ...create, problemType: 'on_fire' }).success).toBe(false);
  });
  it('refuses mass assignment, a bad pincode and out-of-range coordinates', () => {
    expect(CreateRsaRequestBody.safeParse({ ...create, advancePaise: 1 }).success).toBe(false);
    expect(CreateRsaRequestBody.safeParse({ ...create, status: 'requested' }).success).toBe(false);
    expect(CreateRsaRequestBody.safeParse({ ...create, pincode: '012345' }).success).toBe(false);
    expect(CreateRsaRequestBody.safeParse({ ...create, lat: 91 }).success).toBe(false);
  });
  it('knows its public code', () => {
    expect(RsaCodeParam.safeParse({ code: publicCode('RSA', 'RPR') }).success).toBe(true);
    expect(RsaCodeParam.safeParse({ code: 'SR-RPR-2026-ABCDEF' }).success).toBe(false);
  });
});

describe('bill', () => {
  const line = { kind: 'labour', description: 'Jump start', quantity: 1, unitPricePaise: 30_000 };
  it('needs at least one line and a total above zero', () => {
    expect(RsaBillBody.safeParse({ lines: [line], expectedVersion: 3 }).success).toBe(true);
    expect(RsaBillBody.safeParse({ lines: [], expectedVersion: 3 }).success).toBe(false);
    expect(
      RsaBillBody.safeParse({ lines: [{ ...line, unitPricePaise: 0 }], expectedVersion: 3 }).success,
    ).toBe(false);
  });
});

describe('roadside email and WhatsApp copy (spec 10, spec 22)', () => {
  const KEYS = [
    'rsa_received',
    'rsa_accepted',
    'rsa_arrived',
    'rsa_bill_ready',
    'rsa_completed',
    'rsa_cancelled',
    'rsa_refund_processed',
  ] as const;
  const ctx = { webBaseUrl: 'https://mechdost.com', grievanceContact: null as string | null };

  it('renders every roadside email in English and Hindi with its sample and a button to the request', () => {
    for (const key of KEYS)
      for (const locale of ['en', 'hi'] as const) {
        const mail = composeEmail(key, locale, sampleEmailParams(key), ctx);
        expect(mail.subject, `${key} ${locale}`).not.toMatch(/\{\w+\}/);
        const all = JSON.stringify(mail);
        expect(all, `${key} ${locale}`).not.toMatch(/\{\w+\}/);
        expect(all).toContain('/roadside/RSA-RPR-2026-6M4QZB');
        if (locale === 'hi') expect(mail.subject).toMatch(/[ऀ-ॿ]/);
      }
  });

  it('puts the arrival code only in the accepted email and never calls a refund done before it is', () => {
    for (const key of KEYS.filter((k) => k !== 'rsa_accepted'))
      expect(EMAIL_TEMPLATES[key].text).not.toContain('arrivalCode');
    expect(EMAIL_TEMPLATES.rsa_accepted.text).toContain('arrivalCode');
    for (const locale of ['en', 'hi'] as const)
      expect(EMAIL_TEMPLATES.rsa_cancelled[locale].body.toLowerCase()).not.toMatch(
        /has been refunded|refunded to you/,
      );
  });

  it('has Meta-compliant utility bodies in both languages, with the request code only', () => {
    for (const key of [
      'rsa.accepted',
      'rsa.arrived',
      'rsa.bill_ready',
      'rsa.refunded',
      'rsa.offer',
    ] as const) {
      const t = WHATSAPP_TEMPLATES[key];
      expect(t.category).toBe('utility');
      expect(t.params).not.toContain('arrivalCode');
      for (const locale of ['en', 'hi'] as const) {
        const body = whatsAppBodyText(key, locale);
        expect(body, `${key} ${locale}`).not.toBe('');
        expect(utilityTemplateProblem(body), `${key} ${locale}`).toBeNull();
        expect(placeholderProblem(body, t.params.length), `${key} ${locale}`).toBeNull();
        expect(body.trim()).not.toMatch(/^\{\{|\}\}$/);
      }
    }
    expect(WHATSAPP_TEMPLATES['rsa.offer'].audience).toBe('partner');
    expect(buildMetaTemplates().filter((m) => m.key.startsWith('rsa.'))).toHaveLength(10);
  });
});

describe('refund vocabulary', () => {
  it('has the roadside sources and reasons', () => {
    for (const k of ['rsa_cancelled', 'rsa_overpaid']) {
      expect(REFUND_SOURCES).toContain(k);
      expect(REFUND_REASONS).toContain(k);
    }
  });
});
