import { sql } from 'drizzle-orm';
import type { Tx } from './orders';

/** Readiness probe: one trivial round-trip proves the pool can reach Postgres. */
export async function ping(db: Tx): Promise<void> {
  await db.execute(sql`select 1`);
}
