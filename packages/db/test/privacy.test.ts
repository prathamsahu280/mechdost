/**
 * Account -> Privacy (DPDP; design 2026-11-15 item 6): consents are append-only rows, a withdrawal takes effect at
 * once for what uses it (promotions stop), the data export is one active request per person, built by the worker
 * with a size limit, downloadable only by its owner until it expires, then cleared; every step is audited.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { EXPORT_TTL_HOURS } from '@mechdost/shared/privacy-api';
import {
  buildDueDataExports,
  downloadDataExport,
  expireDataExports,
  getPrivacyView,
  hasMarketingConsent,
  requestDataExport,
  setConsent,
  type Tx,
} from '../src/repo';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let ravi = '';
let asha = '';
const HOUR = 3_600_000;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const users = await db
    .insert(s.users)
    .values([
      { firebaseUid: 'fb-priv-ravi', name: 'Ravi Sahu', phone: '+919876500001' },
      { firebaseUid: 'fb-priv-asha', name: 'Asha Verma', phone: '+919876500002' },
    ])
    .returning();
  [ravi, asha] = users.map((u) => u.id) as [string, string];
});

afterAll(async () => {
  await client.close();
});

describe('consents per purpose', () => {
  it('starts as "never asked" for both purposes', async () => {
    const v = await getPrivacyView(t(), ravi);
    expect(v.consents).toEqual([
      { purpose: 'marketing', granted: null, at: null, noticeVersion: null },
      { purpose: 'analytics', granted: null, at: null, noticeVersion: null },
    ]);
    expect(v.export).toBeNull();
    expect(v.canRequestExport).toBe(true);
  });

  it('keeps every grant and withdrawal as a new row; a repeat adds nothing', async () => {
    await setConsent(t(), { userId: ravi, purpose: 'analytics', granted: true });
    await setConsent(t(), { userId: ravi, purpose: 'analytics', granted: true });
    await setConsent(t(), { userId: ravi, purpose: 'analytics', granted: false });
    const rows = await db
      .select()
      .from(s.consents)
      .where(sql`${s.consents.userId} = ${ravi} and ${s.consents.purpose} = 'analytics'`)
      .orderBy(s.consents.createdAt, s.consents.id);
    expect(rows.map((r) => r.granted)).toEqual([true, false]);
    expect(rows.every((r) => r.source === 'account_privacy' && r.noticeVersion.length > 0)).toBe(true);
    const view = await getPrivacyView(t(), ravi);
    expect(view.consents.find((c) => c.purpose === 'analytics')).toMatchObject({ granted: false });
    // The log itself cannot be rewritten.
    await expect(
      db.update(s.consents).set({ granted: true }).where(eq(s.consents.userId, ravi)),
    ).rejects.toThrow();
  });

  it('withdrawing marketing stops promotions at once', async () => {
    await setConsent(t(), { userId: ravi, purpose: 'marketing', granted: true });
    expect(await hasMarketingConsent(t(), ravi)).toBe(true);
    await setConsent(t(), { userId: ravi, purpose: 'marketing', granted: false });
    expect(await hasMarketingConsent(t(), ravi)).toBe(false);
    const prefs = await db
      .select()
      .from(s.notificationPreferences)
      .where(eq(s.notificationPreferences.userId, ravi));
    expect(prefs.filter((p) => p.category === 'promotional').every((p) => !p.enabled)).toBe(true);
    const events = await db.execute(
      sql`select count(*)::int as n from events where event = 'marketing_consent_changed' and user_id = ${ravi}`,
    );
    expect((events.rows[0] as { n: number }).n).toBe(2);
  });

  it('one person never sees or changes another person’s choices', async () => {
    expect((await getPrivacyView(t(), asha)).consents.every((c) => c.granted === null)).toBe(true);
  });
});

describe('data export', () => {
  let exportId = '';

  it('is one active request per person, with a 24 hour wait after the last one', async () => {
    await db.insert(s.addresses).values({
      userId: ravi,
      label: 'home',
      contactName: 'Ravi Sahu',
      contactPhone: '+919876500001',
      line1: 'House 12, Pandri',
      pincode: '492004',
      cityId: null,
      stateId: (await db.select({ id: s.states.id }).from(s.states).limit(1))[0]?.id ?? '',
    });
    const first = await requestDataExport(t(), { userId: ravi });
    exportId = first.id;
    expect(first.status).toBe('requested');
    await expect(requestDataExport(t(), { userId: ravi })).rejects.toMatchObject({ code: 'EXPORT_ACTIVE' });
    const view = await getPrivacyView(t(), ravi);
    expect(view.export?.id).toBe(exportId);
    expect(view.canRequestExport).toBe(false);
  });

  it('the worker builds it with the person’s own data only and nothing of anyone else', async () => {
    const out = await buildDueDataExports(t(), {});
    expect(out).toEqual({ ready: 1, failed: 0 });
    const got = await downloadDataExport(t(), { userId: ravi, exportId });
    const data = got.payload as Record<string, unknown>;
    expect(data.formatVersion).toBe(1);
    expect(JSON.stringify(data)).toContain('House 12, Pandri');
    expect(JSON.stringify(data)).toContain('Ravi Sahu');
    expect(JSON.stringify(data)).not.toContain('Asha Verma');
    expect(JSON.stringify(data)).not.toContain('+919876500002');
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(['profile', 'addresses', 'consents', 'orders', 'tickets']),
    );
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entity, 'data_export'));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['data_export.requested', 'data_export.ready', 'data_export.downloaded']),
    );
    // Audit rows hold no export content.
    expect(JSON.stringify(audit)).not.toContain('House 12');
  });

  it('another person gets a 404 for it', async () => {
    await expect(downloadDataExport(t(), { userId: asha, exportId })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('sends the expiry time to the database as text, never as a raw Date (postgres-js cannot encode one: worker failure 2026-11-16)', async () => {
    const seen: unknown[] = [];
    const original = client.query.bind(client);
    (client as unknown as { query: unknown }).query = (q: string, params?: unknown[], ...rest: unknown[]) => {
      seen.push(...(params ?? []));
      return (original as (...a: unknown[]) => unknown)(q, params, ...rest);
    };
    try {
      await expireDataExports(t(), { now: new Date(Date.now() - 10 * 365 * 24 * HOUR) });
    } finally {
      (client as unknown as { query: unknown }).query = original;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((p) => p instanceof Date)).toBe(false);
  });

  it('expires after 24 hours: the file is cleared and the download is refused', async () => {
    const later = new Date(Date.now() + (EXPORT_TTL_HOURS + 1) * HOUR);
    await expect(downloadDataExport(t(), { userId: ravi, exportId, now: later })).rejects.toMatchObject({
      code: 'EXPORT_EXPIRED',
    });
    expect(await expireDataExports(t(), { now: later })).toBe(1);
    const [row] = await db.select().from(s.dataExportRequests).where(eq(s.dataExportRequests.id, exportId));
    expect(row).toMatchObject({ status: 'expired', payload: null });
    await expect(downloadDataExport(t(), { userId: ravi, exportId, now: later })).rejects.toMatchObject({
      code: 'EXPORT_EXPIRED',
    });
    // A new request is allowed once a day has passed since the last.
    await expect(requestDataExport(t(), { userId: ravi })).rejects.toMatchObject({ code: 'EXPORT_TOO_SOON' });
    const again = await requestDataExport(t(), { userId: ravi, now: later });
    expect(again.status).toBe('requested');
  });

  it('an export over the size limit fails with a code instead of being stored', async () => {
    const out = await buildDueDataExports(t(), { maxBytes: 50 });
    expect(out).toEqual({ ready: 0, failed: 1 });
    const view = await getPrivacyView(t(), ravi, new Date(Date.now() + 48 * HOUR));
    expect(view.export?.status).toBe('failed');
    expect(view.canRequestExport).toBe(true);
    const [row] = await db
      .select()
      .from(s.dataExportRequests)
      .where(eq(s.dataExportRequests.status, 'failed'));
    expect(row).toMatchObject({ errorCode: 'too_large', payload: null });
  });
});
