import { z } from 'zod';
import { PINCODE_RE } from './geo';
import {
  RSA_BILL_LINE_KINDS,
  RSA_CANCEL_REASONS,
  RSA_DECLINE_REASONS,
  RSA_FUELS,
  RSA_MAX_ADVANCE_PAISE,
  RSA_MAX_BILL_LINES,
  RSA_MAX_BILL_PAISE,
  RSA_PROBLEM_TYPES,
  RSA_ROUTING_MODES,
  rsaLineTotalPaise,
} from './rsa';
import { VEHICLE_TYPES, type VehicleType } from './vehicles';

/** Zod request and response contracts of roadside assistance (spec 22). Constants and helpers: `rsa.ts` (Zod-free). */

const Paise = z.number().int().min(100).max(RSA_MAX_ADVANCE_PAISE);
const Minute = z.number().int().min(0).max(1439);
const VehicleTypeEnum = z.enum(VEHICLE_TYPES);
const PhoneIn = z.string().regex(/^\+91[6-9][0-9]{9}$/);

/** The admin-editable per-city settings, as stored and as sent. `version` is the compare-and-set. */
export const RsaSettingsInput = z
  .object({
    enabled: z.boolean(),
    /** The vehicle types offered in this city. 2W and 4W at launch; 3W is added here later. */
    vehicleTypes: z.array(VehicleTypeEnum).min(1).max(3),
    /** Advance per offered vehicle type, paise. Must have exactly one amount per offered type. */
    advancePaise: z.partialRecord(VehicleTypeEnum, Paise),
    pincodes: z.array(z.string().regex(PINCODE_RE)).max(300),
    alwaysOpen: z.boolean(),
    opensAtMinute: Minute,
    closesAtMinute: Minute,
    routingMode: z.enum(RSA_ROUTING_MODES),
    acceptTimerSeconds: z.number().int().min(60).max(900),
    maxAutoAttempts: z.number().int().min(1).max(10),
    problemTypes: z.array(z.enum(RSA_PROBLEM_TYPES)).min(1).max(RSA_PROBLEM_TYPES.length),
    sosPhone: PhoneIn.nullable(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((s, ctx) => {
    const offered = new Set(s.vehicleTypes);
    if (offered.size !== s.vehicleTypes.length)
      ctx.addIssue({ code: 'custom', path: ['vehicleTypes'], message: 'duplicate vehicle type' });
    for (const t of offered)
      if (s.advancePaise[t] === undefined)
        ctx.addIssue({ code: 'custom', path: ['advancePaise', t], message: 'advance missing' });
    for (const t of Object.keys(s.advancePaise))
      if (!offered.has(t as VehicleType))
        ctx.addIssue({
          code: 'custom',
          path: ['advancePaise', t],
          message: 'advance for a type not offered',
        });
    if (new Set(s.pincodes).size !== s.pincodes.length)
      ctx.addIssue({ code: 'custom', path: ['pincodes'], message: 'duplicate pincode' });
    if (!s.alwaysOpen && s.opensAtMinute === s.closesAtMinute)
      ctx.addIssue({ code: 'custom', path: ['closesAtMinute'], message: 'empty window' });
  });
export type RsaSettingsInputT = z.infer<typeof RsaSettingsInput>;

// ── customer ──────────────────────────────────────────────────────────────────────────────────────────────────

const Note = z.string().trim().min(1).max(300);

export const CreateRsaRequestBody = z
  .object({
    vehicleType: VehicleTypeEnum,
    fuel: z.enum(RSA_FUELS),
    /** Optional make/model the customer typed, snapshot on the request. */
    vehicleLabel: z.string().trim().min(1).max(60).optional(),
    /** Optional: `unknown` is the "I don't know what's wrong" choice; omitted is the same to dispatch. */
    problemType: z.enum(RSA_PROBLEM_TYPES).optional(),
    note: Note.optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    pincode: z.string().regex(PINCODE_RE),
    /** Landmark or address line the customer typed. */
    addressLine: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type CreateRsaRequestInput = z.infer<typeof CreateRsaRequestBody>;

export const RsaCodeParam = z.object({
  code: z.string().regex(/^RSA-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/),
});

// ── dispatch (admin) ──────────────────────────────────────────────────────────────────────────────────────────

export const RsaSendOfferBody = z
  .object({ workshopId: z.uuid(), expectedVersion: z.number().int().min(1) })
  .strict();
export const RsaCancelBody = z
  .object({
    reasonCode: z.enum(RSA_CANCEL_REASONS),
    note: Note.optional(),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export const RsaViewParams = z
  .object({ view: z.enum(['needs_dispatch', 'active', 'closed']).default('needs_dispatch') })
  .strict();

// ── responder (workshop) ──────────────────────────────────────────────────────────────────────────────────────

export const RsaWorkshopOptInBody = z
  .object({
    enabled: z.boolean(),
    radiusKm: z.number().int().min(1).max(50),
    vehicleTypes: z.array(VehicleTypeEnum).min(1).max(3),
    problemTypes: z.array(z.enum(RSA_PROBLEM_TYPES)).min(1),
    towing: z.boolean(),
    version: z.number().int().min(0),
  })
  .strict();
export const RsaDeclineBody = z
  .object({ reasonCode: z.enum(RSA_DECLINE_REASONS), note: Note.optional() })
  .strict();
export const RsaArrivalBody = z.object({ arrivalCode: z.string().regex(/^\d{4}$/) }).strict();
export const RsaBillLineInput = z
  .object({
    kind: z.enum(RSA_BILL_LINE_KINDS),
    description: z.string().trim().min(1).max(120),
    quantity: z.number().int().min(1).max(99),
    unitPricePaise: z.number().int().min(0).max(5_000_000),
  })
  .strict();
export const RsaBillBody = z
  .object({
    lines: z.array(RsaBillLineInput).min(1).max(RSA_MAX_BILL_LINES),
    expectedVersion: z.number().int().min(1),
  })
  .strict()
  .refine(
    (b) => {
      const total = b.lines.reduce((n, l) => n + rsaLineTotalPaise(l.quantity, l.unitPricePaise), 0);
      return total > 0 && total <= RSA_MAX_BILL_PAISE;
    },
    { message: 'bill total must be above zero and within the limit', path: ['lines'] },
  );
export const RsaVersionBody = z.object({ expectedVersion: z.number().int().min(1) }).strict();
