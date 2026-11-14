import { getLocale, getTranslations } from 'next-intl/server';
import { trustKey, trustLineText, type TrustPlacement } from '@mechdost/shared/content';
import { site } from '@/lib/site';
import { publishedTrust } from '@/lib/trust-content';
import { TrustText } from './site-overrides';

/**
 * One trust line ("genuine parts", design 2026-11-15): an async Server Component, so no new client code ships with
 * the page beyond the tiny `TrustText` island that applies the demo's browser-stored admin wording. The text is the
 * published admin override (real data mode, cached) or the locale-file default in the page language; `-` in the
 * admin editor hides the line, in which case nothing is rendered. Placements and their copy: spec 08 "Trust lines".
 *
 * - `brand` fills `{brand}` (the product line); without one the product line reads "Genuine part from a verified shop".
 * - `gstBill` adds "GST bill" only where the seller is GST-registered: never a blanket claim (CCPA, design check).
 */
export async function TrustLine({
  placement,
  brand,
  gstBill = false,
  as = 'p',
  className,
}: {
  placement: TrustPlacement;
  brand?: string | null;
  gstBill?: boolean;
  as?: 'p' | 'li' | 'span';
  className?: string;
}) {
  const locale = await getLocale();
  const [t, cities, published] = await Promise.all([
    getTranslations('trust'),
    getTranslations('cities'),
    publishedTrust(locale),
  ]);
  const key = trustKey(placement);
  const city = cities(site.defaultCity);
  const brandName = brand?.trim() ?? '';
  const fallback =
    placement === 'product' && brandName === ''
      ? t('productNoBrand')
      : t(placement, { city, brand: brandName });
  const text = trustLineText(published[key], fallback, { brand: brandName });
  if (text === null) return null;
  return (
    <TrustText
      k={key}
      locale={locale}
      fallback={text}
      brand={brandName}
      suffix={gstBill ? t('productGst') : null}
      as={as}
      className={className}
    />
  );
}
