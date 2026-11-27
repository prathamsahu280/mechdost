'use client';

import { useTranslations } from 'next-intl';
import type { PostView } from '@mechdost/shared/ustaad/dto/feed';

/**
 * Repair-shaped post bodies (Ustaad UI upgrade E8, spec 23 § 6.3 `template` + `fix_*`): a fix log is a `<dl>` of
 * Problem / Cause / What I did rows, each with a 3 px accent rule on its left (structure = information); a tip gets a
 * tinted panel with a "Tip" tag. Tokens only, so the visual-language pass changes colours in one place.
 */
export const fixRowClass = 'border-l-[3px] border-accent pl-3';
export const tipPanelClass = 'mx-4 grid gap-2 rounded-2xl bg-surface-alt p-4';

export function FixLogBody({ fix }: { fix: NonNullable<PostView['fix']> }) {
  const t = useTranslations('ustaad.feed');
  const rows = [
    ['fixSymptom', fix.symptom],
    ['fixCause', fix.cause],
    ['fixFix', fix.fix],
  ] as const;
  return (
    <dl className="mx-4 grid gap-3 text-[15px]">
      {rows.map(([k, v]) =>
        v ? (
          <div key={k} className={fixRowClass}>
            <dt className="text-[13px] font-bold text-muted">{t(k)}</dt>
            <dd data-user-content dir="auto" className="break-words text-ink">
              {v}
            </dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

export function TipTag() {
  const t = useTranslations('ustaad.feed');
  return (
    <p className="inline-flex w-fit items-center rounded-pill bg-accent-soft px-3 py-1 text-[13px] font-bold text-accent-soft-text">
      {t('tipTag')}
    </p>
  );
}
