/**
 * Old "Apply as a mechanic" applications → Ustaad invites (spec 23 § 4a; plan task B1). An application never becomes a
 * membership by itself (the member's own required consent is needed): the mapping writes one `ustaad_application_links`
 * row per mechanic application (phone hash, prefill), and the join accepts `fromApplication` only when the joining
 * user's verified phone matches that row (a code alone proves nothing). The partner application rows are not changed:
 * their status list has no "closed" state, so staff see them as history behind the Partners › Applications notice
 * (decisions 2026-11-26 "workstream B").
 */
import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { partnerApplications, ustaadApplicationLinks, users } from '../../schema';
import { ValidationError } from '../errors';
import type { Tx } from '../orders';

/** sha256 hex of the E.164 phone (the `phone_hash` column format). */
export function ustaadPhoneHash(phone: string): string {
  return createHash('sha256').update(phone.trim()).digest('hex');
}

export interface MappingResult {
  /** Mechanic applications without a link row before this run. */
  candidates: number;
  /** Link rows written (0 on a dry run). */
  written: number;
}

/**
 * `pnpm db:ustaad:map-mechanic-applications [--dry-run]`: one invite link per mechanic application (idempotent: a
 * second run writes nothing). Open applications (`new`, `in_review`) become `invited`; decided ones `closed`.
 */
export async function mapMechanicApplications(tx: Tx, opts: { dryRun: boolean }): Promise<MappingResult> {
  const rows = await tx
    .select({
      id: partnerApplications.id,
      phone: partnerApplications.phone,
      name: partnerApplications.name,
      pincode: partnerApplications.pincode,
      details: partnerApplications.details,
      status: partnerApplications.status,
    })
    .from(partnerApplications)
    .leftJoin(ustaadApplicationLinks, eq(ustaadApplicationLinks.applicationId, partnerApplications.id))
    .where(and(eq(partnerApplications.kind, 'mechanic'), isNull(ustaadApplicationLinks.id)));
  if (opts.dryRun || rows.length === 0) return { candidates: rows.length, written: 0 };
  const inserted = await tx
    .insert(ustaadApplicationLinks)
    .values(
      rows.map((r) => ({
        applicationId: r.id,
        phoneHash: ustaadPhoneHash(r.phone),
        prefill: {
          schema_version: 1,
          name: r.name,
          pincode: r.pincode,
          note: r.details?.slice(0, 500) ?? null,
        },
        status: r.status === 'new' || r.status === 'in_review' ? 'invited' : 'closed',
      })),
    )
    .onConflictDoNothing()
    .returning({ id: ustaadApplicationLinks.id });
  return { candidates: rows.length, written: inserted.length };
}

export interface InviteLink {
  linkId: string;
  applicationId: string;
  version: number;
  prefill: Record<string, unknown>;
}

/**
 * The open invite for an application code, only when it belongs to this user's phone; otherwise
 * `USTAAD_INVITE_INVALID` (same error for unknown, used and foreign codes: no oracle).
 */
export async function ustaadInviteFor(tx: Tx, userId: string, applicationCode: string): Promise<InviteLink> {
  const [u] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
  const invalid = () =>
    new ValidationError('This invite link is not valid for your number', 'USTAAD_INVITE_INVALID');
  if (!u?.phone) throw invalid();
  const [row] = await tx
    .select({
      linkId: ustaadApplicationLinks.id,
      applicationId: ustaadApplicationLinks.applicationId,
      version: ustaadApplicationLinks.version,
      prefill: ustaadApplicationLinks.prefill,
    })
    .from(ustaadApplicationLinks)
    .innerJoin(partnerApplications, eq(partnerApplications.id, ustaadApplicationLinks.applicationId))
    .where(
      and(
        eq(partnerApplications.code, applicationCode),
        eq(ustaadApplicationLinks.status, 'invited'),
        eq(ustaadApplicationLinks.phoneHash, ustaadPhoneHash(u.phone)),
      ),
    )
    .limit(1);
  if (!row) throw invalid();
  return { ...row, prefill: row.prefill as Record<string, unknown> };
}

/** Mark the invite used by this member (conditional on still `invited`). */
export async function markUstaadInviteJoined(tx: Tx, link: InviteLink, memberId: string): Promise<void> {
  const done = await tx
    .update(ustaadApplicationLinks)
    .set({ status: 'joined', memberId })
    .where(
      and(
        eq(ustaadApplicationLinks.id, link.linkId),
        eq(ustaadApplicationLinks.status, 'invited'),
        eq(ustaadApplicationLinks.version, link.version),
      ),
    )
    .returning({ id: ustaadApplicationLinks.id });
  if (done.length === 0)
    throw new ValidationError('This invite link is not valid for your number', 'USTAAD_INVITE_INVALID');
}

/** Count of links per status (admin notice). */
export async function countUstaadApplicationLinks(tx: Tx): Promise<Record<string, number>> {
  const rows = await tx
    .select({ status: ustaadApplicationLinks.status, n: sql<number>`count(*)::int` })
    .from(ustaadApplicationLinks)
    .groupBy(ustaadApplicationLinks.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
