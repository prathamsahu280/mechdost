/**
 * Ustaad preview testers (founder 2026-11-27; spec 23 § 3): named non-staff accounts let into the network while
 * `ustaad.access = staff_preview`. The super admin adds an account by its phone or email; the server looks the account
 * up and answers with the masked phone only (the typed identifier is never stored or audited). Removing keeps the row
 * (`removed_at`) as history. Every change writes one `audit_log` row in the same transaction. A tester holds no role
 * and no permission: the access gate is the only reader.
 */
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { maskPhone } from '@mechdost/shared/contact-mask';
import { parseSignInIdentifier } from '@mechdost/shared/auth';
import {
  USTAAD_TESTERS_MAX,
  type USTAAD_TESTER_ADD_REASONS,
  type USTAAD_TESTER_REMOVE_REASONS,
} from '@mechdost/shared/ustaad/codes';
import { auditLog, users, ustaadPreviewTesters } from '../../schema';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';

type AddReason = (typeof USTAAD_TESTER_ADD_REASONS)[number];
type RemoveReason = (typeof USTAAD_TESTER_REMOVE_REASONS)[number];

export interface PreviewTesterView {
  id: string;
  maskedPhone: string | null;
  reasonCode: AddReason;
  note: string | null;
  addedAt: string;
  version: number;
}

/** User ids on the list now (the access gate caches these with the mode). */
export async function readUstaadPreviewTesterIds(db: Tx): Promise<string[]> {
  const rows = await db
    .select({ userId: ustaadPreviewTesters.userId })
    .from(ustaadPreviewTesters)
    .where(isNull(ustaadPreviewTesters.removedAt))
    .orderBy(asc(ustaadPreviewTesters.createdAt));
  return rows.map((r) => r.userId);
}

/** The active list, oldest first (at most USTAAD_TESTERS_MAX rows). */
export async function listUstaadPreviewTesters(db: Tx): Promise<PreviewTesterView[]> {
  const rows = await db
    .select({
      id: ustaadPreviewTesters.id,
      phone: users.phone,
      reasonCode: ustaadPreviewTesters.reasonCode,
      note: ustaadPreviewTesters.note,
      createdAt: ustaadPreviewTesters.createdAt,
      version: ustaadPreviewTesters.version,
    })
    .from(ustaadPreviewTesters)
    .innerJoin(users, eq(users.id, ustaadPreviewTesters.userId))
    .where(isNull(ustaadPreviewTesters.removedAt))
    .orderBy(asc(ustaadPreviewTesters.createdAt))
    .limit(USTAAD_TESTERS_MAX);
  return rows.map((r) => ({
    id: r.id,
    maskedPhone: maskPhone(r.phone),
    reasonCode: r.reasonCode as AddReason,
    note: r.note,
    addedAt: r.createdAt.toISOString(),
    version: r.version,
  }));
}

export async function addUstaadPreviewTester(
  db: Tx,
  input: { staffUserId: string; identifier: string; reasonCode: AddReason; note?: string },
): Promise<PreviewTesterView> {
  const ident = parseSignInIdentifier(input.identifier);
  if (!ident) throw new ValidationError('Enter a 10-digit mobile number or an email', 'IDENTIFIER_FORMAT');
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          ident.kind === 'phone' ? eq(users.phone, ident.value) : eq(users.email, ident.value),
        ),
      )
      .limit(1);
    if (!user) throw new NotFoundError('No account with that phone number or email');
    const [active] = await tx
      .select({ n: count() })
      .from(ustaadPreviewTesters)
      .where(isNull(ustaadPreviewTesters.removedAt));
    if ((active?.n ?? 0) >= USTAAD_TESTERS_MAX)
      throw new ConflictError(
        `The list holds at most ${String(USTAAD_TESTERS_MAX)} accounts`,
        'TESTERS_FULL',
      );
    const [row] = await tx
      .insert(ustaadPreviewTesters)
      .values({
        userId: user.id,
        reasonCode: input.reasonCode,
        note: input.note ?? null,
        addedBy: input.staffUserId,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError('This account is already a tester', 'TESTER_EXISTS');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'super_admin',
      action: 'ustaad.preview_tester.added',
      entity: 'ustaad_preview_tester',
      entityId: row.id,
      after: { userId: user.id, reasonCode: input.reasonCode },
      reason: input.note ?? null,
    });
    return {
      id: row.id,
      maskedPhone: maskPhone(user.phone),
      reasonCode: input.reasonCode,
      note: row.note,
      addedAt: row.createdAt.toISOString(),
      version: row.version,
    };
  });
}

export async function removeUstaadPreviewTester(
  db: Tx,
  input: {
    staffUserId: string;
    id: string;
    expectedVersion: number;
    reasonCode: RemoveReason;
    note?: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(ustaadPreviewTesters)
      .set({
        removedAt: new Date(),
        removedBy: input.staffUserId,
        removeReasonCode: input.reasonCode,
        removeNote: input.note ?? null,
      })
      .where(
        and(
          eq(ustaadPreviewTesters.id, input.id),
          eq(ustaadPreviewTesters.version, input.expectedVersion),
          isNull(ustaadPreviewTesters.removedAt),
        ),
      )
      .returning({ id: ustaadPreviewTesters.id, userId: ustaadPreviewTesters.userId });
    if (!row) {
      const [exists] = await tx
        .select({ id: ustaadPreviewTesters.id })
        .from(ustaadPreviewTesters)
        .where(and(eq(ustaadPreviewTesters.id, input.id), isNull(ustaadPreviewTesters.removedAt)));
      if (!exists) throw new NotFoundError();
      throw new ConflictError('This tester changed meanwhile', 'STALE_TESTER');
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'super_admin',
      action: 'ustaad.preview_tester.removed',
      entity: 'ustaad_preview_tester',
      entityId: row.id,
      after: { userId: row.userId, reasonCode: input.reasonCode },
      reason: input.note ?? null,
    });
  });
}
