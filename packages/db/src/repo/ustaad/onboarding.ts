/**
 * First-time tutorial and coach-marks (spec 23 § 4 flow 15, § 6.10; plan task B2). Progress per member in
 * `ustaad_member_onboarding`; the cards and coach-marks are admin tables (en + hi). Each save is one conditional
 * UPDATE (no read-then-write); "Help / Kaise use karein" resets the progress so the cards and coach-marks show again.
 * The `tutorial_*` analytics events are sent by the page (client catalogue, spec 23 § 16).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { CoachmarkTarget } from '@mechdost/shared/ustaad/codes';
import type { OnboardingEvent, OnboardingView, Tutorial } from '@mechdost/shared/ustaad/dto/verification';
import { ustaadCoachmarks, ustaadMemberOnboarding, ustaadMembers, ustaadTutorialCards } from '../../schema';
import { NotFoundError } from '../errors';
import type { Tx } from '../orders';

async function memberIdOf(tx: Tx, userId: string): Promise<string> {
  const [m] = await tx
    .select({ id: ustaadMembers.id, status: ustaadMembers.status })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.userId, userId))
    .limit(1);
  if (!m || m.status === 'left' || m.status === 'banned') throw new NotFoundError('Not a member');
  return m.id;
}

export async function getUstaadOnboarding(tx: Tx, actor: { userId: string }): Promise<OnboardingView> {
  const memberId = await memberIdOf(tx, actor.userId);
  await tx.insert(ustaadMemberOnboarding).values({ memberId }).onConflictDoNothing();
  const [o] = await tx
    .select()
    .from(ustaadMemberOnboarding)
    .where(eq(ustaadMemberOnboarding.memberId, memberId))
    .limit(1);
  return {
    lastCard: o?.lastCard ?? null,
    completed: Boolean(o?.tutorialCompletedAt),
    skipped: Boolean(o?.tutorialSkippedAt),
    coachmarksSeen: (o?.coachmarksSeen ?? []) as CoachmarkTarget[],
  };
}

export async function saveUstaadOnboarding(
  tx: Tx,
  actor: { userId: string },
  e: OnboardingEvent,
): Promise<OnboardingView> {
  const memberId = await memberIdOf(tx, actor.userId);
  await tx.insert(ustaadMemberOnboarding).values({ memberId }).onConflictDoNothing();
  const where = eq(ustaadMemberOnboarding.memberId, memberId);
  const now = new Date();
  switch (e.event) {
    case 'card':
      await tx.update(ustaadMemberOnboarding).set({ lastCard: e.card }).where(where);
      break;
    case 'skipped':
      await tx
        .update(ustaadMemberOnboarding)
        .set({
          lastCard: e.card,
          tutorialSkippedAt: sql`coalesce(${ustaadMemberOnboarding.tutorialSkippedAt}, ${now})`,
        })
        .where(where);
      break;
    case 'completed':
      await tx
        .update(ustaadMemberOnboarding)
        .set({
          lastCard: e.card,
          tutorialCompletedAt: sql`coalesce(${ustaadMemberOnboarding.tutorialCompletedAt}, ${now})`,
        })
        .where(where);
      break;
    case 'coachmark':
      // Append once (array_append only when absent), in one statement.
      await tx
        .update(ustaadMemberOnboarding)
        .set({
          coachmarksSeen: sql`array_append(${ustaadMemberOnboarding.coachmarksSeen}, ${e.target}::text)`,
        })
        .where(and(where, sql`not (${e.target}::text = any(${ustaadMemberOnboarding.coachmarksSeen}))`));
      break;
  }
  return getUstaadOnboarding(tx, actor);
}

/** "Help / Kaise use karein": the cards and every coach-mark show again. */
export async function resetUstaadOnboarding(tx: Tx, actor: { userId: string }): Promise<OnboardingView> {
  const memberId = await memberIdOf(tx, actor.userId);
  await tx
    .update(ustaadMemberOnboarding)
    .set({ lastCard: null, tutorialCompletedAt: null, tutorialSkippedAt: null, coachmarksSeen: [] })
    .where(eq(ustaadMemberOnboarding.memberId, memberId));
  return getUstaadOnboarding(tx, actor);
}

/** Active cards and coach-marks in the member's language (Hindi default). */
export async function ustaadTutorial(tx: Tx, lang: 'hi' | 'en'): Promise<Tutorial> {
  const cards = await tx
    .select()
    .from(ustaadTutorialCards)
    .where(eq(ustaadTutorialCards.active, true))
    .orderBy(asc(ustaadTutorialCards.position));
  const marks = await tx
    .select()
    .from(ustaadCoachmarks)
    .where(eq(ustaadCoachmarks.active, true))
    .orderBy(asc(ustaadCoachmarks.position));
  const hi = lang === 'hi';
  return {
    cards: cards.map((c) => ({
      code: c.code,
      position: c.position,
      title: hi ? c.titleHi : c.titleEn,
      body: hi ? c.bodyHi : c.bodyEn,
      imageMediaId: c.imageMediaId,
      audioMediaId: hi ? c.audioHiMediaId : c.audioEnMediaId,
    })),
    coachmarks: marks.map((m) => ({
      target: m.target as CoachmarkTarget,
      text: hi ? m.textHi : m.textEn,
      position: m.position,
    })),
  };
}
