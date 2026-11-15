/**
 * "Notify me" for a PIN code MechDost does not serve yet (spec 15 "waitlist", design 2026-11-15 item 7). A signed-in
 * customer with a verified phone or email asks to be told when MechDost reaches the PIN; there is no guest form and
 * no typed contact address (a guest-typed address would let anyone make MechDost mail a stranger). Per-PIN counts feed
 * the city launch checklist.
 */
import { z } from 'zod';

export const WAITLIST_PIN_RE = /^[1-9][0-9]{5}$/;
/** One customer can wait for this many PINs at a time. */
export const WAITLIST_MAX_ACTIVE = 5;
export const WAITLIST_STATES = ['waiting', 'notified', 'cancelled'] as const;
export type WaitlistState = (typeof WAITLIST_STATES)[number];

export const WaitlistJoinBodySchema = z.object({ pincode: z.string().regex(WAITLIST_PIN_RE) }).strict();

export const WaitlistEntryDto = z.object({
  pincode: z.string(),
  status: z.enum(WAITLIST_STATES),
  createdAt: z.string(),
  notifiedAt: z.string().nullable(),
});
export type WaitlistEntry = z.infer<typeof WaitlistEntryDto>;
export const WaitlistListDto = z.object({ entries: z.array(WaitlistEntryDto) });

/** Admin launch checklist: how many customers wait for each PIN, with its city when the PIN is known. */
export const WaitlistDemandRowDto = z.object({
  pincode: z.string(),
  cityCode: z.string().nullable(),
  area: z.string().nullable(),
  areaHi: z.string().nullable(),
  waiting: z.number().int(),
  notified: z.number().int(),
  /** The PIN is in the PIN table and switched on (customers waiting there are about to be told). */
  servedNow: z.boolean(),
  oldestAt: z.string(),
});
export const WaitlistDemandDto = z.object({
  rows: z.array(WaitlistDemandRowDto),
  totalWaiting: z.number().int(),
});
export type WaitlistDemand = z.infer<typeof WaitlistDemandDto>;
