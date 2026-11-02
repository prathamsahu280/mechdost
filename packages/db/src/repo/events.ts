import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ServerEvent, ServerEventProps } from '@mechdost/shared/analytics';
import { uuidv7 } from '../schema/_common';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * First-party event store (created in 0002, completed in 0030; spec 12). The table is partitioned by month in SQL
 * and therefore not part of the Drizzle schema; this object mirrors its columns for typed inserts and reads.
 */
export const events = pgTable('events', {
  id: uuid().notNull(),
  occurredAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  receivedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  source: text().notNull(),
  event: text().notNull(),
  userId: uuid(),
  anonymousId: text(),
  sessionId: text(),
  cityId: uuid(),
  vehicleId: uuid(),
  page: text(),
  props: jsonb().notNull(),
  device: jsonb(),
  consentVersion: text(),
});

/**
 * Record a server event in the caller's transaction (rolled back with it). `userId` is the acting user (customer,
 * shop user or staff member); props are ids/codes only (type-checked by `ServerEventProps`).
 */
export async function recordServerEvent<E extends ServerEvent>(
  tx: Tx,
  event: E,
  input: { userId?: string | null; cityId?: string | null; props: ServerEventProps[E] },
): Promise<void> {
  await tx.insert(events).values({
    id: uuidv7(),
    source: 'server',
    event,
    userId: input.userId ?? null,
    cityId: input.cityId ?? null,
    props: input.props,
  });
}

/** Create this month's and the next `monthsAhead` months' partitions (worker, daily). Returns how many were new. */
export async function ensureEventPartitions(db: Tx, monthsAhead = 3): Promise<number> {
  const [row] = rowsOf<{ created: unknown }>(
    await db.execute(sql`select public.ensure_event_partitions(${monthsAhead}) as created`),
  );
  return num(row?.created ?? 0);
}

export interface ClientEventRow {
  event: string;
  occurredAt: Date;
  page: string | null;
  props: Record<string, unknown>;
}

/** Store a validated batch of web/app events in one statement (the API validated names and props). */
export async function recordClientEvents(
  db: Tx,
  input: {
    source: 'web' | 'app';
    anonymousId: string;
    sessionId: string | null;
    consentVersion: string | null;
    rows: readonly ClientEventRow[];
  },
): Promise<number> {
  if (input.rows.length === 0) return 0;
  await db.insert(events).values(
    input.rows.map((r) => ({
      id: uuidv7(),
      occurredAt: r.occurredAt,
      source: input.source,
      event: r.event,
      anonymousId: input.anonymousId,
      sessionId: input.sessionId,
      page: r.page,
      props: r.props,
      consentVersion: input.consentVersion,
    })),
  );
  return input.rows.length;
}
