/**
 * Usage and free-limit monitoring (founder 2026-11-26, migration 0103): snapshots and runs append-only, limits from
 * the registry / admin override / measured total, one alert per metric + level + month (critical wins), bell to
 * all-cities settings readers, email to super admins or the configured addresses, versioned admin edits with audit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { UNIT_SPACE } from '@mechdost/shared/usage';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  ConflictError,
  addUsageCounts,
  countSentEmails,
  grantRole,
  measureSupabaseUsage,
  readUsageCounters,
  recordUsageRun,
  saveUsageAlertConfig,
  saveUsageLimit,
  syncRbacCatalogue,
  usageView,
  type Tx,
  type UsageMeasurement,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
const SYSTEM = { type: 'system' as const };
const OK = { r2: 'ok', supabase: 'ok', server: 'ok', resend: 'ok' } as const;

const run = (measurements: UsageMeasurement[], now = new Date('2026-11-26T03:30:00Z')) =>
  recordUsageRun(t(), {
    trigger: 'schedule',
    actor: SYSTEM,
    startedAt: now,
    now,
    statuses: OK,
    measurements,
  });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  const user = async (uid: string, extra: Record<string, unknown> = {}) =>
    (
      await db
        .insert(s.users)
        .values({ firebaseUid: uid, ...extra })
        .returning()
    )[0]!.id;
  F.superEn = await user('fb-u-super-en', { email: 'super-en@example.com', emailVerifiedAt: new Date() });
  F.superHi = await user('fb-u-super-hi', {
    email: 'super-hi@example.com',
    emailVerifiedAt: new Date(),
    language: 'hi',
  });
  F.superUnverified = await user('fb-u-super-unv', { email: 'super-unv@example.com' });
  F.ops = await user('fb-u-ops', { email: 'ops@example.com', emailVerifiedAt: new Date() });
  F.finance = await user('fb-u-fin');
  await grantRole(t(), { userId: F.superEn, role: 'super_admin', grantedBy: null });
  await grantRole(t(), { userId: F.superHi, role: 'super_admin', grantedBy: null });
  await grantRole(t(), { userId: F.superUnverified, role: 'super_admin', grantedBy: null });
  await grantRole(t(), { userId: F.ops, role: 'ops_manager', grantedBy: null });
  await grantRole(t(), { userId: F.finance, role: 'finance', grantedBy: null });
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  // Append-only tables: switch the guard off only for the cleanup between tests.
  await db.execute(sql`alter table usage_alerts disable trigger usage_alerts_append_only`);
  await db.execute(sql`alter table usage_snapshots disable trigger usage_snapshots_append_only`);
  await db.execute(sql`alter table usage_runs disable trigger usage_runs_append_only`);
  await db.execute(sql`delete from usage_alerts`);
  await db.execute(sql`delete from usage_snapshots`);
  await db.execute(sql`delete from usage_runs`);
  await db.execute(sql`alter table usage_alerts enable trigger usage_alerts_append_only`);
  await db.execute(sql`alter table usage_snapshots enable trigger usage_snapshots_append_only`);
  await db.execute(sql`alter table usage_runs enable trigger usage_runs_append_only`);
  await db.execute(sql`delete from usage_limits`);
  await db.execute(sql`delete from notifications`);
  await db.execute(sql`delete from notification_outbox`);
  await db.execute(sql`delete from usage_counters`);
  await db.execute(
    sql`update usage_alert_config set warn_pct = 70, critical_pct = 90, recipients = '{}', email_locale = 'en'`,
  );
});

const bell = () => db.select().from(s.notifications).where(eq(s.notifications.kind, 'staff.usage_alert'));
const mails = () =>
  db
    .select()
    .from(s.notificationOutbox)
    .where(
      and(
        eq(s.notificationOutbox.channel, 'email'),
        eq(s.notificationOutbox.templateKey, 'usage_limit_alert'),
      ),
    );

describe('recordUsageRun', () => {
  it('stores one run and a snapshot per measurement with the limit that applied', async () => {
    const r = await run([
      { metric: 'r2_storage_bytes', value: 1_000_000_000, source: 'measured' },
      { metric: 'server_disk_used_bytes', value: 20_000_000_000, source: 'measured', total: 80_000_000_000 },
      { metric: 'r2_objects_count', value: 12, source: 'measured' },
    ]);
    expect(r.stored).toBe(3);
    const snaps = await db.select().from(s.usageSnapshots).where(eq(s.usageSnapshots.runId, r.runId));
    const by = Object.fromEntries(snaps.map((x) => [x.metricCode, x]));
    expect(by.r2_storage_bytes?.limitValue).toBe(10_000_000_000);
    expect(by.server_disk_used_bytes?.limitValue).toBe(80_000_000_000);
    expect(by.r2_objects_count?.limitValue).toBeNull();
    const [runRow] = await db.select().from(s.usageRuns).where(eq(s.usageRuns.id, r.runId));
    expect(runRow).toMatchObject({ trigger: 'schedule', r2Status: 'ok', staffUserId: null });
  });

  it('snapshots are append-only', async () => {
    await run([{ metric: 'r2_storage_bytes', value: 1, source: 'measured' }]);
    await expect(db.execute(sql`update usage_snapshots set value = 2`)).rejects.toThrow();
    await expect(db.execute(sql`delete from usage_runs`)).rejects.toThrow();
  });

  it('at 70 % sends one bell notice to all-cities settings readers and one email per verified super admin', async () => {
    const r = await run([{ metric: 'r2_storage_bytes', value: 7_500_000_000, source: 'measured' }]);
    expect(r.alerts).toEqual([{ metric: 'r2_storage_bytes', level: 'warn' }]);
    const notices = await bell();
    expect(notices.map((n) => n.userId).sort()).toEqual(
      [F.superEn, F.superHi, F.superUnverified, F.ops].sort(),
    );
    expect(notices.find((n) => n.userId === F.superHi)?.body).toContain('75%');
    expect(notices.find((n) => n.userId === F.superHi)?.title).toContain('सीमा');
    expect(notices[0]?.link).toMatch(/\/admin\/usage$/);
    const m = await mails();
    expect(m.map((x) => x.recipient).sort()).toEqual(['super-en@example.com', 'super-hi@example.com']);
    expect(m.find((x) => x.recipient === 'super-hi@example.com')?.locale).toBe('hi');
    expect(m[0]?.payload).toMatchObject({
      percent: '75',
      value: `7.5${UNIT_SPACE}GB`,
      limit: `10${UNIT_SPACE}GB`,
    });
  });

  it('the same level twice in a month alerts once', async () => {
    await run([{ metric: 'r2_storage_bytes', value: 7_500_000_000, source: 'measured' }]);
    const again = await run([{ metric: 'r2_storage_bytes', value: 7_600_000_000, source: 'measured' }]);
    expect(again.alerts).toEqual([]);
    expect(await db.select().from(s.usageAlerts)).toHaveLength(1);
    expect((await mails()).length).toBe(2);
  });

  it('crossing both thresholds at once sends only critical, and a later warning that month sends nothing', async () => {
    const first = await run([{ metric: 'supabase_db_bytes', value: 480_000_000, source: 'measured' }]);
    expect(first.alerts).toEqual([{ metric: 'supabase_db_bytes', level: 'critical' }]);
    const later = await run([{ metric: 'supabase_db_bytes', value: 400_000_000, source: 'measured' }]);
    expect(later.alerts).toEqual([]);
    const next = await run(
      [{ metric: 'supabase_db_bytes', value: 400_000_000, source: 'measured' }],
      new Date('2026-12-02T03:30:00Z'),
    );
    expect(next.alerts).toEqual([{ metric: 'supabase_db_bytes', level: 'warn' }]);
  });

  it('a warning then critical in the same month sends both', async () => {
    await run([{ metric: 'supabase_db_bytes', value: 360_000_000, source: 'measured' }]);
    const r = await run([{ metric: 'supabase_db_bytes', value: 460_000_000, source: 'measured' }]);
    expect(r.alerts).toEqual([{ metric: 'supabase_db_bytes', level: 'critical' }]);
  });

  it('no alert without a limit or with alerts off (memory is off by default)', async () => {
    const r = await run([
      { metric: 'r2_objects_count', value: 10_000_000, source: 'measured' },
      { metric: 'server_memory_used_bytes', value: 990, source: 'measured', total: 1000 },
    ]);
    expect(r.alerts).toEqual([]);
    await saveUsageLimit(t(), {
      metric: 'r2_storage_bytes',
      limit: null,
      alerts: false,
      expectedVersion: null,
      actor: { type: 'admin', userId: F.superEn },
    });
    const off = await run([{ metric: 'r2_storage_bytes', value: 9_900_000_000, source: 'measured' }]);
    expect(off.alerts).toEqual([]);
  });

  it('configured addresses replace the super admins, in the configured language', async () => {
    const [cfg] = await db.select().from(s.usageAlertConfig);
    await saveUsageAlertConfig(t(), {
      warnPct: 50,
      criticalPct: 80,
      recipients: ['Founder@example.com'],
      emailLocale: 'hi',
      expectedVersion: cfg!.version,
      actor: { type: 'admin', userId: F.superEn },
    });
    const r = await run([{ metric: 'resend_emails_day_count', value: 55, source: 'estimated' }]);
    expect(r.alerts).toEqual([{ metric: 'resend_emails_day_count', level: 'warn' }]);
    const m = await mails();
    expect(m.map((x) => [x.recipient, x.locale])).toEqual([['founder@example.com', 'hi']]);
  });
});

describe('admin edits', () => {
  it('a limit override applies, is versioned and audited; a stale save is refused', async () => {
    const actor = { type: 'admin' as const, userId: F.superEn };
    const v1 = await saveUsageLimit(t(), {
      metric: 'supabase_db_bytes',
      limit: 8_000_000_000,
      alerts: true,
      expectedVersion: null,
      actor,
    });
    expect(v1.version).toBe(1);
    const v2 = await saveUsageLimit(t(), {
      metric: 'supabase_db_bytes',
      limit: 9_000_000_000,
      alerts: true,
      expectedVersion: 1,
      actor,
    });
    expect(v2.version).toBe(2);
    await expect(
      saveUsageLimit(t(), {
        metric: 'supabase_db_bytes',
        limit: 1,
        alerts: true,
        expectedVersion: 1,
        actor,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const r = await run([{ metric: 'supabase_db_bytes', value: 480_000_000, source: 'measured' }]);
    expect(r.alerts).toEqual([]);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'usage.limit_saved'));
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('thresholds must stay ordered and the save is versioned', async () => {
    const actor = { type: 'admin' as const, userId: F.superEn };
    const [cfg] = await db.select().from(s.usageAlertConfig);
    await expect(
      saveUsageAlertConfig(t(), {
        warnPct: 70,
        criticalPct: 90,
        recipients: [],
        emailLocale: 'en',
        expectedVersion: (cfg?.version ?? 1) + 5,
        actor,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('usageView', () => {
  it('shows the latest value per metric, the trend by day and the last run statuses', async () => {
    await run(
      [{ metric: 'r2_storage_bytes', value: 1_000_000_000, source: 'measured' }],
      new Date('2026-11-24T03:30:00Z'),
    );
    await run(
      [{ metric: 'r2_storage_bytes', value: 2_000_000_000, source: 'measured' }],
      new Date('2026-11-25T03:30:00Z'),
    );
    await recordUsageRun(t(), {
      trigger: 'manual',
      actor: { type: 'admin', userId: F.ops },
      startedAt: new Date('2026-11-26T03:30:00Z'),
      now: new Date('2026-11-26T03:30:00Z'),
      statuses: { ...OK, r2: 'not_configured' },
      measurements: [{ metric: 'supabase_db_bytes', value: 100_000_000, source: 'measured' }],
    });
    const v = await usageView(t(), { canEdit: false, now: new Date('2026-11-26T04:00:00Z') });
    const r2 = v.metrics.find((m) => m.code === 'r2_storage_bytes');
    expect(r2).toMatchObject({ value: 2_000_000_000, limit: 10_000_000_000, percent: 20, level: 'ok' });
    expect(r2?.trend.map((p) => p.value)).toEqual([1_000_000_000, 2_000_000_000]);
    expect(v.providers.find((p) => p.provider === 'r2')?.status).toBe('not_configured');
    expect(v.lastCheckedAt).toBe('2026-11-26T03:30:00.000Z');
    expect(v.config).toMatchObject({ warnPct: 70, criticalPct: 90, recipients: [] });
    const mem = v.metrics.find((m) => m.code === 'server_memory_used_bytes');
    expect(mem).toMatchObject({ value: null, alerts: false });
  });
});

describe('counters and estimates', () => {
  it('counts add up across flushes', async () => {
    await addUsageCounts(t(), '2026-11', { r2_class_a_ops_month_count: 3, r2_class_b_ops_month_count: 10 });
    await addUsageCounts(t(), '2026-11', { r2_class_a_ops_month_count: 2 });
    expect(await readUsageCounters(t(), '2026-11')).toEqual({
      r2_class_a_ops_month_count: 5,
      r2_class_b_ops_month_count: 10,
    });
  });

  it('sent emails this month and in the last 24 hours', async () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const add = (key: string, sentAt: Date | null, channel = 'email') =>
      db.insert(s.notificationOutbox).values({
        dedupeKey: key,
        channel,
        recipient: 'x@example.com',
        templateKey: 'order_placed',
        status: sentAt ? 'sent' : 'pending',
        sentAt,
      });
    await add('a', new Date('2026-11-26T08:00:00Z'));
    await add('b', new Date('2026-11-20T08:00:00Z'));
    await add('c', new Date('2026-10-31T23:00:00Z'));
    await add('d', null);
    await add('e', new Date('2026-11-26T09:00:00Z'), 'push');
    expect(await countSentEmails(t(), now)).toEqual({ month: 2, day: 1 });
  });

  it('Supabase sizes: the database always, storage only where the storage schema exists', async () => {
    const r = await measureSupabaseUsage(t());
    expect(r.status).toBe('partial');
    const dbSize = r.measurements.find((m) => m.metric === 'supabase_db_bytes');
    expect(dbSize?.value).toBeGreaterThan(0);
    expect(r.measurements.some((m) => m.metric === 'supabase_storage_bytes')).toBe(false);
  });
});
