'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MyCard } from '@mechdost/shared/ustaad/dto/verification';
import { UstaadIcon } from '@/components/ustaad/shell/icons';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { whatsappShareHref } from '@/lib/ustaad/card';
import { LevelSheet } from './level-sheet';
import { HelpedNote, MeShortcuts, NextLevelProgress } from './next-level';
import { btnBase, btnFillPrimary, btnOnNavy, btnOutline, panel, sectionH } from './styles';

/**
 * The ID card (pehchaan): the one bold thing on the screen (design § 3.8). Navy like a workshop pass; the level chip
 * is a button that opens the level sheet; ONE primary action (send my card on WhatsApp).
 */
function IdCard({ card, onLevel }: { card: MyCard; onLevel: (el: HTMLButtonElement) => void }) {
  const t = useTranslations('ustaad.card');
  const locale = useLocale();
  const m = card.member;
  const verified = m.verificationState === 'verified';
  const pending = m.level === 'ustaad_pending' || m.level === 'apprentice';
  const level = t(`level_${m.level}`);
  const joinUrl =
    typeof window === 'undefined' ? '' : `${window.location.origin}${localePath('/ustaad/join', locale)}`;
  return (
    <section
      aria-label={t('cardLabel')}
      className="overflow-hidden rounded-card bg-navy text-white shadow-float"
    >
      <div className="flex items-center justify-between gap-3 bg-accent-button px-5 py-2.5 text-sm font-bold">
        <span className="inline-flex items-center gap-2">
          <UstaadIcon name="card" size={18} />
          {t('cardLabel')}
        </span>
        <span data-user-content>@{m.handle}</span>
      </div>
      <div className="grid gap-4 p-5">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-white/10 font-heading text-2xl font-extrabold"
          >
            {(m.displayName.trim()[0] ?? '?').toUpperCase()}
          </span>
          <div className="grid min-w-0 gap-1">
            <h2 className="font-heading text-2xl font-extrabold leading-tight">
              <span data-user-content>{m.displayName}</span>
            </h2>
            <p className="text-sm text-white/85">
              {m.showGarage && m.garageName ? (
                <span data-user-content>{m.garageName}</span>
              ) : (
                t('garageHidden')
              )}
              {', '}
              <span data-user-content>{locale === 'hi' && m.areaLabelHi ? m.areaLabelHi : m.areaLabel}</span>
            </p>
            <p className="text-sm text-white/85">{t('years', { n: m.yearsClaimed })}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              onLevel(e.currentTarget);
            }}
            aria-label={t('openLevelSheet', { level })}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white ${
              pending ? 'border border-dashed border-white/60 text-white' : 'bg-white text-navy'
            }`}
          >
            {level}
            <UstaadIcon name="chevronRight" size={16} />
          </button>
          <span
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold ${
              verified ? 'bg-success-bg text-success' : 'bg-white/10 text-white/85'
            }`}
          >
            {verified ? <span aria-hidden="true">✓ </span> : null}
            {verified ? t('verified') : t('notVerified')}
          </span>
          {m.official ? (
            <span className="inline-flex min-h-9 items-center rounded-full bg-accent-button px-3 text-sm font-bold">
              {t('official')}
            </span>
          ) : null}
        </div>
        {m.specialities.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t('specialities')}>
            {m.specialities.map((s) => (
              <li key={s} className="rounded-full bg-white/10 px-3 py-1 text-sm">
                {/* Speciality names live with the join copy (`ustaad.join.spec_*`). */}
                <SpecName code={s} />
              </li>
            ))}
          </ul>
        ) : null}
        <a
          href={whatsappShareHref(t('shareText'), joinUrl)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            track('ustaad_card_shared', { channel: 'whatsapp' });
          }}
          className={`${btnBase} ${btnOnNavy}`}
        >
          <UstaadIcon name="whatsapp" size={20} />
          {t('sendCard')}
          <span className="sr-only"> {t('opensNewTab')}</span>
        </a>
      </div>
    </section>
  );
}

function SpecName({ code }: { code: string }) {
  const t = useTranslations('ustaad.join');
  return <>{t(`spec_${code}` as 'spec_two_wheeler')}</>;
}

/** One compact stat row (design § 3.8): every count kept, followers visible (ruling), Izzat never money. */
function StatRow({ card }: { card: MyCard }) {
  const t = useTranslations('ustaad.card');
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN');
  const stats: [string, string][] = [
    ['stat_izzat', nf.format(card.izzat)],
    ['stat_followers', card.followers],
    ['stat_answers', nf.format(card.answers)],
    ['stat_best', nf.format(card.bestAnswers)],
  ];
  return (
    <section className="grid gap-2">
      <dl className="grid grid-cols-4 divide-x divide-line-card rounded-card border border-line-card bg-surface py-3">
        {stats.map(([k, v]) => (
          <div key={k} className="grid min-w-0 gap-0.5 px-1 text-center">
            <dt className="text-xs leading-snug text-muted">{t(k as 'stat_izzat')}</dt>
            <dd className="font-heading text-xl font-extrabold tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">{t('izzatNote')}</p>
    </section>
  );
}

/** Badge shelf: held badges in colour, not-yet badges outlined with their rule (never greyed to invisibility). */
function BadgeShelf({ card }: { card: MyCard }) {
  const t = useTranslations('ustaad.card');
  return (
    <section aria-labelledby="ustaad-badges" className="grid gap-3">
      <h2 id="ustaad-badges" className={sectionH}>
        {t('badgesTitle')}
      </h2>
      <ul className="grid grid-cols-2 gap-3 min-[520px]:grid-cols-3">
        {card.badges.map((b) => (
          <li
            key={b.code}
            className={`rounded-card border p-3 ${b.held ? 'border-accent bg-accent-soft' : 'border-dashed border-input-border bg-surface'}`}
          >
            <p className="font-bold text-ink">{b.name}</p>
            <p className="text-sm text-muted">{b.rule}</p>
            <p className="mt-1 text-xs font-bold text-ink">{b.held ? t('badgeHeld') : t('badgeLocked')}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Me (spec 23 § 5 `/ustaad/me`; UI upgrade U4, design § 3.8): the ID card first, verification progress, the next
 * level in plain numbers (E7) with the level and Izzat sheet, the weekly "you helped N mechanics" note (Q-UI-2), one
 * compact stat row, badges, Learn/Discover shortcuts (Q-UI-1) and the guide replay.
 */
export function MyCardScreen() {
  const t = useTranslations('ustaad.card');
  const locale = useLocale();
  const router = useRouter();
  const [card, setCard] = useState<MyCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const retried = useRef(false);

  const load = useCallback(async () => {
    setFailed(false);
    const api = await import('@/lib/ustaad/identity-api');
    const res = await api.fetchMyCard(locale);
    if (res.ok) setCard(res.data);
    else setFailed(true);
  }, [locale]);

  // After Retry the button goes away: put focus on the screen's top so keyboard users keep their place.
  useEffect(() => {
    if (retried.current && (card || failed)) top.current?.focus();
  }, [card, failed]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed)
    return (
      <div
        ref={top}
        tabIndex={-1}
        role="alert"
        className="grid gap-3 outline-none focus-visible:ring-2 focus-visible:ring-accent-button"
      >
        <p className="text-base text-ink">{t('error')}</p>
        <button
          type="button"
          onClick={() => {
            retried.current = true;
            void load();
          }}
          className={`${btnBase} ${btnOutline}`}
        >
          {t('retry')}
        </button>
      </div>
    );
  if (!card)
    return (
      <p role="status" className="text-base text-muted">
        {t('loading')}
      </p>
    );

  const openSheet = (el: HTMLElement, own: boolean) => {
    opener.current = el;
    setSheetOpen(true);
    track('ustaad_level_sheet_opened', { level: card.current, own });
  };
  const verified = card.member.verificationState === 'verified';
  return (
    <div
      ref={top}
      tabIndex={-1}
      className="grid gap-6 outline-none focus-visible:ring-2 focus-visible:ring-accent-button"
    >
      <IdCard
        card={card}
        onLevel={(el) => {
          openSheet(el, true);
        }}
      />
      <Link
        href={localePath('/partners/status', locale)}
        className={`${btnBase} ${verified ? btnOutline : btnFillPrimary}`}
      >
        {verified ? t('seeProgress') : t('getVerified')}
      </Link>
      <HelpedNote n={card.helpedThisWeek} />
      <NextLevelProgress
        card={card}
        onExplain={() => {
          if (document.activeElement instanceof HTMLElement) openSheet(document.activeElement, true);
        }}
      />
      <StatRow card={card} />
      <BadgeShelf card={card} />
      <MeShortcuts />
      <section className={`${panel} grid gap-2`}>
        <p className="text-base text-ink">{t('helpBody')}</p>
        <button
          type="button"
          onClick={() => {
            track('ustaad_help_replayed', {});
            void import('@/lib/ustaad/identity-api')
              .then((api) => api.resetOnboarding(locale))
              .finally(() => {
                router.push(localePath('/ustaad/welcome', locale));
              });
          }}
          className={`${btnBase} ${btnOutline}`}
        >
          {t('help')}
        </button>
      </section>
      <LevelSheet
        card={card}
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          opener.current?.focus();
        }}
      />
    </div>
  );
}
