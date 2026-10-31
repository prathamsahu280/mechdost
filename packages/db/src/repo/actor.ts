import { sql } from 'drizzle-orm';
import type { Actor } from '@mechdost/shared/state';

export interface ActorContext {
  type: Actor;
  userId?: string | null;
}

/** Minimal transaction surface shared by postgres-js and PGlite Drizzle transactions. */
export interface SqlExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

/**
 * Record who is acting for the remainder of the current transaction. Database triggers (order_events)
 * read these settings, so every timeline row carries the real actor.
 */
export async function setActor(tx: SqlExecutor, actor: ActorContext): Promise<void> {
  await tx.execute(
    sql`select set_config('app.actor_type', ${actor.type}, true), set_config('app.actor_id', ${actor.userId ?? ''}, true)`,
  );
}
