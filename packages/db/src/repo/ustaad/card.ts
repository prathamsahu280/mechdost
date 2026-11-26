/**
 * My card and level ladder (spec 23 § 5 `/ustaad/me`, § 9; plan task B3/B5): the member's own card facts, counters,
 * badges held and the ladder with "You are here" and the qualified-follower count next to the rule. Phone never part
 * of it (SR-34). Text comes in the member's language (`*_hi` columns, hard rule 10).
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { UstaadLevel, UstaadMemberStatus } from '@mechdost/shared/ustaad/codes';
import type { MyCard } from '@mechdost/shared/ustaad/dto/verification';
import { shownIzzat } from '@mechdost/shared/ustaad/izzat';
import { DEFAULT_LEVEL_RULES, qualifiedFollowers } from '@mechdost/shared/ustaad/levels';
import {
  users,
  ustaadBadgeAwards,
  ustaadBadges,
  ustaadFollows,
  ustaadLevelRules,
  ustaadMemberCounters,
  ustaadMembers,
} from '../../schema';
import { NotFoundError } from '../errors';
import type { Tx } from '../orders';
import { ustaadMemberOfUser } from './members';
import { readUstaadSettingValues } from './settings';

/** Counts above 1,000 are rounded on cards ("1.2k", spec 23 § 9.2); the exact number below. */
export function roundedCount(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.floor(n / 100) / 10;
  return `${String(k)}k`;
}

export async function ustaadMyCard(tx: Tx, userId: string, lang: 'hi' | 'en'): Promise<MyCard> {
  const member = await ustaadMemberOfUser(tx, userId);
  if (!member || member.status === 'left') throw new NotFoundError('Not a member');
  const hi = lang === 'hi';
  const [c] = await tx
    .select()
    .from(ustaadMemberCounters)
    .where(eq(ustaadMemberCounters.memberId, member.id))
    .limit(1);
  const [row] = await tx
    .select({ workshopId: ustaadMembers.workshopId })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, member.id))
    .limit(1);
  const s = await readUstaadSettingValues(tx, [
    'ustaad.levels.follower_min_age_days',
    'ustaad.levels.follower_exclude_same_garage',
  ]);
  const followers = await tx
    .select({
      followerId: ustaadFollows.followerId,
      counted: ustaadFollows.counted,
      verificationState: ustaadMembers.verificationState,
      status: ustaadMembers.status,
      workshopId: ustaadMembers.workshopId,
      accountCreatedAt: users.createdAt,
    })
    .from(ustaadFollows)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadFollows.followerId))
    .innerJoin(users, eq(users.id, ustaadMembers.userId))
    .where(eq(ustaadFollows.followeeId, member.id));
  const qualified = qualifiedFollowers(
    followers.map((f) => ({
      followerId: f.followerId,
      counted: f.counted,
      verified: f.verificationState === 'verified',
      status: f.status as UstaadMemberStatus,
      workshopId: f.workshopId,
      accountCreatedAt: f.accountCreatedAt,
    })),
    new Date(),
    {
      minAgeDays: Number(s['ustaad.levels.follower_min_age_days']),
      excludeSameGarage: s['ustaad.levels.follower_exclude_same_garage'] === true,
      followeeWorkshopId: row?.workshopId ?? null,
    },
  );
  const badges = await tx
    .select({
      code: ustaadBadges.code,
      nameEn: ustaadBadges.nameEn,
      nameHi: ustaadBadges.nameHi,
      ruleEn: ustaadBadges.ruleEn,
      ruleHi: ustaadBadges.ruleHi,
      icon: ustaadBadges.icon,
      held: ustaadBadgeAwards.id,
    })
    .from(ustaadBadges)
    .leftJoin(
      ustaadBadgeAwards,
      and(
        eq(ustaadBadgeAwards.badgeCode, ustaadBadges.code),
        eq(ustaadBadgeAwards.memberId, member.id),
        isNull(ustaadBadgeAwards.revokedAt),
      ),
    )
    .where(eq(ustaadBadges.active, true))
    .orderBy(asc(ustaadBadges.code));
  const rules = await tx
    .select()
    .from(ustaadLevelRules)
    .orderBy(asc(ustaadLevelRules.position), asc(ustaadLevelRules.ruleGroup));
  const byLevel = new Map<string, typeof rules>();
  for (const r of rules) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r]);
  const ladder = (['naya', 'pakka', 'bada', 'master'] as const).map((level) => {
    // Empty admin table → the engine's founder rules (the same fallback as `recomputeUstaadLevel`); the page then
    // uses its own locale names for the level.
    const groups = byLevel.get(level) ?? DEFAULT_LEVEL_RULES.filter((r) => r.level === level);
    const first = byLevel.get(level)?.[0];
    return {
      level,
      name: first ? (hi ? first.nameHi : first.nameEn) : '',
      perk: first ? (hi ? first.perkHi : first.perkEn) : '',
      groups: groups.map((g) => ({
        minFollowers: g.minFollowers,
        minBestAnswers: g.minBestAnswers,
        minHelpfulPct: g.minHelpfulPct,
        minVerifiedYears: g.minVerifiedYears,
        minVideos: g.minVideos,
        minRecommendations: g.minRecommendations,
      })),
      staffReview: groups.some((g) => g.needsStaffReview) || level === 'bada' || level === 'master',
    };
  });
  return {
    member,
    followers: roundedCount(c?.followers ?? 0),
    qualifiedFollowers: qualified,
    izzat: shownIzzat(c?.izzat ?? 0),
    answers: c?.answers ?? 0,
    bestAnswers: c?.bestAnswers ?? 0,
    videos: c?.videosWatched ?? 0,
    recommendations: c?.recommendations ?? 0,
    badges: badges.map((b) => ({
      code: b.code,
      name: hi ? b.nameHi : b.nameEn,
      rule: hi ? b.ruleHi : b.ruleEn,
      icon: b.icon,
      held: b.held !== null,
    })),
    ladder,
    current: member.level as UstaadLevel,
  };
}
