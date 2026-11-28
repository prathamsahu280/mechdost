import { auditLog } from '../schema';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * "Sign out of all devices" (founder 2026-11-28; spec 01 sessions, spec 13): the person ended every session of
 * their own account. Called after the identity provider revoked the refresh tokens. One `audit_log` row (actor =
 * the person, entity = their own user id) and one server event, in one transaction. Ids and codes only.
 */
export async function recordSessionsRevoked(
  db: Tx,
  input: { userId: string; actorRole: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: input.actorRole,
      action: 'auth.sessions_revoked',
      entity: 'user',
      entityId: input.userId,
      after: { scope: 'all_devices' },
    });
    await recordServerEvent(tx, 'account_signed_out_all', { userId: input.userId, props: {} });
  });
}
