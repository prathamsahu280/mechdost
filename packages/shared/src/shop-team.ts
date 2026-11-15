/**
 * Shop portal, next tier part 1 (design `docs/superpowers/specs/2026-11-15-shops-next-tier-design.md`): the busy /
 * closed-today toggle and the shop's team (owner invites staff by phone). One definition for the API and the web.
 */
import { z } from 'zod';
import { IndianMobile } from './partners';

/** Owner + staff + invites still waiting: at most this many people per shop (design 2026-11-15). */
export const SHOP_TEAM_MAX = 10;

/** "Busy for N hours": a whole number of hours, at most this many (longer is a pause, set by staff). */
export const SHOP_BUSY_HOURS_MAX = 12;

/** The hour choices the portal offers (the API accepts any whole number up to the maximum). */
export const SHOP_BUSY_HOUR_CHOICES = [1, 2, 4, 8] as const;

export const ShopBusyBodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('closed_today') }).strict(),
  z.object({ mode: z.literal('hours'), hours: z.number().int().min(1).max(SHOP_BUSY_HOURS_MAX) }).strict(),
  z.object({ mode: z.literal('clear') }).strict(),
]);
export type ShopBusyBody = z.infer<typeof ShopBusyBodySchema>;

const IST_OFFSET_MS = 19_800_000; // +05:30, no daylight saving
const DAY_MS = 86_400_000;

/** The next midnight in India (the end of "today" in IST) after `now`. */
export function nextIstMidnight(now: Date): Date {
  return new Date((Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - IST_OFFSET_MS);
}

/** When the shop is free again for the chosen mode; null clears the toggle. */
export function busyUntilFor(body: ShopBusyBody, now: Date): Date | null {
  if (body.mode === 'clear') return null;
  if (body.mode === 'closed_today') return nextIstMidnight(now);
  return new Date(now.getTime() + body.hours * 3_600_000);
}

/** Wire name of what the busy toggle was set to (events and audit rows). */
export type ShopBusyMode = ShopBusyBody['mode'];

const Name = z.string().trim().min(2).max(60);

export const StaffInviteBodySchema = z.object({ name: Name, phone: IndianMobile }).strict();
export type StaffInviteBody = z.infer<typeof StaffInviteBodySchema>;

export const ShopTeamMember = z.object({
  userId: z.string(),
  role: z.enum(['owner', 'staff']),
  name: z.string().nullable(),
  /** Masked: the last four digits only. */
  phoneLast4: z.string().nullable(),
  /** True for the signed-in person (they cannot remove themselves here). */
  isYou: z.boolean(),
});
export const ShopTeamInvite = z.object({
  id: z.string(),
  name: z.string(),
  phoneLast4: z.string(),
  expiresAt: z.string(),
});
export const ShopTeam = z.object({
  members: z.array(ShopTeamMember),
  invites: z.array(ShopTeamInvite),
  max: z.number().int(),
});
export type ShopTeamDto = z.infer<typeof ShopTeam>;

export const ShopBusySaved = z.object({ busy: z.boolean(), busyUntil: z.string().nullable() });
export const ShopInviteSaved = z.object({ id: z.string(), expiresAt: z.string() });
export const ShopTeamOk = z.object({ ok: z.literal(true) });

/** An invite waiting for the signed-in person (their account shows "Join {shop} as staff?"). */
export const MyShopInvites = z.object({
  invites: z.array(
    z.object({
      id: z.string(),
      shopName: z.string(),
      shopNameHi: z.string().nullable(),
      /** The name the owner typed for this person. */
      invitedAs: z.string(),
      expiresAt: z.string(),
    }),
  ),
});
export const ShopInviteAccepted = z.object({ shopId: z.string() });
