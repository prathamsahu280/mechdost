'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { scrubFreeText } from '@mechdost/shared/privacy';
import { track } from '@/lib/analytics';
import { stripLocale, type SiteLocale } from '@/lib/locale-path';

/**
 * One tiny client island for the whole site (hard rule 9 without turning server components into client ones):
 * page views on navigation, `data-track` clicks and `data-track-search` form submits via event delegation.
 */
export function AnalyticsListener({ locale }: { locale: SiteLocale }) {
  const pathname = usePathname();

  useEffect(() => {
    // Path without the locale prefix, so English and Hindi views of a page aggregate together.
    track('page_view', { path: stripLocale(pathname), locale });
  }, [pathname, locale]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-track]') : null;
      const id = el?.dataset.track;
      if (id) track('click', { id, path: window.location.pathname });
    }
    function onSubmit(e: SubmitEvent) {
      const form = e.target instanceof HTMLFormElement ? e.target : null;
      const source = form?.dataset.trackSearch;
      if (!form || !source) return;
      const query = new FormData(form).get('q');
      if (typeof query === 'string') track('search', { query: scrubFreeText(query), source });
    }
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('submit', onSubmit, { capture: true });
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('submit', onSubmit, { capture: true });
    };
  }, []);

  return null;
}
