import { eq } from 'drizzle-orm';
import { partnerApplications } from '../schema';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Public application status (design 2026-11-15 item 7). An applicant has no account until approval, so the proof is
 * the reference code plus the phone they applied with, confirmed by a one-time code at the moment of asking (the API
 * checks the Firebase token; this function gets the verified phone). A wrong reference and a right reference with
 * another phone look the same (null), so the lookup cannot be used to find out which references exist. Only the stage
 * and the last-updated time leave: never the reviewer, the note, the reason code, the contact details or the KYC.
 */
export interface ApplicationStatusRow {
  code: string;
  kind: 'seller' | 'garage' | 'mechanic' | 'delivery_agent';
  stage: 'new' | 'in_review' | 'approved' | 'rejected';
  updatedAt: Date;
}

export async function getApplicationStatus(
  db: Tx,
  input: { code: string; verifiedPhone: string },
): Promise<ApplicationStatusRow | null> {
  const [a] = await db
    .select({
      code: partnerApplications.code,
      kind: partnerApplications.kind,
      status: partnerApplications.status,
      phone: partnerApplications.phone,
      updatedAt: partnerApplications.updatedAt,
    })
    .from(partnerApplications)
    .where(eq(partnerApplications.code, input.code))
    .limit(1);
  const found = a?.phone === input.verifiedPhone;
  await recordServerEvent(db, 'partner_status_checked', { props: { found } });
  if (!a || !found) return null;
  return {
    code: a.code,
    kind: a.kind as ApplicationStatusRow['kind'],
    stage: a.status as ApplicationStatusRow['stage'],
    updatedAt: a.updatedAt,
  };
}
