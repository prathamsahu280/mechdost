import { describe, expect, it } from 'vitest';
import { contentField, contentStep } from '../src/lib/admin-content-view';
import {
  budgetPaiseFrom,
  eventView,
  metaStatusLabel,
  templateErrorProblem,
  templateSaves,
  type TemplateRow,
} from '../src/lib/admin-notify-view';
import { fromInput, settingBounds, settingUnit, toInput } from '../src/lib/admin-settings-view';
import { commonErrorKey } from '../src/lib/api-error-key';
import { blockErrorKey, customerIdFrom, endsAtFrom } from '../src/lib/customer-blocks-view';

/** Stream D (2026-11-14): helpers behind the admin screens that run on the API in real sign-in builds. */
describe('commonErrorKey', () => {
  it('maps auth, scope, rate, stale and network codes', () => {
    expect(commonErrorKey('AUTH_REQUIRED')).toBe('api_common_err_auth');
    expect(commonErrorKey('STAFF_2FA_REQUIRED')).toBe('api_common_err_2fa');
    expect(commonErrorKey('SCOPE_REQUIRED')).toBe('api_common_err_forbidden');
    expect(commonErrorKey('RATE_LIMITED')).toBe('api_common_err_rate');
    expect(commonErrorKey('STALE_TEMPLATE')).toBe('api_common_err_stale');
    expect(commonErrorKey('HTTP_503')).toBe('api_common_err_network');
    expect(commonErrorKey('NETWORK')).toBe('api_common_err_network');
  });
  it('never returns a raw code', () => {
    expect(commonErrorKey('SOMETHING_NEW')).toBe('api_common_err_generic');
    expect(commonErrorKey('BAD_RESPONSE')).toBe('api_common_err_generic');
  });
});

describe('notifications view', () => {
  const defaults = { en: 'Order {{1}} confirmed.', hi: 'ऑर्डर {{1}} पक्का।' };
  const row = (over: Partial<TemplateRow>): TemplateRow => ({
    key: 'order.confirmed',
    channel: 'whatsapp',
    locale: 'en',
    body: 'Saved {{1}}',
    enabled: true,
    version: 3,
    ...over,
  });

  it('shows the defaults and creates both rows when nothing is saved', () => {
    const view = eventView([], 'order.confirmed', defaults);
    expect(view).toEqual({
      enabled: false,
      body: defaults,
      version: { en: null, hi: null },
      usesDefault: { en: true, hi: true },
    });
    const saves = templateSaves('order.confirmed', view, { enabled: true, body: defaults });
    expect(saves.map((s) => [s.locale, s.version, s.enabled, s.channel])).toEqual([
      ['en', null, true, 'whatsapp'],
      ['hi', null, true, 'whatsapp'],
    ]);
  });

  it('reads saved rows per language and ignores other channels and events', () => {
    const view = eventView(
      [
        row({}),
        row({ locale: 'hi', enabled: false, version: 1, body: 'हिंदी {{1}}' }),
        row({ channel: 'email', body: 'email' }),
        row({ key: 'order.rejected', body: 'other' }),
      ],
      'order.confirmed',
      defaults,
    );
    expect(view.enabled).toBe(true);
    expect(view.body).toEqual({ en: 'Saved {{1}}', hi: 'हिंदी {{1}}' });
    expect(view.version).toEqual({ en: 3, hi: 1 });
    expect(view.usesDefault).toEqual({ en: false, hi: false });
  });

  it('trims the text it sends', () => {
    const [en] = templateSaves(
      'order.confirmed',
      { version: { en: 2, hi: 2 } },
      {
        enabled: false,
        body: { en: '  Hi {{1}}  ', hi: 'x {{1}}' },
      },
    );
    expect(en).toMatchObject({ body: 'Hi {{1}}', version: 2, enabled: false });
  });

  it('maps template errors to field messages', () => {
    expect(templateErrorProblem('TEMPLATE_PROMO_WORDING')).toBe('promo_wording');
    expect(templateErrorProblem('TEMPLATE_PLACEHOLDERS')).toBe('missing');
    expect(templateErrorProblem('STALE_TEMPLATE')).toBe('stale');
    expect(templateErrorProblem('RATE_LIMITED')).toBeNull();
  });

  it('reads the budget in whole rupees within the limits', () => {
    expect(budgetPaiseFrom('5000', [0, 100_000_000])).toBe(500_000);
    expect(budgetPaiseFrom(' 0 ', [0, 100_000_000])).toBe(0);
    expect(budgetPaiseFrom('12.5', [0, 100_000_000])).toBeNull();
    expect(budgetPaiseFrom('-1', [0, 100_000_000])).toBeNull();
    expect(budgetPaiseFrom('1000001', [0, 100_000_000])).toBeNull();
    expect(budgetPaiseFrom('', [0, 100_000_000])).toBeNull();
  });
});

describe('settings view', () => {
  it('shows money in rupees and stores paise', () => {
    expect(settingUnit('checkout.cod_cap_paise')).toBe('rupees');
    expect(toInput('checkout.cod_cap_paise', 500_000)).toBe('5000');
    expect(fromInput('checkout.cod_cap_paise', '5000')).toEqual({ ok: true, value: 500_000 });
    expect(settingBounds('checkout.cod_fee_paise')).toEqual([0, 500]);
  });

  it('applies the registry ranges', () => {
    expect(settingUnit('orders.acceptance_timeout_min')).toBe('minutes');
    expect(fromInput('orders.acceptance_timeout_min', '4')).toEqual({ ok: false, problem: 'range' });
    expect(fromInput('orders.acceptance_timeout_min', '15')).toEqual({ ok: true, value: 15 });
    expect(fromInput('orders.acceptance_timeout_min', '')).toEqual({ ok: false, problem: 'type' });
    expect(fromInput('orders.acceptance_timeout_min', '1.5')).toEqual({ ok: false, problem: 'type' });
  });

  it('treats empty as none only where the setting allows it', () => {
    expect(toInput('checkout.free_delivery_min_paise', null)).toBe('');
    expect(fromInput('checkout.free_delivery_min_paise', '')).toEqual({ ok: true, value: null });
  });

  it('handles switches', () => {
    expect(settingUnit('orders.customer_self_cancel_cod')).toBe('switch');
    expect(settingBounds('orders.customer_self_cancel_cod')).toBeNull();
    expect(toInput('orders.customer_self_cancel_cod', true)).toBe('true');
    expect(fromInput('orders.customer_self_cancel_cod', 'false')).toEqual({ ok: true, value: false });
    expect(settingUnit('partners.invite_days')).toBe('days');
    expect(settingUnit('assistant.daily_messages')).toBe('count');
    // Bulk quote minimum (spec 19): a number of units, not messages.
    expect(settingUnit('quotes.min_units')).toBe('units');
    expect(settingBounds('quotes.min_units')).toEqual([2, 500]);
  });
});

describe('content view', () => {
  const entries = [
    {
      key: 'hero.lead',
      locale: 'en' as const,
      draft: { value: 'New', version: 4 },
      published: { value: 'Live', version: 2 },
    },
    { key: 'hero.eyebrow', locale: 'hi' as const, draft: { value: 'मसौदा', version: 1 }, published: null },
  ];

  it('edits the live text and keeps the draft version for compare-and-set', () => {
    expect(contentField(entries, 'hero.lead', 'en')).toEqual({
      text: 'Live',
      draftVersion: 4,
      publishedVersion: 2,
    });
    expect(contentField(entries, 'hero.eyebrow', 'hi')).toEqual({
      text: '',
      draftVersion: 1,
      publishedVersion: null,
    });
    expect(contentField(entries, 'hero.titleLine1', 'en')).toEqual({
      text: '',
      draftVersion: null,
      publishedVersion: null,
    });
  });

  it('publishes changes, unpublishes emptied fields and skips the rest', () => {
    const live = contentField(entries, 'hero.lead', 'en');
    expect(contentStep(live, ' Live ')).toEqual({ kind: 'none' });
    expect(contentStep(live, 'Better')).toEqual({ kind: 'publish', text: 'Better', draftVersion: 4 });
    expect(contentStep(live, '  ')).toEqual({ kind: 'unpublish', version: 2 });
    expect(contentStep(contentField(entries, 'hero.eyebrow', 'hi'), '')).toEqual({ kind: 'none' });
  });
});

describe('customer blocks view', () => {
  it('maps block codes to the screen messages', () => {
    expect(blockErrorKey('ALREADY_BLOCKED')).toBe('customersErr_already');
    expect(blockErrorKey('BLOCK_PARTNER_FULL')).toBe('customersErr_not_customer');
    expect(blockErrorKey('LIFT_REASON')).toBe('customersErr_liftReason');
    expect(blockErrorKey('STALE_BLOCK')).toBeNull();
  });

  it('accepts only a full account id', () => {
    expect(customerIdFrom(' 0193A2B4-5C6D-7E8F-9A0B-1C2D3E4F5A6B ')).toBe(
      '0193a2b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
    );
    expect(customerIdFrom('0193a2b4')).toBeNull();
    expect(customerIdFrom("x' OR 1=1")).toBeNull();
  });

  it('ends a block at the end of the chosen day in IST', () => {
    expect(endsAtFrom('2026-12-01')).toBe('2026-12-01T18:29:59.000Z');
    expect(endsAtFrom('')).toBeNull();
    expect(endsAtFrom('01/12/2026')).toBeNull();
  });
});

describe('Meta approval label (Admin → Notifications)', () => {
  it('maps Meta statuses to locale keys and unknown words to a neutral one', () => {
    expect(metaStatusLabel('approved')).toBe('notify_meta_approved');
    expect(metaStatusLabel('pending')).toBe('notify_meta_pending');
    expect(metaStatusLabel('unknown')).toBe('notify_meta_unknown');
    expect(metaStatusLabel('missing')).toBe('notify_meta_missing');
    expect(metaStatusLabel('in_appeal')).toBe('notify_meta_other');
  });
});
