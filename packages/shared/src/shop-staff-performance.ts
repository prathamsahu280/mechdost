/**
 * Shop staff performance and earnings (design 2026-11-16, spec 07): what each person on a shop's team did over the last
 * 30 or 90 days (IST days) and what the shop's payout ledger shows. The owner sees every member and the shop's ledger;
 * a staff member sees only their own row. Wire shapes shared by the API and the portal, plus the pure helpers.
 *
 * Attribution: an order step belongs to the member who performed it (the actor on the order timeline). The ledger
 * (`shop_payout_entries`, integer paise, what MechDost owes the shop) is attributed to the member who delivered the
 * order; an admin override or a removed member's work stays in the shop total only.
 */
import { z } from 'zod';
import { SHOP_PAYOUT_ENTRY_KINDS } from './coins';
import { median } from './shop-performance';

export const STAFF_PERFORMANCE_WINDOWS = [30, 90] as const;
export type StaffPerformanceWindow = (typeof STAFF_PERFORMANCE_WINDOWS)[number];

/** Who is looking: the owner sees the whole team, a staff member only themselves. */
export const STAFF_PERFORMANCE_SCOPES = ['owner', 'self'] as const;

/** The raw numbers of one person (or of the whole shop) over a window. */
export interface StaffCounts {
  accepted: number;
  packed: number;
  handedOver: number;
  delivered: number;
  giveUps: number;
  /** Seconds from offer to accept, one per order the person accepted. */
  acceptSeconds: number[];
  /** Orders the person accepted whose hand-over window has ended (or that were handed over), and how many made it. */
  due: number;
  onTime: number;
}

export const emptyStaffCounts = (): StaffCounts => ({
  accepted: 0,
  packed: 0,
  handedOver: 0,
  delivered: 0,
  giveUps: 0,
  acceptSeconds: [],
  due: 0,
  onTime: 0,
});

const bp = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part * 10_000) / whole);

/** The numbers a card shows: counts, median accept time (seconds), on-time share (basis points, null without data). */
export function staffMetricsOf(c: StaffCounts) {
  return {
    accepted: c.accepted,
    packed: c.packed,
    handedOver: c.handedOver,
    delivered: c.delivered,
    giveUps: c.giveUps,
    medianAcceptSeconds: median(c.acceptSeconds),
    onTimeBp: bp(c.onTime, c.due),
  };
}

const Metrics = z.object({
  accepted: z.number().int(),
  packed: z.number().int(),
  handedOver: z.number().int(),
  delivered: z.number().int(),
  giveUps: z.number().int(),
  medianAcceptSeconds: z.number().int().nullable(),
  onTimeBp: z.number().int().nullable(),
});

export const ShopStaffMember = Metrics.extend({
  userId: z.string(),
  /** The name the owner typed in the invite (never the account's own name), null for the owner without one. */
  name: z.string().nullable(),
  role: z.enum(['owner', 'staff']),
  isYou: z.boolean(),
  /** Ledger paise (what MechDost owes the shop) on orders this person delivered. */
  deliveredLedgerPaise: z.number().int(),
});
export type ShopStaffMemberDto = z.infer<typeof ShopStaffMember>;

export const ShopStaffEarnings = z.object({
  /** Everything the ledger shows for the shop in the window (all members, former members and admin overrides). */
  totalPaise: z.number().int(),
  byKind: z.array(
    z.object({ kind: z.enum(SHOP_PAYOUT_ENTRY_KINDS), paise: z.number().int(), entries: z.number().int() }),
  ),
  /** Paise per IST day (`YYYY-MM-DD`), newest first; days without entries are left out. */
  byDay: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paise: z.number().int() })),
});

export const ShopStaffPerformance = z.object({
  shopId: z.string(),
  days: z.union([z.literal(30), z.literal(90)]),
  /** The first IST day of the window, `YYYY-MM-DD`. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(STAFF_PERFORMANCE_SCOPES),
  onTimeHours: z.number().int(),
  members: z.array(ShopStaffMember),
  /** The whole shop's numbers; owner only (null for a staff member). */
  shop: Metrics.nullable(),
  /** The shop's ledger; owner only (null for a staff member, who sees `deliveredLedgerPaise` on their own row). */
  earnings: ShopStaffEarnings.nullable(),
});
export type ShopStaffPerformanceDto = z.infer<typeof ShopStaffPerformance>;
