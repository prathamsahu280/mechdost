import { sql } from 'drizzle-orm';
import { agentOfUser } from './delivery-common';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * The signed-in agent's delivered jobs per IST calendar day (decision 2026-11-27 night, Q-PP-F5): `days` days ending
 * today in IST (or `today`, for tests), zero-filled, oldest first. Actor-scoped: the agent is resolved from the user
 * (a user who is not an agent gets the same 404 as every other `/agent/me` route). Uses
 * `delivery_jobs_agent_status_idx (agent_id, status, updated_at)`; no migration.
 */
export async function agentDailyStats(db: Tx, input: { userId: string; days: number; today?: string }) {
  const a = await agentOfUser(db, input.userId);
  const days = Math.min(90, Math.max(1, Math.floor(input.days)));
  const end = input.today ? sql`${input.today}::date` : sql`(now() at time zone 'Asia/Kolkata')::date`;
  const rows = rowsOf<{ day: string; delivered: unknown }>(
    await db.execute(sql`
      with span as (
        select (g)::date as day
        from generate_series(${end} - ${days - 1}::int, ${end}, interval '1 day') as g
      ),
      done as (
        select (j.delivered_at at time zone 'Asia/Kolkata')::date as day, count(*) as n
        from delivery_jobs j
        where j.agent_id = ${a.id}::uuid and j.status = 'delivered'
          and j.delivered_at >= ((${end} - ${days - 1}::int)::timestamp at time zone 'Asia/Kolkata')
        group by 1
      )
      select to_char(span.day, 'YYYY-MM-DD') as day, coalesce(done.n, 0) as delivered
      from span left join done on done.day = span.day
      order by span.day`),
  );
  const out = rows.map((r) => ({ date: r.day, delivered: num(r.delivered) }));
  return { days: out, totalDelivered: out.reduce((sum, d) => sum + d.delivered, 0) };
}
