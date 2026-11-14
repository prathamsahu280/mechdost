import { desc, eq, sql } from 'drizzle-orm';
import { agreementVersions, auditLog, shopAgreements, shops } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { maybeGoLive } from './price-requests';

/**
 * The MechDost seller agreement (user 2026-11-13; the text comes later, Q77): staff publish versions in English
 * and Hindi; a shop accepts a version once (append-only). Accepting may let a new shop go live.
 */
export async function publishAgreement(
  db: Tx,
  input: { textEn: string; textHi: string; staffUserId: string },
): Promise<{ version: number }> {
  const textEn = input.textEn.trim();
  const textHi = input.textHi.trim();
  if (textEn.length < 20 || textHi.length < 20 || textEn.length > 50_000 || textHi.length > 50_000)
    throw new ValidationError('Give the agreement in English and Hindi', 'AGREEMENT_TEXT');
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table agreement_versions in share row exclusive mode`);
    const [last] = await tx
      .select({ version: agreementVersions.version })
      .from(agreementVersions)
      .orderBy(desc(agreementVersions.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    await tx.insert(agreementVersions).values({ version, textEn, textHi, createdBy: input.staffUserId });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'agreement.published',
      entity: 'agreement',
      entityId: String(version),
    });
    return { version };
  });
}

export async function currentAgreement(
  db: Tx,
): Promise<{ version: number; textEn: string; textHi: string; publishedAt: Date } | null> {
  const [row] = await db
    .select({
      version: agreementVersions.version,
      textEn: agreementVersions.textEn,
      textHi: agreementVersions.textHi,
      publishedAt: agreementVersions.publishedAt,
    })
    .from(agreementVersions)
    .orderBy(desc(agreementVersions.version))
    .limit(1);
  return row ?? null;
}

/** The versions a shop has accepted (newest first). */
export async function shopAgreementStatus(db: Tx, shopId: string): Promise<{ acceptedVersions: number[] }> {
  const rows = await db
    .select({ version: shopAgreements.version })
    .from(shopAgreements)
    .where(eq(shopAgreements.shopId, shopId))
    .orderBy(desc(shopAgreements.version));
  return { acceptedVersions: rows.map((r) => r.version) };
}

export async function acceptAgreement(
  db: Tx,
  input: { shopId: string; userId: string; version: number },
): Promise<{ live: boolean }> {
  return db.transaction(async (tx) => {
    const current = await currentAgreement(tx);
    if (!current) throw new NotFoundError('No agreement has been published yet');
    // Only the current text can be accepted (security review 2026-11-13).
    if (current.version !== input.version)
      throw new ConflictError('A newer agreement has been published; read it again', 'AGREEMENT_OUTDATED');
    const [shop] = await tx.select({ cityId: shops.cityId }).from(shops).where(eq(shops.id, input.shopId));
    if (!shop) throw new NotFoundError('Shop not found');
    const inserted = await tx
      .insert(shopAgreements)
      .values({ shopId: input.shopId, version: input.version, acceptedBy: input.userId })
      .onConflictDoNothing()
      .returning({ id: shopAgreements.id });
    if (inserted.length > 0)
      await recordServerEvent(tx, 'agreement_accepted', {
        userId: input.userId,
        cityId: shop.cityId,
        props: { shopId: input.shopId, version: input.version },
      });
    return { live: await maybeGoLive(tx, input.shopId, input.userId, 'shop') };
  });
}
