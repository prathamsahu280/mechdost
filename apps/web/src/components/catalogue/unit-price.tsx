import { useTranslations } from 'next-intl';
import { unitPrice, type NetQuantity } from '@mechdost/shared/product-attributes';
import { formatPrice } from '@/lib/format';

/**
 * "₹488.89 per litre" under a price (design 2026-11-13; Legal Metrology rule 6(11) puts the unit price on
 * packs). Always from the same pack as the price beside it; nothing when the pack size is not listed.
 */
export function UnitPrice({
  pricePaise,
  pack,
  className = '',
}: {
  pricePaise: number;
  pack: NetQuantity | null;
  className?: string;
}) {
  const t = useTranslations('catalogue');
  const unit = unitPrice(pricePaise, pack);
  if (!unit) return null;
  return (
    <p className={`text-xs text-muted ${className}`}>
      {t(`unitPrice_${unit.per}`, { price: formatPrice(unit.paise) })}
    </p>
  );
}
