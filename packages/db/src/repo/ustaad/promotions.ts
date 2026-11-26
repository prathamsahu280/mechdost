/**
 * Promotions served to members (spec 23 § 6.3, § 9.5, § 15, SR-40–42; workstream D2). The serve side only: staff
 * create, edit and move promotions through workstream G1's `/admin/ustaad/promotions` (`ustaad:promotions`, audited
 * in `admin.ts`). MechDost's own promotions only (the table has no advertiser column); the label is the locked
 * `SPONSORED_LABEL` in the card's first line; the link is a server-built MechDost internal path
 * (`promotionHref`, re-checked by `isSafeInternalPath`), so a promotion can never send a member off-site.
 *
 * Served only when `promo.enabled` and `promo.place.<slot>` are on, never in `answer_parts` (no promotions on
 * ask/answer screens), never on a member's first day, never to a member in restricted mode (SR-42: no
 * recommendations), only while live in its window, for the member's city and specialities when the promotion names
 * them (no targeting on anything else: never on sensitive data), never one the member hid, and at most
 * `promo.daily_cap_per_member` a day (one conditional upsert, so parallel serves cannot pass the cap). Feed spacing
 * (`promo.every_n`, never two in a row) is the feed's job (D1/D2 feed) when it asks for a `feed` promotion.
 */
import { and, desc, eq, lte, gt, or, sql } from 'drizzle-orm';
import type { PROMOTION_HIDE_REASONS, PROMOTION_SERVED_SLOTS } from '@mechdost/shared/ustaad/codes';
import type { ServedPromotion } from '@mechdost/shared/ustaad/dto/promotions';
import { promotionHref, SPONSORED_LABEL } from '@mechdost/shared/ustaad/social-rules';
import { ustaadPromoHides, ustaadPromotions } from '../../schema';
import { NotFoundError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import { bumpUstaadDailyCounter, ustaadActingMember } from './graph-common';
import type { UstaadActor } from './qa';
import { readUstaadSettingValues } from './settings';
import type { UstaadSettingKey } from '@mechdost/shared/ustaad/settings';

type Slot = (typeof PROMOTION_SERVED_SLOTS)[number];
type PromotionRow = typeof ustaadPromotions.$inferSelect;
const DAY_MS = 86_400_000;

/** Live now: `live`, or `scheduled` whose start has come; inside the window. */
const liveNow = () =>
  and(
    or(eq(ustaadPromotions.status, 'live'), eq(ustaadPromotions.status, 'scheduled')),
    lte(ustaadPromotions.startsAt, sql`now()`),
    gt(ustaadPromotions.endsAt, sql`now()`),
  );

function served(p: PromotionRow, slot: Slot, href: string): ServedPromotion {
  return {
    id: p.id,
    slot,
    label: { ...SPONSORED_LABEL },
    titleEn: p.titleEn,
    titleHi: p.titleHi,
    bodyEn: p.bodyEn,
    bodyHi: p.bodyHi,
    href,
  };
}

/** One promotion for a slot, or null. See the file header for every rule. */
export async function serveUstaadPromotion(
  db: Tx,
  actor: UstaadActor,
  slot: Slot,
): Promise<ServedPromotion | null> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    if (me.restrictedMode !== 'none' || me.status !== 'active') return null;
    if (Date.now() - me.joinedAt.getTime() < DAY_MS) return null;
    const place = `ustaad.promo.place.${slot}` as UstaadSettingKey;
    const s = await readUstaadSettingValues(tx, [
      'ustaad.promo.enabled',
      'ustaad.promo.daily_cap_per_member',
      place,
    ]);
    if (s['ustaad.promo.enabled'] !== true || s[place] !== true) return null;
    const rows = await tx
      .select()
      .from(ustaadPromotions)
      .where(
        and(
          eq(ustaadPromotions.slot, slot),
          liveNow(),
          sql`(cardinality(${ustaadPromotions.cityIds}) = 0 or ${me.cityId}::uuid = any(${ustaadPromotions.cityIds}))`,
          sql`(cardinality(${ustaadPromotions.segmentCodes}) = 0 or exists (select 1 from ustaad_member_specialities sp
                where sp.member_id = ${me.id} and sp.code = any(${ustaadPromotions.segmentCodes})))`,
          sql`not exists (select 1 from ustaad_promo_hides h where h.member_id = ${me.id} and h.promotion_id = ${ustaadPromotions.id})`,
        ),
      )
      .orderBy(desc(ustaadPromotions.startsAt), ustaadPromotions.id)
      .limit(10);
    const pick = rows
      .map((p) => ({ p, href: promotionHref(p.target, p.targetId) }))
      .find((x) => x.href !== null);
    if (!pick?.href) return null;
    if (
      !(await bumpUstaadDailyCounter(
        tx,
        me.id,
        'promo_served',
        1,
        Number(s['ustaad.promo.daily_cap_per_member']),
      ))
    )
      return null;
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: me.id,
        kind: 'promo_served',
        actorId: actor.userId,
        actorRole: 'member',
        props: { promotionId: pick.p.id, slot },
      },
      {
        name: 'ustaad_promo_served',
        memberId: me.id,
        userId: actor.userId,
        props: { promo: pick.p.id, slot },
      },
    );
    return served(pick.p, slot, pick.href);
  });
}

/** A click: the promotion must still be live; returns its internal link (the client navigates, no redirect). */
export async function clickUstaadPromotion(
  db: Tx,
  actor: UstaadActor,
  promotionId: string,
): Promise<{ href: string }> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    const [p] = await tx
      .select()
      .from(ustaadPromotions)
      .where(and(eq(ustaadPromotions.id, promotionId), liveNow()))
      .limit(1);
    const href = p ? promotionHref(p.target, p.targetId) : null;
    if (!p || href === null) throw new NotFoundError('Promotion not found');
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: me.id,
        kind: 'promo_clicked',
        actorId: actor.userId,
        actorRole: 'member',
        props: { promotionId: p.id, slot: p.slot },
      },
      {
        name: 'ustaad_promo_clicked',
        memberId: me.id,
        userId: actor.userId,
        props: { promo: p.id, slot: p.slot as Slot },
      },
    );
    return { href };
  });
}

/** "Hide this" with a reason code (idempotent); never served to this member again. */
export async function hideUstaadPromotion(
  db: Tx,
  actor: UstaadActor,
  promotionId: string,
  reason: (typeof PROMOTION_HIDE_REASONS)[number],
): Promise<{ hidden: true }> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    const [p] = await tx
      .select({ id: ustaadPromotions.id })
      .from(ustaadPromotions)
      .where(eq(ustaadPromotions.id, promotionId))
      .limit(1);
    if (!p) throw new NotFoundError('Promotion not found');
    const inserted = await tx
      .insert(ustaadPromoHides)
      .values({ memberId: me.id, promotionId, reasonCode: reason })
      .onConflictDoNothing()
      .returning({ at: ustaadPromoHides.createdAt });
    if (inserted.length > 0)
      await recordUstaadEvent(
        tx,
        {
          entityType: 'member',
          entityId: me.id,
          kind: 'promo_hidden',
          reasonCode: reason,
          actorId: actor.userId,
          actorRole: 'member',
          props: { promotionId },
        },
        {
          name: 'ustaad_promo_hidden_by_member',
          memberId: me.id,
          userId: actor.userId,
          props: { promo: promotionId, reason },
        },
      );
    return { hidden: true };
  });
}
