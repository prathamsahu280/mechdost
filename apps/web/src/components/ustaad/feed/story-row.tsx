'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { StoryRing } from '@mechdost/shared/ustaad/dto/feed';
import { localePath } from '@/lib/locale-path';
import { UstaadIcon } from '../shell/icons';
import { Avatar, useMemberName, useSocial } from './social-common';

const StoryViewer = dynamic(() => import('./story-viewer').then((m) => m.StoryViewer));

/**
 * "Today at the garages" (spec 23 § 4 flow 6): a row of rings like the apps mechanics know: mine first (or "Add
 * story"), then the people I follow and my city. An orange ring = something new; a grey ring = all seen. Tapping a
 * ring opens the viewer (loaded on that tap).
 */
export function StoryRow() {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const name = useMemberName();
  const { loaded, set } = useSocial((c) => c.stories(), 'stories');
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const rings = loaded.state === 'ok' ? loaded.data : [];
  const hasMine = rings.some((r) => r.mine);
  const ringBtn =
    'press flex w-[76px] flex-col items-center gap-1.5 rounded-2xl text-center text-[13px] font-bold text-ink focus-visible:outline-3 focus-visible:outline-focus';

  function seen(ri: number, si: number) {
    const next: StoryRing[] = rings.map((r, i) => {
      if (i !== ri) return r;
      const stories = r.stories.map((s, j) => (j === si ? { ...s, seen: true } : s));
      return { ...r, stories, allSeen: stories.every((s) => s.seen) };
    });
    set(next);
  }

  return (
    <>
      <ul className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
        {!hasMine ? (
          <li>
            <Link
              href={localePath('/ustaad/create?story=1', locale)}
              data-track="ustaad_story_add"
              className={ringBtn}
            >
              <span className="flex size-[64px] items-center justify-center rounded-full border-2 border-dashed border-accent bg-surface text-accent-soft-text">
                <UstaadIcon name="plus" size={26} />
              </span>
              {t('addStory')}
            </Link>
          </li>
        ) : null}
        {loaded.state === 'loading'
          ? [0, 1, 2].map((i) => (
              <li key={i} aria-hidden="true" className="skeleton size-[64px] shrink-0 rounded-full" />
            ))
          : null}
        {rings.map((r, i) => {
          const who = name(r.author);
          return (
            <li key={r.author.id}>
              <button
                type="button"
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  setOpen(i);
                }}
                className={ringBtn}
              >
                <span
                  className={`flex size-[68px] items-center justify-center rounded-full p-[3px] ${r.allSeen ? 'bg-line-card' : 'bg-accent'}`}
                >
                  <span className="flex size-full items-center justify-center rounded-full bg-surface p-[2px]">
                    <Avatar name={who} id={r.author.id} size={56} />
                  </span>
                </span>
                <span data-user-content={r.mine ? undefined : true} className="line-clamp-1 w-full">
                  {r.mine ? t('yourStory') : who.split(' ')[0]}
                </span>
                <span className="sr-only">
                  {`, ${r.mine ? '' : `${who}, `}${r.allSeen ? t('storySeenMark') : t('storyNewMark')}`}
                </span>
              </button>
            </li>
          );
        })}
        {loaded.state === 'ok' && rings.length === 0 ? (
          <li className="flex items-center text-sm text-muted">{t('storiesEmpty')}</li>
        ) : null}
      </ul>
      {hasMine ? (
        <Link
          href={localePath('/ustaad/create?story=1', locale)}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-accent-soft-text hover:underline focus-visible:outline-3 focus-visible:outline-focus"
        >
          <UstaadIcon name="plus" size={18} />
          {t('addStory')}
        </Link>
      ) : null}
      {open !== null ? (
        <StoryViewer
          rings={rings}
          start={open}
          onSeen={seen}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
