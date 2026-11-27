/**
 * `GET /v1/agent/me/stats?days=` (decision 2026-11-27 night, Q-PP-F5; design "Partner portals UI upgrade" § 7): the
 * signed-in rider's delivered jobs per IST calendar day, oldest first, every day present (zero-filled).
 */
import { z } from 'zod';

export const AGENT_STATS_DAYS_MIN = 7;
export const AGENT_STATS_DAYS_MAX = 90;
export const AGENT_STATS_DAYS_DEFAULT = 14;

export const AgentStatsQuery = z
  .object({
    days: z.coerce
      .number()
      .int()
      .min(AGENT_STATS_DAYS_MIN)
      .max(AGENT_STATS_DAYS_MAX)
      .default(AGENT_STATS_DAYS_DEFAULT),
  })
  .strict();

export const AgentDailyStats = z.object({
  /** IST calendar days, oldest first; `date` is `YYYY-MM-DD`. */
  days: z.array(
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), delivered: z.number().int().min(0) }),
  ),
  totalDelivered: z.number().int().min(0),
});
export type AgentDailyStatsDto = z.infer<typeof AgentDailyStats>;
