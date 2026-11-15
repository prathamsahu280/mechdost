import { describe, expect, it } from 'vitest';
import {
  AcceptQuoteSchema,
  CreateQuoteSchema,
  QuoteDetailDto,
  SendOfferSchema,
  WithdrawQuoteSchema,
} from '../src/quote-api';
import { QUOTE_CODE_RE, quoteOfferTotal } from '../src/quote-rules';
import { QUOTE_OPEN_STATES, QUOTE_STATES, quoteMachine, type Actor, type QuoteStatus } from '../src/state';

/** Every legal move and who may make it (spec 19). Anything not listed must be refused for every actor. */
const ALLOWED: Record<string, readonly Actor[]> = {
  'open>negotiating': ['admin'],
  'open>offered': ['admin'],
  'negotiating>offered': ['admin'],
  'offered>accepted': ['customer'],
  'offered>negotiating': ['customer', 'system'],
  'open>declined': ['customer'],
  'negotiating>declined': ['customer'],
  'offered>declined': ['customer'],
  'open>withdrawn': ['admin'],
  'negotiating>withdrawn': ['admin'],
  'offered>withdrawn': ['admin'],
  'open>expired': ['system'],
  'negotiating>expired': ['system'],
  'offered>expired': ['system'],
};
const ACTORS: readonly Actor[] = ['customer', 'shop', 'workshop', 'admin', 'system'];

describe('quote state machine (spec 19)', () => {
  it('walks every (from, to) pair with exactly the allowed actors', () => {
    for (const from of QUOTE_STATES) {
      for (const to of QUOTE_STATES) {
        const allowed = ALLOWED[`${from}>${to}`] ?? [];
        for (const actor of ACTORS) {
          expect(quoteMachine.canActor(from, to, actor), `${from}→${to} by ${actor}`).toBe(
            allowed.includes(actor),
          );
        }
      }
    }
  });

  it('closes for good once accepted, declined, expired or withdrawn', () => {
    const open: readonly QuoteStatus[] = QUOTE_OPEN_STATES;
    for (const s of QUOTE_STATES) expect(quoteMachine.isTerminal(s)).toBe(!open.includes(s));
  });
});

describe('quote rules', () => {
  it('matches QT codes only', () => {
    expect(QUOTE_CODE_RE.test('QT-RPR-2026-7K3Q9X')).toBe(true);
    expect(QUOTE_CODE_RE.test('MD-RPR-2026-7K3Q9X')).toBe(false);
    expect(QUOTE_CODE_RE.test('QT-RPR-2026-7K3Q9I')).toBe(false);
  });

  it('totals an offer in exact paise', () => {
    expect(
      quoteOfferTotal(
        [
          { qty: 12, unitPaise: 41_000 },
          { qty: 3, unitPaise: 59_950 },
        ],
        4_000,
      ),
    ).toEqual({ subtotalPaise: 492_000 + 179_850, totalPaise: 492_000 + 179_850 + 4_000 });
  });
});

describe('quote request schemas', () => {
  const address = {
    contactName: 'Ravi Sahu',
    contactPhone: '+919876543210',
    line1: 'House 12, Pandri',
    pincode: '492004',
  };

  it('accepts a request by slug, with or without the SKU', () => {
    const r = CreateQuoteSchema.parse({
      lines: [
        { slug: 'castrol-activ-4t-20w40-900ml', qty: 12 },
        { slug: 'spark-plug-iridium', sku: 'PRT-SPK-IR', qty: 4 },
      ],
      address,
    });
    expect(r.locale).toBe('en');
  });

  it('refuses duplicates, unknown fields, bad quantities and bad phones', () => {
    const line = { slug: 'castrol-activ-4t-20w40-900ml', qty: 10 };
    expect(CreateQuoteSchema.safeParse({ lines: [line, line], address }).success).toBe(false);
    expect(CreateQuoteSchema.safeParse({ lines: [line], address, price: 1 }).success).toBe(false);
    expect(CreateQuoteSchema.safeParse({ lines: [{ ...line, qty: 100 }], address }).success).toBe(false);
    expect(
      CreateQuoteSchema.safeParse({ lines: [line], address: { ...address, contactPhone: '98765' } }).success,
    ).toBe(false);
  });

  it('needs a positive offer version to accept', () => {
    expect(AcceptQuoteSchema.safeParse({ offerVersion: 0 }).success).toBe(false);
    expect(AcceptQuoteSchema.parse({ offerVersion: 2 })).toEqual({
      offerVersion: 2,
      paymentMethod: 'cod',
      locale: 'en',
    });
    expect(AcceptQuoteSchema.parse({ offerVersion: 2, paymentMethod: 'online' }).paymentMethod).toBe(
      'online',
    );
    expect(AcceptQuoteSchema.safeParse({ offerVersion: 2, paymentMethod: 'card' }).success).toBe(false);
  });

  it('validates offers: one price per line, ₹0 refused, validity 1–30 days', () => {
    const line = { lineNo: 1, unitPaise: 41_000 };
    const offer = { version: 3, lines: [line], deliveryPaise: 0, validDays: 3 };
    expect(SendOfferSchema.safeParse(offer).success).toBe(true);
    expect(SendOfferSchema.safeParse({ ...offer, lines: [{ lineNo: 1, unitPaise: 0 }] }).success).toBe(false);
    expect(SendOfferSchema.safeParse({ ...offer, lines: [line, line] }).success).toBe(false);
    expect(SendOfferSchema.safeParse({ ...offer, validDays: 31 }).success).toBe(false);
  });

  it('asks staff for a reason code and a message to withdraw', () => {
    expect(
      WithdrawQuoteSchema.safeParse({ version: 1, reasonCode: 'cannot_supply', message: 'short' }).success,
    ).toBe(false);
    expect(
      WithdrawQuoteSchema.safeParse({
        version: 1,
        reasonCode: 'cannot_supply',
        message: 'We cannot source this many units this month.',
      }).success,
    ).toBe(true);
  });

  it('parses a detail response', () => {
    const now = new Date().toISOString();
    const detail = {
      code: 'QT-RPR-2026-7K3Q9X',
      status: 'offered',
      cityCode: 'RPR',
      pincode: '492004',
      lines: 1,
      units: 12,
      listTotalPaise: 528_000,
      lastMessageAt: now,
      lastMessageBy: 'staff',
      offer: { version: 1, totalPaise: 492_000, validUntil: now, expired: false },
      orderCode: null,
      orderPayment: null,
      createdAt: now,
      version: 4,
      lineItems: [
        {
          lineNo: 1,
          slug: 'castrol-activ-4t-20w40-900ml',
          sku: 'CAS-ACT4T-0900',
          title: 'Castrol Activ 4T',
          qty: 12,
          listUnitPaise: 44_000,
          mrpPaise: 48_000,
          costPaise: null,
          stock: null,
        },
      ],
      currentOffer: {
        version: 1,
        status: 'active',
        lines: [{ lineNo: 1, unitPaise: 41_000 }],
        subtotalPaise: 492_000,
        deliveryPaise: 0,
        totalPaise: 492_000,
        validUntil: now,
        expired: false,
        terms: null,
        createdAt: now,
      },
      messages: [
        {
          id: 'm1',
          from: 'customer',
          body: 'Need these by Friday',
          at: now,
          attachments: [
            {
              id: 'p1',
              width: 800,
              height: 600,
              thumbUrl: '/quote-photos/p1/thumb?e=1&s=x',
              largeUrl: '/quote-photos/p1/large?e=1&s=x',
            },
          ],
          seen: true,
        },
      ],
      address: {
        contactName: 'Ravi',
        contactPhone: '••••3210',
        line1: 'House 12',
        landmark: null,
        pincode: '492004',
      },
      reasonCode: null,
      closingMessage: null,
    };
    expect(QuoteDetailDto.parse(detail).currentOffer?.totalPaise).toBe(492_000);
  });
});
