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

/** Many server events of one kind in one statement (bulk actions such as a catalogue import). */
export async function recordServerEvents<E extends ServerEvent>(
  tx: Tx,
  event: E,
  input: { userId?: string | null; cityId?: string | null; props: ServerEventProps[E] }[],
): Promise<void> {
  if (input.length === 0) return;
  await tx.insert(events).values(
    input.map((i) => ({
      id: uuidv7(),
      source: 'server',
      event,
      userId: i.userId ?? null,
      cityId: i.cityId ?? null,
      props: i.props,
    })),
  );
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

/** Read position of the PostHog forwarder: the exact `received_at` (text, microseconds kept) and id of the last row. */
export interface EventCursor {
  receivedAt: string;
  id: string;
}

export interface ForwardableEvent {
  id: string;
  occurredAt: Date;
  source: string;
  event: string;
  userId: string | null;
  anonymousId: string | null;
  sessionId: string | null;
  cityId: string | null;
  page: string | null;
  props: unknown;
  consentVersion: string | null;
  cursor: EventCursor;
}

/**
 * Events to forward to PostHog (worker, decision 2026-11-14), oldest first after `after`. Only server events and
 * web/app events stored with a consent record (the API stores none without "Allow analytics"; the forwarder checks
 * the notice version again). Rows younger than `lagSeconds` wait: `received_at` is the inserting transaction's start
 * time, so a slow transaction can commit a row older than the cursor; the lag lets it land first. Without a cursor
 * the read starts `startMinutes` back (after a restart PostHog drops re-sent events by their uuid). The `occurred_at`
 * bound (client times are at most 24 h old, else replaced by the receive time) lets Postgres skip old partitions.
 */
export async function readForwardableEvents(
  db: Tx,
  input: { after: EventCursor | null; limit: number; lagSeconds: number; startMinutes: number },
): Promise<ForwardableEvent[]> {
  const position = input.after
    ? sql`(${events.receivedAt}, ${events.id}) > (${input.after.receivedAt}::timestamptz, ${input.after.id}::uuid)
        and ${events.occurredAt} >= ${input.after.receivedAt}::timestamptz - interval '25 hours'`
    : sql`${events.receivedAt} > now() - make_interval(mins => ${input.startMinutes})
        and ${events.occurredAt} >= now() - make_interval(mins => ${input.startMinutes}) - interval '25 hours'`;
  const rows = await db
    .select({
      id: events.id,
      occurredAt: events.occurredAt,
      receivedAt: sql<string>`${events.receivedAt}::text`,
      source: events.source,
      event: events.event,
      userId: events.userId,
      anonymousId: events.anonymousId,
      sessionId: events.sessionId,
      cityId: events.cityId,
      page: events.page,
      props: events.props,
      consentVersion: events.consentVersion,
    })
    .from(events)
    .where(
      sql`(${events.source} = 'server' or ${events.consentVersion} is not null)
        and ${events.receivedAt} < now() - make_interval(secs => ${input.lagSeconds})
        and ${position}`,
    )
    .orderBy(events.receivedAt, events.id)
    .limit(input.limit);
  return rows.map(({ receivedAt, ...r }) => ({ ...r, cursor: { receivedAt, id: r.id } }));
}
