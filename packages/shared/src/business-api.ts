/**
 * Response shapes of the business application API (audience entry design 2026-11-22), validated by the web with
 * the same schemas the API documents. Request bodies are in `business-applications.ts`.
 */
import { z } from 'zod';
import { BUSINESS_APPLICATION_KINDS, TRADE_REVOKE_REASONS, TRADE_STATUSES } from './business-codes';
import { APPLICATION_REJECT_REASONS } from './partner-codes';
import { BUSINESS_APPLICATION_STATES, TRADE_ACCOUNT_STATES } from './state';

const Iso = z.string();

/** `POST /v1/me/trade-application`, `POST /v1/me/fleet-application`, `POST /v1/business-applications/fleet`. */
export const BusinessApplicationReceived = z.object({
  code: z.string(),
  status: z.enum(BUSINESS_APPLICATION_STATES),
});
export type BusinessApplicationReceivedDto = z.infer<typeof BusinessApplicationReceived>;

/** `GET /v1/me/trade`: the signed-in customer's own trade status; name and GSTIN only while verified. */
export const TradeProfile = z.object({
  status: z.enum(TRADE_STATUSES),
  businessName: z.string().nullable(),
  gstin: z.string().nullable(),
});
export type TradeProfileDto = z.infer<typeof TradeProfile>;

/** `GET /v1/catalogue/categories` as the form reads it (the rest of each category is not needed). */
export const CategoryOptions = z.object({
  categories: z.array(z.object({ slug: z.string(), name: z.string() })),
});

export const BusinessApplicationRow = z.object({
  code: z.string(),
  kind: z.enum(BUSINESS_APPLICATION_KINDS),
  status: z.enum(BUSINESS_APPLICATION_STATES),
  businessName: z.string(),
  contactName: z.string(),
  pincode: z.string(),
  businessType: z.string().nullable(),
  createdAt: Iso,
});
export type BusinessApplicationRowDto = z.infer<typeof BusinessApplicationRow>;

/** `GET /v1/admin/business-applications`. */
export const BusinessApplicationPage = z.object({
  items: z.array(BusinessApplicationRow),
  nextCursor: z.string().nullable(),
});

/** `GET /v1/admin/business-applications/{code}`. */
export const BusinessApplicationDetail = z.object({
  code: z.string(),
  kind: z.enum(BUSINESS_APPLICATION_KINDS),
  status: z.enum(BUSINESS_APPLICATION_STATES),
  version: z.number().int(),
  businessName: z.string(),
  businessType: z.string().nullable(),
  gstin: z.string().nullable(),
  spendBand: z.string().nullable(),
  categories: z.array(z.string()),
  fleet: z.object({ w2: z.number().int(), w3: z.number().int(), w4: z.number().int() }).nullable(),
  needs: z.array(z.string()),
  note: z.string().nullable(),
  contactName: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  signedIn: z.boolean(),
  pincode: z.string(),
  reasonCode: z.string().nullable(),
  createdAt: Iso,
  tradeAccount: z
    .object({
      status: z.enum(TRADE_ACCOUNT_STATES),
      version: z.number().int(),
      reasonCode: z.string().nullable(),
    })
    .nullable(),
});
export type BusinessApplicationDetailDto = z.infer<typeof BusinessApplicationDetail>;

/** The answer of a decision or a standing change. */
export const BusinessOk = z.object({ ok: z.literal(true) });

/** Decision bodies (strict): the console sends the version it saw. */
export const BusinessDecisionBody = z
  .object({
    version: z.number().int().min(1),
    decision: z.enum(['in_review', 'approved', 'rejected', 'closed']),
    reasonCode: z.enum(APPLICATION_REJECT_REASONS).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const TradeStandingBody = z
  .object({
    version: z.number().int().min(1),
    to: z.enum(TRADE_ACCOUNT_STATES),
    reasonCode: z.enum(TRADE_REVOKE_REASONS).optional(),
  })
  .strict();
