import { beforeEach, describe, expect, it } from 'vitest';
import { blockCustomer, customerAllowed } from '../src/demo/customer-blocks';
import {
  acceptOffer,
  addToCart,
  advanceOrder,
  createQuote,
  sendOffer,
  type DemoOrder,
} from '../src/demo/store';

/** Minimal browser stand-in: the store needs localStorage and storage-event listeners only. */
function fakeWindow(opts: { failWrites?: boolean } = {}) {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (opts.failWrites) throw new Error('QuotaExceededError');
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  return data;
}

const stored = (data: Map<string, string>, key: string) => JSON.parse(data.get(key) ?? '[]') as unknown[];

describe('demo store robustness (review B11)', () => {
  it('drops saved cart lines with impossible quantities instead of pricing them', () => {
    const data = fakeWindow();
    data.set(
      'mechdost-cart',
      JSON.stringify([
        { slug: 'bad-negative', qty: -3 },
        { slug: 'bad-huge', qty: 5000 },
        { slug: 'ok', qty: 2 },
      ]),
    );
    expect(addToCart('another')).toBe('added');
    expect(stored(data, 'mechdost-cart')).toEqual([
      { slug: 'ok', qty: 2 },
      { slug: 'another', qty: 1 },
    ]);
  });

  it('drops a saved order without a customer (it would crash the order pages)', () => {
    const data = fakeWindow();
    const good = {
      code: 'MD-RPR-2026-AAAAAA',
      lines: [],
      customer: { name: 'Ravi' },
      stage: 1,
      totalPaise: 100,
    };
    data.set('mechdost-demo-orders', JSON.stringify([{ code: 'MD-RPR-2026-BBBBBB', lines: [] }, good]));
    advanceOrder('MD-RPR-2026-ZZZZZZ'); // any write re-saves the parsed list
    expect((stored(data, 'mechdost-demo-orders') as { code: string }[]).map((o) => o.code)).toEqual([
      good.code,
    ]);
  });

  it('says so when the browser refuses to save the cart, instead of "Added"', () => {
    fakeWindow({ failWrites: true });
    expect(addToCart('castrol-activ-4t-20w40-900ml')).toBe('save_failed');
  });
});

function quoteWithOffer() {
  const quote = createQuote({
    customer: { name: 'Ravi', phone: '9876543210' },
    pincode: '492001',
    lines: [
      {
        slug: 'castrol-activ-4t-20w40-900ml',
        name: 'Castrol Activ 4T',
        brand: 'Castrol',
        qty: 12,
        listPaise: 44_000,
      },
    ],
    note: '',
  });
  sendOffer(quote.code, {
    lines: [{ slug: 'castrol-activ-4t-20w40-900ml', unitPaise: 40_000 }],
    deliveryPaise: 0,
    note: '',
    validDays: 3,
  });
  return quote.code;
}

describe('accepting a quote follows the checkout rules (review B10)', () => {
  beforeEach(() => {
    fakeWindow();
  });

  it('needs a serviceable delivery address', () => {
    const code = quoteWithOffer();
    expect(acceptOffer(code, 1, { allowed: { order: true, cod: true }, address: null })).toEqual({
      ok: false,
      reason: 'address',
    });
    expect(
      acceptOffer(code, 1, {
        allowed: { order: true, cod: true },
        address: { line1: 'House 12, Pandri', landmark: '', pincode: '110001' },
      }),
    ).toEqual({ ok: false, reason: 'address' });
    const ok = acceptOffer(code, 1, {
      allowed: { order: true, cod: true },
      address: { line1: 'House 12, Pandri', landmark: '', pincode: '492001' },
    });
    expect(ok.ok).toBe(true);
  });

  it('a customer blocked from ordering cannot turn a quote into an order', () => {
    const code = quoteWithOffer();
    blockCustomer({
      account: { id: 'acct-ravi', role: 'customer' },
      level: 'orders',
      reasonCode: 'cod_refused',
      note: '',
      endsAt: null,
      by: 'Asha',
    });
    expect(
      acceptOffer(code, 1, {
        allowed: customerAllowed('acct-ravi'),
        address: { line1: 'House 12, Pandri', landmark: '', pincode: '492001' },
      }),
    ).toEqual({ ok: false, reason: 'blocked' });
  });
});

describe('the demo "next update" control (review B12)', () => {
  it('confirming an order also records the shop as having accepted it', () => {
    const data = fakeWindow();
    const order = {
      code: 'MD-RPR-2026-CCCCCC',
      createdAt: new Date().toISOString(),
      lines: [],
      subtotalPaise: 100,
      deliveryPaise: 0,
      totalPaise: 100,
      customer: { name: 'Ravi', phone: '9876543210', address: 'House 12', pincode: '492001' },
      payment: 'cod',
      stage: 1,
      shop: { slug: 'sharma-auto-parts', status: 'offered', offeredAt: '', expiresAt: '' },
    };
    data.set('mechdost-demo-orders', JSON.stringify([order]));
    advanceOrder(order.code);
    const [after] = stored(data, 'mechdost-demo-orders') as DemoOrder[];
    expect(after!.stage).toBe(2);
    expect(after!.shop?.status).toBe('accepted');
  });
});
