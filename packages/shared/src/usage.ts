/**
 * Usage and free-limit monitoring (founder 2026-11-26: "list the storage and stuff … give me warnings when we are
 * about to exceed the free limits"; spec 08 "Usage & limits", spec 10, runbook monitoring.md).
 *
 * One typed registry of what is measured. Codes carry their unit (`_bytes`, `_count`; hard rule 16). Defaults are the
 * published free plans, checked 2026-11-26 (sources in docs/runbooks/monitoring.md "Usage & limits"); the admin
 * overrides any limit (table `usage_limits`, hard rule 8). Decimal units (1 GB = 10^9 bytes) are used on purpose:
 * where a provider does not say, the smaller reading warns earlier.
 */
import { z } from 'zod';

export const USAGE_PROVIDERS = ['r2', 'supabase', 'server', 'resend'] as const;
export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

export interface UsageMetricDef {
  provider: UsageProvider;
  unit: 'bytes' | 'count';
  /** Free-plan limit; null = no limit (shown as a number only). */
  defaultLimit: number | null;
  /** The limit is the measured total (server disk, memory) unless the admin sets one. */
  limitFromMeasurement: boolean;
  /** Counted from our own records, not read from the provider: shown with the "estimated" label. */
  estimated: boolean;
  /** Alerts on unless the admin switches them; memory is a moment's reading, so off by default. */
  alertsByDefault: boolean;
}

const def = (d: UsageMetricDef) => d;

export const USAGE_METRICS = {
  r2_storage_bytes: def({
    provider: 'r2',
    unit: 'bytes',
    defaultLimit: 10_000_000_000,
    limitFromMeasurement: false,
    estimated: false,
    alertsByDefault: true,
  }),
  r2_objects_count: def({
    provider: 'r2',
    unit: 'count',
    defaultLimit: null,
    limitFromMeasurement: false,
    estimated: false,
    alertsByDefault: false,
  }),
  r2_class_a_ops_month_count: def({
    provider: 'r2',
    unit: 'count',
    defaultLimit: 1_000_000,
    limitFromMeasurement: false,
    estimated: true,
    alertsByDefault: true,
  }),
  r2_class_b_ops_month_count: def({
    provider: 'r2',
    unit: 'count',
    defaultLimit: 10_000_000,
    limitFromMeasurement: false,
    estimated: true,
    alertsByDefault: true,
  }),
  supabase_db_bytes: def({
    provider: 'supabase',
    unit: 'bytes',
    defaultLimit: 500_000_000,
    limitFromMeasurement: false,
    estimated: false,
    alertsByDefault: true,
  }),
  supabase_storage_bytes: def({
    provider: 'supabase',
    unit: 'bytes',
    defaultLimit: 1_000_000_000,
    limitFromMeasurement: false,
    estimated: false,
    alertsByDefault: true,
  }),
  supabase_storage_objects_count: def({
    provider: 'supabase',
    unit: 'count',
    defaultLimit: null,
    limitFromMeasurement: false,
    estimated: false,
    alertsByDefault: false,
  }),
  server_disk_used_bytes: def({
    provider: 'server',
    unit: 'bytes',
    defaultLimit: null,
    limitFromMeasurement: true,
    estimated: false,
    alertsByDefault: true,
  }),
  server_memory_used_bytes: def({
    provider: 'server',
    unit: 'bytes',
    defaultLimit: null,
    limitFromMeasurement: true,
    estimated: false,
    alertsByDefault: false,
  }),
  resend_emails_month_count: def({
    provider: 'resend',
    unit: 'count',
    defaultLimit: 3_000,
    limitFromMeasurement: false,
    estimated: true,
    alertsByDefault: true,
  }),
  resend_emails_day_count: def({
    provider: 'resend',
    unit: 'count',
    defaultLimit: 100,
    limitFromMeasurement: false,
    estimated: true,
    alertsByDefault: true,
  }),
} as const satisfies Record<string, UsageMetricDef>;

export type UsageMetricCode = keyof typeof USAGE_METRICS;
export const USAGE_METRIC_CODES = Object.keys(USAGE_METRICS) as UsageMetricCode[];
export const isUsageMetricCode = (s: string): s is UsageMetricCode => Object.hasOwn(USAGE_METRICS, s);

/** Where a stored value came from: our own measurement, our own count (estimated) or the provider's analytics. */
export const USAGE_SOURCES = ['measured', 'estimated', 'provider_api'] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];
export const USAGE_TRIGGERS = ['schedule', 'manual', 'cli'] as const;
export type UsageTrigger = (typeof USAGE_TRIGGERS)[number];
export const USAGE_ALERT_LEVELS = ['warn', 'critical'] as const;
export type UsageAlertLevel = (typeof USAGE_ALERT_LEVELS)[number];
/** Per provider in one check: measured, not set up on this server, failed, or cut short (values are a floor). */
export const USAGE_PROVIDER_STATUSES = ['ok', 'not_configured', 'failed', 'partial'] as const;
export type UsageProviderStatus = (typeof USAGE_PROVIDER_STATUSES)[number];

export const USAGE_DEFAULT_THRESHOLDS = { warnPct: 70, criticalPct: 90 } as const;

/** Percent of the limit, one decimal; null without a positive limit. */
export function usagePercent(value: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return Math.round((value / limit) * 1000) / 10;
}

/** The highest threshold reached (so crossing 70 and 90 at once sends only the 90 alert). */
export function alertLevelFor(
  percent: number | null,
  t: { warnPct: number; criticalPct: number },
): 'ok' | UsageAlertLevel {
  if (percent === null) return 'ok';
  if (percent >= t.criticalPct) return 'critical';
  if (percent >= t.warnPct) return 'warn';
  return 'ok';
}

const BYTE_UNITS = [
  ['TB', 1e12],
  ['GB', 1e9],
  ['MB', 1e6],
  ['KB', 1e3],
] as const;
const oneDecimal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
/** No-break space between a number and its unit, so "7.2 GB" never wraps (web interface guidelines). */
export const UNIT_SPACE = String.fromCharCode(0xa0);

/**
 * A value for people: bytes in decimal units (1 GB = 10^9, like the limits), counts with Indian grouping. Digits stay
 * Latin and units stay as they are in both languages (design-system.md § Hindi content).
 */
export function formatUsageValue(value: number, unit: 'bytes' | 'count'): string {
  if (unit === 'count') return whole.format(value);
  for (const [name, size] of BYTE_UNITS)
    if (value >= size) return `${oneDecimal.format(value / size)}${UNIT_SPACE}${name}`;
  return `${whole.format(value)}${UNIT_SPACE}B`;
}

/** The alert period: one alert per metric and level per UTC calendar month. */
export const usageMonth = (d: Date): string => d.toISOString().slice(0, 7);

// ── API shapes (`/v1/admin/usage`) ───────────────────────────────────────────────────────────────────────────────

const Pct = z.number().int().min(1).max(100);

export const UsageAlertConfigInput = z
  .object({
    warnPct: Pct,
    criticalPct: Pct,
    /** Empty = every active super admin with a verified email. */
    recipients: z.array(z.email().max(254)).max(10),
    /** Language of the alert email for the addresses typed here (accounts get their own language). */
    emailLocale: z.enum(['en', 'hi']),
    expectedVersion: z.number().int().min(1),
  })
  .strict()
  .refine((v) => v.warnPct < v.criticalPct, { path: ['warnPct'], message: 'USAGE_THRESHOLD_ORDER' });
export type UsageAlertConfigInputDto = z.infer<typeof UsageAlertConfigInput>;

export const UsageLimitInput = z
  .object({
    /** Null = back to the default (free plan, or the measured total for disk and memory). */
    limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    alerts: z.boolean(),
    /** Null when no override row exists yet. */
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .strict();
export type UsageLimitInputDto = z.infer<typeof UsageLimitInput>;

export const UsagePoint = z.object({ day: z.string(), value: z.number() });

export const UsageMetricView = z.object({
  code: z.enum(USAGE_METRIC_CODES as [UsageMetricCode, ...UsageMetricCode[]]),
  provider: z.enum(USAGE_PROVIDERS),
  unit: z.enum(['bytes', 'count']),
  value: z.number().nullable(),
  limit: z.number().nullable(),
  percent: z.number().nullable(),
  level: z.enum(['ok', 'warn', 'critical']),
  source: z.enum(USAGE_SOURCES).nullable(),
  measuredAt: z.string().nullable(),
  /** Admin override (null = the default applies) and whether alerts are on. */
  limitOverride: z.number().nullable(),
  alerts: z.boolean(),
  limitVersion: z.number().int().nullable(),
  /** Last value per day, oldest first (30 days at most). */
  trend: z.array(UsagePoint),
});
export type UsageMetricViewDto = z.infer<typeof UsageMetricView>;

export const UsageProviderView = z.object({
  provider: z.enum(USAGE_PROVIDERS),
  status: z.enum(USAGE_PROVIDER_STATUSES).nullable(),
});

export const UsageView = z.object({
  lastCheckedAt: z.string().nullable(),
  providers: z.array(UsageProviderView),
  metrics: z.array(UsageMetricView),
  config: z.object({
    warnPct: z.number().int(),
    criticalPct: z.number().int(),
    recipients: z.array(z.string()),
    emailLocale: z.enum(['en', 'hi']),
    version: z.number().int(),
  }),
  /** Whether this staff member may edit limits, thresholds and recipients (`settings:write`). */
  canEdit: z.boolean(),
});
export type UsageViewDto = z.infer<typeof UsageView>;

/** `POST /v1/admin/usage/check`: values stored, new alerts, and the page again. */
export const UsageCheckResult = z.object({
  stored: z.number().int(),
  alerts: z.number().int(),
  usage: UsageView,
});
/** A versioned save (limit or alert settings). */
export const UsageSaved = z.object({ version: z.number().int() });
