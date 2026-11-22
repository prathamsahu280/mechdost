import type { PublicWorkshop } from '@mechdost/shared/service-api';
import type { ProductView } from './catalogue/view';
import { productPhotoLoader } from './product-photo-loader';
import { absoluteUrl, siteOrigin } from './seo';
import { site } from './site';
import { productFullName } from '@/lib/product-name';

/**
 * schema.org JSON-LD for search results (skill nextjs-seo; decisions 2026-11-17 "SEO"). Pure builders, rendered by
 * `<JsonLd>`. Rules:
 * - Only facts the page itself shows. Product offers and workshop ratings are built from real data only (data mode
 *   `api`): the demo build's prices and seed reviews are not real, and marking them up would be fake structured data.
 * - Money in the markup is rupees with two decimals, derived from integer paise (never floating maths).
 */

type Json = Record<string, unknown>;

const CONTEXT = 'https://schema.org';
/** Weekday numbers as `workshops.hours.days` stores them (0 = Sunday, IST). */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** 44_000 → "440.00"; a schema.org price is a plain decimal string in rupees. */
export function rupeesText(paise: number): string {
  const p = Math.trunc(paise);
  return `${String(Math.trunc(p / 100))}.${String(p % 100).padStart(2, '0')}`;
}

/** The operator: name, logo, support line and registered office (the same facts as the footer). */
export function organizationLd(): Json {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': `${siteOrigin()}/#organization`,
    name: 'MechDost',
    legalName: site.company,
    url: absoluteUrl('/'),
    logo: absoluteUrl('/brand/icons/icon-512.png'),
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: site.supportPhoneE164,
      contactType: 'customer support',
      areaServed: 'IN',
      availableLanguage: ['English', 'Hindi'],
    },
    // Coverage is the state, not the registered-office city (user 2026-11-22).
    areaServed: { '@type': 'AdministrativeArea', name: 'Chhattisgarh' },
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'C-605 Salasar Greens, Sarona, Tatibandh',
      addressLocality: 'Raipur',
      addressRegion: 'Chhattisgarh',
      postalCode: '492099',
      addressCountry: 'IN',
    },
  };
}

/** The site name Google shows above results ("MechDost"), per language. */
export function websiteLd(locale: string): Json {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': `${siteOrigin()}/#website`,
    name: 'MechDost',
    url: absoluteUrl(locale === 'hi' ? '/hi' : '/'),
    inLanguage: locale === 'hi' ? 'hi-IN' : 'en-IN',
    publisher: { '@id': `${siteOrigin()}/#organization` },
  };
}

/** Breadcrumb trail; `path` values are locale paths (`/hi/shop`), the last item is the page itself. */
export function breadcrumbLd(items: readonly { name: string; path: string }[]): Json {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/**
 * A product with its offer (real data only). `null` when Google would reject the item: a product needs an offer or a
 * rating, and one sold "on request" has neither a price nor stock to mark up.
 */
export function productLd(product: ProductView, path: string, categoryName: string | null): Json | null {
  const offer =
    product.price && product.availability !== 'on_request'
      ? {
          '@type': 'Offer',
          url: absoluteUrl(path),
          price: rupeesText(product.price.pricePaise),
          priceCurrency: 'INR',
          availability:
            product.availability === 'low_stock'
              ? 'https://schema.org/LimitedAvailability'
              : 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/NewCondition',
          // MechDost is the seller of record to the customer (user 2026-11-22: no shop shown to customers).
          seller: { '@type': 'Organization', name: 'MechDost' },
        }
      : null;
  const rating =
    product.rating && product.rating.count > 0
      ? {
          '@type': 'AggregateRating',
          ratingValue: product.rating.avg.toFixed(1),
          reviewCount: product.rating.count,
          bestRating: 5,
          worstRating: 1,
        }
      : null;
  if (!offer && !rating) return null;
  const photos = product.photos ?? (product.photo ? [product.photo] : []);
  const gtin = product.partNumbers.find((n) => /^gtin|^ean|^upc/i.test(n.kind))?.value;
  const mpn = product.partNumbers.find((n) => /^mpn|^oem|^part/i.test(n.kind))?.value;
  return {
    '@context': CONTEXT,
    '@type': 'Product',
    name: productFullName(product.brand, product.name),
    brand: { '@type': 'Brand', name: product.brand },
    ...(product.sku ? { sku: product.sku } : {}),
    ...(gtin ? { gtin } : {}),
    ...(mpn ? { mpn } : {}),
    ...(categoryName ? { category: categoryName } : {}),
    ...(product.description || product.spec ? { description: product.description ?? product.spec } : {}),
    ...(photos.length > 0
      ? { image: photos.map((p) => productPhotoLoader({ src: p.path, width: 1600 })) }
      : {}),
    ...(offer ? { offers: offer } : {}),
    ...(rating ? { aggregateRating: rating } : {}),
  };
}

/** A verified workshop as a local business (real data only). Contact numbers stay private (masked relay, spec 06). */
export function workshopLd(w: PublicWorkshop, path: string): Json {
  const prices = w.services.flatMap((s) => [s.lowPaise, s.highPaise]).filter((p) => p > 0);
  const priceRange =
    prices.length > 0
      ? `₹${String(Math.round(Math.min(...prices) / 100))}–₹${String(Math.round(Math.max(...prices) / 100))}`
      : null;
  return {
    '@context': CONTEXT,
    '@type': 'AutoRepair',
    '@id': `${absoluteUrl(path)}#workshop`,
    name: w.name,
    url: absoluteUrl(path),
    address: {
      '@type': 'PostalAddress',
      streetAddress: w.address,
      postalCode: w.pincode,
      addressCountry: 'IN',
    },
    geo: { '@type': 'GeoCoordinates', latitude: w.lat, longitude: w.lng },
    ...(w.hours.days.length > 0
      ? {
          openingHoursSpecification: [
            {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: w.hours.days.flatMap((d) => (DAY_NAMES[d] ? [DAY_NAMES[d]] : [])),
              opens: w.hours.open,
              closes: w.hours.close,
            },
          ],
        }
      : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(w.ratingAvg !== null && w.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: w.ratingAvg.toFixed(1),
            reviewCount: w.ratingCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(w.services.length > 0
      ? {
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            itemListElement: w.services.map((s) => ({
              '@type': 'Offer',
              itemOffered: { '@type': 'Service', name: s.title },
              priceSpecification: {
                '@type': 'PriceSpecification',
                priceCurrency: 'INR',
                minPrice: rupeesText(s.lowPaise),
                maxPrice: rupeesText(s.highPaise),
              },
            })),
          },
        }
      : {}),
  };
}

/** JSON for a `<script type="application/ld+json">`: `<` escaped so text can never close the script tag. */
export function jsonLdText(data: Json | readonly Json[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
