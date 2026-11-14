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
  listInvites,
  openInvite,
  rejectApplication,
  revokeInvite,
  submitSellerApplication,
  syncRbacCatalogue,
  type Tx,
} from '../src/repo';
import { events } from '../src/repo/events';
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
let raipurId = '';
const cityOf = () => raipurId;
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
  raipurId = (await db.select().from(s.cities).limit(1))[0]!.id;
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
      cityId: cityOf(),
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
      cityId: cityOf(),
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
      cityId: cityOf(),
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
      cityId: cityOf(),
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
    // The owner is a shop member too, so live pings (new offers) reach them (shop management 2026-11-14).
    const members = await db.select().from(s.shopUsers).where(eq(s.shopUsers.userId, user.id));
    expect(members.map((m) => [m.shopId, m.role])).toEqual([[grants[0]?.shopId, 'owner']]);
  });
});

describe('security review 2026-11-13', () => {
  it('an owner link happens once: a removed owner is not re-granted on the next sign-in', async () => {
    const user = (await db.insert(s.users).values({ firebaseUid: 'fb-owner-2' }).returning())[0]!;
    // The application's owner was already linked to fb-owner-1 above; another account with that phone gets nothing.
    expect(await linkApplicantOwner(t(), { userId: user.id, phone: '+919811111111' })).toBe(0);
    const owner = (await db.select().from(s.users).where(eq(s.users.firebaseUid, 'fb-owner-1')))[0]!;
    await db.delete(s.userRoles).where(eq(s.userRoles.userId, owner.id)); // an admin removed the owner
    expect(await linkApplicantOwner(t(), { userId: owner.id, phone: '+919811111111' })).toBe(0);
  });

  it('an invite belongs to a city: the application must be in it, and other cities cannot see or revoke it', async () => {
    const raipur = (await db.select().from(s.cities).limit(1))[0]!;
    const invite = await createInvite(t(), {
      name: 'Esha Patel',
      email: 'esha@example.com',
      phone: '+919812345679',
      staffUserId: staff,
      keyring,
      cityId: raipur.id,
    });
    const [row] = await db.select().from(s.partnerInvites).where(eq(s.partnerInvites.phone, '+919812345679'));
    expect(row?.cityId).toBe(raipur.id);
    expect((await listInvites(t(), { all: false, cityIds: [] })).items).toEqual([]);
    await expect(
      revokeInvite(t(), { id: row!.id, staffUserId: staff, scope: { all: false, cityIds: [] } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(invite.token).toBeTruthy();
  });
});

describe('final review fixes 2026-11-13', () => {
  it('an expired invite does not block a new one for that number; the list shows it expired, newest first', async () => {
    const phone = '+919812345690';
    const first = {
      name: 'Gita Rao',
      email: 'g@example.com',
      phone,
      staffUserId: staff,
      keyring,
      cityId: cityOf(),
    };
    await createInvite(t(), first);
    await expect(createInvite(t(), first)).rejects.toMatchObject({ code: 'INVITE_OPEN' });
    await db
      .update(s.partnerInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.partnerInvites.phone, phone));
    await createInvite(t(), { ...first, email: 'gita@example.com' });
    const mine = (await listInvites(t(), ALL)).items.filter((i) => i.phone === phone);
    expect(mine.map((i) => [i.email, i.status])).toEqual([
      ['gita@example.com', 'sent'],
      ['g@example.com', 'expired'],
    ]);
  });
  it('an invited application keeps the invited name, email and mobile, whatever the form sent', async () => {
    const invite = await createInvite(t(), {
      name: 'Hema Patel',
      email: 'hema@example.com',
      phone: '+919812345691',
      staffUserId: staff,
      keyring,
      cityId: cityOf(),
    });
    const r = await submitSellerApplication(t(), {
      application: application({ name: 'Someone Else', email: 'other@example.com', phone: '+919800000000' }),
      source: 'invite',
      inviteToken: invite.token,
      keyring,
    });
    const [row] = await db.select().from(s.partnerApplications).where(eq(s.partnerApplications.code, r.code));
    expect(row).toMatchObject({ name: 'Hema Patel', email: 'hema@example.com', phone: '+919812345691' });
  });
  it('the invite list pages with a cursor, newest first, and never loses a row', async () => {
    const all = (await listInvites(t(), ALL, { limit: 200 })).items;
    expect(all.length).toBeGreaterThan(2);
    const seen: string[] = [];
    let before: { createdAt: string; id: string } | null = null;
    for (;;) {
      const page = await listInvites(t(), ALL, { limit: 2, before });
      seen.push(...page.items.map((i) => i.id));
      const last = page.items.at(-1);
      if (!page.more || !last) break;
      before = { createdAt: last.createdAt.toISOString(), id: last.id };
    }
    expect(seen).toEqual(all.map((i) => i.id));
  });
  it('opening an invite link is counted (partner_invite_opened), with no personal data', async () => {
    const invite = await createInvite(t(), {
      name: 'Jaya Rao',
      email: 'jaya@example.com',
      phone: '+919812345693',
      staffUserId: staff,
      keyring,
      cityId: cityOf(),
    });
    await openInvite(t(), invite.token);
    const rows = await db.select().from(events).where(eq(events.event, 'partner_invite_opened'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1)).toMatchObject({ cityId: cityOf(), props: {} });
  });
});
