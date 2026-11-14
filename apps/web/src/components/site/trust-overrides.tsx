'use client';

import { trustLineText, type TrustKey } from '@mechdost/shared/content';
import { useContentOverride, useSiteSettings } from '@/demo/site-config';

/*
 * Trust lines and the demo labour promise (design 2026-11-15), kept out of `site-overrides.tsx`: the header imports that
 * module on every page, and these parts are needed only where a trust line renders (JS budget, spec 16; CI 2026-11-15
 * measured +1.9 KB gz on every page while they lived there).
 */

/**
 * A trust line ("genuine parts", design 2026-11-15) with the admin's wording on top: the demo's browser-stored
 * override first, else `fallback` (the server's text: the locale-file default or the published override). The text
 * `-` hides the line in that language. `suffix` (e.g. "GST bill") is appended only when there is a line.
 */
export function TrustText({
  k,
  locale,
  fallback,
  brand,
  suffix,
  as: Tag = 'p',
  className,
}: {
  k: TrustKey;
  locale: string;
  fallback: string;
  brand?: string | null;
  suffix?: string | null;
  as?: 'p' | 'li' | 'span';
  className?: string;
}) {
  const text = trustLineText(useContentOverride(k, locale), fallback, { brand });
  if (text === null) return null;
  return <Tag className={className}>{suffix ? `${text} · ${suffix}` : text}</Tag>;
}

/** The labour promise in the demo build: the browser-stored demo setting (0 = off); `{days}` fills the template. */
export function DemoLabourPromise({
  template,
  as: Tag = 'li',
  className,
}: {
  template: string;
  as?: 'p' | 'li' | 'span';
  className?: string;
}) {
  const days = useSiteSettings().labourPromiseDays;
  if (!(days > 0)) return null;
  return <Tag className={className}>{template.replace('{days}', String(days))}</Tag>;
}
