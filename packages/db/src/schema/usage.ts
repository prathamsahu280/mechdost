/**
 * Usage and free-limit monitoring (founder 2026-11-26; spec 08 "Usage & limits", migration 0103). Codes and defaults
 * live in `@mechdost/shared/usage` (single source). Snapshots and alerts are append-only (ML-ready: metric code with
 * its unit, bigint value, UTC time, run id); limits and the alert settings are the admin's (hard rule 8), versioned.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  USAGE_ALERT_LEVELS,
  USAGE_METRIC_CODES,
  USAGE_PROVIDER_STATUSES,
  USAGE_PROVIDERS,
  USAGE_SOURCES,
  USAGE_TRIGGERS,
} from '@mechdost/shared/usage';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { users } from './identity';
import { oneOf } from './ustaad-common';

const big = () => bigint({ mode: 'number' });

const status = () => text().notNull();

/** One row per stored check: who or what started it and how each provider answered (append-only). */
export const usageRuns = pgTable(
  'usage_runs',
  {
    id: id(),
    trigger: text().notNull(),
    /** Staff member who pressed "Check now"; null for the daily job. */
    staffUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    r2Status: status(),
    supabaseStatus: status(),
    serverStatus: status(),
    resendStatus: status(),
    startedAt: ts().notNull(),
    finishedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('usage_runs_finished_idx').on(t.finishedAt),
    index().on(t.staffUserId),
    check('usage_runs_trigger_valid', oneOf(t.trigger, USAGE_TRIGGERS)),
    check('usage_runs_r2_valid', oneOf(t.r2Status, USAGE_PROVIDER_STATUSES)),
    check('usage_runs_supabase_valid', oneOf(t.supabaseStatus, USAGE_PROVIDER_STATUSES)),
    check('usage_runs_server_valid', oneOf(t.serverStatus, USAGE_PROVIDER_STATUSES)),
    check('usage_runs_resend_valid', oneOf(t.resendStatus, USAGE_PROVIDER_STATUSES)),
  ],
);

/** One row per metric per check run. Failed providers write nothing (never a 0). */
export const usageSnapshots = pgTable(
  'usage_snapshots',
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => usageRuns.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    metricCode: text().notNull(),
    value: big().notNull(),
    /** The limit that applied at the time (override, default or measured total); null = none. */
    limitValue: big(),
    source: text().notNull(),
    trigger: text().notNull(),
    measuredAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('usage_snapshots_metric_measured_idx').on(t.metricCode, t.measuredAt),
    index('usage_snapshots_measured_idx').on(t.measuredAt),
    index().on(t.runId),
    check('usage_snapshots_provider_valid', oneOf(t.provider, USAGE_PROVIDERS)),
    check('usage_snapshots_metric_valid', oneOf(t.metricCode, USAGE_METRIC_CODES)),
    check('usage_snapshots_source_valid', oneOf(t.source, USAGE_SOURCES)),
    check('usage_snapshots_trigger_valid', oneOf(t.trigger, USAGE_TRIGGERS)),
    check('usage_snapshots_value', sql`${t.value} >= 0 and (${t.limitValue} is null or ${t.limitValue} > 0)`),
  ],
);

/** Admin overrides per metric (no row = the registry default, alerts as `alertsByDefault`). */
export const usageLimits = pgTable(
  'usage_limits',
  {
    metricCode: text().primaryKey(),
    limitValue: big(),
    alerts: boolean().notNull(),
    version: version(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.updatedBy),
    check('usage_limits_metric_valid', oneOf(t.metricCode, USAGE_METRIC_CODES)),
    check('usage_limits_positive', sql`${t.limitValue} is null or ${t.limitValue} > 0`),
  ],
);

/** The one row of alert settings (thresholds, recipients, email language). */
export const usageAlertConfig = pgTable(
  'usage_alert_config',
  {
    id: smallint().primaryKey().default(1),
    warnPct: integer().notNull().default(70),
    criticalPct: integer().notNull().default(90),
    /** Extra addresses typed by the admin; empty = active super admins with a verified email. */
    recipients: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    emailLocale: text().notNull().default('en'),
    version: version(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.updatedBy),
    check('usage_alert_config_single', sql`${t.id} = 1`),
    check(
      'usage_alert_config_thresholds',
      sql`${t.warnPct} between 1 and 100 and ${t.criticalPct} between 1 and 100 and ${t.warnPct} < ${t.criticalPct}`,
    ),
    check('usage_alert_config_recipients', sql`cardinality(${t.recipients}) <= 10`),
    check('usage_alert_config_locale', oneOf(t.emailLocale, ['en', 'hi'])),
  ],
);

/** One alert per metric, level and UTC month: the unique key is the dedupe (append-only). */
export const usageAlerts = pgTable(
  'usage_alerts',
  {
    id: id(),
    metricCode: text().notNull(),
    level: text().notNull(),
    period: text().notNull(),
    value: big().notNull(),
    limitValue: big().notNull(),
    /** Percent of the limit in basis points (7000 = 70 %). */
    percentBp: integer().notNull(),
    runId: uuid()
      .notNull()
      .references(() => usageRuns.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('usage_alerts_once_uq').on(t.metricCode, t.level, t.period),
    index().on(t.runId),
    index('usage_alerts_created_idx').on(t.createdAt),
    check('usage_alerts_metric_valid', oneOf(t.metricCode, USAGE_METRIC_CODES)),
    check('usage_alerts_level_valid', oneOf(t.level, USAGE_ALERT_LEVELS)),
    check('usage_alerts_period_format', sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check('usage_alerts_numbers', sql`${t.value} >= 0 and ${t.limitValue} > 0 and ${t.percentBp} >= 0`),
  ],
);

/**
 * Our own operation counts per month (R2 Class A/B through the counting media host; flushed in batches by each API
 * instance with `count = count + n`, so instances never overwrite each other).
 */
export const usageCounters = pgTable(
  'usage_counters',
  {
    metricCode: text().notNull(),
    period: text().notNull(),
    count: big().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.metricCode, t.period] }),
    check('usage_counters_metric_valid', oneOf(t.metricCode, USAGE_METRIC_CODES)),
    check('usage_counters_period_format', sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check('usage_counters_count', sql`${t.count} >= 0`),
  ],
);
