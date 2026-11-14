import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { isStaffGrant } from '@mechdost/shared/auth';
import { StaffInviteBodySchema, SHOP_TEAM_MAX, type ShopTeamDto } from '@mechdost/shared/shop-team';
import { shopStaffInviteMachine } from '@mechdost/shared/state';
import { auditLog, roles, shops, shopStaffInvites, shopUsers, userRoles, users } from '../schema';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { inviteDays } from './partner-invites';
import type { Tx } from './orders';
import { grantRole, loadGrants } from './rbac';

/**
 * The shop's team (design 2026-11-15, spec 07/13). The owner invites a helper by phone and name; the invite is bound
 * to that number, single use and expires (`partners.invite_days`). When the invitee signs in with a code sent to
 * that phone (the OTP proves it, as for seller applicants), `claimShopStaffInvites` makes them `seller_staff` for
 * this shop only. The owner can cancel an invite or remove a member; at most `SHOP_TEAM_MAX` people per shop
 * (owner + staff + invites still waiting), counted under the shop row lock so two parallel invites cannot pass it.
 * Every function takes the shops the caller OWNS from the API's grants: another shop's id is a 404.
 */
const last4 = (phone: string | null) => (phone ? phone.slice(-4) : null);

function ownedOr404(owned: readonly string[], shopId: string) {
  if (!owned.includes(shopId)) throw new NotFoundError('Shop not found');
}

async function lockShop(tx: Tx, shopId: string) {
  const [shop] = await tx
    .select({ id: shops.id, cityId: shops.cityId })
    .from(shops)
    .where(eq(shops.id, shopId))
    .for('update');
  if (!shop) throw new NotFoundError('Shop not found');
  return shop;
}

/** Members + invites still waiting, for the limit. */
async function teamSize(tx: Tx, shopId: string): Promise<number> {
  const [m] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(shopUsers)
    .where(eq(shopUsers.shopId, shopId));
  const [i] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(shopStaffInvites)
    .where(
      and(
        eq(shopStaffInvites.shopId, shopId),
        eq(shopStaffInvites.status, 'sent'),
        gt(shopStaffInvites.expiresAt, sql`now()`),
      ),
    );
  return (m?.n ?? 0) + (i?.n ?? 0);
}

export async function listShopTeam(
  db: Tx,
  input: { shopId: string; ownedShopIds: readonly string[]; userId: string },
): Promise<ShopTeamDto> {
  ownedOr404(input.ownedShopIds, input.shopId);
  const members = await db
    .select({ userId: shopUsers.userId, role: shopUsers.role, name: users.name, phone: users.phone })
    .from(shopUsers)
    .innerJoin(users, eq(users.id, shopUsers.userId))
    .where(eq(shopUsers.shopId, input.shopId))
    .orderBy(asc(shopUsers.role), asc(shopUsers.createdAt), asc(shopUsers.id));
  const invites = await db
    .select({
      id: shopStaffInvites.id,
      name: shopStaffInvites.name,
      phone: shopStaffInvites.phone,
      expiresAt: shopStaffInvites.expiresAt,
    })
    .from(shopStaffInvites)
    .where(
      and(
        eq(shopStaffInvites.shopId, input.shopId),
        eq(shopStaffInvites.status, 'sent'),
        gt(shopStaffInvites.expiresAt, sql`now()`),
      ),
    )
    .orderBy(asc(shopStaffInvites.createdAt), asc(shopStaffInvites.id));
  return {
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role === 'owner' ? ('owner' as const) : ('staff' as const),
      name: m.name,
      phoneLast4: last4(m.phone),
      isYou: m.userId === input.userId,
    })),
    invites: invites.map((i) => ({
      id: i.id,
      name: i.name,
      phoneLast4: last4(i.phone) ?? '',
      expiresAt: i.expiresAt.toISOString(),
    })),
    max: SHOP_TEAM_MAX,
  };
}

export async function inviteShopStaff(
  db: Tx,
  input: {
    shopId: string;
    ownedShopIds: readonly string[];
    userId: string;
    name: string;
    phone: string;
  },
): Promise<{ id: string; expiresAt: Date }> {
  ownedOr404(input.ownedShopIds, input.shopId);
  const parsed = StaffInviteBodySchema.safeParse({ name: input.name, phone: input.phone });
  if (!parsed.success) throw new ValidationError('Check the name and mobile number', 'INVITE_INVALID');
  const invite = parsed.data;
  const days = await inviteDays(db);
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  return db.transaction(async (tx) => {
    const shop = await lockShop(tx, input.shopId);
    // A lapsed invite no longer blocks a new one (there is no sweep; the system expires it here).
    shopStaffInviteMachine.assert('sent', 'expired', 'system');
    await tx
      .update(shopStaffInvites)
      .set({ status: 'expired' })
      .where(
        and(
          eq(shopStaffInvites.shopId, shop.id),
          eq(shopStaffInvites.phone, invite.phone),
          eq(shopStaffInvites.status, 'sent'),
          lte(shopStaffInvites.expiresAt, sql`now()`),
        ),
      );
    const [already] = await tx
      .select({ id: shopUsers.id })
      .from(shopUsers)
      .innerJoin(users, eq(users.id, shopUsers.userId))
      .where(and(eq(shopUsers.shopId, shop.id), eq(users.phone, invite.phone)))
      .limit(1);
    if (already) throw new ConflictError('This person is already on your team', 'ALREADY_MEMBER');
    if ((await teamSize(tx, shop.id)) >= SHOP_TEAM_MAX)
      throw new ConflictError(`A shop can have at most ${String(SHOP_TEAM_MAX)} people`, 'TEAM_FULL');
    let row: { id: string } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(shopStaffInvites)
          .values({
            shopId: shop.id,
            name: invite.name,
            phone: invite.phone,
            createdBy: input.userId,
            expiresAt,
          })
          .returning({ id: shopStaffInvites.id }),
      );
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new ConflictError('This mobile number already has an open invite', 'INVITE_OPEN');
      throw err;
    }
    if (!row) throw new Error('invite insert returned no row');
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'shop',
      action: 'shop_staff.invited',
      entity: 'shop_staff_invite',
      entityId: row.id,
      after: { shopId: shop.id, expiresAt: expiresAt.toISOString() },
    });
    await recordServerEvent(tx, 'shop_team_invited', {
      userId: input.userId,
      cityId: shop.cityId,
      props: { shopId: shop.id },
    });
    return { id: row.id, expiresAt };
  });
}

export async function cancelShopStaffInvite(
  db: Tx,
  input: { shopId: string; ownedShopIds: readonly string[]; userId: string; inviteId: string },
): Promise<void> {
  ownedOr404(input.ownedShopIds, input.shopId);
  shopStaffInviteMachine.assert('sent', 'revoked', 'shop');
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(shopStaffInvites)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(shopStaffInvites.id, input.inviteId),
          eq(shopStaffInvites.shopId, input.shopId),
          eq(shopStaffInvites.status, 'sent'),
        ),
      )
      .returning({ id: shopStaffInvites.id });
    if (!row) throw new NotFoundError('Invite not found');
    const shop = await lockShop(tx, input.shopId);
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'shop',
      action: 'shop_staff.invite_cancelled',
      entity: 'shop_staff_invite',
      entityId: row.id,
      after: { shopId: shop.id },
    });
    await recordServerEvent(tx, 'shop_team_invite_cancelled', {
      userId: input.userId,
      cityId: shop.cityId,
      props: { shopId: shop.id },
    });
  });
}

/**
 * The owner removes a helper: the `seller_staff` grant and the membership go in one transaction. The owner and the
 * caller themselves cannot be removed here. The API drops the removed person's cached session so the change applies
 * at once on this instance and within the session-cache period (60 s) on the others.
 */
export async function removeShopMember(
  db: Tx,
  input: { shopId: string; ownedShopIds: readonly string[]; userId: string; memberUserId: string },
): Promise<void> {
  ownedOr404(input.ownedShopIds, input.shopId);
  if (input.memberUserId === input.userId)
    throw new ConflictError('You cannot remove yourself', 'CANNOT_REMOVE_SELF');
  await db.transaction(async (tx) => {
    const shop = await lockShop(tx, input.shopId);
    const [member] = await tx
      .select({ id: shopUsers.id, role: shopUsers.role })
      .from(shopUsers)
      .where(and(eq(shopUsers.shopId, shop.id), eq(shopUsers.userId, input.memberUserId)));
    if (!member) throw new NotFoundError('Member not found');
    if (member.role === 'owner')
      throw new ConflictError('The owner cannot be removed here', 'CANNOT_REMOVE_OWNER');
    const [staffRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'seller_staff'))
      .limit(1);
    if (!staffRole) throw new NotFoundError('Role not found');
    const removed = await tx
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, input.memberUserId),
          eq(userRoles.shopId, shop.id),
          eq(userRoles.roleId, staffRole.id),
        ),
      )
      .returning({ id: userRoles.id });
    await tx.delete(shopUsers).where(eq(shopUsers.id, member.id));
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'shop',
      action: 'role.revoked',
      entity: 'user_role',
      entityId: removed[0]?.id ?? null,
      before: { userId: input.memberUserId, role: 'seller_staff', shopId: shop.id },
      reason: 'removed by the shop owner',
    });
    await recordServerEvent(tx, 'shop_team_member_removed', {
      userId: input.userId,
      cityId: shop.cityId,
      props: { shopId: shop.id },
    });
  });
}

/**
 * On sign-in: open invites for this verified phone become `seller_staff` grants (once each). MechDost staff
 * accounts are skipped (one person, one side: their invite stays open until it lapses), as is a full team.
 * Returns how many shops the person joined. The common case (no invite) is one indexed read, no transaction.
 */
export async function claimShopStaffInvites(
  db: Tx,
  input: { userId: string; phone: string },
): Promise<number> {
  const open = await db
    .select({ id: shopStaffInvites.id })
    .from(shopStaffInvites)
    .where(
      and(
        eq(shopStaffInvites.phone, input.phone),
        eq(shopStaffInvites.status, 'sent'),
        gt(shopStaffInvites.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  if (open.length === 0) return 0;
  if ((await loadGrants(db, input.userId)).some(isStaffGrant)) return 0;
  return db.transaction(async (tx) => {
    const invites = await tx
      .select({ id: shopStaffInvites.id, shopId: shopStaffInvites.shopId })
      .from(shopStaffInvites)
      .where(
        and(
          eq(shopStaffInvites.phone, input.phone),
          eq(shopStaffInvites.status, 'sent'),
          gt(shopStaffInvites.expiresAt, sql`now()`),
        ),
      )
      .orderBy(asc(shopStaffInvites.createdAt), asc(shopStaffInvites.id));
    let joined = 0;
    for (const invite of invites) {
      const shop = await lockShop(tx, invite.shopId);
      const [already] = await tx
        .select({ id: shopUsers.id })
        .from(shopUsers)
        .where(and(eq(shopUsers.shopId, shop.id), eq(shopUsers.userId, input.userId)));
      // Someone who is already on the team (the owner, say) is never changed by an invite; it is just closed.
      // The invite itself held a place when it was made (`teamSize`), so a claim cannot exceed the maximum.
      shopStaffInviteMachine.assert('sent', 'used', 'system');
      const [used] = await tx
        .update(shopStaffInvites)
        .set({ status: 'used', usedAt: new Date(), usedBy: input.userId })
        .where(and(eq(shopStaffInvites.id, invite.id), eq(shopStaffInvites.status, 'sent')))
        .returning({ id: shopStaffInvites.id });
      if (!used || already) continue;
      await grantRole(tx, {
        userId: input.userId,
        role: 'seller_staff',
        shopId: shop.id,
        grantedBy: null,
        reason: 'shop staff invite accepted',
      });
      await tx.insert(shopUsers).values({ shopId: shop.id, userId: input.userId, role: 'staff' });
      await recordServerEvent(tx, 'shop_team_invite_accepted', {
        userId: input.userId,
        cityId: shop.cityId,
        props: { shopId: shop.id },
      });
      joined += 1;
    }
    return joined;
  });
}
