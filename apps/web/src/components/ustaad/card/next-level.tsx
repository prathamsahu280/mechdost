'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import type { MyCard } from '@mechdost/shared/ustaad/dto/verification';
import { UstaadIcon } from '@/components/ustaad/shell/icons';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { helpedBand, nextLevelProgress } from '@/lib/ustaad/card';
import { btnBase, btnOutline, helpedNote, panel, progressBar, sectionH } from './styles';

/**
 * "Next level in plain numbers" (E7, design § 3.8): the next step's closest rule group, each row as a real
 * `<progress>` with the numbers in words ("17/25 · 8 more"). Rules the card has no number for show their text only.
 */
export function NextLevelProgress({ card, onExplain }: { card: MyCard; onExplain: () => void }) {
  const t = useTranslations('ustaad.card');
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN');
  const next = nextLevelProgress(card);
  const explain = (
    <button type="button" onClick={onExplain} className={`${btnBase} ${btnOutline} justify-self-start`}>
      {t('howCounted')}
    </button>
  );
  if (!next)
    return (
      <section aria-labelledby="ustaad-next" className={`${panel} grid gap-3`}>
        <h2 id="ustaad-next" className={sectionH}>
          {t('ladderTitle')}
        </h2>
        <p className="text-base text-ink">{card.current === 'master' ? t('topLevel') : t('verifyFirst')}</p>
        {explain}
      </section>
    );
  return (
    <section aria-labelledby="ustaad-next" className={`${panel} grid gap-4`}>
      <h2 id="ustaad-next" className={sectionH}>
        {t('nextLevel', { level: t(`level_${next.level}`) })}
      </h2>
      <ul className="grid gap-4">
        {next.rows.map((r) => {
          const label = t(`rule_${r.key}`, { n: r.need });
          if (r.have === null || r.left === null)
            return (
              <li key={r.key} className="text-base text-ink">
                {t('ruleTextOnly', { rule: label })}
              </li>
            );
          const id = `ustaad-next-${r.key}`;
          return (
            <li key={r.key} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <label htmlFor={id} className="text-base font-bold text-ink">
                  {label}
                </label>
                <span className="text-sm tabular-nums text-ink">
                  {nf.format(Math.min(r.have, r.need))}/{nf.format(r.need)}
                  {r.left > 0 ? (
                    <b className="ml-2 text-ink">{t('more', { n: nf.format(r.left) })}</b>
                  ) : (
                    <span className="ml-2 text-success">
                      <UstaadIcon name="check" size={16} />
                    </span>
                  )}
                </span>
              </div>
              <progress id={id} value={Math.min(r.have, r.need)} max={r.need} className={progressBar}>
                {nf.format(r.have)}/{nf.format(r.need)}
              </progress>
            </li>
          );
        })}
      </ul>
      {next.staffReview ? <p className="text-sm text-muted">{t('teamCheck')}</p> : null}
      {explain}
    </section>
  );
}

/** Founder Q-UI-2 (2026-11-27): "You helped N mechanics this week". Hidden at zero; no streaks, no leagues. */
export function HelpedNote({ n }: { n: number }) {
  const t = useTranslations('ustaad.card');
  useEffect(() => {
    const band = helpedBand(n);
    if (band !== '0') track('ustaad_helped_note_seen', { band });
  }, [n]);
  if (n <= 0) return null;
  return (
    <section aria-label={t('helpedWeek', { n })} className={helpedNote}>
      <p className="flex items-center gap-2 font-heading text-lg font-extrabold">
        <UstaadIcon name="users" size={20} />
        {t('helpedWeek', { n })}
      </p>
      <p className="mt-0.5 text-sm">{t('helpedLead')}</p>
    </section>
  );
}

/** Founder Q-UI-1: Learn and Discover leave the dock, so Me links to them. */
export function MeShortcuts() {
  const t = useTranslations('ustaad.card');
  const locale = useLocale();
  const items = [
    { to: 'learn', href: '/ustaad/learn', icon: 'learn', label: t('shortcutLearn') },
    { to: 'discover', href: '/ustaad/discover', icon: 'discover', label: t('shortcutDiscover') },
  ] as const;
  return (
    <nav aria-labelledby="ustaad-me-shortcuts" className="grid gap-3">
      <h2 id="ustaad-me-shortcuts" className={sectionH}>
        {t('shortcutsH')}
      </h2>
      <ul className="grid gap-3 min-[520px]:grid-cols-2">
        {items.map((it) => (
          <li key={it.to}>
            <Link
              href={localePath(it.href, locale)}
              onClick={() => {
                track('ustaad_me_shortcut', { to: it.to });
              }}
              className={`${btnBase} ${btnOutline} w-full justify-start`}
            >
              <UstaadIcon name={it.icon} size={22} />
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
