/**
 * Ustaad preview testers (founder 2026-11-27; spec 23 § 3): add by phone or email (the answer shows the masked phone
 * only), one active row per account, removal keeps the history, every change writes one audit row, the cap holds.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  addUstaadPreviewTester,
  listUstaadPreviewTesters,
  readUstaadPreviewTesterIds,
  removeUstaadPreviewTester,
  syncRbacCatalogue,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
});
afterAll(async () => {
  await client.close();
});

async function phoneOf(userId: string): Promise<string> {
  const [u] = await db.select({ phone: s.users.phone }).from(s.users).where(eq(s.users.id, userId));
  if (!u?.phone) throw new Error('fixture user without a phone');
  return u.phone;
}

describe('preview testers repository', () => {
  it('adds an account by phone, shows only the masked phone, audits, and lists it', async () => {
    const phone = await phoneOf(f.customer);
    const row = await addUstaadPreviewTester(t(), {
      staffUserId: f.staff,
      identifier: phone,
      reasonCode: 'qa_run',
      note: 'QA run 2026-11-27',
    });
    expect(row.maskedPhone).toBe(`••••••${phone.slice(-4)}`);
    expect(JSON.stringify(row)).not.toContain(phone);
    expect(await readUstaadPreviewTesterIds(t())).toEqual([f.customer]);
    const list = await listUstaadPreviewTesters(t());
    expect(list.map((r) => r.id)).toEqual([row.id]);
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'ustaad.preview_tester.added'), eq(s.auditLog.entityId, row.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(f.staff);
    expect(JSON.stringify(audit[0]?.after)).not.toContain(phone);
  });

  it('refuses a second active row for the same account (409) and an unknown identifier (404)', async () => {
    const phone = await phoneOf(f.customer);
    await expect(
      addUstaadPreviewTester(t(), { staffUserId: f.staff, identifier: phone, reasonCode: 'qa_run' }),
    ).rejects.toMatchObject({ code: 'TESTER_EXISTS' });
    await expect(
      addUstaadPreviewTester(t(), {
        staffUserId: f.staff,
        identifier: '+919999999990',
        reasonCode: 'qa_run',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      addUstaadPreviewTester(t(), { staffUserId: f.staff, identifier: 'not a phone', reasonCode: 'qa_run' }),
    ).rejects.toMatchObject({ code: 'IDENTIFIER_FORMAT' });
  });

  it('removes with a reason (version-checked), keeps the row as history, and allows a later re-add', async () => {
    const [row] = await listUstaadPreviewTesters(t());
    if (!row) throw new Error('expected a tester');
    await expect(
      removeUstaadPreviewTester(t(), {
        staffUserId: f.staff,
        id: row.id,
        expectedVersion: row.version + 5,
        reasonCode: 'run_finished',
      }),
    ).rejects.toMatchObject({ code: 'STALE_TESTER' });
    await removeUstaadPreviewTester(t(), {
      staffUserId: f.staff,
      id: row.id,
      expectedVersion: row.version,
      reasonCode: 'run_finished',
    });
    expect(await readUstaadPreviewTesterIds(t())).toEqual([]);
    expect(await listUstaadPreviewTesters(t())).toEqual([]);
    const kept = await db.select().from(s.ustaadPreviewTesters).where(eq(s.ustaadPreviewTesters.id, row.id));
    expect(kept[0]?.removeReasonCode).toBe('run_finished');
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'ustaad.preview_tester.removed'), eq(s.auditLog.entityId, row.id)));
    expect(audit).toHaveLength(1);
    // Removing twice is a 404 (already off the list), not a second history row.
    await expect(
      removeUstaadPreviewTester(t(), {
        staffUserId: f.staff,
        id: row.id,
        expectedVersion: row.version + 1,
        reasonCode: 'run_finished',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const again = await addUstaadPreviewTester(t(), {
      staffUserId: f.staff,
      identifier: await phoneOf(f.customer),
      reasonCode: 'beta_mechanic',
    });
    expect(again.id).not.toBe(row.id);
  });
});
