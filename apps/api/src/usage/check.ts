/**
 * One usage check (founder 2026-11-26; spec 08 "Usage & limits"): measure every provider with its adapter (each
 * optional: no keys → `not_configured`, an error → `failed` and no value stored, never a 0), then store the result
 * and raise alerts in one short transaction (`recordUsageRun`). Network calls never run inside a transaction or a
 * lock. Used by the daily worker job, the admin "Check now" button and `pnpm usage:check` (print only).
 */
import {
  addUsageCounts,
  countSentEmails,
  measureSupabaseUsage,
  readUsageCounters,
  recordUsageRun,
  type Tx,
  type UsageMeasurement,
  type UsageStatuses,
} from '@mechdost/db/repo';
import type { ActorContext } from '@mechdost/db/repo';
import {
  usageMonth,
  type UsageAlertLevel,
  type UsageMetricCode,
  type UsageTrigger,
} from '@mechdost/shared/usage';
import type { Config } from '../config';
import { measureR2, r2OperationsThisMonth, type R2UsageConfig } from './r2';
import { measureServer, type ServerProbes } from './server';

export interface UsageSources {
  r2: R2UsageConfig | null;
  /** Cloudflare API token with Account Analytics: Read (exact Class A/B); null = our own estimate. */
  cloudflareToken: string | null;
  diskPath: string;
  /** Resend is on (RESEND_API_KEY): the email counts are only meaningful then. */
  emailConfigured: boolean;
  fetchImpl?: typeof fetch;
  serverProbes?: ServerProbes;
  now?: () => Date;
}

export function usageSourcesFromConfig(config: Config): UsageSources {
  const r2 = config.ustaadMedia.r2;
  return {
    r2: r2 ? { ...r2, buckets: Object.values(config.ustaadMedia.buckets) } : null,
    cloudflareToken: config.usage.cloudflareAnalyticsToken,
    diskPath: config.usage.diskPath,
    emailConfigured: Boolean(config.email),
  };
}

export interface UsageMeasureResult {
  startedAt: Date;
  finishedAt: Date;
  statuses: UsageStatuses;
  measurements: UsageMeasurement[];
  /** ListObjectsV2 calls this check made (Class A, added to our own count when stored). */
  r2ListCalls: number;
}

const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch {
    return null;
  }
};

export async function measureUsage(db: Tx, src: UsageSources): Promise<UsageMeasureResult> {
  const now = src.now ?? (() => new Date());
  const startedAt = now();
  const period = usageMonth(startedAt);
  const r2Config = src.r2;
  const [r2, server, supabase, emails, counters] = await Promise.all([
    r2Config ? safe(() => measureR2(r2Config, src.fetchImpl)) : Promise.resolve(null),
    safe(() => measureServer(src.diskPath, src.serverProbes)),
    safe(() => measureSupabaseUsage(db)),
    src.emailConfigured ? safe(() => countSentEmails(db, startedAt)) : Promise.resolve(null),
    safe(() => readUsageCounters(db, period)),
  ]);
  const ops =
    src.r2 && src.cloudflareToken
      ? await r2OperationsThisMonth(
          { accountId: src.r2.accountId, token: src.cloudflareToken, now: startedAt },
          src.fetchImpl,
        )
      : null;
  const m: UsageMeasurement[] = [];
  const statuses: UsageStatuses = {
    r2: !src.r2 ? 'not_configured' : (r2?.status ?? 'failed'),
    server: server?.status ?? 'failed',
    supabase: supabase?.status ?? 'failed',
    resend: !src.emailConfigured ? 'not_configured' : emails ? 'ok' : 'failed',
  };
  const listCalls = r2?.listCalls ?? 0;
  if (r2 && r2.status !== 'failed') {
    m.push(
      { metric: 'r2_storage_bytes', value: r2.bytes, source: 'measured' },
      { metric: 'r2_objects_count', value: r2.objects, source: 'measured' },
    );
  }
  if (src.r2) {
    if (ops)
      m.push(
        { metric: 'r2_class_a_ops_month_count', value: ops.classA, source: 'provider_api' },
        { metric: 'r2_class_b_ops_month_count', value: ops.classB, source: 'provider_api' },
      );
    else if (counters)
      m.push(
        {
          metric: 'r2_class_a_ops_month_count',
          value: (counters.r2_class_a_ops_month_count ?? 0) + listCalls,
          source: 'estimated',
        },
        {
          metric: 'r2_class_b_ops_month_count',
          value: counters.r2_class_b_ops_month_count ?? 0,
          source: 'estimated',
        },
      );
  }
  if (supabase) m.push(...supabase.measurements);
  if (server?.disk)
    m.push({
      metric: 'server_disk_used_bytes',
      value: server.disk.used,
      source: 'measured',
      total: server.disk.total,
    });
  if (server?.memory)
    m.push({
      metric: 'server_memory_used_bytes',
      value: server.memory.used,
      source: 'measured',
      total: server.memory.total,
    });
  if (emails)
    m.push(
      { metric: 'resend_emails_month_count', value: emails.month, source: 'estimated' },
      { metric: 'resend_emails_day_count', value: emails.day, source: 'estimated' },
    );
  return { startedAt, finishedAt: now(), statuses, measurements: m, r2ListCalls: listCalls };
}

export interface UsageRunResult {
  runId: string;
  stored: number;
  alerts: { metric: UsageMetricCode; level: UsageAlertLevel }[];
  statuses: UsageStatuses;
}

/** Measure, then store and alert. */
export async function runUsageCheck(
  db: Tx,
  src: UsageSources,
  input: { trigger: UsageTrigger; actor: ActorContext },
): Promise<UsageRunResult> {
  return storeUsageCheck(db, await measureUsage(db, src), input);
}

/** Store a finished measurement and raise its alerts (the listing calls join our own Class A count). */
export async function storeUsageCheck(
  db: Tx,
  r: UsageMeasureResult,
  input: { trigger: UsageTrigger; actor: ActorContext },
): Promise<UsageRunResult> {
  if (r.r2ListCalls > 0)
    await addUsageCounts(db, usageMonth(r.startedAt), { r2_class_a_ops_month_count: r.r2ListCalls });
  const stored = await recordUsageRun(db, {
    trigger: input.trigger,
    actor: input.actor,
    startedAt: r.startedAt,
    now: r.finishedAt,
    statuses: r.statuses,
    measurements: r.measurements,
  });
  return { ...stored, statuses: r.statuses };
}
