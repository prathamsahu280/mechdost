import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { BannedGate, MemberGate } from '@/components/ustaad/common';
import { HomeFeed } from '@/components/ustaad/feed/feed-list';
import { HOME_TILE, HOME_TILE_ICON, HomeMore } from '@/components/ustaad/feed/home-more';
import { StoryRow } from '@/components/ustaad/feed/story-row';
import { UstaadIcon, type UstaadIconName } from '@/components/ustaad/shell/icons';
import { CoachMark } from '@/components/ustaad/tutorial/coach-mark';
import { UstaadGreeting } from '@/components/ustaad/shell/ustaad-gate';
import type { Locale } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams?: Promise<{ tab?: string }>;
}

/**
 * No network name in the tab title: during the staff preview the same page is served to everyone and the client gate
 * shows "page not found" to those refused, so the title must not name the network (review 2026-11-26).
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Shortcut tiles (spec 23 § 5 Home). Each opens its workstream's screen (B–E build them). */
type ShortcutKey =
  'ask' | 'jobs' | 'dukaan' | 'learn' | 'discover' | 'network' | 'area' | 'saved' | 'pin' | 'card';
/** The first four are tiles; the rest open from "More" (UI upgrade U1, design § 3.1 item 3). */
const VISIBLE = 4;
const SHORTCUTS: readonly { key: ShortcutKey; icon: UstaadIconName; path: string }[] = [
  { key: 'ask', icon: 'mic', path: '/ustaad/ask' },
  { key: 'jobs', icon: 'jobs', path: '/ustaad/jobs' },
  { key: 'dukaan', icon: 'dukaan', path: '/shop' },
  { key: 'learn', icon: 'learn', path: '/ustaad/learn' },
  { key: 'discover', icon: 'discover', path: '/ustaad/discover' },
  { key: 'network', icon: 'network', path: '/ustaad/network' },
  { key: 'area', icon: 'area', path: '/ustaad/area' },
  { key: 'saved', icon: 'saved', path: '/ustaad/saved' },
  { key: 'pin', icon: 'pin', path: '/ustaad/me/location' },
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
    <div className="mx-auto grid max-w-2xl gap-5">
      {/* SIM-RT1: a banned member sees the banned screen instead of the Home (reason, end date, appeal). */}
      <ClientMessages namespaces={['ustaad.standing', 'ustaad.shell', 'ustaad.labels', 'segments']}>
        <BannedGate>
          <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
            <UstaadGreeting template={t('greeting', { name: '{name}' })} fallback={t('greetingStaff')} />
          </h1>

          <section aria-labelledby="ustaad-stories">
            <h2 id="ustaad-stories" className="font-heading text-lg font-extrabold text-ink">
              {t('storiesTitle')}
            </h2>
            <div className="mt-3 min-h-24">
              <ClientMessages
                namespaces={[
                  'ustaad.feed',
                  'ustaad.story',
                  'ustaad.labels',
                  'ustaad.media',
                  'ustaad.correction',
                  'ustaad.shell',
                  'ustaad.standing',
                  'segments',
                ]}
              >
                <StoryRow />
              </ClientMessages>
            </div>
          </section>

          <section
            aria-labelledby="ustaad-ask"
            className="rounded-hero bg-navy p-4 text-white shadow-float tab:p-5"
          >
            <div className="flex items-center gap-4">
              <Link
                id="ustaad-ask-mic"
                href={href('/ustaad/ask/new')}
                aria-label={t('heroAction')}
                data-track="ustaad_home_ask"
                className="press inline-flex size-16 shrink-0 items-center justify-center rounded-full bg-accent-button text-white ring-4 ring-white/15 hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-focus"
              >
                <UstaadIcon name="mic" size={28} />
              </Link>
              <div className="min-w-0 flex-1">
                <h2 id="ustaad-ask" className="font-heading text-lg font-extrabold tab:text-xl">
                  {t('askTitle')}
                </h2>
                <p className="mt-0.5 text-[14px] leading-snug text-white/85">{t('askBody')}</p>
                {/* Kept as the card's secondary text button: it opens the full composer. */}
                <Link
                  href={href('/ustaad/ask/new')}
                  data-track="ustaad_home_ask_text"
                  className="mt-1 inline-flex min-h-11 items-center text-[15px] font-bold text-white underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-focus"
                >
                  {t('askCta')}
                </Link>
              </div>
            </div>
            <ClientMessages namespaces={['ustaad.tutorial']}>
              <CoachMark target="mic" returnFocusTo="ustaad-ask-mic" />
            </ClientMessages>
          </section>

          <section aria-labelledby="ustaad-shortcuts">
            <h2 id="ustaad-shortcuts" className="sr-only">
              {t('shortcutsTitle')}
            </h2>
            <ul className="grid grid-cols-5 gap-2 tab:gap-3">
              {SHORTCUTS.slice(0, VISIBLE).map((s) => (
                <li key={s.key}>
                  <Link href={href(s.path)} data-track={`ustaad_shortcut_${s.key}`} className={HOME_TILE}>
                    <span className={HOME_TILE_ICON}>
                      <UstaadIcon name={s.icon} />
                    </span>
                    {t(`sc_${s.key}`)}
                  </Link>
                </li>
              ))}
              <li>
                <ClientMessages namespaces={['ustaad.labels']}>
                  <HomeMore
                    label={t('more')}
                    title={t('moreTitle')}
                    icon={<UstaadIcon name="more" />}
                    links={SHORTCUTS.slice(VISIBLE).map((s) => ({
                      key: s.key,
                      href: href(s.path),
                      label: t(`sc_${s.key}`),
                      icon: <UstaadIcon name={s.icon} />,
                    }))}
                  />
                </ClientMessages>
              </li>
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
                    scroll={false}
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
                    scroll={false}
                    aria-current={following ? 'page' : undefined}
                    data-track="ustaad_feed_following"
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${following ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`}
                  >
                    {t('feed_following')}
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="mt-4">
              <ClientMessages
                namespaces={[
                  'ustaad.feed',
                  'ustaad.home',
                  'ustaad.labels',
                  'ustaad.media',
                  'ustaad.correction',
                  'ustaad.shell',
                  'ustaad.standing',
                  'segments',
                ]}
              >
                <MemberGate>
                  <HomeFeed tab={following ? 'following' : 'for_you'} />
                </MemberGate>
              </ClientMessages>
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
                  href={href('/ustaad/me/location')}
                  data-track="ustaad_home_pin"
                  className="underline-offset-4 hover:underline"
                >
                  {t('pinTitle')}
                </Link>
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{t('pinBody')}</p>
            </div>
          </section>
        </BannedGate>
      </ClientMessages>
    </div>
  );
}
