/**
 * Customer blocks: one active block per level (database-enforced), lift with reason + compare-and-set, history
 * kept, expired blocks stop applying and can be replaced, no self-blocks, every change audited; placement honours
 * `orders` (403) and `cod_only` (COD refused).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  activeBlockLevels,
  blockCustomer,
  liftCustomerBlock,
  listCustomerBlocks,
  placeCodOrder,
  quoteCheckout,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let customer = '';
let staff = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  customer = (await db.insert(s.users).values({ firebaseUid: 'fb-block-customer' }).returning())[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-block-staff' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

const block = (level: 'cod_only' | 'orders' | 'full', extra: { endsAt?: Date | null } = {}) =>
  blockCustomer(t(), {
    userId: customer,
    level,
    reasonCode: 'cod_refused',
    note: 'Refused 3 parcels in October',
    endsAt: extra.endsAt ?? null,
    staffUserId: staff,
  });

describe('customer blocks', () => {
  it('one active block per level; lifting needs a reason and the current version', async () => {
    const b = await block('cod_only');
    expect(await activeBlockLevels(t(), customer)).toEqual(['cod_only']);
    await expect(block('cod_only')).rejects.toMatchObject({ code: 'ALREADY_BLOCKED' });
    await expect(
      liftCustomerBlock(t(), { blockId: b.id, expectedVersion: b.version, reason: 'ok', staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'LIFT_REASON' });
    await expect(
      liftCustomerBlock(t(), {
        blockId: b.id,
        expectedVersion: b.version + 1,
        reason: 'Paid the pending COD dues',
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_BLOCK' });
    await liftCustomerBlock(t(), {
      blockId: b.id,
      expectedVersion: b.version,
      reason: 'Paid the pending COD dues',
      staffUserId: staff,
    });
    expect(await activeBlockLevels(t(), customer)).toEqual([]);
    const history = await listCustomerBlocks(t(), customer);
    expect(history[0]).toMatchObject({
      level: 'cod_only',
      inForce: false,
      liftedReason: 'Paid the pending COD dues',
    });
    expect(
      await db.$count(s.auditLog, sql`${s.auditLog.action} in ('customer.blocked', 'customer.unblocked')`),
    ).toBe(2);
  });

  it('an expired block stops applying and can be replaced; no self-blocks', async () => {
    const b = await block('orders', { endsAt: new Date(Date.now() + 60_000) });
    await db
      .update(s.customerBlocks)
      .set({ endsAt: sql`now() - interval '1 hour'`, createdAt: sql`now() - interval '1 day'` })
      .where(eq(s.customerBlocks.id, b.id));
    expect(await activeBlockLevels(t(), customer)).toEqual([]);
    const again = await block('orders');
    expect(again.id).not.toBe(b.id);
    expect(await activeBlockLevels(t(), customer)).toEqual(['orders']);
    await expect(
      blockCustomer(t(), {
        userId: staff,
        level: 'full',
        reasonCode: 'other',
        note: null,
        endsAt: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'BLOCK_SELF' });
    await liftCustomerBlock(t(), {
      blockId: again.id,
      expectedVersion: again.version,
      reason: 'Test over now',
      staffUserId: staff,
    });
  });

  it('placement refuses `orders` blocks and cash on delivery under `cod_only`', async () => {
    const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const order = (key: string) =>
      placeCodOrder(t(), {
        userId: customer,
        idempotencyKey: key,
        address: {
          contactName: 'Asha',
          contactPhone: '+919876543210',
          line1: 'House 4, Pandri',
          line2: null,
          landmark: null,
          pincode: '492004',
        },
        lines,
        expectedTotalPaise: q.totalPaise,
        note: null,
        locale: 'en',
      });
    const ordersBlock = await block('orders');
    await expect(order('blocked-key-00000001')).rejects.toMatchObject({
      code: 'ORDERS_BLOCKED',
      status: 403,
    });
    await liftCustomerBlock(t(), {
      blockId: ordersBlock.id,
      expectedVersion: ordersBlock.version,
      reason: 'Spoke to the customer',
      staffUserId: staff,
    });
    await block('cod_only');
    await expect(order('blocked-key-00000002')).rejects.toMatchObject({
      code: 'COD_NOT_ALLOWED',
      details: { reason: 'customer' },
    });
    expect(await db.$count(s.orderGroups)).toBe(0);
  });
});
