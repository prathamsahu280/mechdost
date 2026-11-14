import { and, eq, isNull, sql } from 'drizzle-orm';
import { isStaffGrant, type SignInIdentifier } from '@mechdost/shared/auth';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { auditLog, users } from '../schema';
import { ConflictError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { loadGrants } from './rbac';

/** What a verified Firebase ID token tells us about the caller. Never built from request bodies. */
export interface VerifiedIdentity {
  firebaseUid: string;
  /** E.164; Firebase phone sign-in means the number is verified. */
  phone: string | null;
  email: string | null;
  emailVerified: boolean;
}

const userColumns = {
  id: users.id,
  firebaseUid: users.firebaseUid,
  name: users.name,
  phone: users.phone,
  phoneVerifiedAt: users.phoneVerifiedAt,
  email: users.email,
  emailVerifiedAt: users.emailVerifiedAt,
  language: users.language,
  status: users.status,
  version: users.version,
};

export type UserRecord = Pick<typeof users.$inferSelect, keyof typeof userColumns>;

const E164 = /^\+[1-9][0-9]{7,14}$/;

async function findByFirebaseUid(db: Tx, firebaseUid: string): Promise<UserRecord | undefined> {
  const rows = await db.select(userColumns).from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
  return rows[0];
}

/** Fields that differ between the stored row and the token, as a minimal UPDATE patch. */
function identityPatch(user: UserRecord, id: VerifiedIdentity) {
  const patch: PgUpdateSetSource<typeof users> = {};
  const now = sql`now()`;
  if (id.phone !== null && (id.phone !== user.phone || user.phoneVerifiedAt === null)) {
    patch.phone = id.phone;
    patch.phoneVerifiedAt = now;
  }
  if (id.email !== null) {
    const sameEmail = user.email !== null && user.email.toLowerCase() === id.email.toLowerCase();
    if (!sameEmail) {
      patch.email = id.email;
      patch.emailVerifiedAt = id.emailVerified ? now : null;
    } else if (id.emailVerified && user.emailVerifiedAt === null) {
      patch.emailVerifiedAt = now;
    }
  }
  return patch;
}

function identityInUse(err: unknown): never {
  if (pgCode(err) === '23505') {
    throw new ConflictError('This phone number or email is linked to another account', 'IDENTITY_IN_USE');
  }
  throw err;
}

/**
 * Find or create the profile row for a verified identity (docs/specs/01-auth-accounts.md).
 * Read-mostly: writes only on first sign-in or when the token's phone/email/verification changed.
 * Concurrent first requests are safe: INSERT … ON CONFLICT (firebase_uid) DO NOTHING, then re-read.
 * The audit entry records which facts changed, never the phone number or email (DPDP minimisation).
 */
export async function ensureUser(db: Tx, id: VerifiedIdentity): Promise<UserRecord> {
  if (id.phone !== null && !E164.test(id.phone)) {
    throw new ValidationError('Phone number must be in E.164 format', 'PHONE_FORMAT');
  }
  const existing = await findByFirebaseUid(db, id.firebaseUid);
  if (!existing) {
    // Accounts are only ever created by phone sign-up (decision 2026-11-01): a password sign-in token can
    // never create a user, so every account has a verified phone from its first row.
    if (id.phone === null) {
      throw new ValidationError('Create your account with your mobile number first', 'PHONE_SIGNUP_REQUIRED');
    }
    return provision(db, id);
  }

  const patch = identityPatch(existing, id);
  if (Object.keys(patch).length === 0) return existing;

  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .update(users)
        .set(patch)
        .where(sql`${users.id} = ${existing.id} and ${users.version} = ${existing.version}`)
        .returning(userColumns);
      const row = rows[0];
      // Zero rows: a concurrent request already synced this user — return the fresh row.
      if (!row) return (await findByFirebaseUid(tx, id.firebaseUid)) ?? existing;
      await tx.insert(auditLog).values({
        actorUserId: row.id,
        actorRole: 'system',
        action: 'user.identity_synced',
        entity: 'user',
        entityId: row.id,
        after: { fields: Object.keys(patch) },
      });
      return row;
    });
  } catch (err) {
    identityInUse(err);
  }
}

async function provision(db: Tx, id: VerifiedIdentity): Promise<UserRecord> {
  try {
    return await db.transaction(async (tx) => {
      const now = sql`now()`;
      const rows = await tx
        .insert(users)
        .values({
          firebaseUid: id.firebaseUid,
          phone: id.phone,
          phoneVerifiedAt: id.phone === null ? null : now,
          email: id.email,
          emailVerifiedAt: id.email !== null && id.emailVerified ? now : null,
        })
        .onConflictDoNothing({ target: users.firebaseUid })
        .returning(userColumns);
      const row = rows[0];
      if (!row) {
        const winner = await findByFirebaseUid(tx, id.firebaseUid);
        if (!winner) throw new ConflictError('User provisioning raced; retry', 'PROVISION_RACE');
        return winner;
      }
      await tx.insert(auditLog).values({
        actorUserId: row.id,
        actorRole: 'system',
        action: 'user.provisioned',
        entity: 'user',
        entityId: row.id,
        after: { phoneVerified: id.phone !== null, emailVerified: row.emailVerifiedAt !== null },
      });
      return row;
    });
  } catch (err) {
    identityInUse(err);
  }
}

export interface ProfilePatch {
  name?: string;
  language?: 'en' | 'hi';
}

/**
 * Self-service profile edit. Optimistic concurrency: the client sends the `version` it last saw; a stale
 * version (another tab/device saved first) ⇒ ConflictError, never a silent overwrite.
 */
export async function updateProfile(
  db: Tx,
  args: { userId: string; expectedVersion: number; patch: ProfilePatch },
): Promise<UserRecord> {
  const fields = Object.keys(args.patch);
  if (fields.length === 0) throw new ValidationError('Nothing to update', 'EMPTY_PATCH');
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set(args.patch)
      .where(
        sql`${users.id} = ${args.userId} and ${users.version} = ${args.expectedVersion} and ${users.deletedAt} is null`,
      )
      .returning(userColumns);
    const row = rows[0];
    if (!row)
      throw new ConflictError('Your profile changed elsewhere — reload and try again', 'STALE_PROFILE');
    await tx.insert(auditLog).values({
      actorUserId: args.userId,
      actorRole: 'customer',
      action: 'user.profile_updated',
      entity: 'user',
      entityId: args.userId,
      after: { fields },
    });
    // Field names only: the new name is personal data and never goes into analytics (hard rule 16).
    await recordServerEvent(tx, 'profile_updated', { userId: args.userId, props: { fields } });
    return row;
  });
}

/** Staff deactivates an account (customers:block). Idempotent; audited with the reason. */
export async function deactivateUser(
  db: Tx,
  args: { userId: string; actorUserId: string | null; reason: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set({ status: 'deactivated', deactivatedAt: sql`now()` })
      .where(sql`${users.id} = ${args.userId} and ${users.status} = 'active'`)
      .returning({ id: users.id });
    if (rows.length === 0) return;
    await tx.insert(auditLog).values({
      actorUserId: args.actorUserId,
      actorRole: args.actorUserId === null ? 'system' : 'admin',
      action: 'user.deactivated',
      entity: 'user',
      entityId: args.userId,
      reason: args.reason,
    });
  });
}

/** The account a password sign-in names (spec 01): what the API needs to check the password and pick the flow. */
export interface PasswordAccount {
  userId: string;
  firebaseUid: string;
  phone: string | null;
  email: string | null;
  status: string;
  /** Holds a staff grant: signs in with password **and** a phone code (decision 2026-11-01). */
  staff: boolean;
}

/**
 * Look up the account behind "phone number or email" for `POST /v1/auth/password`. Deleted accounts are never
 * found (their phone and email may belong to someone new). Email matching is case-insensitive (citext).
 */
export async function findPasswordAccount(db: Tx, ident: SignInIdentifier): Promise<PasswordAccount | null> {
  const [u] = await db
    .select({
      userId: users.id,
      firebaseUid: users.firebaseUid,
      phone: users.phone,
      email: users.email,
      status: users.status,
    })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        ident.kind === 'phone' ? eq(users.phone, ident.value) : eq(users.email, ident.value),
      ),
    )
    .limit(1);
  if (!u) return null;
  return { ...u, staff: (await loadGrants(db, u.userId)).some(isStaffGrant) };
}

/**
 * Sign-in audit (spec 01): failures and locks, with the account when one was named — never the phone or email
 * that was typed (DPDP minimisation; the identifier may belong to someone else).
 */
export async function recordSignInAudit(
  db: Tx,
  input: {
    action: 'auth.password_failed' | 'auth.locked';
    userId: string | null;
    ipTruncated: string | null;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: input.userId,
    actorRole: 'anonymous',
    action: input.action,
    entity: 'user',
    entityId: input.userId,
    ipTruncated: input.ipTruncated,
  });
}
