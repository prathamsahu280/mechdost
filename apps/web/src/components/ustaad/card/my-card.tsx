'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { MyCard } from '@mechdost/shared/ustaad/dto/verification';
import { UstaadIcon } from '@/components/ustaad/shell/icons';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { ladderState, ruleParts, whatsappShareHref } from '@/lib/ustaad/card';

const btn =
  'press inline-flex min-h-12 items-center justify-center gap-2 rounded-button px-5 text-base font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** The ID card (pehchaan): the one bold thing on the screen. Navy like a workshop pass, accent level chip. */
function IdCard({ card }: { card: MyCard }) {
  const t = useTranslations('ustaad.card');
  const locale = useLocale();
  const m = card.member;
  const verified = m.verificationState === 'verified';
  const pending = m.level === 'ustaad_pending' || m.level === 'apprentice';
  const joinUrl =
    typeof window === 'undefined' ? '' : `${window.location.origin}${localePath('/ustaad/join', locale)}`;
  return (
    <article
      aria-label={t('cardLabel')}
      className="overflow-hidden rounded-[26px] bg-navy text-white shadow-float"
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
          <div className="min-w-0 grid gap-1">
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
          <span
            className={`inline-flex min-h-9 items-center rounded-full px-3 text-sm font-bold ${
              pending ? 'border border-white/50 text-white' : 'bg-white text-navy'
            }`}
          >
            {t(`level_${m.level}`)}
          </span>
          <span
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold ${
              verified ? 'bg-success-bg text-success' : 'bg-white/10 text-white/85'
            }`}
          >
            {verified ? '✓ ' : ''}
            {verified ? t('verified') : t('notVerified')}
          </span>
          {m.official ? (
            <span className="inline-flex min-h-9 items-center rounded-full bg-accent-button px-3 text-sm font-bold">
              {t('official')}
            </span>
          ) : null}
        </div>
        {m.specialities.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t('title')}>
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
            track('ustaad_post_shared', { channel: 'whatsapp' });
          }}
          className={`${btn} bg-white text-navy`}
        >
          {t('shareWhatsApp')}
        </a>
      </div>
    </article>
  );
}

function SpecName({ code }: { code: string }) {
  const t = useTranslations('ustaad.join');
  return <>{t(`spec_${code}` as 'spec_two_wheeler')}</>;
}

function Ladder({ card }: { card: MyCard }) {
  const t = useTranslations('ustaad.card');
  return (
    <section aria-labelledby="ustaad-ladder" className="grid gap-3">
      <h2 id="ustaad-ladder" className="font-heading text-xl font-extrabold text-ink">
        {t('ladderTitle')}
      </h2>
      <p className="text-sm text-ink-muted">{t('ladderLead')}</p>
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
                <h3 className="font-heading text-lg font-extrabold text-ink">
                  {step.name || t(`level_${step.level}`)}
                </h3>
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
              {step.staffReview ? <p className="mt-1 text-sm text-ink-muted">{t('staffCheck')}</p> : null}
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
 * Me (spec 23 § 5 `/ustaad/me`; plan task B3): the ID card, stats with Izzat (never money), the level ladder with
 * "You are here" and the qualified-follower count, badges, "Get verified" and "Kaise use karein" (replays the guide).
 * Not built yet: QR on the card, profile edit, settings and my choices.
 */
export function MyCardScreen() {
  const t = useTranslations('ustaad.card');
  const locale = useLocale();
  const [card, setCard] = useState<MyCard | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const api = await import('@/lib/ustaad/identity-api');
    const res = await api.fetchMyCard(locale);
    if (res.ok) setCard(res.data);
    else setFailed(true);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed)
    return (
      <div role="alert" className="grid gap-3">
        <p className="text-base text-ink">{t('error')}</p>
        <button
          type="button"
          onClick={() => {
            void load();
          }}
          className={`${btn} border border-line-card text-ink`}
        >
          {t('retry')}
        </button>
      </div>
    );
  if (!card)
    return (
      <p className="text-base text-ink-muted" aria-live="polite">
        {t('loading')}
      </p>
    );

  const nf = new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN');
  const stats: [string, string][] = [
    ['stat_izzat', nf.format(card.izzat)],
    ['stat_followers', card.followers],
    ['stat_best', nf.format(card.bestAnswers)],
    ['stat_answers', nf.format(card.answers)],
  ];
  const verified = card.member.verificationState === 'verified';
  return (
    <div className="grid gap-6">
      <IdCard card={card} />
      <a
        href={localePath('/partners/status', locale)}
        className={`${btn} ${verified ? 'border border-line-card text-ink' : 'bg-accent-button text-white hover:bg-accent-button-hover'}`}
      >
        {verified ? t('seeProgress') : t('getVerified')}
      </a>
      <section className="grid gap-2">
        <dl className="grid grid-cols-2 gap-3 min-[520px]:grid-cols-4">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-card border border-line-card bg-surface p-3 text-center">
              <dt className="text-sm text-ink-muted">{t(k as 'stat_izzat')}</dt>
              <dd className="font-heading text-2xl font-extrabold tabular-nums text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-ink-muted">{t('izzatNote')}</p>
      </section>
      <Ladder card={card} />
      <section aria-labelledby="ustaad-badges" className="grid gap-3">
        <h2 id="ustaad-badges" className="font-heading text-xl font-extrabold text-ink">
          {t('badgesTitle')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 min-[520px]:grid-cols-3">
          {card.badges.map((b) => (
            <li
              key={b.code}
              className={`rounded-card border p-3 ${b.held ? 'border-accent bg-accent-soft' : 'border-line-card bg-surface opacity-70'}`}
            >
              <p className="font-bold text-ink">{b.name}</p>
              <p className="text-sm text-ink-muted">{b.rule}</p>
              <p className="mt-1 text-xs font-bold text-ink">{b.held ? t('badgeHeld') : t('badgeLocked')}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-2 rounded-card border border-line-card bg-surface p-4">
        <p className="text-base text-ink">{t('helpBody')}</p>
        <button
          type="button"
          onClick={() => {
            track('ustaad_help_replayed', {});
            void import('@/lib/ustaad/identity-api')
              .then((api) => api.resetOnboarding(locale))
              .finally(() => {
                window.location.assign(localePath('/ustaad/welcome', locale));
              });
          }}
          className={`${btn} border border-line-card text-ink`}
        >
          {t('help')}
        </button>
      </section>
    </div>
  );
}
