/**
 * Business applications (audience entry design 2026-11-22, item 3): a trade account application (mechanics,
 * garages, retailers buying parts; sent signed in, the account is what gets verified) and a fleet enquiry (a lead,
 * may be sent signed out). One definition for the API and the web form. Strict objects: no mass assignment.
 */
import { z } from 'zod';
import { isGstin, normaliseGstin } from './gst';
import { IndianMobile } from './partners';
import { FLEET_NEEDS, FLEET_SIZE_MAX, TRADE_BUSINESS_TYPES, TRADE_SPEND_BANDS } from './business-codes';

export * from './business-codes';

const Pincode = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/);
const Text = (min: number, max: number) => z.string().trim().min(min).max(max);
const Email = z.string().trim().toLowerCase().pipe(z.email().max(120));
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const unique = (list: readonly string[]) => new Set(list).size === list.length;

/** Optional GSTIN: empty means none; present means it must pass the checksum. */
const OptionalGstin = z
  .string()
  .max(30)
  .optional()
  .transform((v) => {
    const n = normaliseGstin(v ?? '');
    return n === '' ? undefined : n;
  })
  .refine((v) => v === undefined || isGstin(v), { message: 'GSTIN' });

export const TradeApplicationSchema = z
  .object({
    businessName: Text(2, 120),
    businessType: z.enum(TRADE_BUSINESS_TYPES),
    gstin: OptionalGstin,
    pincode: Pincode,
    spendBand: z.enum(TRADE_SPEND_BANDS),
    /** Category slugs the business buys (checked against the live catalogue by the repository). */
    categories: z.array(Slug).min(1).max(30).refine(unique, 'duplicate categories'),
    consent: z.literal(true),
  })
  .strict();
export type TradeApplication = z.infer<typeof TradeApplicationSchema>;

const FleetCount = z.number().int().min(0).max(FLEET_SIZE_MAX);

export const FleetApplicationSchema = z
  .object({
    companyName: Text(2, 120),
    fleet: z
      .object({ w2: FleetCount, w3: FleetCount, w4: FleetCount })
      .strict()
      .refine((f) => f.w2 + f.w3 + f.w4 > 0, 'FLEET_EMPTY'),
    pincode: Pincode,
    contactName: Text(2, 80),
    phone: IndianMobile,
    email: Email,
    needs: z.array(z.enum(FLEET_NEEDS)).min(1).max(FLEET_NEEDS.length).refine(unique, 'duplicate needs'),
    note: Text(1, 500).optional(),
    consent: z.literal(true),
  })
  .strict();
export type FleetApplication = z.infer<typeof FleetApplicationSchema>;
