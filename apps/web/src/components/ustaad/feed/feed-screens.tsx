'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { localePath } from '@/lib/locale-path';
import { btnPrimary, btnQuiet, card, LoadFailed, LoadingBlock, SampleNote } from '../common';
import { UstaadIcon } from '../shell/icons';
import { CommentsPanel } from './comments-sheet';
import { PostCard } from './post-card';
import { PostList } from './feed-list';
import { useSocial, useSocialAction, useSocialError } from './social-common';

/** `/ustaad/p/[id]`: one post with its comments open below (the bell's reply notices link here). */
export function PostDetail({ id }: { id: string }) {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const errorText = useSocialError('feed');
  const { loaded, reload, sample, set } = useSocial((c) => c.post(id), `post-${id}`);
  const [gone, setGone] = useState<string | null>(null);
  if (loaded.state === 'loading') return <LoadingBlock />;
  if (gone || (loaded.state === 'error' && loaded.status === 404))
    return (
      <div className={`${card} grid justify-items-center gap-3 text-center`}>
        <p className="text-[16px] text-ink">{gone ?? t('postGone')}</p>
        <Link href={localePath('/ustaad', locale)} className={btnPrimary}>
          {t('backToFeed')}
        </Link>
      </div>
    );
  if (loaded.state === 'error') return <LoadFailed message={errorText(loaded.code)} onRetry={reload} />;
  const post = loaded.data;
  return (
    <div className="grid gap-4">
      <SampleNote show={sample} />
      <PostCard
        post={post}
        linkToDetail={false}
        eager
        onChange={set}
        onGone={(_id, why) => {
          setGone(
            why === 'deleted'
              ? t('deleteDone')
              : why === 'hidden'
                ? t('hiddenDone')
                : why === 'muted'
                  ? t('muteDone')
                  : t('blockDone'),
          );
        }}
      />
      <section aria-labelledby="post-comments" className={card}>
        <h2 id="post-comments" className="mb-3 font-heading text-lg font-extrabold text-ink">
          {t('commentsTitle')}
        </h2>
        <CommentsPanel
          post={post}
          onCount={(n) => {
            set({ ...post, counts: { ...post.counts, comments: n } });
          }}
        />
      </section>
    </div>
  );
}

/** `/ustaad/tags/[slug]`: the tag's name and group, Follow tag, and its posts. */
export function TagScreen({ slug }: { slug: string }) {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const client = useSocialAction();
  const errorText = useSocialError('feed');
  const { loaded, reload, sample, set } = useSocial((c) => c.tag(slug, null), `tag-${slug}`);
  const [status, setStatus] = useState('');
  if (loaded.state === 'loading')
    return (
      <>
        <h1 className="sr-only">#{slug}</h1>
        <LoadingBlock />
      </>
    );
  if (loaded.state === 'error')
    return loaded.status === 404 ? (
      <div className={`${card} grid justify-items-center gap-3 text-center`}>
        <h1 className="font-heading text-xl font-extrabold text-ink">#{slug}</h1>
        <p className="text-[16px] text-ink">{t('tagEmpty')}</p>
        <Link href={localePath('/ustaad/discover', locale)} className={btnPrimary}>
          {t('findUstaads')}
        </Link>
      </div>
    ) : (
      <>
        <h1 className="sr-only">#{slug}</h1>
        <LoadFailed message={errorText(loaded.code)} onRetry={reload} />
      </>
    );
  const tag = loaded.data.tag;
  const label = `#${locale === 'hi' ? tag.nameHi : tag.nameEn}`;
  async function follow() {
    const on = !tag.followed;
    const r = await (await client()).followTag(slug, on);
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    if (loaded.state === 'ok') set({ ...loaded.data, tag: { ...tag, followed: r.data.followed } });
    setStatus(r.data.followed ? t('tagFollowingNote') : '');
  }
  return (
    <div className="grid gap-4">
      <SampleNote show={sample} />
      <header className={`${card} flex flex-wrap items-center gap-4`}>
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-text">
          <UstaadIcon name="hash" size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-[clamp(22px,4.6vw,28px)] font-extrabold text-ink">{label}</h1>
          {t.has(`tagGroup_${tag.group}` as 'tagGroup_part') ? (
            <p className="text-sm text-muted">{t(`tagGroup_${tag.group}` as 'tagGroup_part')}</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-pressed={tag.followed}
          onClick={() => void follow()}
          className={tag.followed ? btnQuiet : btnPrimary}
        >
          <UstaadIcon name={tag.followed ? 'check' : 'plus'} />
          {t('tagFollow')}
        </button>
        <p role="status" className="w-full text-sm text-muted empty:sr-only">
          {status}
        </p>
      </header>
      <PostList
        listKey={`tag-posts-${slug}`}
        load={async (c, cursor) => {
          const r = await c.tag(slug, cursor);
          return r.ok ? { ok: true, data: { items: r.data.items, nextCursor: r.data.nextCursor } } : r;
        }}
        empty={
          <div className={`${card} grid justify-items-center gap-3 text-center`}>
            <p className="text-[15px] text-muted">{t('tagEmpty')}</p>
            <Link href={localePath('/ustaad/create', locale)} className={btnPrimary}>
              {t('emptyCta')}
            </Link>
          </div>
        }
      />
    </div>
  );
}
