import { describe, expect, it } from 'vitest';
import {
  USAGE_METRICS,
  USAGE_METRIC_CODES,
  UsageAlertConfigInput,
  UsageLimitInput,
  alertLevelFor,
  formatUsageValue,
  usageMonth,
  usagePercent,
} from '../src/usage';

describe('usage metric registry (founder 2026-11-26)', () => {
  it('every code names its unit and has a provider', () => {
    for (const code of USAGE_METRIC_CODES) {
      expect(code).toMatch(/_(bytes|count)$/);
      expect(USAGE_METRICS[code].provider).toMatch(/^(r2|supabase|server|resend)$/);
    }
  });

  it('defaults match the published free plans (2026-11-26)', () => {
    expect(USAGE_METRICS.r2_storage_bytes.defaultLimit).toBe(10_000_000_000);
    expect(USAGE_METRICS.r2_class_a_ops_month_count.defaultLimit).toBe(1_000_000);
    expect(USAGE_METRICS.r2_class_b_ops_month_count.defaultLimit).toBe(10_000_000);
    expect(USAGE_METRICS.supabase_db_bytes.defaultLimit).toBe(500_000_000);
    expect(USAGE_METRICS.supabase_storage_bytes.defaultLimit).toBe(1_000_000_000);
    expect(USAGE_METRICS.resend_emails_month_count.defaultLimit).toBe(3_000);
    expect(USAGE_METRICS.resend_emails_day_count.defaultLimit).toBe(100);
  });

  it('server disk and memory take their limit from the measurement', () => {
    expect(USAGE_METRICS.server_disk_used_bytes.limitFromMeasurement).toBe(true);
    expect(USAGE_METRICS.server_memory_used_bytes.limitFromMeasurement).toBe(true);
    expect(USAGE_METRICS.server_memory_used_bytes.alertsByDefault).toBe(false);
  });

  it('operation counts are labelled estimated', () => {
    expect(USAGE_METRICS.r2_class_a_ops_month_count.estimated).toBe(true);
    expect(USAGE_METRICS.resend_emails_month_count.estimated).toBe(true);
    expect(USAGE_METRICS.r2_storage_bytes.estimated).toBe(false);
  });
});

describe('usagePercent', () => {
  it('is null without a positive limit', () => {
    expect(usagePercent(5, null)).toBeNull();
    expect(usagePercent(5, 0)).toBeNull();
  });
  it('rounds to one decimal', () => {
    expect(usagePercent(1, 3)).toBe(33.3);
    expect(usagePercent(12, 10)).toBe(120);
  });
});

describe('alertLevelFor', () => {
  const t = { warnPct: 70, criticalPct: 90 };
  it('below the warning is ok', () => {
    expect(alertLevelFor(69.9, t)).toBe('ok');
  });
  it('at the warning is warn', () => {
    expect(alertLevelFor(70, t)).toBe('warn');
  });
  it('crossing both sends only critical', () => {
    expect(alertLevelFor(95, t)).toBe('critical');
  });
  it('no percent is ok', () => {
    expect(alertLevelFor(null, t)).toBe('ok');
  });
});

describe('formatUsageValue', () => {
  it('bytes in decimal units with Latin digits', () => {
    expect(formatUsageValue(7_200_000_000, 'bytes')).toBe('7.2 GB');
    expect(formatUsageValue(512_000_000, 'bytes')).toBe('512 MB');
    expect(formatUsageValue(900, 'bytes')).toBe('900 B');
    expect(formatUsageValue(1_500_000_000_000, 'bytes')).toBe('1.5 TB');
  });
  it('counts with Indian grouping', () => {
    expect(formatUsageValue(1_000_000, 'count')).toBe('10,00,000');
  });
});

describe('usageMonth', () => {
  it('is the UTC month', () => {
    expect(usageMonth(new Date('2026-11-30T23:30:00Z'))).toBe('2026-11');
    expect(usageMonth(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
  });
});

describe('input validation', () => {
  it('warning must be below critical', () => {
    expect(
      UsageAlertConfigInput.safeParse({
        warnPct: 90,
        criticalPct: 70,
        recipients: [],
        emailLocale: 'en',
        expectedVersion: 1,
      }).success,
    ).toBe(false);
  });
  it('recipients are e-mail addresses, at most 10, no extra keys', () => {
    const ok = {
      warnPct: 70,
      criticalPct: 90,
      recipients: ['owner@example.com'],
      emailLocale: 'hi',
      expectedVersion: 1,
    };
    expect(UsageAlertConfigInput.safeParse(ok).success).toBe(true);
    expect(UsageAlertConfigInput.safeParse({ ...ok, recipients: ['nope'] }).success).toBe(false);
    expect(
      UsageAlertConfigInput.safeParse({
        ...ok,
        recipients: Array.from({ length: 11 }, (_, i) => `a${String(i)}@example.com`),
      }).success,
    ).toBe(false);
    expect(UsageAlertConfigInput.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  it('a limit is a positive whole number or null (back to the default)', () => {
    expect(UsageLimitInput.safeParse({ limit: 5, alerts: true, expectedVersion: null }).success).toBe(true);
    expect(UsageLimitInput.safeParse({ limit: null, alerts: true, expectedVersion: 2 }).success).toBe(true);
    expect(UsageLimitInput.safeParse({ limit: 0, alerts: true, expectedVersion: 2 }).success).toBe(false);
    expect(UsageLimitInput.safeParse({ limit: 1.5, alerts: true, expectedVersion: 2 }).success).toBe(false);
  });
});
