import type { RecoSlot } from '@mechdost/shared/recommendations';
import type { Locale } from '@/i18n/routing';
import { ProductCard } from './product-card';
import { RecommendationsCore } from './recommendations-core';

/** "Goes well with this" on the product page (spec 11): the suggestions with the usual catalogue card. */
export function RecommendationsSection({
  slugs,
  slot,
  locale,
}: {
  slugs: readonly string[];
  slot: RecoSlot;
  locale: Locale;
}) {
  return (
    <RecommendationsCore
      slugs={slugs}
      slot={slot}
      locale={locale}
      renderCard={(card) => <ProductCard product={card} scope={`reco-${slot}`} compare={false} />}
    />
  );
}
