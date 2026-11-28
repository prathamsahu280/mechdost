/**
 * DC-F3 and DC-P6 (delivery + COD QA 2026-11-27, docs/qa/qa-backlog-2026-11-27.md): the daily request limit counts
 * created requests only, and a turned-down customer is told on which date they may ask again.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  codStatusFor,
  decideCodRequest,
  quoteCheckout,
  requestCod,
  withdrawCodRequest,
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
let staff = '';
const ALL = { all: true } as const;
const OIL = 'CAS-ACT4T-0900';
const PIN = '492004';
let n = 0;
const newUser = async () =>
  (
    await db
      .insert(s.users)
      .values({ firebaseUid: `fb-codx-${String(++n)}`, phone: `+9198100${String(n).padStart(5, '0')}` })
      .returning()
  )[0]!.id;

beforeAll(async () => {
  ({ db, client } = await createTestDb({ codDefaults: true }));
  await seedRaipurDemo(t(), fixture);
  staff = await newUser();
});
afterAll(async () => {
  await client.close();
});

describe('DC-F3 daily request limit', () => {
  it('refused attempts do not use it up; only created requests count', async () => {
    const user = await newUser();
    const first = await requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'other', note: null });
    // Eight refused tries while a request is pending: each is a 409 and none counts.
    for (let i = 0; i < 8; i++)
      await expect(
        requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'other', note: null }),
      ).rejects.toMatchObject({ code: 'COD_REQUEST_PENDING' });
    await withdrawCodRequest(t(), { userId: user, requestId: first.id, expectedVersion: first.version });
    // Four more created and withdrawn make five created: the sixth create is the one refused.
    for (let i = 0; i < 4; i++) {
      const r = await requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'other', note: null });
      await withdrawCodRequest(t(), { userId: user, requestId: r.id, expectedVersion: r.version });
    }
    await expect(
      requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'other', note: null }),
    ).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });
});

describe('DC-P6 ask again on a date', () => {
  it('after a rejection the status and the checkout quote carry the date; others have none', async () => {
    const user = await newUser();
    const r = await requestCod(t(), { userId: user, pincode: PIN, reasonCode: 'large_order', note: null });
    await decideCodRequest(t(), {
      requestId: r.id,
      expectedVersion: r.version,
      decision: 'reject',
      reasonCode: 'insufficient_history',
      staffUserId: staff,
      scope: ALL,
    });
    const status = await codStatusFor(t(), { userId: user, pincode: PIN });
    expect(status.askAgainAt).toBeInstanceOf(Date);
    expect(status.askAgainAt?.getTime() ?? 0).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const quote = await quoteCheckout(
      t(),
      { pincode: PIN, lines: [{ sku: OIL, qty: 1 }], locale: 'en' },
      { userId: user },
    );
    expect(quote.cod.eligibility.askAgainAt).toBe(status.askAgainAt?.toISOString());
    const fresh = await codStatusFor(t(), { userId: await newUser(), pincode: PIN });
    expect(fresh.askAgainAt).toBeNull();
  });
});
