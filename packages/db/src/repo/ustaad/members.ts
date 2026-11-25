/**
 * Ustaad Network membership (spec 23 § 4 flow 1, § 8 "Membership"; plan task A3). The only writer of
 * `ustaad_members`. Join creates the member, its specialities, counters, onboarding row, the four join consents, the
 * verification request (when a method was picked) and the `mechanic` grant in one transaction, so the member row and
 * the grant never disagree (the API's member guard reads the row, never a cached token). Leaving keeps the row (handle
 * reserved, counters kept); a rejoin reuses it (plan review focus 3). The phone number is never part of a member view
 * (SR-34).
 */
import { randomInt } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  USTAAD_CONSENT_NOTICE_VERSION,
  USTAAD_JOIN_CONSENTS,
  type UstaadSpecialityCode,
} from '@mechdost/shared/ustaad/codes';
import type { Join, MemberView } from '@mechdost/shared/ustaad/dto/members';
import { startLevel } from '@mechdost/shared/ustaad/levels';
import {
  cities,
  consents,
  pincodes,
  roles,
  states,
  userRoles,
  ustaadEvents,
  ustaadMemberCounters,
  ustaadMemberOnboarding,
  ustaadMembers,
  ustaadMemberSpecialities,
  ustaadReachCities,
  ustaadVerifications,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { insertUserRole } from '../rbac';
import { recordUstaadEvent } from './events';
import { assertUstaadNameAllowed } from './names';
import { readUstaadSettingValues } from './settings';

type MemberRow = typeof ustaadMembers.$inferSelect;

/** The state a city must be in for "all of Chhattisgarh" (`ustaad.general.all_state`). */
const REACH_STATE_CODE = 'CG';

/**
 * The enabled city for a place (SR-46, AT-REGION-1), or null. Cities carry no polygons yet, so a PIN code maps
 * through `pincodes.city_id` (the spec's fallback); with `general.all_state` on, any PIN in Chhattisgarh counts and
 * maps to its city. Workstream E adds the `ST_Within`/radius check for a garage pin.
 */
export async function ustaadRegionFor(tx: Tx, place: { pincode: string }): Promise<string | null> {
  const [row] = await tx
    .select({
      cityId: pincodes.cityId,
      enabled: ustaadReachCities.enabled,
      stateCode: states.code,
      active: pincodes.active,
    })
    .from(pincodes)
    .innerJoin(states, eq(states.id, pincodes.stateId))
    .leftJoin(ustaadReachCities, eq(ustaadReachCities.cityId, pincodes.cityId))
    .where(eq(pincodes.pincode, place.pincode))
    .limit(1);
  if (!row?.cityId || !row.active) return null;
  if (row.enabled === true) return row.cityId;
  if (row.enabled === false) return null; // switched off explicitly wins over "all state"
  const s = await readUstaadSettingValues(tx, ['ustaad.general.all_state']);
  return s['ustaad.general.all_state'] && row.stateCode === REACH_STATE_CODE ? row.cityId : null;
}

async function viewOf(tx: Tx, m: MemberRow): Promise<MemberView> {
  const [city] = await tx.select({ code: cities.code }).from(cities).where(eq(cities.id, m.cityId)).limit(1);
  const specs = await tx
    .select({ code: ustaadMemberSpecialities.code })
    .from(ustaadMemberSpecialities)
    .where(eq(ustaadMemberSpecialities.memberId, m.id))
    .orderBy(ustaadMemberSpecialities.code);
  return {
    id: m.id,
    handle: m.handle,
    displayName: m.displayName,
    displayNameHi: m.displayNameHi,
    track: m.track as MemberView['track'],
    level: m.level as MemberView['level'],
    status: m.status as MemberView['status'],
    verificationState: m.verificationState as MemberView['verificationState'],
    cityCode: city?.code ?? '',
    areaLabel: m.areaLabel,
    areaLabelHi: m.areaLabelHi,
    workPlace: m.workPlace as MemberView['workPlace'],
    garageName: m.garageName,
    showGarage: m.showGarage,
    yearsClaimed: m.yearsClaimed,
    specialities: specs.map((s) => s.code as UstaadSpecialityCode),
    dmMode: m.dmMode as MemberView['dmMode'],
    suggestMe: m.suggestMe,
    lang: m.lang as MemberView['lang'],
    official: m.official,
    founding: m.founding,
    joinedAt: m.joinedAt.toISOString(),
    version: m.version,
  };
}

async function memberRowOfUser(tx: Tx, userId: string): Promise<MemberRow | undefined> {
  const [row] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.userId, userId)).limit(1);
  return row;
}

/** The member row of a user (any status), or null. Used by the API guard. */
export async function ustaadMemberOfUser(tx: Tx, userId: string): Promise<MemberView | null> {
  const row = await memberRowOfUser(tx, userId);
  return row ? viewOf(tx, row) : null;
}

/** A handle from the display name: lower-case Latin letters and digits, a short random suffix; never the phone. */
function handleCandidate(displayName: string): string {
  const base = displayName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
  const stem = base.length >= 3 ? base : 'mistri';
  return `${stem}_${String(randomInt(1000, 10_000))}`;
}

async function writeConsents(
  tx: Tx,
  userId: string,
  values: Record<(typeof USTAAD_JOIN_CONSENTS)[number], boolean>,
  source: string,
): Promise<void> {
  await tx.insert(consents).values(
    USTAAD_JOIN_CONSENTS.map((purpose) => ({
      userId,
      purpose,
      granted: values[purpose],
      noticeVersion: USTAAD_CONSENT_NOTICE_VERSION,
      source,
    })),
  );
}

async function grantMechanic(tx: Tx, userId: string): Promise<void> {
  await insertUserRole(tx, { userId, role: 'mechanic', grantedBy: null });
}

async function revokeMechanic(tx: Tx, userId: string): Promise<void> {
  const ids = tx.select({ id: roles.id }).from(roles).where(eq(roles.key, 'mechanic'));
  await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, ids)));
}

/**
 * The status a member had when they last left (from the append-only `left` event), so a rejoin restores it. Only
 * `active` or `restricted` can leave (banned members cannot); anything unexpected restores `restricted`, never
 * a cleaner standing.
 */
async function statusBeforeLeaving(tx: Tx, memberId: string): Promise<'active' | 'restricted'> {
  const [last] = await tx
    .select({ fromStatus: ustaadEvents.fromStatus })
    .from(ustaadEvents)
    .where(
      and(
        eq(ustaadEvents.entityType, 'member'),
        eq(ustaadEvents.entityId, memberId),
        eq(ustaadEvents.kind, 'left'),
      ),
    )
    .orderBy(desc(ustaadEvents.occurredAt), desc(ustaadEvents.id))
    .limit(1);
  return last?.fromStatus === 'active' ? 'active' : 'restricted';
}

export interface JoinContext {
  via: 'ustaad' | 'partners_apply';
}

/**
 * Join (or rejoin after leaving). The caller has checked the verified phone and Turnstile (SR-3). Refuses:
 * `USTAAD_ALREADY_MEMBER` (409), `USTAAD_BANNED` (403), `USTAAD_REGION` (422), `USTAAD_METHOD_OFF` (422),
 * `USTAAD_JOIN_CLOSED` (422, join mode `invite_only` without an invite), `NAME_RESERVED` (422, workstream B).
 */
export async function joinUstaad(
  db: Tx,
  actor: { userId: string },
  input: Join,
  ctx: JoinContext,
): Promise<MemberView> {
  const s = await readUstaadSettingValues(db, [
    'ustaad.general.join_mode',
    'ustaad.verify.owner_enabled',
    'ustaad.verify.vouch_enabled',
    'ustaad.verify.certificate_enabled',
    'ustaad.dm.default_mode',
    'ustaad.general.default_lang',
  ]);
  const methodOn = {
    owner: s['ustaad.verify.owner_enabled'],
    vouch: s['ustaad.verify.vouch_enabled'],
    certificate: s['ustaad.verify.certificate_enabled'],
  } as const;
  for (const m of input.verifyMethods)
    if (!methodOn[m]) throw new ValidationError(`The ${m} proof is not available`, 'USTAAD_METHOD_OFF');
  // `invite_only` is refused outright until workstream B checks `fromApplication` against `ustaad_application_links`
  // (a code alone proves nothing; review 2026-11-26).
  if (s['ustaad.general.join_mode'] === 'invite_only')
    throw new ValidationError('Joining is by invite right now', 'USTAAD_JOIN_CLOSED');
  await assertUstaadNameAllowed(db, input.displayName);

  return db.transaction(async (tx) => {
    const cityId = await ustaadRegionFor(tx, { pincode: input.pincode });
    if (!cityId) throw new ValidationError('Ustaad Network is opening in your city soon', 'USTAAD_REGION');
    const existing = await memberRowOfUser(tx, actor.userId);
    if (existing?.status === 'banned')
      throw new ForbiddenError('This account cannot use the network', 'USTAAD_BANNED');
    if (existing && existing.status !== 'left')
      throw new ConflictError('You are already a member', 'USTAAD_ALREADY_MEMBER');

    const verificationState = input.verifyMethods.length > 0 ? 'pending_verification' : 'unverified';
    const profile = {
      displayName: input.displayName,
      cityId,
      areaLabel: input.areaLabel,
      pincode: input.pincode,
      workPlace: input.workPlace,
      garageName: input.garageName ?? null,
      showGarage: input.showGarage,
      yearsClaimed: input.yearsClaimed,
    };
    let row: MemberRow | undefined;
    if (existing) {
      // Rejoin: same row, same handle, same earned track and level; profile refreshed. A moderation standing never
      // resets by leaving (security review 2026-11-26): the status before leaving comes back (a restricted member stays
      // restricted), `restricted_mode`, `perks_frozen_until` and `banned_until` are not touched, and a verified or
      // revoked verification state is kept.
      const standing = await statusBeforeLeaving(tx, existing.id);
      const keepVerification =
        existing.verificationState === 'verified' || existing.verificationState === 'revoked';
      [row] = await tx
        .update(ustaadMembers)
        .set({
          ...profile,
          status: standing,
          leftAt: null,
          verificationState: keepVerification ? existing.verificationState : verificationState,
          lastActiveAt: new Date(),
        })
        .where(
          and(
            eq(ustaadMembers.id, existing.id),
            eq(ustaadMembers.status, 'left'),
            eq(ustaadMembers.version, existing.version),
          ),
        )
        .returning();
      if (!row) throw new ConflictError('Your membership changed meanwhile; try again', 'STALE_MEMBER');
      await tx.delete(ustaadMemberSpecialities).where(eq(ustaadMemberSpecialities.memberId, row.id));
    } else {
      for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
        [row] = await tx
          .insert(ustaadMembers)
          .values({
            ...profile,
            userId: actor.userId,
            handle: handleCandidate(input.displayName),
            track: input.track,
            level: startLevel(input.track),
            verificationState,
            dmMode: s['ustaad.dm.default_mode'] as MemberRow['dmMode'],
            lang: s['ustaad.general.default_lang'] as MemberRow['lang'],
            createdBy: actor.userId,
            lastActiveAt: new Date(),
          })
          .onConflictDoNothing({ target: ustaadMembers.handle })
          .returning();
      }
      if (!row) throw new ConflictError('Could not pick a handle; try again', 'RETRY');
    }
    const member = row;
    await tx
      .insert(ustaadMemberSpecialities)
      .values([...new Set(input.specialities)].map((code) => ({ memberId: member.id, code })));
    await tx.insert(ustaadMemberCounters).values({ memberId: member.id }).onConflictDoNothing();
    await tx.insert(ustaadMemberOnboarding).values({ memberId: member.id }).onConflictDoNothing();
    await writeConsents(tx, actor.userId, input.consents, 'ustaad_join');
    // No automatic request for a verified member, nor for a revoked one (staff decide what happens next).
    if (
      input.verifyMethods.length > 0 &&
      member.verificationState !== 'verified' &&
      member.verificationState !== 'revoked'
    ) {
      await tx
        .insert(ustaadVerifications)
        .values({ memberId: member.id, proofKinds: [...new Set(input.verifyMethods)] })
        .onConflictDoNothing();
    }
    await grantMechanic(tx, actor.userId);
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: member.id,
        kind: existing ? 'rejoined' : 'joined',
        fromStatus: existing ? 'left' : null,
        toStatus: member.status,
        actorId: actor.userId,
        actorRole: 'member',
        cityId,
        props: { via: ctx.via, track: member.track },
      },
      {
        name: 'ustaad_joined',
        memberId: member.id,
        userId: actor.userId,
        props: { memberId: member.id, track: member.track as 'apprentice' | 'ustaad', via: ctx.via },
      },
    );
    return viewOf(tx, member);
  });
}

/** Leave the network: the MechDost account stays; the profile is hidden; the handle stays reserved. */
export async function leaveUstaad(db: Tx, actor: { userId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await memberRowOfUser(tx, actor.userId);
    if (!existing || existing.status === 'left') throw new NotFoundError('Not a member');
    if (existing.status === 'banned')
      throw new ForbiddenError('This account cannot use the network', 'USTAAD_BANNED');
    const [row] = await tx
      .update(ustaadMembers)
      .set({ status: 'left', leftAt: new Date() })
      .where(and(eq(ustaadMembers.id, existing.id), eq(ustaadMembers.version, existing.version)))
      .returning({ id: ustaadMembers.id });
    if (!row) throw new ConflictError('Your membership changed meanwhile; try again', 'STALE_MEMBER');
    await revokeMechanic(tx, actor.userId);
    await tx.insert(consents).values({
      userId: actor.userId,
      purpose: 'ustaad_profile',
      granted: false,
      noticeVersion: USTAAD_CONSENT_NOTICE_VERSION,
      source: 'ustaad_leave',
    });
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: existing.id,
        kind: 'left',
        fromStatus: existing.status,
        toStatus: 'left',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: existing.cityId,
      },
      { name: 'ustaad_left', memberId: existing.id, userId: actor.userId, props: { memberId: existing.id } },
    );
  });
}

/** Members per status (admin overview; no personal data). */
export async function countUstaadMembers(tx: Tx): Promise<Record<string, number>> {
  const rows = await tx
    .select({ status: ustaadMembers.status, n: sql<number>`count(*)::int` })
    .from(ustaadMembers)
    .groupBy(ustaadMembers.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
