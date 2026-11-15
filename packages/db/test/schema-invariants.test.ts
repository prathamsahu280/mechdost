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

/**
 * Row-level security stays on for everything the Supabase Data API could reach (security review 2026-11-14,
 * "views bypass RLS"): every public table has RLS, every view runs as the caller (`security_invoker`), and the
 * `anon` / `authenticated` roles hold no table privileges. The API connects as the owner; these guard direct access.
 */
const tablesWithoutRls = async () =>
  (
    (
      await db.execute(sql`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`)
    ).rows as { relname: string }[]
  ).map((r) => r.relname);

const viewsWithoutInvoker = async () =>
  (
    (
      await db.execute(sql`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and not coalesce('security_invoker=true' = any(c.reloptions), false) order by 1`)
    ).rows as { relname: string }[]
  ).map((r) => r.relname);

const clientGrants = async () =>
  (
    (
      await db.execute(sql`
    select table_name || ':' || grantee || ':' || privilege_type as g from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and table_name not in (select tablename from pg_policies where schemaname = 'public') order by 1`)
    ).rows as { g: string }[]
  ).map((r) => r.g);

describe('row-level security', () => {
  it('is on for every public table (a new table without it is caught)', async () => {
    expect(await tablesWithoutRls()).toEqual([]);
    await db.execute(sql`create table zz_rls_probe (id int)`);
    expect(await tablesWithoutRls()).toEqual(['zz_rls_probe']);
    await db.execute(sql`drop table zz_rls_probe`);
  });

  it('cannot be bypassed by a view (every view runs as the caller)', async () => {
    expect(await viewsWithoutInvoker()).toEqual([]);
    await db.execute(sql`create view zz_view_probe as select 1 as x`);
    expect(await viewsWithoutInvoker()).toEqual(['zz_view_probe']);
    await db.execute(sql`drop view zz_view_probe`);
  });

  // Tables with a read policy (the RLS mirror, rls.test.ts) are the only ones a client role may hold SELECT on.
  it('leaves no table privileges to the anon and authenticated roles on tables without a policy', async () => {
    expect(await clientGrants()).toEqual([]);
    await db.execute(sql`create table zz_grant_probe (id int)`);
    await db.execute(sql`grant select on zz_grant_probe to anon`);
    expect(await clientGrants()).toEqual(['zz_grant_probe:anon:SELECT']);
    await db.execute(sql`drop table zz_grant_probe`);
  });
});
