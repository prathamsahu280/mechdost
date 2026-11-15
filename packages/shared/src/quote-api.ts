/**
 * Bulk quotes (spec 19): the request DTOs the API validates and the response shapes the website parses (hard
 * rule 4), one definition for both. The API adds OpenAPI names; the web loads this module only from the real-mode
 * quote screens (lazy chunks). Money in integer paise, times as ISO strings, reasons as codes (hard rule 16).
 * The database layer must not import this module at runtime (L101/L102); it uses `quote-rules.ts`.
 */
import { z } from 'zod';
import {
  QUOTE_CODE_RE,
  QUOTE_LINE_MAX_QTY,
  QUOTE_MAX_LINES,
  QUOTE_MESSAGE_MAX,
  QUOTE_OFFER_MAX_DAYS,
  QUOTE_OFFER_MAX_DELIVERY_PAISE,
  QUOTE_OFFER_MAX_UNIT_PAISE,
  QUOTE_OFFER_MIN_DAYS,
  QUOTE_TERMS_MAX,
  QUOTE_WITHDRAW_MESSAGE_MAX,
  QUOTE_WITHDRAW_MESSAGE_MIN,
} from './quote-rules';
import { QUOTE_DECLINE_REASONS, QUOTE_OFFER_STATES, QUOTE_STATES, QUOTE_WITHDRAW_REASONS } from './state';

export { QUOTE_CODE_RE } from './quote-rules';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,47}$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;
const version = z.number().int().min(1);

// ── requests ──────────────────────────────────────────────────────────────────────────────────────────────────

/** One product line: the catalogue slug, optionally the pack's SKU (else the product's first pack). */
export const QuoteLineInputSchema = z
  .object({
    slug: z.string().regex(SLUG_RE),
    sku: z.string().regex(SKU_RE).nullable().optional(),
    qty: z.number().int().min(1).max(QUOTE_LINE_MAX_QTY),
  })
  .strict();

export const CreateQuoteSchema = z
  .object({
    lines: z
      .array(QuoteLineInputSchema)
      .min(1)
      .max(QUOTE_MAX_LINES)
      .refine((ls) => new Set(ls.map((l) => `${l.slug}|${l.sku ?? ''}`)).size === ls.length, {
        message: 'Each product appears once',
      }),
    address: z
      .object({
        contactName: text(2, 80),
        contactPhone: z.string().regex(/^\+91[6-9][0-9]{9}$/),
        line1: text(5, 200),
        landmark: text(1, 120).nullable().optional(),
        pincode: z.string().regex(PINCODE_RE),
      })
      .strict(),
    note: text(1, QUOTE_MESSAGE_MAX).nullable().optional(),
    locale: z.enum(['en', 'hi']).default('en'),
  })
  .strict();
export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>;

export const QuoteMessageSchema = z.object({ body: text(1, QUOTE_MESSAGE_MAX) }).strict();
export type QuoteMessageInput = z.infer<typeof QuoteMessageSchema>;

/** Accept exactly the offer version the customer saw. */
export const AcceptQuoteSchema = z
  .object({
    offerVersion: version,
    /** Cash on delivery (default; capped by `quotes.cod_cap_paise`) or online with Razorpay. */
    paymentMethod: z.enum(['cod', 'online']).default('cod'),
    locale: z.enum(['en', 'hi']).default('en'),
  })
  .strict();
export type AcceptQuoteInput = z.infer<typeof AcceptQuoteSchema>;

export const DeclineQuoteSchema = z.object({ reasonCode: z.enum(QUOTE_DECLINE_REASONS) }).strict();
export type DeclineQuoteInput = z.infer<typeof DeclineQuoteSchema>;

/** Staff offer: a unit price for every line (GST-inclusive, paise), delivery, validity and terms. */
export const SendOfferSchema = z
  .object({
    version,
    lines: z
      .array(
        z
          .object({
            lineNo: z.number().int().min(1).max(QUOTE_MAX_LINES),
            unitPaise: z.number().int().min(1).max(QUOTE_OFFER_MAX_UNIT_PAISE),
          })
          .strict(),
      )
      .min(1)
      .max(QUOTE_MAX_LINES)
      .refine((ls) => new Set(ls.map((l) => l.lineNo)).size === ls.length, {
        message: 'Each line appears once',
      }),
    deliveryPaise: z.number().int().min(0).max(QUOTE_OFFER_MAX_DELIVERY_PAISE),
    validDays: z.number().int().min(QUOTE_OFFER_MIN_DAYS).max(QUOTE_OFFER_MAX_DAYS),
    terms: text(1, QUOTE_TERMS_MAX).nullable().optional(),
    /** Staff confirm a unit price below the shop price or under a tenth of the list price (rupee/paise slips). */
    confirmLowPrices: z.boolean().optional(),
  })
  .strict();
export type SendOfferInput = z.infer<typeof SendOfferSchema>;

export const StaffQuoteMessageSchema = QuoteMessageSchema;

export const WithdrawQuoteSchema = z
  .object({
    version,
    reasonCode: z.enum(QUOTE_WITHDRAW_REASONS),
    message: text(QUOTE_WITHDRAW_MESSAGE_MIN, QUOTE_WITHDRAW_MESSAGE_MAX),
  })
  .strict();
export type WithdrawQuoteInput = z.infer<typeof WithdrawQuoteSchema>;

export const QuoteCodeSchema = z.string().regex(QUOTE_CODE_RE);

// ── responses ─────────────────────────────────────────────────────────────────────────────────────────────────

export const QuoteRulesDto = z.object({
  minUnits: z.number().int(),
  maxLines: z.number().int(),
  maxQty: z.number().int(),
  openLimit: z.number().int(),
  /** The signed-in customer's open quotes right now. */
  open: z.number().int(),
});
export type QuoteRules = z.infer<typeof QuoteRulesDto>;

export const QuoteCreatedDto = z.object({
  code: z.string(),
  status: z.enum(QUOTE_STATES),
  version: z.number().int(),
});

export const QuoteChangedDto = z.object({ status: z.enum(QUOTE_STATES), version: z.number().int() });
export type QuoteChanged = z.infer<typeof QuoteChangedDto>;

export const QuoteOfferSentDto = QuoteChangedDto.extend({ offerVersion: z.number().int() });

export const QuoteAcceptedDto = z.object({
  /** The order group (MD-…) created from the offer. */
  orderCode: z.string(),
  totalPaise: z.number().int(),
  replayed: z.boolean(),
  paymentMethod: z.enum(['cod', 'online']),
  /** Online only: what the browser needs to open Razorpay Checkout (null once paid or expired). */
  razorpay: z
    .object({
      keyId: z.string(),
      orderId: z.string(),
      amountPaise: z.number().int(),
      currency: z.literal('INR'),
    })
    .nullable()
    .optional(),
});
export type QuoteAccepted = z.infer<typeof QuoteAcceptedDto>;

const OfferBrief = z.object({
  version: z.number().int(),
  totalPaise: z.number().int(),
  validUntil: z.string(),
  expired: z.boolean(),
});

export const QuoteSummaryDto = z.object({
  code: z.string(),
  status: z.enum(QUOTE_STATES),
  cityCode: z.string(),
  pincode: z.string(),
  lines: z.number().int(),
  units: z.number().int(),
  /** Sum of the catalogue prices at request time (null when a product had no price for the PIN). */
  listTotalPaise: z.number().int().nullable(),
  lastMessageAt: z.string().nullable(),
  lastMessageBy: z.enum(['customer', 'staff']).nullable(),
  offer: OfferBrief.nullable(),
  orderCode: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type QuoteSummary = z.infer<typeof QuoteSummaryDto>;

export const QuotePageDto = z.object({ items: z.array(QuoteSummaryDto), nextCursor: z.string().nullable() });
export type QuotePage = z.infer<typeof QuotePageDto>;

export const QuoteLineDto = z.object({
  lineNo: z.number().int(),
  slug: z.string(),
  sku: z.string(),
  /** Brand + product name in the request's locale (Hindi with the English fallback). */
  title: z.string(),
  qty: z.number().int(),
  listUnitPaise: z.number().int().nullable(),
  mrpPaise: z.number().int(),
  /** Staff only (null for customers): the lowest approved shop price that can supply the line at the PIN. */
  costPaise: z.number().int().nullable(),
  /** Staff only (null for customers): the most units one covering shop has free right now. */
  stock: z.number().int().nullable(),
});
export type QuoteLine = z.infer<typeof QuoteLineDto>;

export const QuoteOfferDto = z.object({
  version: z.number().int(),
  status: z.enum(QUOTE_OFFER_STATES),
  lines: z.array(z.object({ lineNo: z.number().int(), unitPaise: z.number().int() })),
  subtotalPaise: z.number().int(),
  deliveryPaise: z.number().int(),
  totalPaise: z.number().int(),
  validUntil: z.string(),
  expired: z.boolean(),
  terms: z.string().nullable(),
  createdAt: z.string(),
});
export type QuoteOffer = z.infer<typeof QuoteOfferDto>;

export const QuoteMessageDto = z.object({
  id: z.string(),
  from: z.enum(['customer', 'staff', 'system']),
  body: z.string(),
  at: z.string(),
});
export type QuoteMessage = z.infer<typeof QuoteMessageDto>;

export const QuoteDetailDto = QuoteSummaryDto.extend({
  lineItems: z.array(QuoteLineDto),
  /** The offer the customer can act on (active), or the accepted one; null before the first offer. */
  currentOffer: QuoteOfferDto.nullable(),
  messages: z.array(QuoteMessageDto),
  address: z.object({
    contactName: z.string(),
    /** Staff see only the last four digits. */
    contactPhone: z.string(),
    line1: z.string(),
    landmark: z.string().nullable(),
    pincode: z.string(),
  }),
  /** Why the quote closed (decline / withdraw / expiry code) and staff's message on a withdrawal. */
  reasonCode: z.string().nullable(),
  closingMessage: z.string().nullable(),
});
export type QuoteDetail = z.infer<typeof QuoteDetailDto>;

/** Admin queue views (spec 19): needs our reply, all active, offered, offers running out within 24 h, closed. */
export const ADMIN_QUOTE_VIEWS = ['waiting', 'active', 'offered', 'expiring', 'closed'] as const;
export type AdminQuoteView = (typeof ADMIN_QUOTE_VIEWS)[number];
