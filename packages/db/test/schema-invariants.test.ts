/**
 * Schema invariants that hold for every table, present and future (CLAUDE.md conventions; rule 3). A new table
 * with `version` or `updated_at` must get its trigger — 0002 installed them once, and tables added later
 * silently missed them until 0031 (code review 2026-11-03).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});

afterAll(async () => {
  await client.close();
});

async function tablesWithout(column: string, suffix: string): Promise<string[]> {
  const res = await db.execute(sql`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = ${column} and t.table_type = 'BASE TABLE'
      and not exists (
        select 1 from pg_trigger g join pg_class k on k.oid = g.tgrelid
        where k.relname = c.table_name and g.tgname = c.table_name || ${suffix}
      )
    order by 1`);
  return (res.rows as { table_name: string }[]).map((r) => r.table_name);
}

describe('schema invariants', () => {
  it('every table with `version` bumps it on update', async () => {
    expect(await tablesWithout('version', '_bump_version')).toEqual([]);
  });

  it('every table with `updated_at` touches it on update', async () => {
    expect(await tablesWithout('updated_at', '_touch_updated_at')).toEqual([]);
  });
});
