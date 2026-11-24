import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { CUSTOMER_STEPS, roadsideErrorKey, stepIndex } from '../src/lib/roadside';

/**
 * Roadside assistance on the web (spec 22): the browser demo follows the API's rules (advance snapshot, balance maths,
 * refund request for an overpaid advance, cancel only before a workshop accepts, the arrival code), the screens map
 * every API error to a message, and every message exists in English and Hindi.
 */
const store = new Map<string, string>();
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  },
});

async function demo() {
  vi.resetModules();
  return import('../src/demo/roadside');
}

beforeEach(() => {
  store.clear();
});

describe('demo roadside flow', () => {
  it('offers 2W and 4W only, with the 500 rupee advance, and refuses other areas', async () => {
    const d = await demo();
    const a = d.demoAvailability('492001');
    expect(a).toMatchObject({
      available: true,
      vehicleTypes: ['2W', '4W'],
      advancePaise: { '2W': 50_000, '4W': 50_000 },
    });
    expect(a.advancePaise['3W']).toBeUndefined();
    expect(d.demoAvailability('110001')).toMatchObject({ available: false, reason: 'RSA_OUT_OF_AREA' });
    expect(d.demoCreate({ vehicleType: '3W', problemType: null, pincode: '492001' })).toEqual({
      ok: false,
      code: 'RSA_VEHICLE_NOT_OFFERED',
    });
  });

  it('walks request, advance, offer, accept, arrival code, bill and balance', async () => {
    const d = await demo();
    const made = d.demoCreate({ vehicleType: '2W', problemType: 'unknown', pincode: '492001' });
    expect(made.ok).toBe(true);
    // One open request at a time.
    expect(d.demoCreate({ vehicleType: '2W', problemType: null, pincode: '492001' })).toMatchObject({
      code: 'RSA_ALREADY_OPEN',
    });
    const step = d.demoStep;
    expect(step({ kind: 'offer' })).toBe(false);
    expect(step({ kind: 'pay_advance' })).toBe(true);
    expect(step({ kind: 'pay_advance' })).toBe(false);
    expect(step({ kind: 'offer' })).toBe(true);
    expect(step({ kind: 'accept' })).toBe(true);
    expect(step({ kind: 'arrive', code: '0000' })).toBe(false);
    expect(step({ kind: 'arrive', code: d.DEMO_ARRIVAL_CODE })).toBe(true);
    expect(step({ kind: 'start' })).toBe(true);
    const lines = [{ kind: 'labour', description: 'Jump start', quantity: 1, unitPricePaise: 180_000 }];
    expect(step({ kind: 'bill', lines })).toBe(true);
    const raw = JSON.parse(store.get('mechdost-demo-roadside-v1') ?? 'null') as Parameters<
      typeof d.demoView
    >[0];
    const view = d.demoView(raw);
    expect(view.status).toBe('billed');
    expect(view.bill).toMatchObject({
      totalPaise: 180_000,
      advancePaise: 50_000,
      balancePaise: 130_000,
      overpaidPaise: 0,
    });
    expect(step({ kind: 'cancel', reason: 'other' })).toBe(false);
    expect(step({ kind: 'cash' })).toBe(true);
  });

  it('completes without a balance and raises a refund when the total is under the advance', async () => {
    const d = await demo();
    d.demoCreate({ vehicleType: '4W', problemType: 'flat_tyre', pincode: '492004' });
    for (const kind of ['pay_advance', 'offer', 'accept', 'en_route'] as const)
      expect(d.demoStep({ kind })).toBe(true);
    expect(d.demoStep({ kind: 'arrive', code: d.DEMO_ARRIVAL_CODE })).toBe(true);
    d.demoStep({ kind: 'start' });
    d.demoStep({
      kind: 'bill',
      lines: [{ kind: 'labour', description: 'Check', quantity: 1, unitPricePaise: 30_000 }],
    });
    const view = d.demoView(
      JSON.parse(store.get('mechdost-demo-roadside-v1') ?? 'null') as Parameters<typeof d.demoView>[0],
    );
    expect(view.status).toBe('completed');
    expect(view.bill).toMatchObject({ balancePaise: 0, overpaidPaise: 20_000 });
    expect(view.refunds).toEqual([{ amountPaise: 20_000, stage: 'under_review' }]);
  });

  it('lets admin cancel only before acceptance, refunding the advance for approval', async () => {
    const d = await demo();
    d.demoCreate({ vehicleType: '2W', problemType: null, pincode: '492001' });
    d.demoStep({ kind: 'pay_advance' });
    d.demoStep({ kind: 'offer' });
    expect(d.demoStep({ kind: 'cancel', reason: 'no_responder_accepted' })).toBe(true);
    const view = d.demoView(
      JSON.parse(store.get('mechdost-demo-roadside-v1') ?? 'null') as Parameters<typeof d.demoView>[0],
    );
    expect(view).toMatchObject({
      status: 'cancelled',
      refunds: [{ amountPaise: 50_000, stage: 'under_review' }],
    });
    // A new request is possible again.
    expect(d.demoCreate({ vehicleType: '2W', problemType: null, pincode: '492001' }).ok).toBe(true);
  });

  it('never shows the arrival code after the mechanic arrived', async () => {
    const d = await demo();
    d.demoCreate({ vehicleType: '2W', problemType: null, pincode: '492001' });
    for (const kind of ['pay_advance', 'offer', 'accept'] as const) d.demoStep({ kind });
    const read = () =>
      d.demoView(
        JSON.parse(store.get('mechdost-demo-roadside-v1') ?? 'null') as Parameters<typeof d.demoView>[0],
      );
    expect(read().arrivalCode).toBe(d.DEMO_ARRIVAL_CODE);
    d.demoStep({ kind: 'arrive', code: d.DEMO_ARRIVAL_CODE });
    expect(read().arrivalCode).toBeNull();
  });
});

describe('screens', () => {
  it('map API errors to messages and unknown ones to the generic one', () => {
    expect(roadsideErrorKey('RSA_CLOSED')).toBe('err_RSA_CLOSED');
    expect(roadsideErrorKey('SOMETHING_NEW')).toBe('err_generic');
  });

  it('place every status on the customer steps', () => {
    expect(stepIndex('awaiting_payment')).toBe(-1);
    expect(stepIndex('offered')).toBe(0);
    expect(stepIndex('en_route')).toBe(1);
    expect(stepIndex('completed')).toBe(CUSTOMER_STEPS.length - 1);
  });
});

describe('messages', () => {
  const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
  it('have the same roadside keys in English and Hindi, none empty', () => {
    expect(keys(hi.roadside)).toEqual(keys(en.roadside));
    for (const v of Object.values(hi.roadside)) expect(v.trim().length).toBeGreaterThan(0);
  });

  it('name every status, problem type, error and refund stage the screens can ask for', () => {
    const need = [
      ...[
        'awaiting_payment',
        'requested',
        'offered',
        'accepted',
        'en_route',
        'arrived',
        'in_progress',
        'billed',
        'completed',
        'cancelled',
      ].flatMap((s) => [`status_${s}`, `statusHint_${s}`]),
      ...['dead_battery', 'flat_tyre', 'out_of_fuel', 'minor_fix', 'needs_towing', 'unknown', 'skipped'].map(
        (p) => `problem_${p}`,
      ),
      ...['under_review', 'processing', 'refunded', 'declined', 'failed'].map((r) => `refund_${r}`),
      ...['manual', 'auto', 'auto_then_manual'].map((m) => `routing_${m}`),
      ...['no_responder_accepted', 'customer_unreachable', 'duplicate_request', 'other'].map(
        (c) => `cancel_${c}`,
      ),
      ...['RSA_NOT_AVAILABLE', 'RSA_OUT_OF_AREA', 'RSA_CLOSED'].map((c) => `closed_${c}`),
    ];
    for (const k of need) expect(en.roadside, k).toHaveProperty(k);
  });

  it('never promise an instant refund', () => {
    for (const text of Object.values(en.roadside))
      expect(text.toLowerCase()).not.toMatch(/instant|immediately/);
  });
});
