/**
 * Business purchase at checkout (design 2026-11-13, buyer GSTIN): optional; both fields or neither. One schema
 * for the browser form, the API body and (through the API) the database snapshot on `order_groups`.
 */
import { z } from 'zod';
import { isGstin, normaliseGstin } from './gst';

export const BusinessPurchaseSchema = z
  .object({
    gstin: z.string().max(30).transform(normaliseGstin).refine(isGstin, { message: 'Check the GSTIN' }),
    businessName: z.string().trim().min(2).max(120),
  })
  .strict();

export type BusinessPurchase = z.infer<typeof BusinessPurchaseSchema>;
