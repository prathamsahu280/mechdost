/**
 * Seller applications and invites (plan 2026-11-13 Task 3): the GST number is stored encrypted, duplicates are
 * flagged, invites are single use, an invited application is approved on submit (unless its GSTIN is already
 * known), approval creates a pending shop with its delivery area, and the applicant becomes its owner on sign-in.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SellerApplication } from '@mechdost/shared/partners';
import { loadKeyring } from '../src/crypto';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  approveApplication,
  createInvite,
  getApplication,
  linkApplicantOwner,
  openInvite,
  rejectApplication,
  revokeInvite,
  submitSellerApplication,
  syncRbacCatalogue,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
const ALL = { all: true } as const;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let n = 0;

const application = (over: Partial<SellerApplication> = {}): SellerApplication => {
  n += 1;
  return {
    name: 'Ravi Sahu',
    phone: `+9198765432${String(n).padStart(2, '0')}`,
    email: `ravi${String(n)}@example.com`,
    businessName: 'Sahu Auto Parts',
    shopName: 'Sahu Auto Parts',
    gstStatus: 'registered',
    gstNumber: '27AAPFU0939F1ZV',
    addressLine: 'Shop 4, GE Road, Pandri',
    pincode: '492004',
    location: { lat: 21.25, lng: 81.65, accuracyM: 12, source: 'gps' },
    productSlugs: ['castrol-activ-4t-20w40-900ml', 'exide-xltz4a-2w-battery'],
    consent: true,
    ...over,
  };
};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  await syncRbacCatalogue(t());
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-apps-staff' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('public seller applications', () => {
  it('stores the GST number encrypted, the products and the map pin', async () => {
    const r = await submitSellerApplication(t(), { application: application(), source: 'public', keyring });
    expect(r.status).toBe('new');
    const [row] = await db.select().from(s.partnerApplications).where(eq(s.partnerApplications.code, r.code));
    expect(row?.kycEnc).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain('27AAPFU0939F1ZV');
    expect(row).toMatchObject({
      kind: 'seller',
      gstStatus: 'registered',
      locationSource: 'gps',
      source: 'public',
    });
    const products = await db
      .select()
      .from(s.partnerApplicationProducts)
      .where(eq(s.partnerApplicationProducts.applicationId, row!.id));
    expect(products).toHaveLength(2);
    const detail = await getApplication(t(), ALL, r.code, keyring);
    expect(detail).toMatchObject({ gstNumber: '27AAPFU0939F1ZV', duplicateGstin: false, products: 2 });
  });

  it('flags a GSTIN that another application already used; refuses unknown products', async () => {
    const r = await submitSellerApplication(t(), { application: application(), source: 'public', keyring });
    expect((await getApplication(t(), ALL, r.code, keyring)).duplicateGstin).toBe(true);
    await expect(
      submitSellerApplication(t(), {
        application: application({ productSlugs: ['no-such-product'] }),
        source: 'public',
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'PRODUCTS' });
  });
});

describe('invites', () => {
  it('an invite is single use, and the invited application is approved on submit', async () => {
    const invite = await createInvite(t(), {
      name: 'Asha Verma',
      email: 'asha@example.com',
      phone: '+919812345670',
      staffUserId: staff,
      keyring,
    });
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await openInvite(t(), invite.token)).toMatchObject({ name: 'Asha Verma', phoneLast4: '5670' });
    const r = await submitSellerApplication(t(), {
      application: application({ phone: '+919812345670', gstNumber: '22ABVCS4888H1ZL' }),
      source: 'invite',
      inviteToken: invite.token,
      keyring,
    });
    expect(r.status).toBe('approved');
    await expect(
      submitSellerApplication(t(), {
        application: application({ phone: '+919812345670', gstNumber: '22ABVCS4888H1ZL' }),
        source: 'invite',
        inviteToken: invite.token,
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'INVITE_USED' });
    const outbox = await db.select().from(s.notificationOutbox);
    expect(outbox.some((o) => o.templateKey === 'partner_invite' && o.channel === 'email')).toBe(true);
  });

  it('expired, revoked and unknown links are refused; an invited duplicate GSTIN goes to review', async () => {
    await expect(openInvite(t(), 'x'.repeat(43))).rejects.toMatchObject({ status: 404 });
    const revoked = await createInvite(t(), {
      name: 'Bina Rao',
      email: 'b@example.com',
      phone: '+919812345671',
      staffUserId: staff,
      keyring,
    });
    const [row] = await db.select().from(s.partnerInvites).where(eq(s.partnerInvites.phone, '+919812345671'));
    await revokeInvite(t(), { id: row!.id, staffUserId: staff });
    await expect(openInvite(t(), revoked.token)).rejects.toMatchObject({ code: 'INVITE_REVOKED' });
    const expired = await createInvite(t(), {
      name: 'Chetan Das',
      email: 'c@example.com',
      phone: '+919812345672',
      staffUserId: staff,
      keyring,
    });
    await db
      .update(s.partnerInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.partnerInvites.phone, '+919812345672'));
    await expect(openInvite(t(), expired.token)).rejects.toMatchObject({ code: 'INVITE_EXPIRED' });
    const dup = await createInvite(t(), {
      name: 'Deepa Sen',
      email: 'd@example.com',
      phone: '+919812345673',
      staffUserId: staff,
      keyring,
    });
    const r = await submitSellerApplication(t(), {
      application: application({ phone: '+919812345673' }), // the GSTIN used by the public applications above
      source: 'invite',
      inviteToken: dup.token,
      keyring,
    });
    expect(r.status).toBe('new');
  });
});

describe('review', () => {
  it('approval creates a pending shop with its delivery area; another city sees 404; rejection needs a reason', async () => {
    const app = await submitSellerApplication(t(), {
      application: application({ gstNumber: '22ABVCS4888H1ZL', phone: '+919811111111' }),
      source: 'public',
      keyring,
    });
    const detail = await getApplication(t(), ALL, app.code, keyring);
    await expect(
      approveApplication(t(), {
        scope: { all: false, cityIds: [] },
        code: app.code,
        expectedVersion: detail.version,
        staffUserId: staff,
        coverage: [{ pincode: '492004', shippingPaise: 4000, leadDays: 2 }],
        keyring,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const { shopId } = await approveApplication(t(), {
      scope: ALL,
      code: app.code,
      expectedVersion: detail.version,
      staffUserId: staff,
      coverage: [
        { pincode: '492004', shippingPaise: 4000, leadDays: 2 },
        { pincode: '492001', shippingPaise: 5000, leadDays: 3 },
      ],
      keyring,
    });
    const [shop] = await db.select().from(s.shops).where(eq(s.shops.id, shopId));
    expect(shop).toMatchObject({
      status: 'pending',
      gstStatus: 'registered',
      gstin: '22ABVCS4888H1ZL',
      pincode: '492004',
    });
    const pins = await db.select().from(s.shopPincodes).where(eq(s.shopPincodes.shopId, shopId));
    expect(pins.map((p) => p.pincode).sort()).toEqual(['492001', '492004']);

    const other = await submitSellerApplication(t(), {
      application: application({ phone: '+919811111112' }),
      source: 'public',
      keyring,
    });
    const o = await getApplication(t(), ALL, other.code, keyring);
    await expect(
      rejectApplication(t(), {
        scope: ALL,
        code: other.code,
        expectedVersion: o.version,
        staffUserId: staff,
        reasonCode: 'nope' as 'other',
      }),
    ).rejects.toMatchObject({ code: 'REASON_CODE' });
    await rejectApplication(t(), {
      scope: ALL,
      code: other.code,
      expectedVersion: o.version,
      staffUserId: staff,
      reasonCode: 'duplicate',
    });
    expect((await getApplication(t(), ALL, other.code, keyring)).status).toBe('rejected');
  });

  it('the applicant becomes the shop owner when they sign in with that phone, once', async () => {
    const user = (
      await db.insert(s.users).values({ firebaseUid: 'fb-owner-1', phone: '+919811111111' }).returning()
    )[0]!;
    expect(await linkApplicantOwner(t(), { userId: user.id, phone: '+919811111111' })).toBe(1);
    expect(await linkApplicantOwner(t(), { userId: user.id, phone: '+919811111111' })).toBe(0);
    const grants = await db.select().from(s.userRoles).where(eq(s.userRoles.userId, user.id));
    expect(grants).toHaveLength(1);
    expect(grants[0]?.shopId).toBeTruthy();
  });
});
