/**
 * Browser analytics events of the partner portals' shared kit (spec 12; design 2026-11-27 "Partner portals UI
 * upgrade" § 10; hard rule 9). Codes only — never an order code, a name or a phone. Merged into
 * `CLIENT_EVENT_SCHEMAS` (`./analytics.ts`).
 */
import { z } from 'zod';

export const PARTNER_PORTALS = ['shop', 'workshop', 'rider'] as const;
export type PartnerPortal = (typeof PARTNER_PORTALS)[number];

/** A tab, tile, lane or chart id: a short lower-case code the kit's caller chose (never user text). */
const code = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .max(40);
const portal = z.enum(PARTNER_PORTALS);

export const PARTNER_CLIENT_EVENT_SCHEMAS = {
  /** A portal tab was opened from the frame's tab bar or side rail. */
  partner_tab_viewed: z.object({ portal, tab: code }).strict(),
  /** A "Today" number tile was tapped (it links to its list). */
  partner_kpi_clicked: z.object({ portal, tile: code }).strict(),
  /** A lane (order or job state tab) was opened. */
  partner_lane_viewed: z.object({ portal, lane: code }).strict(),
  /** The partner unlocked the new-work sound (browsers need one tap) or turned it off/on again. */
  partner_sound_enabled: z.object({ portal, on: z.boolean() }).strict(),
  /** The new-work sound played for fresh work (client, once per new batch). */
  partner_offer_alert_played: z.object({ portal, count: z.number().int().min(1).max(50) }).strict(),
  /** A chart was switched to its table view or back. */
  partner_chart_table_toggled: z.object({ portal, chart: code, table: z.boolean() }).strict(),
  /** A shop tapped − or + on a stock row ("Your prices"); `refused` = the API said no (stale, below reserved). */
  partner_stock_stepped: z
    .object({ portal, direction: z.enum(['up', 'down']), result: z.enum(['saved', 'refused']) })
    .strict(),
  /** A day of the workshop Calendar strip was shown (0 = today … 6); the day itself is never sent. */
  partner_calendar_day_viewed: z.object({ portal, offset: z.number().int().min(0).max(6) }).strict(),
} as const;
