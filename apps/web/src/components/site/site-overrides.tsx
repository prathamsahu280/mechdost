'use client';

import type { ReactNode } from 'react';
import { trustLineText, type TrustKey } from '@mechdost/shared/content';
import type { CategoryKey } from '@/demo/catalogue';
import { usePartnerStatus, type PartnerKind } from '@/demo/partner-status';
import {
  useCategoryEmoji,
  useContentOverride,
  useSiteSettings,
  type ContentKey,
  type SiteSettings,
} from '@/demo/site-config';

/**
 * Tiny client islands that let admin customisation (demo: stored in this browser) show on Server Component
 * pages. Each renders the server's default first (identical HTML, no hydration mismatch), then the admin's value
 * if one exists. They receive translated text as props, so no i18n runtime ships to the browser. Phase 1 serves
 * the same values from the content API with ISR, and these become plain text again.
 */
export function SiteText({ k, locale, fallback }: { k: ContentKey; locale: string; fallback: string }) {
  return <>{useContentOverride(k, locale) ?? fallback}</>;
}

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

/** A whole-number setting inside translated copy, e.g. `t.rich('…<min>15</min>…', { min: … })`. */
export function SettingValue({
  setting,
  fallback,
}: {
  setting: Extract<keyof SiteSettings, 'acceptMinutes' | 'bulkMinUnits'>;
  fallback: ReactNode;
}) {
  const value = useSiteSettings()[setting];
  return <>{Number.isFinite(value) ? value : fallback}</>;
}

export function CategoryEmoji({ k, fallback }: { k: CategoryKey; fallback: string }) {
  return <>{useCategoryEmoji()(k, fallback)}</>;
}

/** Hides a server-rendered partner card once the admin suspends that partner (demo: browser-stored status). */
export function HideIfSuspended({
  kind,
  slug,
  children,
}: {
  kind: PartnerKind;
  slug: string;
  children: ReactNode;
}) {
  return usePartnerStatus(kind, slug).status === 'suspended' ? null : <>{children}</>;
}
