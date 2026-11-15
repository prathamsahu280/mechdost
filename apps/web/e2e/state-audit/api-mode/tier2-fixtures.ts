/**
 * Typed fixtures of the shop portal tier 2 audit rows (design 2026-11-15 items 4 to 7): the CSV card (idle, a check
 * with problems, a clean check, a refused file, applied), the performance card (with and without the city median, no
 * data, error), the packing slip page and the public status form. Every body carries its shared schema.
 */
import { PackingSlip, ShopCsvApplied, ShopCsvPreview, ShopPerformance } from '@mechdost/shared/shop-tools';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const long = (c: AuditCase) => c.state.stress === 'long-text';

const LONG_EN =
  'Castrol Activ 4T Engine Oil 20W-40 Semi Synthetic Motorcycle Lubricant Pack of Twelve Bottles';
const LONG_HI = 'कैस्ट्रॉल एक्टिव 4T इंजन ऑयल 20W-40 सेमी सिंथेटिक मोटरसाइकिल लुब्रिकेंट बारह बोतलों का पैक';

function preview(c: AuditCase): Reply {
  const kind = c.state.csv ?? 'idle';
  if (kind === 'file-error') return { status: 422, code: 'CSV_HEADER' };
  const changes = [
    {
      line: 2,
      sku: 'CAS-ACT4T-0900',
      stock: { from: 12, to: 40 },
      active: null,
      price: { requestedPaise: 41_000, currentPaise: 44_500, onHand: 40 },
    },
    {
      line: 3,
      sku: 'BRK-PAD-0120',
      stock: null,
      active: { from: true, to: false },
      price: null,
    },
    {
      line: 4,
      sku: 'SPK-IR-0004',
      stock: null,
      active: null,
      price: { requestedPaise: 38_000, currentPaise: null, onHand: 6 },
    },
  ];
  const errors =
    kind === 'errors'
      ? [
          { line: 2, column: 'sku' as const, code: 'UNKNOWN_SKU' as const },
          { line: 3, column: 'stock' as const, code: 'STOCK_BELOW_RESERVED' as const },
          { line: 4, column: 'requested_price' as const, code: 'FORMULA_CELL' as const },
          ...Array.from({ length: 24 }, (_, i) => ({
            line: 5 + i,
            column: 'active' as const,
            code: 'ACTIVE_INVALID' as const,
          })),
        ]
      : [];
  return {
    body: {
      rows: 30,
      unchanged: 27,
      errors,
      changes: errors.length > 0 ? [] : changes,
      counts: { stock: 1, active: 1, priceRequests: 2 },
    } satisfies Dto<typeof ShopCsvPreview>,
  };
}

function performance(c: AuditCase): Reply {
  const kind = c.state.perf ?? 'full';
  if (kind === 'error') return { status: 500, code: 'INTERNAL' };
  const none = {
    offers: 0,
    acceptanceBp: null,
    medianAcceptSeconds: null,
    giveUps: 0,
    giveUpBp: null,
    onTimeBp: null,
    ratingX100: null,
    ratingCount: 0,
  };
  const mine = (days: number) =>
    kind === 'empty'
      ? none
      : {
          offers: days === 30 ? 41 : 118,
          acceptanceBp: days === 30 ? 8537 : 9102,
          medianAcceptSeconds: days === 30 ? 95 : 410,
          giveUps: days === 30 ? 2 : 3,
          giveUpBp: days === 30 ? 571 : 280,
          onTimeBp: days === 30 ? 9333 : 8800,
          ratingX100: 442,
          ratingCount: days === 30 ? 9 : 31,
        };
  const city = {
    acceptanceBp: 7800,
    medianAcceptSeconds: 600,
    giveUpBp: 400,
    onTimeBp: 8600,
    ratingX100: 410,
  };
  return {
    body: {
      shopId: uuid(1),
      onTimeHours: 24,
      windows: [30, 90].map((days) => ({
        days,
        mine: mine(days),
        city: kind === 'full' ? city : null,
      })),
    } satisfies Dto<typeof ShopPerformance>,
  };
}

function slip(c: AuditCase): Reply {
  const kind = c.state.slip ?? 'one-item';
  if (kind === 'unavailable') return { status: 409, code: 'SLIP_UNAVAILABLE' };
  if (kind === 'error') return { status: 500, code: 'INTERNAL' };
  const item = (n: number) => ({
    title: long(c) ? (c.locale === 'hi' ? LONG_HI : LONG_EN) : `Engine oil ${String(n)}`,
    titleHi: long(c) ? LONG_HI : `इंजन ऑयल ${String(n)}`,
    sku: `SKU-${String(n)}`,
    qty: n + 1,
  });
  return {
    body: {
      code: 'MD-RPR-2026-HND401-1',
      placedAt: '2026-11-15T08:30:00.000Z',
      shopName: 'Sharma Auto Parts',
      shopNameHi: 'शर्मा ऑटो पार्ट्स',
      items: kind === 'many-items' ? Array.from({ length: 9 }, (_, i) => item(i + 1)) : [item(1)],
      pincode: '492001',
      area: 'Shankar Nagar',
      areaHi: 'शंकर नगर',
      firstName: 'Ravi',
      phoneMasked: '••••••3210',
    } satisfies Dto<typeof PackingSlip>,
  };
}

/** The extra endpoints of the shop portal (CSV card, performance card); the rest is the shop portal's own mocks. */
export function tier2PortalMocks(): Mock[] {
  return [
    {
      method: 'POST',
      path: /^\/shop\/csv\/[^/]+\/preview$/,
      schema: ShopCsvPreview,
      reply: ({ c }) => preview(c),
    },
    {
      method: 'POST',
      path: /^\/shop\/csv\/[^/]+\/apply$/,
      schema: ShopCsvApplied,
      reply: () => ({
        body: { stock: 1, active: 1, priceRequests: 2 } satisfies Dto<typeof ShopCsvApplied>,
      }),
    },
    {
      method: 'GET',
      path: /^\/shop\/performance\/[^/]+$/,
      schema: ShopPerformance,
      reply: ({ c }) => performance(c),
    },
  ];
}

/** The packing slip page: the slip itself (the session's `/me` comes with the case registry). */
export function slipMocks(): Mock[] {
  return [
    {
      method: 'GET',
      path: /^\/shop\/slip\/[^/]+$/,
      schema: PackingSlip,
      reply: ({ c }) => slip(c),
    },
  ];
}
