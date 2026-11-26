/**
 * Ustaad profile, specialities, choices and the SR-2 freeze (spec 23 § 8 "Membership", flow 14, § 14a SR-2, SR-4,
 * SR-5; plan task B3). The member writes only their own row, conditional on the version they read; level, status,
 * city, the official badge and verification never change here.
 */
import { and, desc, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import {
  USTAAD_CONSENT_NOTICE_VERSION,
  USTAAD_JOIN_CONSENTS,
  type UstaadLevel,
} from '@mechdost/shared/ustaad/codes';
import type {
  Choices,
  ChoicesView,
  MemberView,
  PatchMe,
  Specialities,
} from '@mechdost/shared/ustaad/dto/members';
import { levelAtLeast } from '@mechdost/shared/ustaad/levels';
import { consents, ustaadMembers, ustaadMemberSpecialities } from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import { ustaadMemberRowOfUser, ustaadMemberViewOf } from './members';
import { assertUstaadNameAllowed } from './names';
import { notifyUstaad } from './notify';
import { readUstaadSettingValues } from './settings';

type MemberRow = typeof ustaadMembers.$inferSelect;

async function activeRowOfUser(tx: Tx, userId: string): Promise<MemberRow> {
  const row = await ustaadMemberRowOfUser(tx, userId);
  if (!row || row.status === 'left') throw new NotFoundError('Not a member');
  if (row.status === 'banned')
    throw new ForbiddenError('This account cannot use the network', 'USTAAD_BANNED');
  return row;
}

/**
 * `PATCH /ustaad/me`: the member's own profile, conditional on the version they read (409 `STALE_MEMBER`). Only the
 * fields of `PatchMeDto` can change (SR-5). Names pass the reserved and confusable check (SR-4). The event and the
 * analytics carry the field names or their number, never their values.
 */
export async function updateUstaadProfile(
  db: Tx,
  actor: { userId: string },
  input: PatchMe,
): Promise<MemberView> {
  const { expectedVersion, ...patch } = input;
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<
    Omit<PatchMe, 'expectedVersion'>
  >;
  const fields = Object.keys(set).sort();
  if (fields.length === 0) throw new ValidationError('Nothing to update', 'EMPTY_PATCH');
  if (set.displayName !== undefined)
    await assertUstaadNameAllowed(db, set.displayName, { userId: actor.userId });
  if (set.displayNameHi) await assertUstaadNameAllowed(db, set.displayNameHi, { userId: actor.userId });
  return db.transaction(async (tx) => {
    const m = await activeRowOfUser(tx, actor.userId);
    // A new area without its Hindi form: the old Hindi label would name the old area.
    const clearHi =
      set.areaLabel !== undefined && set.areaLabel !== m.areaLabel && set.areaLabelHi === undefined;
    const [row] = await tx
      .update(ustaadMembers)
      .set({ ...set, ...(clearHi ? { areaLabelHi: null } : {}) })
      .where(
        and(
          eq(ustaadMembers.id, m.id),
          eq(ustaadMembers.version, expectedVersion),
          inArray(ustaadMembers.status, ['active', 'restricted']),
        ),
      )
      .returning();
    if (!row) throw new ConflictError('Your profile changed meanwhile; reload and try again', 'STALE_MEMBER');
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: m.id,
        kind: 'profile_updated',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: m.cityId,
        props: { fields },
      },
      {
        name: 'ustaad_profile_updated',
        memberId: m.id,
        userId: actor.userId,
        props: { memberId: m.id, fields: fields.length },
      },
    );
    return ustaadMemberViewOf(tx, row);
  });
}

/**
 * `PUT /ustaad/me/specialities`: the full list. A code that stays keeps its earned step (`pakka`/`mahir`) and date;
 * new codes start at `shuru`; dropped codes go. Never a delete-all (that would erase earned steps).
 */
export async function setUstaadSpecialities(
  db: Tx,
  actor: { userId: string },
  input: Specialities,
): Promise<MemberView> {
  const codes = [...new Set(input.codes)];
  return db.transaction(async (tx) => {
    const m = await activeRowOfUser(tx, actor.userId);
    await tx
      .delete(ustaadMemberSpecialities)
      .where(
        and(eq(ustaadMemberSpecialities.memberId, m.id), notInArray(ustaadMemberSpecialities.code, codes)),
      );
    await tx
      .insert(ustaadMemberSpecialities)
      .values(codes.map((code) => ({ memberId: m.id, code })))
      .onConflictDoNothing();
    await recordUstaadEvent(tx, {
      entityType: 'member',
      entityId: m.id,
      kind: 'specialities_set',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: m.cityId,
      props: { codes },
    });
    return ustaadMemberViewOf(tx, m);
  });
}

const OPTIONAL_CONSENTS = ['ustaad_directory', 'ustaad_training', 'ustaad_offers'] as const;

/** The latest grant or withdrawal per join purpose (append-only `consents`, newest row wins). */
async function joinConsentState(tx: Tx, userId: string): Promise<ChoicesView['consents']> {
  const rows = await tx
    .selectDistinctOn([consents.purpose], { purpose: consents.purpose, granted: consents.granted })
    .from(consents)
    .where(and(eq(consents.userId, userId), inArray(consents.purpose, [...USTAAD_JOIN_CONSENTS])))
    .orderBy(consents.purpose, desc(consents.createdAt), desc(consents.id));
  const state = new Map(rows.map((r) => [r.purpose, r.granted]));
  return {
    ustaad_profile: state.get('ustaad_profile') === true,
    ustaad_directory: state.get('ustaad_directory') === true,
    ustaad_training: state.get('ustaad_training') === true,
    ustaad_offers: state.get('ustaad_offers') === true,
  };
}

/** `GET /ustaad/me/choices`. */
export async function getUstaadChoices(tx: Tx, userId: string): Promise<ChoicesView> {
  const m = await activeRowOfUser(tx, userId);
  const s = await readUstaadSettingValues(tx, ['ustaad.correction.member_can_change']);
  return {
    dmMode: m.dmMode as ChoicesView['dmMode'],
    suggestMe: m.suggestMe,
    correctionMode: m.correctionMode as ChoicesView['correctionMode'],
    canChangeCorrection: s['ustaad.correction.member_can_change'] === true,
    dataSaver: m.dataSaver,
    consents: await joinConsentState(tx, userId),
    version: m.version,
  };
}

/**
 * `PUT /ustaad/me/choices`: conditional on the member version (a consents-only save bumps it too, so a stale screen
 * is refused). Smart-correction mode only while `correction.member_can_change` is on (422 `USTAAD_SETTING_LOCKED`). A
 * changed optional consent appends one `consents` row (DPDP: grants and withdrawals are both kept).
 */
export async function saveUstaadChoices(
  db: Tx,
  actor: { userId: string },
  input: Choices,
): Promise<ChoicesView> {
  const { expectedVersion, consents: wanted, ...prefs } = input;
  return db.transaction(async (tx) => {
    const m = await activeRowOfUser(tx, actor.userId);
    if (prefs.correctionMode !== undefined) {
      const s = await readUstaadSettingValues(tx, ['ustaad.correction.member_can_change']);
      if (s['ustaad.correction.member_can_change'] !== true)
        throw new ValidationError('Smart correction is set by MechDost right now', 'USTAAD_SETTING_LOCKED');
    }
    const set = Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== undefined)) as Partial<
      Omit<Choices, 'expectedVersion' | 'consents'>
    >;
    const [row] = await tx
      .update(ustaadMembers)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(ustaadMembers.id, m.id), eq(ustaadMembers.version, expectedVersion)))
      .returning({ id: ustaadMembers.id });
    if (!row) throw new ConflictError('Your choices changed meanwhile; reload and try again', 'STALE_MEMBER');
    let fields = Object.keys(set).length;
    if (wanted) {
      const current = await joinConsentState(tx, actor.userId);
      const changed = OPTIONAL_CONSENTS.filter((p) => wanted[p] !== undefined && wanted[p] !== current[p]);
      if (changed.length > 0)
        await tx.insert(consents).values(
          changed.map((purpose) => ({
            userId: actor.userId,
            purpose,
            granted: wanted[purpose] === true,
            noticeVersion: USTAAD_CONSENT_NOTICE_VERSION,
            source: 'ustaad_choices',
          })),
        );
      fields += changed.length;
    }
    if (fields > 0)
      await recordUstaadEvent(
        tx,
        {
          entityType: 'member',
          entityId: m.id,
          kind: 'choices_saved',
          actorId: actor.userId,
          actorRole: 'member',
          cityId: m.cityId,
          props: { fields },
        },
        {
          name: 'ustaad_choices_saved',
          memberId: m.id,
          userId: actor.userId,
          props: { memberId: m.id, fields },
        },
      );
    return getUstaadChoices(tx, actor.userId);
  });
}

// ── SR-2: freeze after a credential change on a Pakka+ account ──────────────────────────────────────────────

export type CredentialChange = 'phone_changed' | 'email_changed' | 'password_changed';

/**
 * SR-2 (spec 23 § 14a): after a phone, email or password change on a Pakka-or-higher member, perks and job posting
 * pause for `security.high_level_freeze_hours` (job posting already refuses with `USTAAD_PERKS_FROZEN`). The freeze
 * only ever extends, so a late or replayed signal never shortens it. Writes an `ustaad_events` row and the
 * `ustaad.security_freeze` notice in the caller's transaction. True when a freeze was set or extended.
 * "Sign out everywhere" stays the existing Firebase revoke; a new-device signal has no data source yet (not built).
 */
export async function freezeUstaadPerksAfterCredentialChange(
  tx: Tx,
  userId: string,
  reason: CredentialChange,
  now: Date = new Date(),
): Promise<boolean> {
  const m = await ustaadMemberRowOfUser(tx, userId);
  if (!m || m.status === 'left' || m.status === 'banned') return false;
  if (!levelAtLeast(m.level as UstaadLevel, 'pakka')) return false;
  const s = await readUstaadSettingValues(tx, ['ustaad.security.high_level_freeze_hours']);
  const until = new Date(now.getTime() + Number(s['ustaad.security.high_level_freeze_hours']) * 3_600_000);
  const [row] = await tx
    .update(ustaadMembers)
    .set({ perksFrozenUntil: until })
    .where(
      and(
        eq(ustaadMembers.id, m.id),
        or(isNull(ustaadMembers.perksFrozenUntil), lt(ustaadMembers.perksFrozenUntil, until)),
      ),
    )
    .returning({ id: ustaadMembers.id });
  if (!row) return false;
  await recordUstaadEvent(
    tx,
    {
      entityType: 'member',
      entityId: m.id,
      kind: 'security_freeze',
      reasonCode: reason,
      actorId: null,
      actorRole: 'system',
      cityId: m.cityId,
      props: { until: until.toISOString() },
    },
    { name: 'ustaad_security_freeze', memberId: m.id, userId, props: { memberId: m.id, reason } },
  );
  await notifyUstaad(tx, 'ustaad.security_freeze', {
    userId,
    entityId: m.id,
    version: `freeze:${String(until.getTime())}`,
    params: {},
  });
  return true;
}
