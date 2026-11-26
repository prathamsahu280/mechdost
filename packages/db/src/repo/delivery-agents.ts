import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import {
  AGENT_DOCUMENT_KINDS,
  documentNumberProblem,
  maskDocumentNumber,
  normaliseDocumentNumber,
  ratingAverageX10,
  type AgentDocumentKind,
  type AgentDocumentRejectReason,
  type AgentStatusReason,
  type AgentVehicleType,
} from '@mechdost/shared/delivery/codes';
import { publicCode } from '@mechdost/shared/ids';
import { agentStatusMachine, type AgentStatus } from '@mechdost/shared/state';
import { blindIndex, decryptField, encryptField, type Keyring } from '../crypto';
import {
  cities,
  deliveryAgentDocuments,
  deliveryAgentEvents,
  deliveryAgentInvites,
  deliveryAgents,
  deliveryJobs,
  deliveryRatings,
  mediaObjects,
  orders,
  partnerApplications,
  users,
} from '../schema';
import { lockAgentWork, releaseAgentWork } from './delivery-jobs';
import { agentOfUser, auditDelivery, deliverySettings, type AgentRow } from './delivery-common';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, pgCode } from './errors';
import { recordServerEvent } from './events';
import { queueNotice, queueStaffNotice } from './notices';
import { notificationChannelEnabled } from './notification-admin';
import { enqueueNotification } from './notify';
import { sealPayloadField } from './order-notifications';
import type { Tx } from './orders';
import { insertUserRole } from './rbac';
import type { CityScope } from './routing';
import { num, rowsOf } from './sql-rows';

/**
 * Delivery-agent onboarding and standing (spec 24; Lead's call 10): the public application (name, phone, city,
 * vehicle), staff invites (email + WhatsApp, a one-time token bound to the phone, 72 h), joining after phone sign-in,
 * documents (PAN, licence, RC: numbers encrypted with a blind index, photos in the private media host), staff
 * verification and standing with reason codes and history. Staff reads are scoped by city; an agent only ever reads
 * their own row (404 otherwise).
 */

const DOC_AAD = 'delivery_agent_documents.number_enc';
export const hashAgentInviteToken = (token: string): string =>
  createHash('sha256').update(`delivery_invite:${token}`, 'utf8').digest('hex');

function inScope(scope: CityScope, cityId: string): boolean {
  return scope.all || scope.cityIds.includes(cityId);
}

async function cityByCode(tx: Tx, code: string): Promise<{ id: string; code: string }> {
  const [c] = await tx
    .select({ id: cities.id, code: cities.code })
    .from(cities)
    .where(eq(cities.code, code))
    .limit(1);
  if (!c) throw new ValidationError('Unknown city', 'CITY_UNKNOWN');
  return c;
}

async function agentEvent(
  tx: Tx,
  input: {
    agentId: string;
    kind: (typeof deliveryAgentEvents.$inferInsert)['kind'];
    from?: string | null;
    to?: string | null;
    reasonCode?: string | null;
    note?: string | null;
    documentKind?: AgentDocumentKind | null;
    actor: 'delivery_agent' | 'admin' | 'system';
    actorId?: string | null;
  },
): Promise<void> {
  await tx.insert(deliveryAgentEvents).values({
    agentId: input.agentId,
    kind: input.kind,
    fromStatus: input.from ?? null,
    toStatus: input.to ?? null,
    reasonCode: input.reasonCode ?? null,
    note: input.note ?? null,
    documentKind: input.documentKind ?? null,
    actorType: input.actor,
    actorId: input.actorId ?? null,
  });
}

// ── public application ───────────────────────────────────────────────────────────────────────────────────────────

export async function submitAgentApplication(
  db: Tx,
  input: { name: string; phone: string; cityCode: string; vehicleType: AgentVehicleType },
): Promise<{ code: string; status: string }> {
  return db.transaction(async (tx) => {
    const city = await cityByCode(tx, input.cityCode);
    const code = publicCode('PA', city.code);
    const [row] = await tx
      .insert(partnerApplications)
      .values({
        code,
        kind: 'delivery_agent',
        name: input.name,
        phone: input.phone,
        pincode: null,
        cityId: city.id,
        vehicleType: input.vehicleType,
        source: 'public',
        consentAt: new Date(),
      })
      .returning({ id: partnerApplications.id });
    if (!row) throw new Error('application insert returned no row');
    await auditDelivery(tx, {
      actorUserId: null,
      actorRole: 'system',
      action: 'delivery_agent.applied',
      entity: 'delivery_agent',
      entityId: row.id,
      after: { code, vehicleType: input.vehicleType },
    });
    await recordServerEvent(tx, 'delivery_agent_applied', {
      cityId: city.id,
      props: { applicationCode: code, vehicleType: input.vehicleType },
    });
    await queueStaffNotice(tx, {
      kind: 'staff.delivery_agent_application',
      cityId: city.id,
      entityId: row.id,
      version: 1,
    });
    return { code, status: 'new' };
  });
}

// ── invites ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type AgentInviteSource =
  | { applicationCode: string }
  | {
      name: string;
      phone: string;
      email?: string | undefined;
      cityCode: string;
      vehicleType: AgentVehicleType;
    };

/**
 * Staff invite a person to become an agent (from their application, or someone who never applied). The token is
 * returned once to staff and sealed in the outbox for the email and the WhatsApp button; only its hash is stored.
 * Bound to the phone: joining needs the same OTP-proven number (so a forwarded link is useless).
 */
export async function createAgentInvite(
  db: Tx,
  input: { scope: CityScope; staffUserId: string; keyring: Keyring; from: AgentInviteSource },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  return db.transaction(async (tx) => {
    let name: string;
    let phone: string;
    let email: string | null = null;
    let cityId: string;
    let vehicleType: AgentVehicleType;
    let applicationId: string | null = null;
    if ('applicationCode' in input.from) {
      const [app] = await tx
        .select()
        .from(partnerApplications)
        .where(
          and(
            eq(partnerApplications.code, input.from.applicationCode),
            eq(partnerApplications.kind, 'delivery_agent'),
          ),
        )
        .for('update');
      if (!app?.cityId || !app.vehicleType || !inScope(input.scope, app.cityId))
        throw new NotFoundError('Application not found');
      if (app.status !== 'new' && app.status !== 'in_review')
        throw new ConflictError('This application was already decided', 'APPLICATION_DECIDED');
      const updated = await tx
        .update(partnerApplications)
        .set({ status: 'approved', reviewedBy: input.staffUserId })
        .where(and(eq(partnerApplications.id, app.id), eq(partnerApplications.version, app.version)))
        .returning({ id: partnerApplications.id });
      if (updated.length === 0) throw new ConflictError('The application changed meanwhile', 'STALE');
      ({ name, phone } = app);
      email = app.email ?? null;
      cityId = app.cityId;
      vehicleType = app.vehicleType as AgentVehicleType;
      applicationId = app.id;
    } else {
      const city = await cityByCode(tx, input.from.cityCode);
      if (!inScope(input.scope, city.id)) throw new NotFoundError('City not found');
      ({ name, phone, vehicleType } = input.from);
      email = input.from.email ?? null;
      cityId = city.id;
    }
    const [already] = await tx
      .select({ id: deliveryAgents.id })
      .from(deliveryAgents)
      .where(eq(deliveryAgents.phone, phone))
      .limit(1);
    if (already) throw new ConflictError('This number is already a delivery agent', 'ALREADY_AGENT');
    // Stale invites for this phone stop blocking a new one (no separate sweep needed for that).
    await tx
      .update(deliveryAgentInvites)
      .set({ status: 'expired' })
      .where(
        and(
          eq(deliveryAgentInvites.phone, phone),
          eq(deliveryAgentInvites.status, 'sent'),
          lte(deliveryAgentInvites.expiresAt, sql`now()`),
        ),
      );
    const settings = await deliverySettings(tx, cityId);
    const expiresAt = new Date(Date.now() + settings.inviteHours * 3_600_000);
    let row: { id: string } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(deliveryAgentInvites)
          .values({
            tokenHash: hashAgentInviteToken(token),
            name,
            phone,
            email,
            cityId,
            vehicleType,
            applicationId,
            createdBy: input.staffUserId,
            expiresAt,
          })
          .returning({ id: deliveryAgentInvites.id }),
      );
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new ConflictError('This mobile number already has an open invite', 'INVITE_OPEN');
      throw err;
    }
    if (!row) throw new Error('invite insert returned no row');
    const sealed = sealPayloadField(token, input.keyring, 'token');
    const hours = settings.inviteHours;
    if (email)
      await enqueueNotification(tx, {
        dedupeKey: `delivery_agent_invite:${row.id}:email`,
        channel: 'email',
        recipient: email,
        templateKey: 'delivery_agent_invite',
        payload: { name, hours, ...sealed },
      });
    // Same gate as every WhatsApp event (spec 10): only while staff switched the channel on for it.
    if (await notificationChannelEnabled(tx, 'delivery.agent_invite', 'whatsapp'))
      await enqueueNotification(tx, {
        dedupeKey: `delivery_agent_invite:${row.id}:whatsapp`,
        channel: 'whatsapp',
        recipient: phone,
        templateKey: 'delivery.agent_invite',
        // Never the token on WhatsApp (lock screens, backups): the join page finds the invite by the signed-in phone.
        payload: { name, hours },
      });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_agent.invited',
      entity: 'delivery_invite',
      entityId: row.id,
      after: { applicationId, vehicleType, withEmail: email !== null, expiresAt: expiresAt.toISOString() },
    });
    await recordServerEvent(tx, 'delivery_agent_invited', {
      userId: input.staffUserId,
      cityId,
      props: {
        inviteId: row.id,
        vehicleType,
        fromApplication: applicationId !== null,
        withEmail: email !== null,
      },
    });
    return { id: row.id, token, expiresAt };
  });
}

async function openInviteByToken(tx: Tx, token: string, lock: boolean) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundError('Invite not found');
  const q = tx
    .select({
      id: deliveryAgentInvites.id,
      name: deliveryAgentInvites.name,
      phone: deliveryAgentInvites.phone,
      cityId: deliveryAgentInvites.cityId,
      cityCode: cities.code,
      vehicleType: deliveryAgentInvites.vehicleType,
      applicationId: deliveryAgentInvites.applicationId,
      status: deliveryAgentInvites.status,
      expiresAt: deliveryAgentInvites.expiresAt,
      live: sql<boolean>`${deliveryAgentInvites.expiresAt} > now()`,
    })
    .from(deliveryAgentInvites)
    .innerJoin(cities, eq(cities.id, deliveryAgentInvites.cityId))
    .where(eq(deliveryAgentInvites.tokenHash, hashAgentInviteToken(token)));
  const [inv] = lock ? await q.for('update', { of: deliveryAgentInvites }) : await q.limit(1);
  if (!inv) throw new NotFoundError('Invite not found');
  if (inv.status === 'used') throw new ConflictError('This invite has already been used', 'INVITE_USED');
  if (inv.status === 'revoked') throw new ConflictError('This invite was withdrawn', 'INVITE_REVOKED');
  if (inv.status === 'expired' || !inv.live)
    throw new ConflictError('This invite has expired', 'INVITE_EXPIRED');
  return inv;
}

/** The open, unexpired invite of a phone (locked); 404 when there is none. */
async function openInviteByPhone(tx: Tx, phone: string | null) {
  if (!phone) throw new NotFoundError('Invite not found');
  const [row] = await tx
    .select({ hash: deliveryAgentInvites.tokenHash })
    .from(deliveryAgentInvites)
    .where(
      and(
        eq(deliveryAgentInvites.phone, phone),
        eq(deliveryAgentInvites.status, 'sent'),
        sql`${deliveryAgentInvites.expiresAt} > now()`,
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Invite not found');
  const [inv] = await tx
    .select({
      id: deliveryAgentInvites.id,
      name: deliveryAgentInvites.name,
      phone: deliveryAgentInvites.phone,
      cityId: deliveryAgentInvites.cityId,
      vehicleType: deliveryAgentInvites.vehicleType,
      applicationId: deliveryAgentInvites.applicationId,
    })
    .from(deliveryAgentInvites)
    .where(eq(deliveryAgentInvites.tokenHash, row.hash))
    .for('update');
  if (!inv) throw new NotFoundError('Invite not found');
  return inv;
}

/** What the invite page shows before sign-in (the phone only by its last four digits). */
export async function previewAgentInvite(db: Tx, token: string) {
  const inv = await openInviteByToken(db, token, false);
  return {
    name: inv.name,
    cityCode: inv.cityCode,
    phoneLast4: inv.phone.slice(-4),
    vehicleType: inv.vehicleType as AgentVehicleType,
    expiresAt: inv.expiresAt.toISOString(),
  };
}

/**
 * The invited person joins after phone sign-in: the OTP-proven phone of the account must be the invite's phone
 * (403 `INVITE_PHONE_MISMATCH` otherwise). Single use (conditional UPDATE), grants the `delivery_agent` role and
 * creates the agent in `onboarding` (documents next).
 */
export async function acceptAgentInvite(
  db: Tx,
  input: { userId: string; token?: string | undefined },
): Promise<{ agentId: string; status: AgentStatus }> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ phone: users.phone, verified: users.phoneVerifiedAt })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    // From the WhatsApp message there is no token: the open invite of this OTP-proven phone (bound to it anyway).
    const inv = input.token
      ? await openInviteByToken(tx, input.token, true)
      : await openInviteByPhone(tx, user?.verified ? (user.phone ?? null) : null);
    if (!user?.phone || !user.verified || user.phone !== inv.phone)
      throw new ForbiddenError('This invite is for a different phone number', 'INVITE_PHONE_MISMATCH');
    const [existing] = await tx
      .select({ id: deliveryAgents.id })
      .from(deliveryAgents)
      .where(eq(deliveryAgents.userId, input.userId))
      .limit(1);
    if (existing) throw new ConflictError('This account is already a delivery agent', 'ALREADY_AGENT');
    const used = await tx
      .update(deliveryAgentInvites)
      .set({ status: 'used', usedAt: sql`now()`, usedBy: input.userId })
      .where(and(eq(deliveryAgentInvites.id, inv.id), eq(deliveryAgentInvites.status, 'sent')))
      .returning({ id: deliveryAgentInvites.id });
    if (used.length === 0) throw new ConflictError('This invite has already been used', 'INVITE_USED');
    const [agent] = await tx
      .insert(deliveryAgents)
      .values({
        userId: input.userId,
        cityId: inv.cityId,
        name: inv.name,
        phone: inv.phone,
        vehicleType: inv.vehicleType,
        inviteId: inv.id,
        applicationId: inv.applicationId,
      })
      .returning({ id: deliveryAgents.id });
    if (!agent) throw new Error('agent insert returned no row');
    await insertUserRole(tx, { userId: input.userId, role: 'delivery_agent', grantedBy: null });
    await agentEvent(tx, {
      agentId: agent.id,
      kind: 'joined',
      to: 'onboarding',
      actor: 'delivery_agent',
      actorId: input.userId,
    });
    await auditDelivery(tx, {
      actorUserId: input.userId,
      actorRole: 'delivery_agent',
      action: 'delivery_agent.joined',
      entity: 'delivery_agent',
      entityId: agent.id,
      after: { inviteId: inv.id },
    });
    await recordServerEvent(tx, 'delivery_agent_joined', {
      userId: input.userId,
      cityId: inv.cityId,
      props: { agentId: agent.id, inviteId: inv.id },
    });
    return { agentId: agent.id, status: 'onboarding' };
  });
}

export async function listAgentInvites(
  db: Tx,
  input: { scope: CityScope; cursor: { createdAt: string; id: string } | null; limit: number },
) {
  const where = [
    input.scope.all
      ? undefined
      : inArray(
          deliveryAgentInvites.cityId,
          input.scope.cityIds.length ? input.scope.cityIds : ['00000000-0000-0000-0000-000000000000'],
        ),
    input.cursor
      ? or(
          lt(deliveryAgentInvites.createdAt, new Date(input.cursor.createdAt)),
          and(
            eq(deliveryAgentInvites.createdAt, new Date(input.cursor.createdAt)),
            lt(deliveryAgentInvites.id, input.cursor.id),
          ),
        )
      : undefined,
  ];
  const rows = await db
    .select({
      id: deliveryAgentInvites.id,
      name: deliveryAgentInvites.name,
      phone: deliveryAgentInvites.phone,
      email: deliveryAgentInvites.email,
      cityCode: cities.code,
      vehicleType: deliveryAgentInvites.vehicleType,
      status: deliveryAgentInvites.status,
      expiresAt: deliveryAgentInvites.expiresAt,
      createdAt: deliveryAgentInvites.createdAt,
    })
    .from(deliveryAgentInvites)
    .innerJoin(cities, eq(cities.id, deliveryAgentInvites.cityId))
    .where(and(...where))
    .orderBy(desc(deliveryAgentInvites.createdAt), desc(deliveryAgentInvites.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit).map((r) => ({
    id: r.id,
    name: r.name,
    phoneLast4: r.phone.slice(-4),
    hasEmail: r.email !== null,
    cityCode: r.cityCode,
    vehicleType: r.vehicleType as AgentVehicleType,
    status: r.status,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
  return { items, more: rows.length > input.limit };
}

export async function revokeAgentInvite(
  db: Tx,
  input: { scope: CityScope; staffUserId: string; inviteId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .select({ id: deliveryAgentInvites.id, cityId: deliveryAgentInvites.cityId })
      .from(deliveryAgentInvites)
      .where(eq(deliveryAgentInvites.id, input.inviteId))
      .limit(1);
    if (!inv || !inScope(input.scope, inv.cityId)) throw new NotFoundError('Invite not found');
    const done = await tx
      .update(deliveryAgentInvites)
      .set({ status: 'revoked' })
      .where(and(eq(deliveryAgentInvites.id, inv.id), eq(deliveryAgentInvites.status, 'sent')))
      .returning({ id: deliveryAgentInvites.id });
    if (done.length === 0) throw new ConflictError('Only an open invite can be withdrawn', 'INVITE_NOT_OPEN');
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_agent.invite_revoked',
      entity: 'delivery_invite',
      entityId: inv.id,
    });
  });
}

// ── the agent's own profile ──────────────────────────────────────────────────────────────────────────────────────

async function documentsOf(tx: Tx, agentId: string) {
  const rows = await tx
    .select({
      kind: deliveryAgentDocuments.kind,
      status: deliveryAgentDocuments.status,
      last4: deliveryAgentDocuments.numberLast4,
      rejectReason: deliveryAgentDocuments.rejectReason,
      submittedAt: deliveryAgentDocuments.updatedAt,
    })
    .from(deliveryAgentDocuments)
    .where(eq(deliveryAgentDocuments.agentId, agentId));
  return rows.map((d) => ({
    kind: d.kind as AgentDocumentKind,
    status: d.status as 'submitted' | 'verified' | 'rejected',
    numberMasked: maskDocumentNumber(`000000${d.last4}`).slice(-10),
    rejectReason: (d.rejectReason as AgentDocumentRejectReason | null) ?? null,
    submittedAt: d.submittedAt.toISOString(),
  }));
}

export async function getAgentProfile(db: Tx, userId: string) {
  const a = await agentOfUser(db, userId);
  const [row] = await db
    .select({
      cityCode: cities.code,
      statusReason: deliveryAgents.statusReason,
      ratingSum: deliveryAgents.ratingSum,
      ratingCount: deliveryAgents.ratingCount,
    })
    .from(deliveryAgents)
    .innerJoin(cities, eq(cities.id, deliveryAgents.cityId))
    .where(eq(deliveryAgents.id, a.id))
    .limit(1);
  const documents = await documentsOf(db, a.id);
  const settings = await deliverySettings(db, a.cityId);
  const have = new Set(documents.filter((d) => d.status !== 'rejected').map((d) => d.kind));
  return {
    id: a.id,
    firstName: a.name.split(/\s+/)[0] ?? a.name,
    cityCode: row?.cityCode ?? '',
    vehicleType: a.vehicleType,
    status: a.status as AgentStatus,
    statusReason: (row?.statusReason as AgentStatusReason | null) ?? null,
    online: a.online,
    canReceiveOffers: settings.agentsEnabled && a.status === 'active' && a.online,
    documents,
    missingDocuments: AGENT_DOCUMENT_KINDS.filter((k) => !have.has(k)),
    ratingAvgX10: ratingAverageX10(row?.ratingSum ?? 0, row?.ratingCount ?? 0),
    ratingCount: row?.ratingCount ?? 0,
    version: a.version,
  };
}

/** Online / offline (active agents only); going offline never touches jobs already accepted. */
export async function setAgentOnline(
  db: Tx,
  input: { userId: string; online: boolean; expectedVersion: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    const a = await agentOfUser(tx, input.userId, { lock: true });
    if (input.online && a.status !== 'active')
      throw new ForbiddenError('Your account is not active for deliveries yet', 'AGENT_NOT_ACTIVE');
    if (a.online === input.online) return;
    const done = await tx
      .update(deliveryAgents)
      .set({
        online: input.online,
        lastOnlineAt: input.online ? sql`now()` : sql`${deliveryAgents.lastOnlineAt}`,
      })
      .where(and(eq(deliveryAgents.id, a.id), eq(deliveryAgents.version, input.expectedVersion)))
      .returning({ id: deliveryAgents.id });
    if (done.length === 0) throw new ConflictError('Your profile changed meanwhile', 'STALE');
    await agentEvent(tx, {
      agentId: a.id,
      kind: input.online ? 'online' : 'offline',
      actor: 'delivery_agent',
      actorId: input.userId,
    });
    await recordServerEvent(tx, 'delivery_agent_online', {
      userId: input.userId,
      cityId: a.cityId,
      props: { agentId: a.id, online: input.online },
    });
  });
}

/**
 * The agent uploads (or replaces) one document: the number is normalised, refused if it looks like Aadhaar, encrypted
 * with a blind index (one agent per number), and tied to a photo the agent uploaded as `agent_document`.
 */
export async function submitAgentDocument(
  db: Tx,
  input: { userId: string; keyring: Keyring; kind: AgentDocumentKind; number: string; mediaId: string },
): Promise<void> {
  const problem = documentNumberProblem(input.kind, input.number);
  if (problem)
    throw new ValidationError(
      'Check the document number',
      problem === 'aadhaar' ? 'DOCUMENT_AADHAAR' : 'DOCUMENT_FORMAT',
    );
  const number = normaliseDocumentNumber(input.kind, input.number);
  await db.transaction(async (tx) => {
    const me = await agentOfUser(tx, input.userId);
    const work = await lockAgentWork(tx, me.id);
    const a = await agentOfUser(tx, input.userId, { lock: true });
    if (a.status === 'offboarded' || a.status === 'suspended')
      throw new ForbiddenError('Documents cannot be changed now', 'AGENT_NOT_ACTIVE');
    const [media] = await tx
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.id, input.mediaId),
          eq(mediaObjects.ownerKind, 'agent_document'),
          eq(mediaObjects.ownerId, a.id),
          sql`${mediaObjects.deletedAt} is null`,
        ),
      )
      .limit(1);
    if (!media) throw new NotFoundError('Photo not found');
    const index = blindIndex(number, input.keyring, `agent_document:${input.kind}`);
    const [dup] = await tx
      .select({ agentId: deliveryAgentDocuments.agentId })
      .from(deliveryAgentDocuments)
      .where(and(eq(deliveryAgentDocuments.kind, input.kind), eq(deliveryAgentDocuments.numberIndex, index)))
      .limit(1);
    if (dup && dup.agentId !== a.id)
      throw new ConflictError('This document is already used by another agent', 'DOCUMENT_IN_USE');
    const values = {
      numberEnc: encryptField(number, input.keyring, DOC_AAD),
      numberIndex: index,
      numberLast4: number.slice(-4),
      mediaId: media.id,
      status: 'submitted',
      rejectReason: null,
      reviewedBy: null,
      reviewedAt: null,
    };
    const [prev] = await tx
      .select({ id: deliveryAgentDocuments.id })
      .from(deliveryAgentDocuments)
      .where(and(eq(deliveryAgentDocuments.agentId, a.id), eq(deliveryAgentDocuments.kind, input.kind)))
      .for('update');
    if (prev) {
      await tx.update(deliveryAgentDocuments).set(values).where(eq(deliveryAgentDocuments.id, prev.id));
      // A replaced document must be verified again before any new work (security review 2026-11-26): offline, and
      // open offers withdrawn in the same transaction. Jobs already accepted stay with the agent.
      if (a.online) await tx.update(deliveryAgents).set({ online: false }).where(eq(deliveryAgents.id, a.id));
      await releaseAgentWork(tx, {
        agentId: a.id,
        jobs: work,
        mode: 'offers',
        actor: 'system',
        actorId: input.userId,
      });
    } else await tx.insert(deliveryAgentDocuments).values({ agentId: a.id, kind: input.kind, ...values });
    await agentEvent(tx, {
      agentId: a.id,
      kind: 'document_submitted',
      documentKind: input.kind,
      actor: 'delivery_agent',
      actorId: input.userId,
    });
    await recordServerEvent(tx, 'delivery_agent_document_submitted', {
      userId: input.userId,
      cityId: a.cityId,
      props: { agentId: a.id, kind: input.kind, resubmitted: prev !== undefined },
    });
    await queueStaffNotice(tx, {
      kind: 'staff.delivery_documents',
      cityId: a.cityId,
      entityId: a.id,
      version: `${input.kind}:${Date.now()}`,
    });
  });
}

// ── staff ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function scopedAgent(tx: Tx, scope: CityScope, agentId: string, lock = false) {
  const q = tx.select().from(deliveryAgents).where(eq(deliveryAgents.id, agentId));
  const [a] = lock ? await q.for('update') : await q.limit(1);
  if (!a || !inScope(scope, a.cityId)) throw new NotFoundError('Delivery agent not found');
  return a;
}

const maskPhone = (p: string) => `${p.slice(0, 3)}•••••${p.slice(-4)}`;

const ACTIVE_JOB_SQL = sql.raw(`('accepted','picked_up','failed','returning')`);

export async function listAgents(
  db: Tx,
  input: {
    scope: CityScope;
    status?: AgentStatus | undefined;
    cursor: { createdAt: string; id: string } | null;
    limit: number;
  },
) {
  const scopeSql = input.scope.all
    ? sql`true`
    : input.scope.cityIds.length === 0
      ? sql`false`
      : sql`a.city_id in (${sql.join(
          input.scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = rowsOf<{
    id: string;
    name: string;
    phone: string;
    city_code: string;
    vehicle_type: string;
    status: string;
    status_reason: string | null;
    online: boolean;
    active_jobs: unknown;
    docs_verified: unknown;
    rating_sum: unknown;
    rating_count: unknown;
    created_at: Date | string;
    version: number;
  }>(
    await db.execute(sql`
      select a.id, a.name, a.phone, c.code as city_code, a.vehicle_type, a.status, a.status_reason, a.online,
        (select count(*) from delivery_jobs j where j.agent_id = a.id and j.status in ${ACTIVE_JOB_SQL}) as active_jobs,
        (select count(*) from delivery_agent_documents d where d.agent_id = a.id and d.status = 'verified') as docs_verified,
        a.rating_sum, a.rating_count, a.created_at, a.version
      from delivery_agents a join cities c on c.id = a.city_id
      where ${scopeSql}
        ${input.status ? sql`and a.status = ${input.status}` : sql``}
        ${input.cursor ? sql`and (a.created_at, a.id) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)` : sql``}
      order by a.created_at desc, a.id desc
      limit ${input.limit + 1}`),
  );
  const items = rows.slice(0, input.limit).map((r) => ({
    id: r.id,
    name: r.name,
    phoneMasked: maskPhone(r.phone),
    cityCode: r.city_code,
    vehicleType: r.vehicle_type as AgentVehicleType,
    status: r.status as AgentStatus,
    statusReason: (r.status_reason as AgentStatusReason | null) ?? null,
    online: r.online,
    activeJobs: num(r.active_jobs),
    documentsVerified: num(r.docs_verified),
    ratingAvgX10: ratingAverageX10(num(r.rating_sum), num(r.rating_count)),
    ratingCount: num(r.rating_count),
    createdAt: new Date(r.created_at),
    version: r.version,
  }));
  return { items, more: rows.length > input.limit };
}

export async function getAgentAdmin(db: Tx, input: { scope: CityScope; agentId: string }) {
  const a = await scopedAgent(db, input.scope, input.agentId);
  const page = await listAgents(db, {
    scope: { all: false, cityIds: [a.cityId] },
    cursor: null,
    limit: 1_000,
  });
  const row = page.items.find((i) => i.id === a.id);
  if (!row) throw new NotFoundError('Delivery agent not found');
  const history = await db
    .select()
    .from(deliveryAgentEvents)
    .where(and(eq(deliveryAgentEvents.agentId, a.id), eq(deliveryAgentEvents.kind, 'status')))
    .orderBy(desc(deliveryAgentEvents.id))
    .limit(50);
  const ratings = await db
    .select({
      orderCode: orders.code,
      stars: deliveryRatings.stars,
      reasons: deliveryRatings.reasons,
      note: deliveryRatings.note,
      at: deliveryRatings.updatedAt,
    })
    .from(deliveryRatings)
    .innerJoin(orders, eq(orders.id, deliveryRatings.orderId))
    .where(eq(deliveryRatings.agentId, a.id))
    .orderBy(desc(deliveryRatings.createdAt))
    .limit(20);
  const [k] = rowsOf<{ offers: unknown; accepted: unknown; delivered: unknown; failed: unknown }>(
    await db.execute(sql`
      select
        (select count(*) from delivery_job_offers o where o.agent_id = ${a.id}::uuid and o.offered_at > now() - interval '30 days') as offers,
        (select count(*) from delivery_job_offers o where o.agent_id = ${a.id}::uuid and o.offered_at > now() - interval '30 days' and o.status in ('accepted','given_up')) as accepted,
        (select count(*) from delivery_jobs j where j.agent_id = ${a.id}::uuid and j.status = 'delivered' and j.delivered_at > now() - interval '30 days') as delivered,
        (select count(*) from delivery_job_events e where e.agent_id = ${a.id}::uuid and e.to_status = 'failed' and e.created_at > now() - interval '30 days') as failed`),
  );
  return {
    ...row,
    documents: await documentsOf(db, a.id),
    history: history.map((h) => ({
      at: h.createdAt.toISOString(),
      fromStatus: (h.fromStatus as AgentStatus | null) ?? null,
      toStatus: (h.toStatus ?? a.status) as AgentStatus,
      reasonCode: (h.reasonCode as AgentStatusReason | null) ?? null,
      note: h.note,
    })),
    ratings: ratings.map((r) => ({ ...r, at: r.at.toISOString() })),
    kpis: {
      offers30d: num(k?.offers),
      accepted30d: num(k?.accepted),
      delivered30d: num(k?.delivered),
      failed30d: num(k?.failed),
    },
  };
}

/**
 * Staff change an agent's standing (machine + CAS, reason code required except for `active`). Activating from
 * onboarding needs all three documents verified. Pausing, suspending or offboarding takes the agent offline and
 * withdraws their open offers (accepted jobs stay for staff to take back).
 */
export async function setAgentStatus(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    agentId: string;
    to: AgentStatus;
    reasonCode?: AgentStatusReason | undefined;
    note?: string | undefined;
    pausedUntil?: Date | undefined;
    expectedVersion: number;
  },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    // Order rows and jobs of this agent first, then the agent row (lock order, spec 14).
    const probe = await scopedAgent(tx, input.scope, input.agentId);
    const work = input.to === 'active' ? [] : await lockAgentWork(tx, probe.id);
    const a = await scopedAgent(tx, input.scope, input.agentId, true);
    const from = a.status as AgentStatus;
    agentStatusMachine.assert(from, input.to, 'admin');
    if (input.to !== 'active' && !input.reasonCode)
      throw new ValidationError('Pick a reason', 'REASON_REQUIRED');
    let verifiedAt = a.verifiedAt;
    if (input.to === 'active' && !verifiedAt) {
      const docs = await tx
        .select({ kind: deliveryAgentDocuments.kind })
        .from(deliveryAgentDocuments)
        .where(and(eq(deliveryAgentDocuments.agentId, a.id), eq(deliveryAgentDocuments.status, 'verified')));
      if (docs.length < AGENT_DOCUMENT_KINDS.length)
        throw new ConflictError('All three documents must be verified first', 'DOCUMENTS_NOT_VERIFIED');
      verifiedAt = new Date();
    }
    const leaving = input.to !== 'active';
    const [row] = await tx
      .update(deliveryAgents)
      .set({
        status: input.to,
        statusReason: input.to === 'active' ? null : (input.reasonCode ?? null),
        statusNote: input.note ?? null,
        statusChangedBy: input.staffUserId,
        statusChangedAt: sql`now()`,
        pausedUntil: input.to === 'paused' ? (input.pausedUntil ?? null) : null,
        online: leaving ? false : a.online,
        verifiedAt,
        verifiedBy: a.verifiedBy ?? (input.to === 'active' ? input.staffUserId : null),
        offboardedAt: input.to === 'offboarded' ? sql`now()` : a.offboardedAt,
      })
      .where(and(eq(deliveryAgents.id, a.id), eq(deliveryAgents.version, input.expectedVersion)))
      .returning({ version: deliveryAgents.version });
    if (!row) throw new ConflictError('The agent changed meanwhile', 'STALE');
    if (leaving) {
      // Every held job is flagged for staff; accepted jobs go back to the queue; a paused agent may finish parcels
      // already picked up, a suspended or offboarded one may not (lead rulings 2026-11-26).
      await releaseAgentWork(tx, {
        agentId: a.id,
        jobs: work,
        mode: input.to === 'paused' ? 'pause' : 'stop',
        actor: 'admin',
        actorId: input.staffUserId,
      });
    }
    if (input.to === 'offboarded')
      await tx.execute(sql`delete from user_roles ur using roles r
        where r.id = ur.role_id and r.key = 'delivery_agent' and ur.user_id = ${a.userId}::uuid`);
    await agentEvent(tx, {
      agentId: a.id,
      kind: 'status',
      from,
      to: input.to,
      reasonCode: input.reasonCode ?? null,
      note: input.note ?? null,
      actor: 'admin',
      actorId: input.staffUserId,
    });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: `delivery_agent.${input.to}`,
      entity: 'delivery_agent',
      entityId: a.id,
      after: { from, to: input.to, reasonCode: input.reasonCode ?? null },
      reason: input.note ?? null,
    });
    await recordServerEvent(tx, 'delivery_agent_status_changed', {
      userId: input.staffUserId,
      cityId: a.cityId,
      props: { agentId: a.id, from, to: input.to, reasonCode: input.reasonCode ?? null },
    });
    await queueNotice(tx, {
      kind: 'delivery.status_changed',
      userId: a.userId,
      entityId: a.id,
      version: row.version,
      params: {},
    });
    return { version: row.version };
  });
}

/** Staff correct the vehicle (the agent cannot change it themselves; it decides which loads they get). */
export async function editAgentVehicle(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    agentId: string;
    vehicleType: AgentVehicleType;
    expectedVersion: number;
  },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const a = await scopedAgent(tx, input.scope, input.agentId, true);
    const [row] = await tx
      .update(deliveryAgents)
      .set({ vehicleType: input.vehicleType })
      .where(and(eq(deliveryAgents.id, a.id), eq(deliveryAgents.version, input.expectedVersion)))
      .returning({ version: deliveryAgents.version });
    if (!row) throw new ConflictError('The agent changed meanwhile', 'STALE');
    await agentEvent(tx, {
      agentId: a.id,
      kind: 'vehicle',
      note: `${a.vehicleType}>${input.vehicleType}`,
      actor: 'admin',
      actorId: input.staffUserId,
    });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_agent.vehicle',
      entity: 'delivery_agent',
      entityId: a.id,
      after: { from: a.vehicleType, to: input.vehicleType },
    });
    return { version: row.version };
  });
}

export async function decideAgentDocument(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    agentId: string;
    kind: AgentDocumentKind;
    decision: 'verified' | 'rejected';
    reasonCode?: AgentDocumentRejectReason | undefined;
  },
): Promise<void> {
  if (input.decision === 'rejected' && !input.reasonCode)
    throw new ValidationError('Pick a reason', 'REASON_REQUIRED');
  await db.transaction(async (tx) => {
    const a = await scopedAgent(tx, input.scope, input.agentId, true);
    const done = await tx
      .update(deliveryAgentDocuments)
      .set({
        status: input.decision,
        rejectReason: input.decision === 'rejected' ? (input.reasonCode ?? null) : null,
        reviewedBy: input.staffUserId,
        reviewedAt: sql`now()`,
      })
      .where(
        and(
          eq(deliveryAgentDocuments.agentId, a.id),
          eq(deliveryAgentDocuments.kind, input.kind),
          eq(deliveryAgentDocuments.status, 'submitted'),
        ),
      )
      .returning({ id: deliveryAgentDocuments.id, version: deliveryAgentDocuments.version });
    if (done.length === 0)
      throw new ConflictError('Only a document waiting for review can be decided', 'DOCUMENT_NOT_PENDING');
    await agentEvent(tx, {
      agentId: a.id,
      kind: input.decision === 'verified' ? 'document_verified' : 'document_rejected',
      documentKind: input.kind,
      reasonCode: input.reasonCode ?? null,
      actor: 'admin',
      actorId: input.staffUserId,
    });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: `delivery_agent.document_${input.decision}`,
      entity: 'delivery_agent',
      entityId: a.id,
      after: { kind: input.kind, reasonCode: input.reasonCode ?? null },
    });
    await recordServerEvent(tx, 'delivery_agent_document_decided', {
      userId: input.staffUserId,
      cityId: a.cityId,
      props: {
        agentId: a.id,
        kind: input.kind,
        decision: input.decision,
        reasonCode: input.reasonCode ?? null,
      },
    });
    await queueNotice(tx, {
      kind: 'delivery.document_decided',
      userId: a.userId,
      entityId: done[0]?.id ?? a.id,
      version: done[0]?.version ?? 0,
      params: {},
    });
  });
}

/** Staff open one document (full number + photo id); every view is audited and on the agent's history. */
export async function viewAgentDocument(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    agentId: string;
    kind: AgentDocumentKind;
    keyring: Keyring;
  },
): Promise<{ number: string; mediaId: string; status: string }> {
  return db.transaction(async (tx) => {
    const a = await scopedAgent(tx, input.scope, input.agentId);
    const [d] = await tx
      .select()
      .from(deliveryAgentDocuments)
      .where(and(eq(deliveryAgentDocuments.agentId, a.id), eq(deliveryAgentDocuments.kind, input.kind)))
      .limit(1);
    if (!d) throw new NotFoundError('Document not found');
    await agentEvent(tx, {
      agentId: a.id,
      kind: 'document_viewed',
      documentKind: input.kind,
      actor: 'admin',
      actorId: input.staffUserId,
    });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_agent.document_viewed',
      entity: 'delivery_agent',
      entityId: a.id,
      after: { kind: input.kind },
    });
    return {
      number: decryptField(d.numberEnc, input.keyring, DOC_AAD),
      mediaId: d.mediaId,
      status: d.status,
    };
  });
}

/** The worker: paused agents whose end date passed become active again. */
export async function resumePausedAgents(db: Tx): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(deliveryAgents)
      .set({
        status: 'active',
        statusReason: null,
        statusNote: null,
        pausedUntil: null,
        statusChangedAt: sql`now()`,
      })
      .where(and(eq(deliveryAgents.status, 'paused'), lte(deliveryAgents.pausedUntil, sql`now()`)))
      .returning({ id: deliveryAgents.id });
    for (const r of rows)
      await agentEvent(tx, { agentId: r.id, kind: 'status', from: 'paused', to: 'active', actor: 'system' });
    return rows.length;
  });
}

export type { AgentRow };

// ?? photos (pickup, delivery, failure, documents) ????????????????????????????????????????????????????????????????

export type AgentUploadPurpose = 'pickup' | 'delivery' | 'failure' | 'document';

/**
 * Who owns an upload before any image work: a job photo belongs to a job the active agent holds (404 otherwise); a
 * document photo belongs to the agent. Returns the media owner for `saveAgentMedia`.
 */
export async function prepareAgentUpload(
  db: Tx,
  input: { userId: string; purpose: AgentUploadPurpose; jobId?: string | undefined },
): Promise<{ ownerKind: 'delivery_photo' | 'agent_document'; ownerId: string }> {
  const a = await agentOfUser(db, input.userId);
  if (input.purpose === 'document') {
    if (a.status === 'offboarded' || a.status === 'suspended')
      throw new ForbiddenError('Documents cannot be changed now', 'AGENT_NOT_ACTIVE');
    return { ownerKind: 'agent_document', ownerId: a.id };
  }
  if (a.status !== 'active' && a.status !== 'paused')
    throw new ForbiddenError('Your account is not active for deliveries', 'AGENT_NOT_ACTIVE');
  if (!input.jobId) throw new ValidationError('Which job is this photo for?', 'JOB_REQUIRED');
  const [j] = await db
    .select({ id: deliveryJobs.id, agentId: deliveryJobs.agentId, status: deliveryJobs.status })
    .from(deliveryJobs)
    .where(eq(deliveryJobs.id, input.jobId))
    .limit(1);
  // A paused agent may only photograph a parcel already picked up (to deliver it or report a failure).
  const stages = a.status === 'paused' ? ['picked_up'] : ['accepted', 'picked_up'];
  if (j?.agentId !== a.id || !stages.includes(j.status)) throw new NotFoundError('Delivery job not found');
  return { ownerKind: 'delivery_photo', ownerId: j.id };
}

export async function saveAgentMedia(
  db: Tx,
  input: {
    userId: string;
    ownerKind: 'delivery_photo' | 'agent_document';
    ownerId: string;
    image: {
      mediaId: string;
      bucket: string;
      path: string;
      thumbPath: string;
      width: number;
      height: number;
      bytes: number;
      thumbBytes: number;
      sha256: string;
    };
  },
): Promise<{ mediaId: string }> {
  const img = input.image;
  await db.insert(mediaObjects).values({
    id: img.mediaId,
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    bucket: img.bucket,
    path: img.path,
    thumbPath: img.thumbPath,
    width: img.width,
    height: img.height,
    bytes: img.bytes,
    thumbBytes: img.thumbBytes,
    sha256: img.sha256,
    uploadedBy: input.userId,
  });
  return { mediaId: img.mediaId };
}

/** A delivery or document photo to serve (the API checks the signed URL first; only staff get those URLs). */
export async function deliveryMediaForServing(db: Tx, mediaId: string) {
  const [m] = await db
    .select({ bucket: mediaObjects.bucket, path: mediaObjects.path, thumbPath: mediaObjects.thumbPath })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.id, mediaId),
        inArray(mediaObjects.ownerKind, ['delivery_photo', 'agent_document']),
        sql`${mediaObjects.deletedAt} is null`,
      ),
    )
    .limit(1);
  return m ?? null;
}

// ?? applications (staff) ?????????????????????????????????????????????????????????????????????????????????????????

export async function listAgentApplications(
  db: Tx,
  input: {
    scope: CityScope;
    status: 'new' | 'in_review' | 'approved' | 'rejected';
    limit: number;
    before?: Date | null;
  },
) {
  const rows = await db
    .select({
      id: partnerApplications.id,
      code: partnerApplications.code,
      name: partnerApplications.name,
      phone: partnerApplications.phone,
      cityId: partnerApplications.cityId,
      cityCode: cities.code,
      vehicleType: partnerApplications.vehicleType,
      status: partnerApplications.status,
      reasonCode: partnerApplications.reasonCode,
      createdAt: partnerApplications.createdAt,
      version: partnerApplications.version,
    })
    .from(partnerApplications)
    .innerJoin(cities, eq(cities.id, partnerApplications.cityId))
    .where(
      and(
        eq(partnerApplications.kind, 'delivery_agent'),
        eq(partnerApplications.status, input.status),
        input.scope.all
          ? undefined
          : inArray(
              partnerApplications.cityId,
              input.scope.cityIds.length ? input.scope.cityIds : ['00000000-0000-0000-0000-000000000000'],
            ),
        input.before ? lt(partnerApplications.createdAt, input.before) : undefined,
      ),
    )
    .orderBy(desc(partnerApplications.createdAt))
    .limit(input.limit + 1);
  return {
    items: rows.slice(0, input.limit).map((r) => ({ ...r, phone: maskPhone(r.phone) })),
    more: rows.length > input.limit,
  };
}

export async function rejectAgentApplication(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    code: string;
    reasonCode: string;
    note?: string | undefined;
    expectedVersion: number;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(partnerApplications)
      .where(and(eq(partnerApplications.code, input.code), eq(partnerApplications.kind, 'delivery_agent')))
      .for('update');
    if (!app?.cityId || !inScope(input.scope, app.cityId)) throw new NotFoundError('Application not found');
    const done = await tx
      .update(partnerApplications)
      .set({
        status: 'rejected',
        reasonCode: input.reasonCode,
        reviewNote: input.note ?? null,
        reviewedBy: input.staffUserId,
      })
      .where(
        and(
          eq(partnerApplications.id, app.id),
          eq(partnerApplications.version, input.expectedVersion),
          inArray(partnerApplications.status, ['new', 'in_review']),
        ),
      )
      .returning({ id: partnerApplications.id });
    if (done.length === 0) throw new ConflictError('The application changed meanwhile', 'STALE');
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_agent.application_rejected',
      entity: 'delivery_agent',
      entityId: app.id,
      after: { reasonCode: input.reasonCode },
    });
  });
}
