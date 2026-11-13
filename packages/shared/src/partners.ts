/**
 * Seller onboarding (design `docs/superpowers/specs/2026-11-13-seller-onboarding-design.md`): the application the
 * public form and the invite link send, the invite the admin creates, and the codes used for decisions.
 * One definition for the API (OpenAPI names are added there) and the web forms.
 */
import { z } from 'zod';
import { isGstEnrolmentNumber, isGstin } from './gst';

// The code lists live in a Zod-free module so browser code (the demo store on every page) can use them without
// pulling Zod into the page bundle (JS budget, spec 16; CI 2026-11-13).
export * from './partner-codes';
import { GST_STATUSES, LOCATION_SOURCES } from './partner-codes';

/** At most this many products on one application (a large shop can add more after approval). */
export const APPLICATION_PRODUCTS_MAX = 500;

/** An Indian mobile number (10 digits starting 6–9, with or without +91), stored as E.164. */
export const IndianMobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\+91)?[6-9][0-9]{9}$/))
  .transform((v) => (v.startsWith('+91') ? v : `+91${v}`));

const Text = (min: number, max: number) => z.string().trim().min(min).max(max);
const Email = z.string().trim().toLowerCase().pipe(z.email().max(120));

export const LocationSchema = z
  .object({
    lat: z.number().min(6).max(38),
    lng: z.number().min(68).max(98),
    accuracyM: z.number().int().min(0).max(100_000),
    source: z.enum(LOCATION_SOURCES),
  })
  .strict();
export type Location = z.infer<typeof LocationSchema>;

export const SellerApplicationSchema = z
  .object({
    name: Text(2, 80),
    phone: IndianMobile,
    email: Email,
    businessName: Text(2, 120),
    shopName: Text(2, 80),
    shopNameHi: Text(2, 80).optional(),
    gstStatus: z.enum(GST_STATUSES),
    gstNumber: z.string().trim().toUpperCase(),
    addressLine: Text(5, 200),
    landmark: Text(2, 120).optional(),
    pincode: z.string().regex(/^[1-9][0-9]{5}$/),
    location: LocationSchema,
    productSlugs: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/))
      .min(1)
      .max(APPLICATION_PRODUCTS_MAX)
      .refine((list) => new Set(list).size === list.length, 'duplicate products'),
    consent: z.literal(true),
  })
  .strict()
  .superRefine((app, ctx) => {
    const ok = app.gstStatus === 'registered' ? isGstin(app.gstNumber) : isGstEnrolmentNumber(app.gstNumber);
    if (!ok) ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: 'GST_NUMBER' });
  });
export type SellerApplication = z.infer<typeof SellerApplicationSchema>;

export const InviteSchema = z
  .object({
    name: Text(2, 80),
    email: Email,
    phone: IndianMobile,
  })
  .strict();
export type Invite = z.infer<typeof InviteSchema>;
