import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import {
  SERVICE_CANCEL_REASONS,
  SERVICE_DECLINE_REASONS,
  SERVICE_REJECT_REASONS,
  SERVICE_REQUEST_STATES,
  serviceRequestMachine,
} from '@mechdost/shared/state';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_STEPS,
  SERVICE_ERROR_CODES,
  badLineFrom,
  customerMayCancel,
  customerStepIndex,
  daysLabel,
  durationParts,
  estimateDecisions,
  fromPaise,
  istDate,
  lastKmFrom,
  newIdempotencyKey,
  parseOdometerKm,
  rangeOf,
  requestStatusKey,
  routableWorkshops,
  rupeesToPaise,
  serviceErrorKey,
  servicesFor,
  workshopMayRevise,
  workshopNextAction,
} from '../src/lib/service-views';

type Tree = Record<string, unknown>;
const ns = (tree: unknown, name: string): Tree => (tree as Record<string, Tree>)[name] ?? {};
const has = (tree: unknown, name: string, key: string) => {
  const v = ns(tree, name)[key];
  return typeof v === 'string' && v.trim() !== '';
};

describe('service request status (customer)', () => {
  it('names every API state with a request.* string in English and Hindi', () => {
    for (const s of SERVICE_REQUEST_STATES) {
      const key = requestStatusKey(s);
      expect(has(en, 'request', key), `en request.${key}`).toBe(true);
      expect(has(hi, 'request', key), `hi request.${key}`).toBe(true);
    }
  });

  it('puts open states on the stepper and outcomes in a box', () => {
    expect(customerStepIndex('needs_routing')).toBe(0);
    expect(customerStepIndex('proposed')).toBe(0);
    expect(customerStepIndex('confirmed')).toBe(1);
    expect(customerStepIndex('estimate_sent')).toBe(3);
    expect(customerStepIndex('in_progress')).toBe(4);
    expect(customerStepIndex('billed')).toBe(6);
    expect(customerStepIndex('completed')).toBe(CUSTOMER_STEPS.length);
    for (const s of ['cancelled', 'rejected', 'no_work_approved'] as const)
      expect(customerStepIndex(s)).toBeNull();
  });

  it('lets the customer cancel only until the vehicle is received (as the machine)', () => {
    for (const s of SERVICE_REQUEST_STATES)
      expect(customerMayCancel(s), s).toBe(serviceRequestMachine.canActor(s, 'cancelled', 'customer'));
  });

  it('has every cancel reason in both languages', () => {
    for (const r of SERVICE_CANCEL_REASONS) {
      expect(has(en, 'request', `cancelReason_${r}`)).toBe(true);
      expect(has(hi, 'request', `cancelReason_${r}`)).toBe(true);
    }
  });
});

describe('workshop job card', () => {
  it('offers the one step the machine allows the workshop next', () => {
    expect(workshopNextAction('awaiting_workshop')).toBe('propose');
    expect(workshopNextAction('confirmed')).toBe('receive');
    expect(workshopNextAction('vehicle_received')).toBe('estimate');
    expect(workshopNextAction('estimate_sent')).toBe('wait_approval');
    expect(workshopNextAction('approved')).toBe('start');
    expect(workshopNextAction('in_progress')).toBe('ready');
    expect(workshopNextAction('ready')).toBe('bill');
    expect(workshopNextAction('billed')).toBe('paid');
    expect(workshopNextAction('no_work_approved')).toBe('return');
    expect(workshopNextAction('completed')).toBeNull();
    // Every one-click step is a transition the workshop may make.
    expect(serviceRequestMachine.canActor('approved', 'in_progress', 'workshop')).toBe(true);
    expect(serviceRequestMachine.canActor('ready', 'billed', 'workshop')).toBe(true);
  });

  it('allows a revised estimate only after a decision, never while the customer decides', () => {
    expect(workshopMayRevise('approved')).toBe(true);
    expect(workshopMayRevise('in_progress')).toBe(true);
    expect(workshopMayRevise('no_work_approved')).toBe(true);
    expect(workshopMayRevise('estimate_sent')).toBe(false);
    expect(workshopMayRevise('vehicle_received')).toBe(false);
    expect(workshopMayRevise('ready')).toBe(false);
  });

  it('reads the odometer and estimate-line details the API sends', () => {
    expect(lastKmFrom({ lastKm: 12500 })).toBe(12500);
    expect(lastKmFrom({ lastKm: '12500' })).toBeNull();
    expect(lastKmFrom(null)).toBeNull();
    expect(badLineFrom({ line: 2, field: 'qty' })).toEqual({ line: 2, field: 'qty' });
    expect(badLineFrom({ line: 0, field: 'qty' })).toBeNull();
    expect(badLineFrom({ line: 1, field: 'colour' })).toBeNull();
  });

  it('parses money and odometer readings as typed', () => {
    expect(rupeesToPaise('1,250')).toBe(125_000);
    expect(rupeesToPaise('₹ 800')).toBe(80_000);
    expect(rupeesToPaise('12.5')).toBeNull();
    expect(rupeesToPaise('')).toBeNull();
    expect(parseOdometerKm('12,345')).toBe(12_345);
    expect(parseOdometerKm('3000000')).toBeNull();
    expect(parseOdometerKm('-4')).toBeNull();
  });

  it('has every decline reason and payment method in both languages', () => {
    for (const r of SERVICE_DECLINE_REASONS)
      for (const tree of [en, hi]) expect(has(tree, 'portal', `ws_api_declineReason_${r}`), r).toBe(true);
    for (const r of SERVICE_REJECT_REASONS)
      for (const tree of [en, hi]) expect(has(tree, 'portal', `ws_api_rejectReason_${r}`), r).toBe(true);
    for (const m of ['cash', 'upi', 'card'])
      for (const tree of [en, hi]) expect(has(tree, 'portal', `ws_api_payMethod_${m}`), m).toBe(true);
  });
});

describe('API error codes', () => {
  it('explains every known code in English and Hindi', () => {
    for (const code of SERVICE_ERROR_CODES) {
      const key = serviceErrorKey(code);
      expect(key).toBe(`api_err_${code}`);
      expect(has(en, 'request', key), `en ${key}`).toBe(true);
      expect(has(hi, 'request', key), `hi ${key}`).toBe(true);
    }
    expect(has(en, 'request', 'api_err_generic')).toBe(true);
    expect(has(hi, 'request', 'api_err_generic')).toBe(true);
  });

  it('maps machine, transport and unknown codes to a message', () => {
    expect(serviceErrorKey('ILLEGAL_TRANSITION')).toBe('api_err_WRONG_STEP');
    expect(serviceErrorKey('CONFLICT')).toBe('api_err_STALE_REQUEST');
    expect(serviceErrorKey('HTTP_404')).toBe('api_err_NOT_FOUND');
    expect(serviceErrorKey('HTTP_503')).toBe('api_err_UNAVAILABLE');
    expect(serviceErrorKey('BAD_RESPONSE')).toBe('api_err_generic');
    expect(serviceErrorKey('SOMETHING_NEW')).toBe('api_err_generic');
  });
});

describe('ranges, menus and hours', () => {
  it('sums the requested services and finds the cheapest line', () => {
    expect(
      rangeOf([
        { lowPaise: 25_000, highPaise: 60_000 },
        { lowPaise: 80_000, highPaise: 150_000 },
      ]),
    ).toEqual({ low: 105_000, high: 210_000 });
    expect(fromPaise([{ lowPaise: 9_000 }, { lowPaise: 4_000 }])).toBe(4_000);
    expect(fromPaise([])).toBeNull();
  });

  it('shows menu lines for the chosen vehicle (null = every type)', () => {
    const menu = [
      { key: 'a', vehicleType: null },
      { key: 'b', vehicleType: '2W' as const },
      { key: 'c', vehicleType: '4W' as const },
    ];
    expect(servicesFor(menu, '2W').map((m) => m.key)).toEqual(['a', 'b']);
  });

  it('formats durations in minutes or half hours', () => {
    expect(durationParts(30, 60)).toEqual({ unit: 'min', min: '30', max: '60' });
    expect(durationParts(120, 210)).toEqual({ unit: 'h', min: '2', max: '3.5' });
  });

  it('writes opening days as runs from Monday', () => {
    expect(daysLabel([1, 2, 3, 4, 5, 6], 'en')).toBe('Mon–Sat');
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6], 'en')).toBe('Mon–Sun');
    expect(daysLabel([1, 3, 5], 'en')).toBe('Mon, Wed, Fri');
    expect(daysLabel([6, 0], 'en')).toBe('Sat, Sun');
    expect(daysLabel([1, 2, 3], 'hi')).toMatch(/[ऀ-ॿ]/);
  });
});

describe('estimate decisions', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  it('needs a choice on every line, in line order', () => {
    expect(estimateDecisions(items, { a: 'approved' })).toEqual({ ok: false, missing: 'b' });
    expect(estimateDecisions(items, { b: 'declined', a: 'approved' })).toEqual({
      ok: true,
      decisions: [
        { itemId: 'a', decision: 'approved' },
        { itemId: 'b', decision: 'declined' },
      ],
    });
  });
});

describe('admin routing suggestions', () => {
  const ws = (over: Partial<Parameters<typeof routableWorkshops>[0][number]>) => ({
    id: 'w',
    slug: 'w',
    pincode: '492002',
    vehicleTypes: ['2W' as const],
    status: 'approved',
    published: true,
    locationVerified: true,
    busy: false,
    ...over,
  });

  it('offers only bookable workshops serving the vehicle, same PIN first, never the current one', () => {
    const list = [
      ws({ id: '1', slug: 'far' }),
      ws({ id: '2', slug: 'paused', status: 'paused' }),
      ws({ id: '3', slug: 'busy', busy: true }),
      ws({ id: '4', slug: 'unlisted', published: false }),
      ws({ id: '5', slug: 'unverified', locationVerified: false }),
      ws({ id: '6', slug: 'cars', vehicleTypes: ['4W'] }),
      ws({ id: '7', slug: 'near', pincode: '492001' }),
      ws({ id: '8', slug: 'current', pincode: '492001' }),
    ];
    const out = routableWorkshops(list, { vehicleType: '2W', pincode: '492001', workshopSlug: 'current' });
    expect(out.map((w) => w.slug)).toEqual(['near', 'far']);
  });
});

describe('helpers', () => {
  it('makes idempotency keys the API accepts', () => {
    const k = newIdempotencyKey();
    expect(k).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(newIdempotencyKey()).not.toBe(k);
  });

  it('computes dates in India time', () => {
    // 20:00 UTC on 14 Nov is already 15 Nov in India.
    expect(istDate(0, new Date('2026-11-14T20:00:00Z'))).toBe('2026-11-15');
    expect(istDate(30, new Date('2026-11-14T00:00:00Z'))).toBe('2026-12-14');
  });
});
