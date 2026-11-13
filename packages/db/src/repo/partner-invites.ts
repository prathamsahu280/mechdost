import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { InviteSchema } from '@mechdost/shared/partners';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { inviteMachine, type InviteStatus } from '@mechdost/shared/state';
import type { Keyring } from '../crypto';
import { auditLog, partnerInvites, settings } from '../schema';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { enqueueNotification } from './notify';
import { sealPayloadField } from './order-notifications';
import type { Tx } from './orders';
import type { CityScope } from './routing';

/**
 * Admin invites to sellers (design 2026-11-13): a one-time link. Only the SHA-256 of the token is stored; the
 * token travels to the seller in the invite email (encrypted in the outbox payload until it is sent) and is shown
 * once to the admin to copy. Opening the link proves the email; the phone is still confirmed by OTP at sign-in (Q78).
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function inviteDays(db: Tx): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, 'partners.invite_days'), isNull(settings.cityId)))
    .limit(1);
  const v = row?.value;
  const s = OPERATIONAL_SETTINGS['partners.invite_days'];
  return typeof v === 'number' && Number.isInteger(v) && v >= s.min && v <= s.max ? v : s.default;
}

export async function createInvite(
  db: Tx,
  input: {
    name: string;
    email: string;
    phone: string;
    staffUserId: string;
    keyring: Keyring;
    cityId: string;
  },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const parsed = InviteSchema.safeParse({ name: input.name, email: input.email, phone: input.phone });
  if (!parsed.success) throw new ValidationError('Check the name, email and mobile number', 'INVITE_INVALID');
  const invite = parsed.data;
  const token = randomBytes(32).toString('base64url');
  const days = await inviteDays(db);
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  return db.transaction(async (tx) => {
    // An invite past its date no longer blocks a new one for that number (final review 2026-11-13; there is no
    // sweep, so stale rows are expired here, by the system).
    inviteMachine.assert('sent', 'expired', 'system');
    await tx
      .update(partnerInvites)
      .set({ status: 'expired' })
      .where(
        and(
          eq(partnerInvites.phone, invite.phone),
          eq(partnerInvites.status, 'sent'),
          lte(partnerInvites.expiresAt, sql`now()`),
        ),
      );
    let row: { id: string } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(partnerInvites)
          .values({
            tokenHash: hashInviteToken(token),
            name: invite.name,
            email: invite.email,
            phone: invite.phone,
            cityId: input.cityId,
            createdBy: input.staffUserId,
            expiresAt,
          })
          .returning({ id: partnerInvites.id }),
      );
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new ConflictError('This mobile number already has an open invite', 'INVITE_OPEN');
      throw err;
    }
    if (!row) throw new Error('invite insert returned no row');
    await enqueueNotification(tx, {
      dedupeKey: `partner_invite:${row.id}:email`,
      channel: 'email',
      recipient: invite.email,
      templateKey: 'partner_invite',
      payload: {
        name: invite.name,
        expiresOn: expiresAt.toISOString().slice(0, 10),
        ...sealPayloadField(token, input.keyring, 'token'),
      },
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'partner_invite.sent',
      entity: 'partner_invite',
      entityId: row.id,
      after: { name: invite.name, expiresAt: expiresAt.toISOString() },
    });
    await recordServerEvent(tx, 'partner_invite_sent', { userId: input.staffUserId, props: {} });
    return { id: row.id, token, expiresAt };
  });
}

export interface OpenInvite {
  id: string;
  cityId: string;
  name: string;
  email: string;
  phone: string;
  status: InviteStatus;
  expiresAt: Date;
  version: number;
}

/** The invite behind a token, still open. Unknown → 404; used, revoked or expired → 409 with the reason. */
export async function findOpenInvite(db: Tx, token: string, lock = false): Promise<OpenInvite> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundError('Invite not found');
  const query = db
    .select({
      id: partnerInvites.id,
      cityId: partnerInvites.cityId,
      name: partnerInvites.name,
      email: partnerInvites.email,
      phone: partnerInvites.phone,
      status: partnerInvites.status,
      expiresAt: partnerInvites.expiresAt,
      version: partnerInvites.version,
    })
    .from(partnerInvites)
    .where(eq(partnerInvites.tokenHash, hashInviteToken(token)))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Invite not found');
  const status = row.status as InviteStatus;
  if (status === 'used') throw new ConflictError('This invite has already been used', 'INVITE_USED');
  if (status === 'revoked') throw new ConflictError('This invite was withdrawn', 'INVITE_REVOKED');
  if (status === 'expired' || row.expiresAt.getTime() <= Date.now())
    throw new ConflictError('This invite has expired', 'INVITE_EXPIRED');
  return { ...row, status };
}

/** What the invite page may show before the seller fills in the form (the phone is masked). */
export async function openInvite(
  db: Tx,
  token: string,
): Promise<{ name: string; email: string; phoneLast4: string; expiresAt: Date }> {
  const invite = await findOpenInvite(db, token);
  // Funnel step (spec 12): no personal data, only the city.
  await recordServerEvent(db, 'partner_invite_opened', { cityId: invite.cityId, props: {} });
  return {
    name: invite.name,
    email: invite.email,
    phoneLast4: invite.phone.slice(-4),
    expiresAt: invite.expiresAt,
  };
}

export async function revokeInvite(
  db: Tx,
  input: { id: string; staffUserId: string; scope?: CityScope },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: partnerInvites.status,
        version: partnerInvites.version,
        cityId: partnerInvites.cityId,
      })
      .from(partnerInvites)
      .where(eq(partnerInvites.id, input.id))
      .for('update');
    if (!row || (input.scope && !input.scope.all && !input.scope.cityIds.includes(row.cityId)))
      throw new NotFoundError('Invite not found');
    inviteMachine.assert(row.status as InviteStatus, 'revoked', 'admin');
    await tx
      .update(partnerInvites)
      .set({ status: 'revoked' })
      .where(and(eq(partnerInvites.id, input.id), eq(partnerInvites.version, row.version)));
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'partner_invite.revoked',
      entity: 'partner_invite',
      entityId: input.id,
    });
  });
}

/** Invites in the staff member's cities, newest first; a `sent` invite past its date shows as `expired`. */
export async function listInvites(
  db: Tx,
  scope: CityScope,
  opts: { limit?: number; before?: { createdAt: string; id: string } | null } = {},
) {
  if (!scope.all && scope.cityIds.length === 0) return { items: [], more: false };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const before = opts.before;
  const rows = await db
    .select({
      id: partnerInvites.id,
      name: partnerInvites.name,
      email: partnerInvites.email,
      phone: partnerInvites.phone,
      status: partnerInvites.status,
      expiresAt: partnerInvites.expiresAt,
      usedAt: partnerInvites.usedAt,
      createdAt: partnerInvites.createdAt,
    })
    .from(partnerInvites)
    .where(
      and(
        scope.all ? undefined : inArray(partnerInvites.cityId, scope.cityIds),
        before
          ? or(
              lt(partnerInvites.createdAt, new Date(before.createdAt)),
              and(eq(partnerInvites.createdAt, new Date(before.createdAt)), lt(partnerInvites.id, before.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(partnerInvites.createdAt), desc(partnerInvites.id))
    .limit(limit + 1);
  const now = Date.now();
  const items = rows
    .slice(0, limit)
    .map((r) => (r.status === 'sent' && r.expiresAt.getTime() <= now ? { ...r, status: 'expired' } : r));
  return { items, more: rows.length > limit };
}
