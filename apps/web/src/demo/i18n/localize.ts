/**
 * Locale-aware views of the demo content data (hard rule 10). Every helper returns the same shape it receives,
 * so components localise once at the top (`const p = localizeProduct(product, locale)`) and render as before.
 * English returns the input unchanged; Hindi overlays `./hi.ts` and falls back to the English value only for a
 * field that has no translation (the unit test fails in that case, so it never ships).
 *
 * Works in Server Components (`getLocale()` / `useLocale()`) and client components (`useLocale()`).
 */
import type { DemoProduct } from '../catalogue';
import type { DemoShop } from '../shops';
import type { DemoService, DemoWorkshop } from '../workshops';
import { AREA_HI, DAY_HI, PRODUCT_HI, SERVICE_HI, SHOP_HI, WORKSHOP_HI } from './hi';

const isHi = (locale: string) => locale === 'hi';

export function localizeArea(area: string, locale: string): string {
  return isHi(locale) ? (AREA_HI[area] ?? area) : area;
}

/** "9:00 – 20:00 · Mon–Sat" → "9:00 – 20:00 · सोम–शनि". */
export function localizeHours(hours: string, locale: string): string {
  return isHi(locale) ? hours.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, (d) => DAY_HI[d] ?? d) : hours;
}

export function localizeProduct(product: DemoProduct, locale: string): DemoProduct {
  const hi = isHi(locale) ? PRODUCT_HI[product.slug] : undefined;
  if (!hi) return product;
  return {
    ...product,
    name: hi.name ?? product.name,
    spec: hi.spec,
    compatibility: hi.compatibility,
    highlights: [...hi.highlights],
  };
}

export function localizeService<S extends Pick<DemoService, 'key' | 'name'> & Partial<DemoService>>(
  service: S,
  locale: string,
): S {
  const hi = isHi(locale) ? SERVICE_HI[service.key] : undefined;
  if (!hi) return service;
  return {
    ...service,
    name: hi.name,
    ...(service.duration === undefined ? {} : { duration: hi.duration }),
    ...(service.included === undefined ? {} : { included: hi.included }),
  };
}

export function localizeWorkshop(workshop: DemoWorkshop, locale: string): DemoWorkshop {
  if (!isHi(locale)) return workshop;
  const hi = WORKSHOP_HI[workshop.slug];
  return {
    ...workshop,
    name: hi?.name ?? workshop.name,
    address: hi?.address ?? workshop.address,
    area: localizeArea(workshop.area, locale),
    hours: localizeHours(workshop.hours, locale),
    services: workshop.services.map((s) => localizeService(s, locale)),
  };
}

export function localizeShop(shop: DemoShop, locale: string): DemoShop {
  if (!isHi(locale)) return shop;
  return { ...shop, name: SHOP_HI[shop.slug] ?? shop.name, area: localizeArea(shop.area, locale) };
}

// Snapshots (orders, service requests, quotes) keep the English text they were created with — the record of
// what was sold. Display looks the current translation up by its stable id and falls back to the snapshot.

export function productNameFor(slug: string, snapshot: string, locale: string): string {
  return isHi(locale) ? (PRODUCT_HI[slug]?.name ?? snapshot) : snapshot;
}

export function workshopNameFor(slug: string, snapshot: string, locale: string): string {
  return isHi(locale) ? (WORKSHOP_HI[slug]?.name ?? snapshot) : snapshot;
}

export function serviceNameFor(key: string, snapshot: string, locale: string): string {
  return isHi(locale) ? (SERVICE_HI[key]?.name ?? snapshot) : snapshot;
}

export function shopNameFor(slug: string, snapshot: string, locale: string): string {
  return isHi(locale) ? (SHOP_HI[slug] ?? snapshot) : snapshot;
}
