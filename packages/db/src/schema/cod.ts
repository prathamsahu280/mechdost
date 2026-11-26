/**
 * Cash-on-delivery requests and approvals (founder ruling 2026-11-26; spec 03 § Cash-on-delivery eligibility). One
 * row per request: the customer asks for one city (the PIN they shop from), staff approve (optional personal cap and
 * end date) or reject with a reason code, and may revoke an approval later. Moves go through `codRequestMachine`
 * (packages/shared/src/state/cod-request.ts) as conditional UPDATEs on (status, version); `cod_request_events` is the
 * append-only history. Written only by `repo/cod-requests.ts`.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  COD_DECISION_REASONS,
  COD_REQUEST_REASONS,
  COD_REQUEST_STATES,
  COD_REVOKE_REASONS,
} from '@mechdost/shared/cod-eligibility';
import { createdAt, id, paise, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

export const codRequests = pgTable(
  'cod_requests',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** The city the approval is for (from the PIN the customer asked from); staff city scope reads it. */
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    pincode: text().notNull(),
    status: text().notNull().default('pending'),
    reasonCode: text().notNull(),
    /** The customer's optional words (user text, shown to staff only). */
    note: text(),
    decidedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: ts(),
    /** Reject reason (code shown to the customer in plain words). */
    decisionReasonCode: text(),
    /** Staff-only note on approve, reject or revoke; never shown to the customer. */
    staffNote: text(),
    /** Personal cap set on approval; the city cap still applies (the lower wins). */
    capPaise: paise(),
    /** The approval ends here (null = until revoked). */
    expiresAt: ts(),
    revokedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: ts(),
    revokeReasonCode: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('cod_requests_status_valid', sql`${t.status} in (${inList(COD_REQUEST_STATES)})`),
    check('cod_requests_reason_valid', sql`${t.reasonCode} in (${inList(COD_REQUEST_REASONS)})`),
    check(
      'cod_requests_decision_reason_valid',
      sql`${t.decisionReasonCode} is null or ${t.decisionReasonCode} in (${inList(COD_DECISION_REASONS)})`,
    ),
    check(
      'cod_requests_revoke_reason_valid',
      sql`${t.revokeReasonCode} is null or ${t.revokeReasonCode} in (${inList(COD_REVOKE_REASONS)})`,
    ),
    check('cod_requests_pincode_format', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('cod_requests_note_length', sql`${t.note} is null or char_length(${t.note}) <= 300`),
    check(
      'cod_requests_staff_note_length',
      sql`${t.staffNote} is null or char_length(${t.staffNote}) <= 500`,
    ),
    check('cod_requests_cap_positive', sql`${t.capPaise} is null or ${t.capPaise} > 0`),
    // A decision is complete: decided rows carry who and when; a rejection carries its reason code.
    check(
      'cod_requests_decided_complete',
      sql`(${t.status} in ('pending','withdrawn')) = (${t.decidedAt} is null) and (${t.decidedAt} is null) = (${t.decidedBy} is null)`,
    ),
    check(
      'cod_requests_reject_reason',
      sql`(${t.status} = 'rejected') = (${t.decisionReasonCode} is not null)`,
    ),
    check(
      'cod_requests_revoke_complete',
      sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null) and (${t.revokedAt} is null) = (${t.revokedBy} is null) and (${t.revokedAt} is null) = (${t.revokeReasonCode} is null)`,
    ),
    check(
      'cod_requests_expires_after_decision',
      sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.decidedAt}`,
    ),
    check('cod_requests_not_self', sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.userId}`),
    // One pending request per customer; one approval per customer and city (hard rule 3).
    uniqueIndex('cod_requests_one_pending_uq')
      .on(t.userId)
      .where(sql`status = 'pending'`),
    uniqueIndex('cod_requests_one_approved_uq')
      .on(t.userId, t.cityId)
      .where(sql`status = 'approved'`),
    index('cod_requests_queue_idx').on(t.status, t.id),
    index().on(t.userId, t.createdAt),
    index().on(t.cityId),
    index().on(t.decidedBy),
    index().on(t.revokedBy),
    index().on(t.createdBy),
  ],
);

/** Append-only history (update/delete blocked by `forbid_update_delete`). Codes only, never free text. */
export const codRequestEvents = pgTable(
  'cod_request_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    requestId: uuid()
      .notNull()
      .references(() => codRequests.id, { onDelete: 'restrict' }),
    fromStatus: text(),
    toStatus: text().notNull(),
    actorType: text().notNull(),
    actorId: uuid(),
    reasonCode: text(),
    payload: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    check('cod_request_events_actor_valid', sql`${t.actorType} in ('customer','admin','system')`),
    check('cod_request_events_status_valid', sql`${t.toStatus} in (${inList(COD_REQUEST_STATES)})`),
    index().on(t.requestId, t.id),
  ],
);
