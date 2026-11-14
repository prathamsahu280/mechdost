/**
 * "Shop gives up an accepted order" and "warnings" over HTTP (spec 04, 07, 08; ruling 2026-11-15): the owner gives up
 * before packing with a reason code; another shop's owner and staff without a shop get 404/403; the order lands in
 * the admin reroute queue with the reason; staff with partners:approve warn a shop and are prompted at the
 * threshold; the shop reads its own warnings (no threshold); strict bodies.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole, placeCodOrder, quoteCheckout, routeOrder } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
const shop: Record<string, string> = {};
const SHARMA = 'Sharma Auto Parts';
const GUPTA = 'Gupta Lubes & Spares';

async function person(n: string, role: string, shopId: string | null = null) {
  const phone = `+9198222222${n}`;
  const token = ctx.verifier.add(`token-giveup-api-0000${n}`, {
    firebaseUid: `gu-${n}`,
    phone,
    email: `gu-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `gu-${n}`,
    phone,
    email: `gu-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}
const send = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  ctx.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const bodyOf = async (res: Response) => JSON.stringify(await res.clone().json());
const errorCode = async (res: Response) => ((await res.json()) as ErrorJson).error.code;

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
});

describe('give up over HTTP', () => {
  it('owner gives up before packing; the order is back with admin with the reason; others are refused', async () => {
    const owner = await person('01', 'seller_owner', shop[SHARMA]);
    const other = await person('02', 'seller_owner', shop[GUPTA]);
    const ops = await person('03', 'ops_manager');
    const customer = await ensureUser(ctx.db, {
      firebaseUid: 'gu-customer',
      phone: '+919822222299',
      email: 'gu-customer@example.com',
      emailVerified: true,
    });
    const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
    const q = await quoteCheckout(ctx.db, { pincode: '492004', lines, locale: 'en' });
    const placed = await placeCodOrder(ctx.db, {
      userId: customer.id,
      idempotencyKey: 'give-up-api-key-0001',
      address: {
        contactName: 'Ravi',
        contactPhone: '+919822222299',
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
    const o = (await ctx.db.select().from(s.orders)).find((r) => r.code === code)!;
    const routed = await routeOrder(ctx.db, {
      scope: { all: true },
      code,
      shopId: shop[SHARMA]!,
      expectedVersion: o.version,
      staffUserId: ops.id,
    });
    const accepted = await send('POST', `/v1/shop/offers/${routed.assignmentId}/accept`, owner.headers);
    const version = ((await accepted.json()) as { version: number }).version;
    const url = `/v1/shop/orders/${code}/give-up`;

    const r404 = await send('POST', url, other.headers, { reasonCode: 'out_of_stock', version });
    expect(r404.status, await bodyOf(r404)).toBe(404);
    expect((await send('POST', url, ops.headers, { reasonCode: 'out_of_stock', version })).status).toBe(403);
    expect((await send('POST', url, owner.headers, { reasonCode: 'made_up', version })).status).toBe(400);
    expect((await send('POST', url, owner.headers, { reasonCode: 'other', version, extra: 1 })).status).toBe(
      400,
    );
    const ok = await send('POST', url, owner.headers, {
      reasonCode: 'out_of_stock',
      note: 'Sold in store',
      version,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'needs_rerouting' });
    expect(
      await errorCode(await send('POST', url, owner.headers, { reasonCode: 'out_of_stock', version })),
    ).toBe(
      'NOT_FOUND', // the shop no longer holds the order
    );

    const queue = (await (await send('GET', '/v1/admin/orders?view=needs_routing', ops.headers)).json()) as {
      items: { code: string; gaveUpReason: string | null }[];
    };
    expect(queue.items.find((i) => i.code === code)).toMatchObject({ gaveUpReason: 'out_of_stock' });
    const view = (await (await send('GET', `/v1/admin/orders/${code}`, ops.headers)).json()) as {
      history: { status: string; giveUpReason: string | null }[];
    };
    expect(view.history[0]).toMatchObject({ status: 'given_up', giveUpReason: 'out_of_stock' });
    const done = (await (await send('GET', '/v1/shop/orders?view=done', owner.headers)).json()) as {
      orders: { code: string; status: string; givenUpReason: string | null }[];
    };
    expect(done.orders.find((i) => i.code === code)).toMatchObject({
      status: 'given_up',
      givenUpReason: 'out_of_stock',
    });
  });
});

describe('warnings over HTTP', () => {
  it('staff with approval rights warn and are prompted at the threshold; the shop reads its own, never the threshold', async () => {
    const ops = await person('04', 'ops_manager');
    const support = await person('05', 'support_agent');
    const owner = await person('06', 'seller_owner', shop[SHARMA]);
    const other = await person('07', 'seller_owner', shop[GUPTA]);
    const url = `/v1/admin/shops/${shop[SHARMA]}/warnings`;

    expect((await send('POST', url, support.headers, { reasonCode: 'missed_offers' })).status).toBe(403);
    expect((await send('POST', url, ops.headers, { reasonCode: 'made_up' })).status).toBe(400);
    expect((await send('POST', url, ops.headers, { reasonCode: 'other' })).status).toBe(400);
    expect((await send('POST', url, ops.headers, { reasonCode: 'missed_offers', extra: 1 })).status).toBe(
      400,
    );
    const first = await send('POST', url, ops.headers, { reasonCode: 'missed_offers' });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string; warnings: { suggestPause: boolean } };
    expect(firstBody.warnings.suggestPause).toBe(false);
    await send('POST', url, ops.headers, { reasonCode: 'gave_up_orders', note: 'Three given up this week' });
    const third = (await (
      await send('POST', url, ops.headers, { reasonCode: 'late_deliveries' })
    ).json()) as {
      warnings: { counting: number; suggestPause: boolean; threshold: number };
    };
    expect(third.warnings).toMatchObject({ counting: 3, threshold: 3, suggestPause: true });
    const shopRow = (await ctx.db.select().from(s.shops)).find((r) => r.id === shop[SHARMA]);
    expect(shopRow?.status).toBe('approved'); // a prompt, never an automatic pause

    const mine = (await (await send('GET', '/v1/shop/warnings', owner.headers)).json()) as {
      shops: { shopId: string; counting: number; warnings: unknown[] }[];
    };
    expect(mine.shops).toHaveLength(1);
    expect(mine.shops[0]).toMatchObject({ shopId: shop[SHARMA], counting: 3 });
    expect(JSON.stringify(mine)).not.toContain('threshold');
    const theirs = (await (await send('GET', '/v1/shop/warnings', other.headers)).json()) as {
      shops: { counting: number }[];
    };
    expect(theirs.shops[0]?.counting).toBe(0);

    const withdrawn = await send('POST', `${url}/${firstBody.id}/withdraw`, ops.headers, {
      note: 'Issued by mistake',
    });
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toMatchObject({ counting: 2, suggestPause: false });
    expect(
      await errorCode(
        await send('POST', `${url}/${firstBody.id}/withdraw`, ops.headers, { note: 'Again please' }),
      ),
    ).toBe('WARNING_WITHDRAWN');
    expect((await send('GET', url, support.headers)).status).toBe(200);
  });
});
