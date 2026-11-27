'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef } from 'react';
import type { MyCard } from '@mechdost/shared/ustaad/dto/verification';
import { UstaadIcon } from '@/components/ustaad/shell/icons';
import { ladderState, ruleParts } from '@/lib/ustaad/card';
import { btnBase, btnOutline, sheet } from './styles';

/** The level ladder with "You are here" and the qualified-follower count (moved into the sheet, design § 3.8). */
function Ladder({ card }: { card: MyCard }) {
  const t = useTranslations('ustaad.card');
  return (
    <section aria-labelledby="ustaad-ladder" className="grid gap-3">
      <h3 id="ustaad-ladder" className="font-heading text-lg font-extrabold text-ink">
        {t('ladderTitle')}
      </h3>
      <p className="text-sm text-muted">{t('ladderLead')}</p>
      <ol className="grid gap-3">
        {card.ladder.map((step) => {
          const state = ladderState(card.current, step.level);
          return (
            <li
              key={step.level}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`rounded-card border-2 p-4 ${
                state === 'current' ? 'border-accent bg-accent-soft' : 'border-line-card bg-surface'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className="text-lg">
                  {state === 'done' ? '✓' : state === 'current' ? '●' : '○'}
                </span>
                <span className="sr-only">{t(`state_${state}`)}: </span>
                <h4 className="font-heading text-base font-extrabold text-ink">
                  {step.name || t(`level_${step.level}`)}
                </h4>
                {state === 'current' ? (
                  <span className="rounded-full bg-accent-button px-2.5 py-0.5 text-xs font-bold text-white">
                    {t('youAreHere')}
                  </span>
                ) : null}
              </div>
              <ul className="mt-2 grid gap-1 text-sm text-ink">
                {step.groups.map((g, n) => (
                  <li key={n}>
                    {n > 0 ? <b className="mr-1">{t('or')}</b> : null}
                    {ruleParts(g)
                      .map(([k, v]) => t(`rule_${k}`, { n: v }))
                      .join(' + ')}
                  </li>
                ))}
              </ul>
              {step.staffReview ? <p className="mt-1 text-sm text-muted">{t('teamCheck')}</p> : null}
              {step.perk ? (
                <p className="mt-1 text-sm font-bold text-ink">{t('perk', { perk: step.perk })}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-ink">
        <b>{t('qualified', { n: card.qualifiedFollowers })}</b> {t('qualifiedHelp')}
      </p>
    </section>
  );
}

/**
 * The level and Izzat explainer (design § 3.8 "level sheet"): one sheet, closes with the Close button, Escape or the
 * backdrop, and focus goes back to the control that opened it (memory "no-reload-feel"). Native `<dialog>` so the
 * page behind is inert while it is open.
 */
export function LevelSheet({ card, open, onClose }: { card: MyCard; open: boolean; onClose: () => void }) {
  const t = useTranslations('ustaad.card');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className={sheet}
    >
      <div className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-heading text-xl font-extrabold text-ink">
            {t('levelsSheetTitle')}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className={`${btnBase} ${btnOutline} min-h-11 px-3`}
          >
            <UstaadIcon name="close" size={18} />
            {t('close')}
          </button>
        </div>
        <section aria-label={t('yourStatus')} className="grid gap-1 rounded-card bg-pill p-3">
          <p className="text-sm font-bold text-ink">{t('yourStatus')}</p>
          <p className="text-base text-ink">
            {t(`level_${card.current}`)} · {t('stat_izzat')} {card.izzat} · {t('stat_best')}{' '}
            {card.bestAnswers}
          </p>
        </section>
        <p className="text-sm text-ink">{t('izzatNote')}</p>
        <Ladder card={card} />
      </div>
    </dialog>
  );
}
