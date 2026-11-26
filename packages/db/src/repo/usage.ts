/**
 * Usage and free-limit monitoring (founder 2026-11-26; spec 08 "Usage & limits", spec 10, migration 0103).
 *
 * The measuring itself (R2 listing, disk, memory) happens outside any transaction (`apps/api/src/usage`); this module
 * only reads the database's own numbers and stores one finished check in ONE short transaction: the run, a snapshot
 * per value, and for every metric over a threshold one `usage_alerts` row per metric + level + UTC month (the unique
 * key is the dedupe). A new alert row writes, in the same transaction, the bell notice for staff with an all-cities
 * `settings:read` grant and one email per recipient (outbox), so a rolled-back check never notifies.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  USAGE_DEFAULT_THRESHOLDS,
  USAGE_METRICS,
  USAGE_METRIC_CODES,
  USAGE_PROVIDERS,
  alertLevelFor,
  formatUsageValue,
  isUsageMetricCode,
  usageMonth,
  usagePercent,
  type UsageAlertLevel,
  type UsageMetricCode,
  type UsageProvider,
  type UsageProviderStatus,
  type UsageSource,
  type UsageTrigger,
  type UsageViewDto,
} from '@mechdost/shared/usage';
import { usageMetricName } from '@mechdost/shared/usage-copy';
import {
  auditLog,
  roles,
  usageAlertConfig,
  usageAlerts,
  usageCounters,
  usageLimits,
  usageRuns,
  usageSnapshots,
  userRoles,
  users,
} from '../schema';
import type { ActorContext } from './actor';
import { queueEmail } from './email-notifications';
import { ConflictError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { queueStaffNotice } from './notices';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

export interface UsageMeasurement {
  metric: UsageMetricCode;
  value: number;
  source: UsageSource;
  /** Measured total (server disk, memory): the limit when the admin set none. */
  total?: number;
}

export type UsageStatuses = Record<UsageProvider, UsageProviderStatus>;

interface LimitRow {
  limitValue: number | null;
  alerts: boolean;
  version: number;
}

interface AlertConfig {
  warnPct: number;
  criticalPct: number;
  recipients: string[];
  emailLocale: 'en' | 'hi';
  version: number;
}

async function readConfig(tx: Tx): Promise<AlertConfig> {
  const [c] = await tx.select().from(usageAlertConfig).where(eq(usageAlertConfig.id, 1)).limit(1);
  return c
    ? {
        warnPct: c.warnPct,
        criticalPct: c.criticalPct,
        recipients: c.recipients,
        emailLocale: c.emailLocale === 'hi' ? 'hi' : 'en',
        version: c.version,
      }
    : { ...USAGE_DEFAULT_THRESHOLDS, recipients: [], emailLocale: 'en', version: 1 };
}

export async function readUsageLimitOverrides(tx: Tx): Promise<Map<UsageMetricCode, LimitRow>> {
  const rows = await tx.select().from(usageLimits);
  const map = new Map<UsageMetricCode, LimitRow>();
  for (const r of rows)
    if (isUsageMetricCode(r.metricCode))
      map.set(r.metricCode, { limitValue: r.limitValue, alerts: r.alerts, version: r.version });
  return map;
}

/** The admin's override, else the registry default, else the measured total (disk, memory). */
export function effectiveUsageLimit(
  code: UsageMetricCode,
  override: number | null | undefined,
  measuredTotal: number | null | undefined,
): number | null {
  if (override !== null && override !== undefined && override > 0) return override;
  const def = USAGE_METRICS[code];
  if (def.defaultLimit !== null) return def.defaultLimit;
  if (def.limitFromMeasurement && measuredTotal && measuredTotal > 0) return measuredTotal;
  return null;
}

const alertsOn = (code: UsageMetricCode, row: LimitRow | undefined) =>
  row ? row.alerts : USAGE_METRICS[code].alertsByDefault;

/** Active super admins (all-cities grant) with a confirmed email: the default recipients. */
async function superAdmins(tx: Tx): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: users.id })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(roles.key, 'super_admin'),
        isNull(userRoles.cityId),
        isNull(userRoles.shopId),
        eq(users.status, 'active'),
        sql`${users.email} is not null and ${users.emailVerifiedAt} is not null`,
      ),
    );
  return rows.map((r) => r.id);
}

async function notifyAlert(
  tx: Tx,
  input: {
    metric: UsageMetricCode;
    level: UsageAlertLevel;
    period: string;
    value: number;
    limit: number;
    percent: number;
    config: AlertConfig;
  },
): Promise<void> {
  const entity = `${input.metric}:${input.level}:${input.period}`;
  const unit = USAGE_METRICS[input.metric].unit;
  const percent = String(Math.floor(input.percent));
  await queueStaffNotice(tx, {
    kind: 'staff.usage_alert',
    cityId: null,
    entityId: entity,
    version: 1,
    params: (locale) => ({ metric: usageMetricName(input.metric, locale), percent }),
  });
  const payload = (locale: 'en' | 'hi') => ({
    metric: usageMetricName(input.metric, locale),
    percent,
    value: formatUsageValue(input.value, unit),
    limit: formatUsageValue(input.limit, unit),
  });
  if (input.config.recipients.length > 0) {
    for (const email of input.config.recipients)
      await queueEmail(tx, {
        template: 'usage_limit_alert',
        entityId: `${entity}:${email.toLowerCase()}`,
        version: 1,
        to: { email, locale: input.config.emailLocale },
        payload,
      });
    return;
  }
  for (const userId of await superAdmins(tx))
    await queueEmail(tx, {
      template: 'usage_limit_alert',
      entityId: `${entity}:${userId}`,
      version: 1,
      audience: 'partner',
      userId,
      payload,
    });
}

/**
 * Store one finished check and raise its alerts. Serialised by a transaction-scoped advisory lock (two workers, or a
 * "Check now" during the daily run, never race on the alert decision); no network call happens inside.
 */
export async function recordUsageRun(
  db: Tx,
  input: {
    trigger: UsageTrigger;
    actor: ActorContext;
    startedAt: Date;
    now?: Date;
    statuses: UsageStatuses;
    measurements: readonly UsageMeasurement[];
  },
): Promise<{ runId: string; stored: number; alerts: { metric: UsageMetricCode; level: UsageAlertLevel }[] }> {
  const now = input.now ?? new Date();
  const period = usageMonth(now);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mechdost_usage_run'))`);
    const [runRow] = await tx
      .insert(usageRuns)
      .values({
        trigger: input.trigger,
        staffUserId: input.actor.type === 'admin' ? (input.actor.userId ?? null) : null,
        r2Status: input.statuses.r2,
        supabaseStatus: input.statuses.supabase,
        serverStatus: input.statuses.server,
        resendStatus: input.statuses.resend,
        startedAt: input.startedAt,
        finishedAt: now,
      })
      .returning({ id: usageRuns.id });
    if (!runRow) throw new Error('usage run not stored');
    const runId = runRow.id;
    const config = await readConfig(tx);
    const limits = await readUsageLimitOverrides(tx);
    const valid = input.measurements.filter(
      (m) => Number.isFinite(m.value) && m.value >= 0 && isUsageMetricCode(m.metric),
    );
    if (valid.length > 0)
      await tx.insert(usageSnapshots).values(
        valid.map((m) => ({
          runId,
          provider: USAGE_METRICS[m.metric].provider,
          metricCode: m.metric,
          value: Math.round(m.value),
          limitValue: effectiveUsageLimit(m.metric, limits.get(m.metric)?.limitValue, m.total),
          source: m.source,
          trigger: input.trigger,
          measuredAt: now,
        })),
      );
    const alerts: { metric: UsageMetricCode; level: UsageAlertLevel }[] = [];
    for (const m of valid) {
      const row = limits.get(m.metric);
      if (!alertsOn(m.metric, row)) continue;
      const limit = effectiveUsageLimit(m.metric, row?.limitValue, m.total);
      const percent = usagePercent(m.value, limit);
      const level = alertLevelFor(percent, config);
      if (level === 'ok' || limit === null || percent === null) continue;
      // A warning after this month's critical alert says nothing new.
      if (level === 'warn') {
        const [crit] = await tx
          .select({ id: usageAlerts.id })
          .from(usageAlerts)
          .where(
            and(
              eq(usageAlerts.metricCode, m.metric),
              eq(usageAlerts.level, 'critical'),
              eq(usageAlerts.period, period),
            ),
          )
          .limit(1);
        if (crit) continue;
      }
      const percentBp = Math.round(percent * 100);
      const inserted = await tx
        .insert(usageAlerts)
        .values({
          metricCode: m.metric,
          level,
          period,
          value: Math.round(m.value),
          limitValue: limit,
          percentBp,
          runId,
        })
        .onConflictDoNothing()
        .returning({ id: usageAlerts.id });
      if (inserted.length === 0) continue;
      alerts.push({ metric: m.metric, level });
      await notifyAlert(tx, { metric: m.metric, level, period, value: m.value, limit, percent, config });
      await recordServerEvent(tx, 'usage_alert_raised', {
        props: { metric: m.metric, level, percentBp, period },
      });
    }
    await recordServerEvent(tx, 'usage_check_run', {
      userId: input.actor.type === 'admin' ? (input.actor.userId ?? null) : null,
      props: {
        runId,
        trigger: input.trigger,
        metrics: valid.length,
        alerts: alerts.length,
        ...input.statuses,
      },
    });
    return { runId, stored: valid.length, alerts };
  });
}

/** When the last check of this kind finished (the daily job runs when the last one is older than ~23 h). */
export async function lastUsageRunAt(db: Tx, trigger?: UsageTrigger): Promise<Date | null> {
  const [r] = await db
    .select({ at: sql<Date | null>`max(${usageRuns.finishedAt})` })
    .from(usageRuns)
    .where(trigger ? eq(usageRuns.trigger, trigger) : undefined);
  const at = r?.at ?? null;
  return at === null ? null : new Date(at);
}

// ── Our own numbers ──────────────────────────────────────────────────────────────────────────────────────────

/** Add operation counts (each API instance flushes its in-memory tally; `count + n` never loses a concurrent add). */
export async function addUsageCounts(
  db: Tx,
  period: string,
  deltas: Partial<Record<UsageMetricCode, number>>,
): Promise<void> {
  const rows = Object.entries(deltas)
    .filter((e): e is [UsageMetricCode, number] => isUsageMetricCode(e[0]) && (e[1] ?? 0) > 0)
    .map(([metricCode, count]) => ({ metricCode, period, count: Math.round(count) }));
  if (rows.length === 0) return;
  await db
    .insert(usageCounters)
    .values(rows)
    .onConflictDoUpdate({
      target: [usageCounters.metricCode, usageCounters.period],
      set: { count: sql`${usageCounters.count} + excluded.count`, updatedAt: sql`now()` },
    });
}

export async function readUsageCounters(
  db: Tx,
  period: string,
): Promise<Partial<Record<UsageMetricCode, number>>> {
  const rows = await db.select().from(usageCounters).where(eq(usageCounters.period, period));
  const out: Partial<Record<UsageMetricCode, number>> = {};
  for (const r of rows) if (isUsageMetricCode(r.metricCode)) out[r.metricCode] = r.count;
  return out;
}

/** Emails our dispatcher handed to Resend this UTC month and in the last 24 hours (index `outbox_email_sent_idx`). */
export async function countSentEmails(db: Tx, now: Date): Promise<{ month: number; day: number }> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = new Date(now.getTime() - 24 * 3_600_000);
  const [r] = rowsOf<{ month: number | string; day: number | string }>(
    await db.execute(sql`
      select count(*) filter (where sent_at >= ${monthStart.toISOString()}::timestamptz) as month,
             count(*) filter (where sent_at >= ${dayStart.toISOString()}::timestamptz) as day
      from notification_outbox
      where channel = 'email' and sent_at is not null
        and sent_at >= least(${monthStart.toISOString()}::timestamptz, ${dayStart.toISOString()}::timestamptz)
        and sent_at <= ${now.toISOString()}::timestamptz`),
  );
  return { month: Number(r?.month ?? 0), day: Number(r?.day ?? 0) };
}

/**
 * Database size and Supabase Storage per bucket (read-only). Outside Supabase (tests, local Postgres) there is no
 * `storage.objects`: the database size is still read and the status is `partial`.
 */
export async function measureSupabaseUsage(
  db: Tx,
): Promise<{ status: UsageProviderStatus; measurements: UsageMeasurement[] }> {
  const [size] = rowsOf<{ bytes: number | string }>(
    await db.execute(sql`select pg_database_size(current_database()) as bytes`),
  );
  const measurements: UsageMeasurement[] = [
    { metric: 'supabase_db_bytes', value: Number(size?.bytes ?? 0), source: 'measured' },
  ];
  const [has] = rowsOf<{ ok: boolean }>(
    await db.execute(sql`select to_regclass('storage.objects') is not null as ok`),
  );
  if (!has?.ok) return { status: 'partial', measurements };
  const [st] = rowsOf<{ bytes: number | string | null; files: number | string }>(
    await db.execute(sql`
      select coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0) as bytes, count(*) as files
      from storage.objects`),
  );
  measurements.push(
    { metric: 'supabase_storage_bytes', value: Number(st?.bytes ?? 0), source: 'measured' },
    { metric: 'supabase_storage_objects_count', value: Number(st?.files ?? 0), source: 'measured' },
  );
  return { status: 'ok', measurements };
}

// ── The admin page ───────────────────────────────────────────────────────────────────────────────────────────

/** Latest value per metric, the last value of each of the last 30 days, the last run's statuses, the settings. */
export async function usageView(db: Tx, input: { canEdit: boolean; now?: Date }): Promise<UsageViewDto> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const latest = rowsOf<{
    metric_code: string;
    value: number | string;
    limit_value: number | string | null;
    source: string;
    measured_at: Date | string;
  }>(
    await db.execute(sql`
      select distinct on (metric_code) metric_code, value, limit_value, source, measured_at
      from usage_snapshots
      where metric_code in (${sql.join(
        USAGE_METRIC_CODES.map((c) => sql`${c}`),
        sql`, `,
      )})
      order by metric_code, measured_at desc`),
  );
  const daily = rowsOf<{ metric_code: string; day: string; value: number | string }>(
    await db.execute(sql`
      select distinct on (metric_code, day) metric_code, day, value from (
        select metric_code, to_char(measured_at at time zone 'UTC', 'YYYY-MM-DD') as day, value, measured_at
        from usage_snapshots where measured_at >= ${since.toISOString()}::timestamptz
      ) d
      order by metric_code, day, measured_at desc`),
  );
  const [lastRun] = await db
    .select()
    .from(usageRuns)
    .orderBy(sql`${usageRuns.finishedAt} desc`)
    .limit(1);
  const config = await readConfig(db);
  const limits = await readUsageLimitOverrides(db);
  const latestBy = new Map(latest.map((r) => [r.metric_code, r]));
  const trendBy = new Map<string, { day: string; value: number }[]>();
  for (const d of daily) {
    const list = trendBy.get(d.metric_code) ?? [];
    list.push({ day: d.day, value: Number(d.value) });
    trendBy.set(d.metric_code, list);
  }
  const statusOf: Record<UsageProvider, UsageProviderStatus | null> = lastRun
    ? {
        r2: lastRun.r2Status as UsageProviderStatus,
        supabase: lastRun.supabaseStatus as UsageProviderStatus,
        server: lastRun.serverStatus as UsageProviderStatus,
        resend: lastRun.resendStatus as UsageProviderStatus,
      }
    : { r2: null, supabase: null, server: null, resend: null };
  const iso = (d: Date | string) => new Date(d).toISOString();
  return {
    lastCheckedAt: lastRun ? iso(lastRun.finishedAt) : null,
    providers: USAGE_PROVIDERS.map((provider) => ({ provider, status: statusOf[provider] })),
    metrics: USAGE_METRIC_CODES.map((code) => {
      const def = USAGE_METRICS[code];
      const row = limits.get(code);
      const snap = latestBy.get(code);
      const value = snap ? Number(snap.value) : null;
      // The stored limit carries a measured total (disk, memory); an override saved since then wins.
      const stored =
        snap?.limit_value === null || snap?.limit_value === undefined ? null : Number(snap.limit_value);
      const limit = effectiveUsageLimit(code, row?.limitValue, def.limitFromMeasurement ? stored : null);
      const percent = value === null ? null : usagePercent(value, limit);
      const alerts = alertsOn(code, row);
      return {
        code,
        provider: def.provider,
        unit: def.unit,
        value,
        limit,
        percent,
        level: alerts ? alertLevelFor(percent, config) : 'ok',
        source: snap ? (snap.source as UsageSource) : null,
        measuredAt: snap ? iso(snap.measured_at) : null,
        limitOverride: row?.limitValue ?? null,
        alerts,
        limitVersion: row?.version ?? null,
        trend: trendBy.get(code) ?? [],
      };
    }),
    config: {
      warnPct: config.warnPct,
      criticalPct: config.criticalPct,
      recipients: config.recipients,
      emailLocale: config.emailLocale,
      version: config.version,
    },
    canEdit: input.canEdit,
  };
}

/** Set (or clear, `limit: null`) one metric's limit and its alerts. Conditional on the version; audited. */
export async function saveUsageLimit(
  db: Tx,
  input: {
    metric: string;
    limit: number | null;
    alerts: boolean;
    expectedVersion: number | null;
    actor: ActorContext;
  },
): Promise<{ version: number }> {
  if (!isUsageMetricCode(input.metric)) throw new ValidationError('Unknown metric', 'USAGE_METRIC');
  const metric = input.metric;
  if (input.limit !== null && (!Number.isSafeInteger(input.limit) || input.limit <= 0))
    throw new ValidationError('The limit must be a positive whole number', 'USAGE_LIMIT');
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(usageLimits).where(eq(usageLimits.metricCode, metric));
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(usageLimits)
        .values({
          metricCode: metric,
          limitValue: input.limit,
          alerts: input.alerts,
          updatedBy: input.actor.userId ?? null,
        })
        .onConflictDoNothing()
        .returning({ version: usageLimits.version });
    } else {
      [saved] = await tx
        .update(usageLimits)
        .set({ limitValue: input.limit, alerts: input.alerts, updatedBy: input.actor.userId ?? null })
        .where(and(eq(usageLimits.metricCode, metric), eq(usageLimits.version, input.expectedVersion)))
        .returning({ version: usageLimits.version });
    }
    if (!saved)
      throw new ConflictError('Someone else changed this limit; reload and try again', 'STALE_USAGE');
    await tx.insert(auditLog).values({
      actorUserId: input.actor.userId ?? null,
      actorRole: 'staff',
      action: 'usage.limit_saved',
      entity: 'usage_limit',
      entityId: metric,
      before: before ? { limit: before.limitValue, alerts: before.alerts, version: before.version } : null,
      after: { limit: input.limit, alerts: input.alerts, version: saved.version },
    });
    await recordServerEvent(tx, 'admin_usage_limit_saved', {
      userId: input.actor.userId ?? null,
      props: { metric, limit: input.limit, alerts: input.alerts },
    });
    return saved;
  });
}

/** Thresholds, recipients and email language. Conditional on the version; audited (addresses in the audit row only). */
export async function saveUsageAlertConfig(
  db: Tx,
  input: {
    warnPct: number;
    criticalPct: number;
    recipients: readonly string[];
    emailLocale: 'en' | 'hi';
    expectedVersion: number;
    actor: ActorContext;
  },
): Promise<{ version: number }> {
  if (!(input.warnPct >= 1 && input.criticalPct <= 100 && input.warnPct < input.criticalPct))
    throw new ValidationError('The warning must be lower than critical', 'USAGE_THRESHOLD_ORDER');
  const recipients = [
    ...new Set(input.recipients.map((r) => r.trim().toLowerCase()).filter((r) => r !== '')),
  ];
  if (recipients.length > 10) throw new ValidationError('At most 10 addresses', 'USAGE_RECIPIENTS');
  return db.transaction(async (tx) => {
    const before = await readConfig(tx);
    const [saved] = await tx
      .update(usageAlertConfig)
      .set({
        warnPct: input.warnPct,
        criticalPct: input.criticalPct,
        recipients,
        emailLocale: input.emailLocale,
        updatedBy: input.actor.userId ?? null,
      })
      .where(and(eq(usageAlertConfig.id, 1), eq(usageAlertConfig.version, input.expectedVersion)))
      .returning({ version: usageAlertConfig.version });
    if (!saved)
      throw new ConflictError('Someone else changed these settings; reload and try again', 'STALE_USAGE');
    await tx.insert(auditLog).values({
      actorUserId: input.actor.userId ?? null,
      actorRole: 'staff',
      action: 'usage.alerts_saved',
      entity: 'usage_alert_config',
      entityId: '1',
      before: {
        warnPct: before.warnPct,
        criticalPct: before.criticalPct,
        recipients: before.recipients,
        emailLocale: before.emailLocale,
        version: before.version,
      },
      after: {
        warnPct: input.warnPct,
        criticalPct: input.criticalPct,
        recipients,
        emailLocale: input.emailLocale,
        version: saved.version,
      },
    });
    await recordServerEvent(tx, 'admin_usage_alerts_saved', {
      userId: input.actor.userId ?? null,
      props: {
        warnPct: input.warnPct,
        criticalPct: input.criticalPct,
        recipients: recipients.length,
        emailLocale: input.emailLocale,
      },
    });
    return saved;
  });
}
