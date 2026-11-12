/**
 * Seller onboarding schema (plan 2026-11-13 Task 2): one pending price per shop and product, codes checked by the
 * database, a seller application needs its GST status, address and location, one open invite per phone, and
 * agreement acceptances are append-only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import type { Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let shopId = '';
let variantId = '';
let staffId = '';

const pgCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? 'error';
  }
};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  shopId = (await db.select({ id: s.shops.id }).from(s.shops).limit(1))[0]!.id;
  variantId = (await db.select({ id: s.productVariants.id }).from(s.productVariants).limit(1))[0]!.id;
  staffId = (await db.insert(s.users).values({ firebaseUid: 'fb-onboarding-staff' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('seller onboarding schema (migration 0038)', () => {
  it('one pending price request per shop and product', async () => {
    const request = { shopId, variantId, requestedPaise: 45_000, onHand: 5, requestedBy: staffId };
    expect(await pgCode(db.insert(s.shopPriceRequests).values(request))).toBe('ok');
    expect(await pgCode(db.insert(s.shopPriceRequests).values(request))).toBe('23505');
    expect(await pgCode(db.insert(s.shopPriceRequests).values({ ...request, status: 'approved' }))).toBe(
      'ok',
    );
    expect(await pgCode(db.insert(s.shopPriceRequests).values({ ...request, status: 'maybe' }))).toBe(
      '23514',
    );
  });

  it('shops and applications only take known GST statuses; a seller application needs address and location', async () => {
    expect(
      await pgCode(
        db
          .update(s.shops)
          .set({ gstStatus: 'unregistered' })
          .where(sql`id = ${shopId}`),
      ),
    ).toBe('23514');
    const base = {
      code: 'PA-RPR-2026-AB12CD',
      kind: 'seller',
      name: 'Ravi',
      phone: '+919876543210',
      pincode: '492004',
      consentAt: new Date(),
    };
    expect(await pgCode(db.insert(s.partnerApplications).values(base))).toBe('23514');
    expect(
      await pgCode(
        db.insert(s.partnerApplications).values({
          ...base,
          gstStatus: 'registered',
          addressLine: 'Shop 4, GE Road',
          location: { lng: 81.65, lat: 21.25 },
          locationSource: 'gps',
          locationAccuracyM: 10,
        }),
      ),
    ).toBe('ok');
    expect(
      await pgCode(
        db
          .insert(s.partnerApplications)
          .values({ ...base, code: 'PA-RPR-2026-AB12CE', kind: 'garage', details: 'x' }),
      ),
    ).toBe('ok'); // garages keep the old form
  });

  it('one open invite per phone', async () => {
    const invite = {
      tokenHash: 'a'.repeat(64),
      name: 'Asha',
      email: 'asha@example.com',
      phone: '+919812345670',
      createdBy: staffId,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    expect(await pgCode(db.insert(s.partnerInvites).values(invite))).toBe('ok');
    expect(await pgCode(db.insert(s.partnerInvites).values({ ...invite, tokenHash: 'b'.repeat(64) }))).toBe(
      '23505',
    );
  });

  it('agreement acceptances are append-only; inventory rows can be blocked by staff', async () => {
    await db
      .insert(s.agreementVersions)
      .values({ version: 1, textEn: 'Terms', textHi: 'शर्तें', createdBy: staffId });
    await db.insert(s.shopAgreements).values({ shopId, version: 1, acceptedBy: staffId });
    expect(await pgCode(db.update(s.shopAgreements).set({ version: 2 }))).not.toBe('ok');
    expect(await pgCode(db.delete(s.shopAgreements))).not.toBe('ok');
    const [row] = await db.select({ blocked: s.shopInventory.adminBlocked }).from(s.shopInventory).limit(1);
    expect(row?.blocked).toBe(false);
  });
});
