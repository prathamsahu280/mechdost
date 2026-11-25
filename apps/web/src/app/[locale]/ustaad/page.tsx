import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { UstaadIcon, type UstaadIconName } from '@/components/ustaad/shell/icons';
import { UstaadGreeting } from '@/components/ustaad/shell/ustaad-gate';
import type { Locale } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams?: Promise<{ tab?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ustaad.home' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Shortcut tiles (spec 23 § 5 Home). Each opens its workstream's screen (B–E build them). */
type ShortcutKey = 'ask' | 'jobs' | 'dukaan' | 'learn' | 'network' | 'area' | 'saved' | 'pin' | 'card';
const SHORTCUTS: readonly { key: ShortcutKey; icon: UstaadIconName; path: string }[] = [
  { key: 'ask', icon: 'mic', path: '/ustaad/ask' },
  { key: 'jobs', icon: 'jobs', path: '/ustaad/jobs' },
  { key: 'dukaan', icon: 'dukaan', path: '/shop' },
  { key: 'learn', icon: 'learn', path: '/ustaad/learn' },
  { key: 'network', icon: 'network', path: '/ustaad/network' },
  { key: 'area', icon: 'area', path: '/ustaad/area' },
  { key: 'saved', icon: 'saved', path: '/ustaad/saved' },
  { key: 'pin', icon: 'pin', path: '/ustaad/pin' },
  { key: 'card', icon: 'card', path: '/ustaad/me' },
];

/**
 * Ustaad Home (spec 23 § 5; plan task A3): greeting, the one bold thing on the screen (ask an Ustaad by voice), today's
 * stories, big shortcut tiles and the feed. Workstream A ships the frame with its empty states (each with one next
 * action); B–E fill stories, questions and the feed. Server-rendered; the greeting is the only client island.
 */
export default async function UstaadHome({ params, searchParams }: Props) {
  const { locale } = await params;
  const following = (await searchParams)?.tab === 'following';
  const t = await getTranslations({ locale, namespace: 'ustaad.home' });
  const href = (path: string) => localePath(path, locale);
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
        <UstaadGreeting template={t('greeting', { name: '{name}' })} fallback={t('greetingStaff')} />
      </h1>

      <section
        aria-labelledby="ustaad-ask"
        className="rounded-[26px] bg-navy p-5 text-white shadow-float tab:p-6"
      >
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <h2 id="ustaad-ask" className="font-heading text-xl font-extrabold tab:text-2xl">
              {t('askTitle')}
            </h2>
            <p className="mt-1 text-[15px] leading-relaxed text-white/85">{t('askBody')}</p>
          </div>
          <Link
            href={href('/ustaad/ask/new')}
            aria-label={t('askCta')}
            data-track="ustaad_home_ask"
            className="press inline-flex size-[68px] shrink-0 items-center justify-center rounded-full bg-accent-button text-white ring-4 ring-white/15 hover:bg-accent-button-hover"
          >
            <UstaadIcon name="mic" size={30} />
          </Link>
        </div>
        <Link
          href={href('/ustaad/ask/new')}
          data-track="ustaad_home_ask_text"
          className="press mt-4 inline-flex min-h-12 items-center rounded-button bg-white px-5 text-[15px] font-bold text-navy"
        >
          {t('askCta')}
        </Link>
      </section>

      <section aria-labelledby="ustaad-stories">
        <h2 id="ustaad-stories" className="font-heading text-lg font-extrabold text-ink">
          {t('storiesTitle')}
        </h2>
        <ul className="mt-3 flex gap-4 overflow-x-auto pb-1">
          <li>
            <Link
              href={href('/ustaad/create?story=1')}
              data-track="ustaad_story_add"
              className="press flex w-[76px] flex-col items-center gap-1.5 text-center text-[13px] font-bold text-ink"
            >
              <span className="flex size-[64px] items-center justify-center rounded-full border-2 border-dashed border-accent bg-surface text-accent-soft-text">
                <UstaadIcon name="plus" size={26} />
              </span>
              {t('storyAdd')}
            </Link>
          </li>
          <li className="flex items-center text-sm text-muted">{t('storiesEmpty')}</li>
        </ul>
      </section>

      <section aria-labelledby="ustaad-shortcuts">
        <h2 id="ustaad-shortcuts" className="sr-only">
          {t('shortcutsTitle')}
        </h2>
        <ul className="grid grid-cols-3 gap-3">
          {SHORTCUTS.map((s) => (
            <li key={s.key}>
              <Link
                href={href(s.path)}
                data-track={`ustaad_shortcut_${s.key}`}
                className="press flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border border-line-card bg-surface px-2 py-3 text-center text-[13.5px] leading-tight font-bold text-ink shadow-card hover:border-accent"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text">
                  <UstaadIcon name={s.icon} />
                </span>
                {t(`sc_${s.key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="ustaad-questions"
        className="rounded-2xl border border-line-card bg-surface p-5 shadow-card"
      >
        <h2 id="ustaad-questions" className="font-heading text-lg font-extrabold text-ink">
          {t('questionsUstaad')}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{t('questionsEmpty')}</p>
      </section>

      <section aria-labelledby="ustaad-feed">
        <h2 id="ustaad-feed" className="font-heading text-lg font-extrabold text-ink">
          {t('feedTitle')}
        </h2>
        <nav aria-label={t('feedTitle')} className="mt-3">
          <ul className="inline-flex rounded-full bg-pill p-1">
            <li>
              <Link
                href={href('/ustaad')}
                aria-current={following ? undefined : 'page'}
                data-track="ustaad_feed_for_you"
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${following ? 'text-muted hover:text-ink' : 'bg-surface text-ink shadow-card'}`}
              >
                {t('feed_for_you')}
              </Link>
            </li>
            <li>
              <Link
                href={href('/ustaad?tab=following')}
                aria-current={following ? 'page' : undefined}
                data-track="ustaad_feed_following"
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${following ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`}
              >
                {t('feed_following')}
              </Link>
            </li>
          </ul>
        </nav>
        <div className="mt-4 rounded-2xl border border-line-card bg-surface p-6 text-center shadow-card">
          <p className="font-heading text-lg font-extrabold text-ink">{t('feedEmptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-sm text-[15px] leading-relaxed text-muted">{t('feedEmptyBody')}</p>
          <Link
            href={href('/ustaad/create')}
            data-track="ustaad_feed_empty_create"
            className="press mt-4 inline-flex min-h-12 items-center rounded-button bg-accent-button px-6 text-[15px] font-bold text-white hover:bg-accent-button-hover"
          >
            {t('feedEmptyCta')}
          </Link>
        </div>
      </section>

      <section
        aria-labelledby="ustaad-pin"
        className="flex items-start gap-4 rounded-2xl border border-line-card bg-surface p-5 shadow-card"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text">
          <UstaadIcon name="pin" />
        </span>
        <div>
          <h2 id="ustaad-pin" className="font-heading text-base font-extrabold text-ink">
            <Link
              href={href('/ustaad/pin')}
              data-track="ustaad_home_pin"
              className="underline-offset-4 hover:underline"
            >
              {t('pinTitle')}
            </Link>
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t('pinBody')}</p>
        </div>
      </section>
    </div>
  );
}
