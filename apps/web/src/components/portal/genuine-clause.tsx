'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { withGenuineClause } from '@mechdost/shared/seller-clause';
import { track } from '@/lib/analytics';
import { portalQuiet } from './portal-styles';

/**
 * Adds the "Genuine parts only" clause (draft, pending legal review; `@mechdost/shared/seller-clause`) to the
 * agreement editor's English and Hindi texts, so it is part of the version a shop accepts. Pressing it twice never
 * duplicates it. The editor's textareas are uncontrolled (`#agreement-textEn`, `#agreement-textHi`); the change is
 * dispatched as an input event so a controlled wrapper would also notice.
 */
export function GenuineClauseButton() {
  const t = useTranslations('trust');
  const [added, setAdded] = useState(false);

  function add() {
    for (const [id, locale] of [
      ['agreement-textEn', 'en'],
      ['agreement-textHi', 'hi'],
    ] as const) {
      const box = document.getElementById(id);
      if (!(box instanceof HTMLTextAreaElement)) continue;
      box.value = withGenuineClause(box.value, locale);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setAdded(true);
    track('click', { id: 'admin_agreement_clause_added', path: window.location.pathname });
  }

  return (
    <div className="rounded-lg bg-private-bg p-3 text-sm text-private">
      <p>{t('clauseHelp')}</p>
      <button type="button" onClick={add} className={`${portalQuiet} mt-2`}>
        {t('clauseAdd')}
      </button>
      <p role="status" className="mt-1 text-xs font-bold">
        {added ? t('clauseAdded') : ''}
      </p>
    </div>
  );
}
