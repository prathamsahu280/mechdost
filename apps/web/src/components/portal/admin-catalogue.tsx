'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { AUTH_MODE } from '@/lib/auth/mode';
import { portalCard } from './portal-styles';

/** The editor (API calls, schemas, price board) loads only when the real backend is in use. */
const CatalogueEditor = dynamic(() => import('./admin-catalogue-editor').then((m) => m.CatalogueEditor), {
  ssr: false,
});

/** The search vocabulary editor (spec 02 "Smart search"): another lazy chunk, real backend only. */
const SearchSynonyms = dynamic(() => import('./admin-search-synonyms').then((m) => m.AdminSearchSynonyms), {
  ssr: false,
});

/**
 * Admin → Catalogue (plan 2026-11-13 admin catalogue + PIN prices, Task 5; spec 08): product texts in English and
 * Hindi, vehicle fit, pack sizes and customer prices per city and PIN. It edits the real catalogue through the API,
 * so the browser demo shows a notice and makes no API calls.
 */
export function AdminCatalogue() {
  const t = useTranslations('portal');
  return (
    <section aria-labelledby="catalogue-title" className="space-y-4">
      <div>
        <h2 id="catalogue-title" className="font-heading text-xl font-extrabold text-ink">
          {t('cat_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('cat_intro')}</p>
      </div>
      {AUTH_MODE === 'firebase' ? (
        <>
          <CatalogueEditor />
          <SearchSynonyms />
        </>
      ) : (
        <p className={`${portalCard} text-sm font-bold text-ink`}>{t('cat_demoNotice')}</p>
      )}
    </section>
  );
}
