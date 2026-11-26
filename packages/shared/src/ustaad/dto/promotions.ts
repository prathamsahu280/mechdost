/**
 * Promotions served to members (spec 23 § 6.3, § 9.5, § 15, SR-40–41; workstream D2). MechDost's own promotions only;
 * the label is locked ("Sponsored" / "प्रायोजित", first line); the link is a server-built MechDost internal path.
 * Staff create and schedule them through G1's `/admin/ustaad/promotions` (`ustaad:promotions`, audited).
 */
import { z } from 'zod';
import { PROMOTION_HIDE_REASONS, PROMOTION_SERVED_SLOTS } from '../codes';

export const ServePromotionQueryDto = z.object({ slot: z.enum(PROMOTION_SERVED_SLOTS) }).strict();

export const ServedPromotionDto = z.object({
  id: z.uuid(),
  slot: z.enum(PROMOTION_SERVED_SLOTS),
  /** Always present, never editable: render it in the card's first line. */
  label: z.object({ en: z.literal('Sponsored'), hi: z.literal('प्रायोजित') }),
  titleEn: z.string(),
  titleHi: z.string(),
  bodyEn: z.string(),
  bodyHi: z.string(),
  /** A MechDost internal path (`/shop/…`, `/offers`, `/ustaad/learn…`), never an absolute URL. */
  href: z.string(),
});
export type ServedPromotion = z.infer<typeof ServedPromotionDto>;

export const ServePromotionResultDto = z.object({ promotion: ServedPromotionDto.nullable() });

export const PromotionIdParamDto = z.object({ id: z.uuid() });
export const HidePromotionDto = z.object({ reason: z.enum(PROMOTION_HIDE_REASONS) }).strict();
export const PromotionClickResultDto = z.object({ href: z.string() });
