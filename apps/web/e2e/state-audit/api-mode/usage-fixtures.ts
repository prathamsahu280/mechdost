/**
 * Typed fixtures of Admin → Usage & limits (founder 2026-11-26; spec 08). `usage=empty` never checked, `full` every
 * provider measured with one warning and one critical metric (super admin, editable), `readonly` the same for an
 * operations manager, `mixed` R2 not set up and Supabase failed, `error` the read fails. Bodies parse with the shared
 * schema, so a fixture that drifts from the API contract fails the case.
 */
import {
  USAGE_METRICS,
  USAGE_METRIC_CODES,
  UsageCheckResult,
  UsageView,
  type UsageMetricCode,
  type UsageViewDto,
} from '@mechdost/shared/usage';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';

const day = (i: number) => new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);

const VALUES: Record<UsageMetricCode, { value: number; total?: number }> = {
  r2_storage_bytes: { value: 7_400_000_000 },
  r2_objects_count: { value: 18_420 },
  r2_class_a_ops_month_count: { value: 120_000 },
  r2_class_b_ops_month_count: { value: 2_300_000 },
  supabase_db_bytes: { value: 465_000_000 },
  supabase_storage_bytes: { value: 310_000_000 },
  supabase_storage_objects_count: { value: 2_140 },
  server_disk_used_bytes: { value: 21_000_000_000, total: 80_000_000_000 },
  server_memory_used_bytes: { value: 1_500_000_000, total: 4_000_000_000 },
  resend_emails_month_count: { value: 640 },
  resend_emails_day_count: { value: 31 },
};

function view(c: AuditCase): UsageViewDto {
  const mode = c.state.usage ?? 'full';
  const checked = mode !== 'empty';
  const statuses =
    mode === 'mixed'
      ? { r2: 'not_configured', supabase: 'failed', server: 'ok', resend: 'ok' }
      : { r2: 'ok', supabase: 'ok', server: 'ok', resend: 'ok' };
  return {
    lastCheckedAt: checked ? new Date(Date.now() - 3_600_000).toISOString() : null,
    providers: (['r2', 'supabase', 'server', 'resend'] as const).map((provider) => ({
      provider,
      status: checked ? (statuses[provider] as 'ok') : null,
    })),
    metrics: USAGE_METRIC_CODES.map((code) => {
      const def = USAGE_METRICS[code];
      const skip = !checked || (mode === 'mixed' && def.provider === 'r2');
      const v = VALUES[code];
      const limit = def.defaultLimit ?? v.total ?? null;
      const percent = skip || limit === null ? null : Math.round((v.value / limit) * 1000) / 10;
      const level =
        def.alertsByDefault && percent !== null
          ? percent >= 90
            ? 'critical'
            : percent >= 70
              ? 'warn'
              : 'ok'
          : 'ok';
      return {
        code,
        provider: def.provider,
        unit: def.unit,
        value: skip ? null : v.value,
        limit,
        percent,
        level,
        source: skip ? null : def.estimated ? 'estimated' : 'measured',
        measuredAt: skip ? null : new Date(Date.now() - 3_600_000).toISOString(),
        limitOverride: null,
        alerts: def.alertsByDefault,
        limitVersion: null,
        trend: skip
          ? []
          : Array.from({ length: 30 }, (_, i) => ({
              day: day(i),
              value: Math.round((v.value * (60 + i)) / 89),
            })),
      };
    }),
    config: {
      warnPct: 70,
      criticalPct: 90,
      recipients: c.state.stress === 'long-text' ? ['founder.with.a.very.long.address@example.com'] : [],
      emailLocale: 'en',
      version: 1,
    },
    canEdit: mode !== 'readonly',
  };
}

export function usageMocks(c: AuditCase): Mock[] {
  return [
    {
      method: 'GET',
      path: /^\/admin\/usage$/,
      schema: UsageView,
      reply: (): Reply => (c.state.usage === 'error' ? { status: 500, code: 'INTERNAL' } : { body: view(c) }),
    },
    {
      method: 'POST',
      path: /^\/admin\/usage\/check$/,
      schema: UsageCheckResult,
      reply: (): Reply => ({
        body: { stored: 11, alerts: 0, usage: view({ ...c, state: { ...c.state, usage: 'full' } }) },
      }),
    },
  ];
}
