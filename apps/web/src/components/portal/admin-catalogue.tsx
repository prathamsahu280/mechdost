'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { AUTH_MODE } from '@/lib/auth/mode';
import { adminCard } from './admin-ui';

/** The editor (API calls, schemas, price board) loads only when the real backend is in use. */
const CatalogueEditor = dynamic(() => import('./admin-catalogue-editor').then((m) => m.CatalogueEditor), {
  ssr: false,
});

/** The search vocabulary editor (spec 02 "Smart search"): another lazy chunk, real backend only. */
const SearchSynonyms = dynamic(() => import('./admin-search-synonyms').then((m) => m.AdminSearchSynonyms), {
  ssr: false,
});

/** The vehicle segment editor (design 2026-11-25): live through the API, in the demo against the browser store. */
const Segments = dynamic(() => import('./admin-segments').then((m) => m.AdminSegments), { ssr: false });

/**
 * Admin → Catalogue (plan 2026-11-13 admin catalogue + PIN prices, Task 5; spec 08): product texts in English and
 * Hindi, vehicle fit, pack sizes and customer prices per city and PIN. It edits the real catalogue through the API,
 * so the browser demo shows a notice and makes no API calls.
 */
export function AdminCatalogue() {
  const t = useTranslations('portal');
  return (
    <section aria-labelledby="admin-page-title" className="space-y-4">
      {AUTH_MODE === 'firebase' ? (
        <>
          <CatalogueEditor />
          <Segments />
          <SearchSynonyms />
        </>
      ) : (
        <>
          <p className={`${adminCard} text-sm font-bold text-ink`}>{t('cat_demoNotice')}</p>
          <Segments />
        </>
      )}
    </section>
  );
}
