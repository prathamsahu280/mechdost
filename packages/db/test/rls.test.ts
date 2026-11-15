/**
 * The RLS mirror (spec 13, docs/research/rls-matrix.md): if a client ever reaches Postgres directly as
 * `authenticated` (Supabase Realtime/Storage, a leaked key) it sees what the API would show it, and `anon` sees
 * nothing sensitive. The API connects as the owner and is unaffected. Policies read the Firebase uid from the JWT
 * `sub` claim (Supabase third-party auth) and map it to `users` in the database; nothing trusts a role claim.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { placeCodOrder, quoteCheckout, routeOrder, type CityScope, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { RLS_INVENTORY } from './rls-inventory';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const scope: CityScope = { all: true };
const ids: Record<string, string> = {};
let keyN = 0;

type Role = 'anon' | 'authenticated';

/** Run one query as a client role carrying a JWT (or none), then go back to the owner. */
const PROJECT = 'mechdost-test';
async function as(
  role: Role,
  uid: string | null,
  query: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const claims =
    uid === null
      ? ''
      : JSON.stringify({
          sub: uid,
          role: 'authenticated',
          iss: `https://securetoken.google.com/${PROJECT}`,
          aud: PROJECT,
          ...extra,
        });
  await client.exec(`set role ${role}`);
  await client.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  try {
    return (await client.query<Record<string, unknown>>(query)).rows;
  } finally {
    await client.exec(`reset role`);
    await client.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
const asUser = (uid: string, query: string) => as('authenticated', uid, query);

async function place(userId: string, to: string | null) {
  const lines = [{ sku: OIL, qty: 1 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  keyN += 1;
  const placed = await placeCodOrder(t(), {
    userId,
    idempotencyKey: `rls-test-key-${String(keyN).padStart(5, '0')}`,
    address: {
      contactName: 'Ravi Sahu',
      contactPhone: '+919876543210',
      line1: 'House 12, Pandri',
      line2: null,
      landmark: null,
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: q.totalPaise,
    note: null,
    locale: 'en',
  });
  const code = placed.orders[0]!.code;
  const [o] = await db.select().from(s.orders).where(eq(s.orders.code, code));
  if (to) {
    await routeOrder(t(), {
      scope,
      code,
      shopId: ids[to]!,
      expectedVersion: o!.version,
      staffUserId: ids.staff!,
    });
  }
  return o!.id;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const mk = async (key: string) => {
    ids[key] = (
      await db
        .insert(s.users)
        .values({ firebaseUid: `fb-rls-${key}`, name: key })
        .returning()
    )[0]!.id;
  };
  for (const k of ['a', 'b', 'staff', 'sharma', 'gupta', 'gone']) await mk(k);
  await db.execute(sql`insert into admin_prices (variant_id, city_id, selling_paise, updated_by)
    select v.id, c.id, v.mrp_paise, ${ids.staff} from product_variants v cross join cities c where c.code = 'RPR'`);
  for (const row of await db.select().from(s.shops)) ids[row.name] = row.id;
  await db.insert(s.shopUsers).values([
    { shopId: ids['Sharma Auto Parts']!, userId: ids.sharma!, role: 'owner' },
    { shopId: ids['Gupta Lubes & Spares']!, userId: ids.gupta!, role: 'owner' },
  ]);
  ids.orderA = await place(ids.a!, 'Sharma Auto Parts');
  ids.orderB = await place(ids.b!, null);
  for (const [key, who] of [
    ['a', 'house A'],
    ['b', 'house B'],
  ] as const) {
    await db.execute(sql`insert into addresses (user_id, label, contact_name, contact_phone, line1, pincode, state_id)
      select ${ids[key]!}, 'home', ${who}, '+919876543210', ${who}, '492004', id from states limit 1`);
    await db.insert(s.notifications).values({ userId: ids[key]!, title: `hello ${key}`, body: 'x' });
  }
  // A signed-out (deleted) account must see nothing even with a valid token.
  await db.insert(s.notifications).values({ userId: ids.gone!, title: 'hello gone', body: 'x' });
  await db.update(s.users).set({ status: 'deactivated' }).where(eq(s.users.id, ids.gone!));
  // The one-row config the user fills when Supabase third-party auth is set up (rls-matrix.md); empty = dormant.
  await db.execute(sql`insert into private.auth_config (firebase_project_id) values (${PROJECT})`);
});

afterAll(async () => {
  await client.close();
});

describe('customer rows', () => {
  it('sees their own user, order, address and notification, never another customer’s', async () => {
    expect(await asUser('fb-rls-a', 'select id from users')).toEqual([{ id: ids.a }]);
    expect(await asUser('fb-rls-a', 'select id from orders')).toEqual([{ id: ids.orderA }]);
    expect(await asUser('fb-rls-b', 'select id from orders')).toEqual([{ id: ids.orderB }]);
    expect(await asUser('fb-rls-a', 'select contact_name from addresses')).toEqual([
      { contact_name: 'house A' },
    ]);
    expect(await asUser('fb-rls-b', "select title from notifications where title like 'hello%'")).toEqual([
      { title: 'hello b' },
    ]);
  });

  it('sees order lines of their own orders only, and never MechDost’s margin column', async () => {
    const own = await asUser('fb-rls-a', 'select order_id from order_items');
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.order_id === ids.orderA)).toBe(true);
    await expect(asUser('fb-rls-a', 'select shop_unit_paise from order_items')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot read another customer’s rows by id', async () => {
    expect(await asUser('fb-rls-a', `select id from orders where id = '${ids.orderB}'`)).toEqual([]);
    expect(await asUser('fb-rls-a', `select id from users where id = '${ids.b}'`)).toEqual([]);
  });

  it('sees nothing with an unknown uid, a deactivated account, or no token at all', async () => {
    expect(await asUser('fb-rls-nobody', 'select id from orders')).toEqual([]);
    expect(await asUser('fb-rls-gone', 'select id from notifications')).toEqual([]);
    expect(await as('authenticated', null, 'select id from orders')).toEqual([]);
  });

  it('has no write access at all (the API is the only writer)', async () => {
    for (const q of [
      `insert into addresses (user_id, contact_name, contact_phone, line1, pincode, state_id) select id, 'x', '+919876543210', 'x', '492004', (select id from states limit 1) from users limit 1`,
      `update orders set customer_message = 'x'`,
      `update users set name = 'x'`,
      `delete from notifications`,
    ]) {
      await expect(asUser('fb-rls-a', q)).rejects.toThrow(/permission denied/);
    }
  });
});

describe('token issuer and audience (a foreign token cannot borrow a Firebase uid)', () => {
  const q = 'select id from orders';
  it('shows nothing for another issuer, another audience, or a missing claim', async () => {
    expect(await as('authenticated', 'fb-rls-a', q, { iss: 'https://evil.example/auth/v1' })).toEqual([]);
    expect(
      await as('authenticated', 'fb-rls-a', q, { iss: 'https://securetoken.google.com/other-project' }),
    ).toEqual([]);
    expect(await as('authenticated', 'fb-rls-a', q, { aud: 'other-project' })).toEqual([]);
    expect(await as('authenticated', 'fb-rls-a', q, { aud: undefined })).toEqual([]);
    expect(await as('authenticated', 'fb-rls-a', q, { iss: undefined })).toEqual([]);
  });

  it('shows the own rows with the right issuer and audience', async () => {
    expect(await asUser('fb-rls-a', q)).toEqual([{ id: ids.orderA }]);
  });

  it('is dormant while the config table is empty, and the client roles cannot read or change it', async () => {
    await expect(asUser('fb-rls-a', 'select * from private.auth_config')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser('fb-rls-a', `update private.auth_config set firebase_project_id = 'x'`),
    ).rejects.toThrow(/permission denied/);
    await db.execute(sql`delete from private.auth_config`);
    try {
      expect(await asUser('fb-rls-a', q)).toEqual([]);
    } finally {
      await db.execute(sql`insert into private.auth_config (firebase_project_id) values (${PROJECT})`);
    }
  });
});

describe('partner members', () => {
  it('see their own shop and its offers only', async () => {
    expect((await asUser('fb-rls-sharma', 'select name from shops')).map((r) => r.name)).toEqual([
      'Sharma Auto Parts',
    ]);
    expect((await asUser('fb-rls-gupta', 'select name from shops')).map((r) => r.name)).toEqual([
      'Gupta Lubes & Spares',
    ]);
    expect(
      (await asUser('fb-rls-sharma', 'select order_id from order_assignments')).map((r) => r.order_id),
    ).toEqual([ids.orderA]);
    expect(await asUser('fb-rls-gupta', 'select order_id from order_assignments')).toEqual([]);
    const stock = await asUser('fb-rls-sharma', 'select distinct shop_id from shop_inventory');
    expect(stock).toEqual([{ shop_id: ids['Sharma Auto Parts'] }]);
  });

  it('never see the customer’s order, the PAN or the staff note', async () => {
    expect(await asUser('fb-rls-sharma', 'select id from orders')).toEqual([]);
    await expect(asUser('fb-rls-sharma', 'select pan_enc from shops')).rejects.toThrow(/permission denied/);
    await expect(asUser('fb-rls-sharma', 'select give_up_note from order_assignments')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot write to their shop directly', async () => {
    await expect(asUser('fb-rls-sharma', `update shops set busy = true`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asUser('fb-rls-sharma', `update shop_inventory set on_hand = 9999`)).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('anon and public catalogue', () => {
  it('reads live products, categories and cities, but nothing personal', async () => {
    expect((await as('anon', null, `select count(*)::int as n from products`))[0]!.n).toBeGreaterThan(0);
    expect(await as('anon', null, `select count(*)::int as n from products where status <> 'live'`)).toEqual([
      { n: 0 },
    ]);
    expect((await as('anon', null, `select count(*)::int as n from categories`))[0]!.n).toBeGreaterThan(0);
    for (const table of ['users', 'orders', 'addresses', 'notifications', 'shops', 'payments']) {
      await expect(as('anon', null, `select 1 from ${table}`)).rejects.toThrow(/permission denied/);
    }
  });

  it('hides draft products and the rejection reason from everyone', async () => {
    await db.execute(sql`update products set status = 'draft' where id = (select id from products limit 1)`);
    const live = await db.$count(s.products, eq(s.products.status, 'live'));
    expect((await as('anon', null, `select count(*)::int as n from products`))[0]!.n).toBe(live);
    await expect(as('anon', null, `select rejection_reason from products`)).rejects.toThrow(
      /permission denied/,
    );
    await db.execute(sql`update products set status = 'live' where status = 'draft'`);
  });

  it('cannot call the policy helpers or write anything', async () => {
    await expect(as('anon', null, `select private.current_user_id()`)).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, `delete from categories`)).rejects.toThrow(/permission denied/);
  });
});

describe('RLS matrix over the inventory', () => {
  const tables = async () =>
    (
      (
        await db.execute(sql`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition order by 1`)
      ).rows as { relname: string }[]
    ).map((r) => r.relname);

  it('classifies every public table (a new table must be added to the inventory)', async () => {
    const real = await tables();
    expect(real.filter((n) => !(n in RLS_INVENTORY))).toEqual([]);
    expect(Object.keys(RLS_INVENTORY).filter((n) => !real.includes(n))).toEqual([]);
  });

  it('has RLS on for every table, partitions included', async () => {
    const off = (
      await db.execute(sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`)
    ).rows;
    expect(off).toEqual([]);
  });

  it('gives deny-all tables no policy and no grant, and the others SELECT policies only', async () => {
    const policies = (
      (
        await db.execute(
          sql`select tablename, cmd, roles::text as roles from pg_policies where schemaname = 'public'`,
        )
      ).rows as { tablename: string; cmd: string; roles: string }[]
    ).filter((p) => p.tablename in RLS_INVENTORY);
    const grants = (
      (
        await db.execute(sql`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`)
      ).rows as { table_name: string; grantee: string; privilege_type: string }[]
    ).filter((g) => g.table_name in RLS_INVENTORY);
    const columnGrants = (
      (
        await db.execute(sql`
      select table_name, grantee from information_schema.column_privileges
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`)
      ).rows as { table_name: string; grantee: string }[]
    ).filter((g) => g.table_name in RLS_INVENTORY);

    for (const [table, access] of Object.entries(RLS_INVENTORY)) {
      const p = policies.filter((x) => x.tablename === table);
      const g = [
        ...grants.filter((x) => x.table_name === table),
        ...columnGrants.filter((x) => x.table_name === table),
      ];
      if (access === 'none') {
        expect({ table, policies: p.length, grants: g.length }).toEqual({ table, policies: 0, grants: 0 });
        continue;
      }
      expect({ table, hasPolicy: p.length > 0 }).toEqual({ table, hasPolicy: true });
      expect({ table, commands: [...new Set(p.map((x) => x.cmd))] }).toEqual({ table, commands: ['SELECT'] });
      expect({
        table,
        writes: grants.filter((x) => x.table_name === table && x.privilege_type !== 'SELECT'),
      }).toEqual({
        table,
        writes: [],
      });
      // Public tables are readable by anon; everything else is `authenticated` only.
      const anon = p.some((x) => x.roles.includes('anon'));
      expect({ table, anon }).toEqual({ table, anon: access === 'public' });
    }
  });

  it('indexes every column a policy filters on (a policy runs on each row it covers)', async () => {
    const policyColumns: [string, string][] = [
      ['users', 'firebase_uid'],
      ['addresses', 'user_id'],
      ['vehicles', 'user_id'],
      ['notifications', 'user_id'],
      ['notification_preferences', 'user_id'],
      ['consents', 'user_id'],
      ['coin_ledger', 'user_id'],
      ['orders', 'user_id'],
      ['order_items', 'order_id'],
      ['service_requests', 'user_id'],
      ['carts', 'user_id'],
      ['cart_items', 'cart_id'],
      ['wishlist_items', 'user_id'],
      ['shop_users', 'user_id'],
      ['shop_inventory', 'shop_id'],
      ['order_assignments', 'shop_id'],
      ['user_roles', 'user_id'],
      ['user_roles', 'shop_id'],
      ['user_roles', 'workshop_id'],
    ];
    const missing: string[] = [];
    for (const [table, column] of policyColumns) {
      const found = (
        await db.execute(sql`
        select 1 from pg_index i join pg_class c on c.oid = i.indrelid
        join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
        where c.relname = ${table} and a.attname = ${column} and i.indisvalid limit 1`)
      ).rows;
      if (found.length === 0) missing.push(`${table}.${column}`);
    }
    expect(missing).toEqual([]);
  });

  it('keeps the policy helpers out of anon’s and the Data API’s reach', async () => {
    const rows = (
      await db.execute(sql`
      select p.proname, p.prosecdef, coalesce('search_path=""' = any(p.proconfig), false) as fixed_path,
        has_function_privilege('anon', p.oid, 'execute') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' order by 1`)
    ).rows as {
      proname: string;
      prosecdef: boolean;
      fixed_path: boolean;
      anon_exec: boolean;
      auth_exec: boolean;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect({ fn: r.proname, anon: r.anon_exec }).toEqual({ fn: r.proname, anon: false });
      expect({ fn: r.proname, auth: r.auth_exec }).toEqual({ fn: r.proname, auth: true });
      expect({ fn: r.proname, fixedPath: r.fixed_path }).toEqual({
        fn: r.proname,
        fixedPath: true,
      });
    }
  });
});
