'use client';

import type { ReactNode } from 'react';
import { useContentOverride, useSiteSettings, type ContentKey, type SiteSettings } from '@/demo/site-config';

/**
 * Tiny client islands that let admin customisation (demo: stored in this browser) show on Server Component
 * pages. Each renders the server's default first (identical HTML, no hydration mismatch), then the admin's value
 * if one exists. They receive translated text as props, so no i18n runtime ships to the browser. Phase 1 serves
 * the same values from the content API with ISR, and these become plain text again.
 */
export function SiteText({ k, locale, fallback }: { k: ContentKey; locale: string; fallback: string }) {
  return <>{useContentOverride(k, locale) ?? fallback}</>;
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
