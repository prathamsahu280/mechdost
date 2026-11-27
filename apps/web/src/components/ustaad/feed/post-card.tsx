'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { PostView } from '@mechdost/shared/ustaad/dto/feed';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { whatsappShareUrl } from '@/lib/ustaad/feed-format';
import { EditedText } from '../correction/edited-text';
import { useCodeLabel, useTimeAgo } from '../common';
import { UstaadIcon } from '../shell/icons';
import { PostMedia } from './post-media';
import { Avatar, useMemberName, useSocialAction, useSocialError } from './social-common';

/** Sheets load only when opened (spec 23 § 17: the feed's first load stays small). */
const CommentsSheet = dynamic(() => import('./comments-sheet').then((m) => m.CommentsSheet));
const PostMenu = dynamic(() => import('./post-menu').then((m) => m.PostMenu));

export type PostGone = 'hidden' | 'deleted' | 'muted' | 'blocked';

const actionBtn =
  // Under 420 px the icon sits above its words (the words never hide: founder rule "a word on every action",
  // QA simulation 2026-11-27 audit #3); wider screens keep one row.
  'press inline-flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[12px] leading-tight font-bold transition-colors duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus min-[420px]:flex-row min-[420px]:gap-1.5 min-[420px]:px-2 min-[420px]:text-[14px]';

/**
 * One post in the feed (spec 23 § 4 flows 4–5; founder: "something an Indian mechanic would actually use"): who and
 * when, the words (corrected text with "see original"), a fix log or tip, tags, big media, then four actions with icons
 * and words: ♥ Like with the count, Comment with the count, Save, and WhatsApp share (a teaser link: no post text
 * leaves the network, SR-44). ⋯ opens report, hide, mute and block (or delete for one's own post). Likes and saves
 * change at once and roll back if the API says no; every outcome is read out in one live region.
 */
export function PostCard({
  post,
  onChange,
  onGone,
  linkToDetail = true,
  openComments = false,
  eager = false,
}: {
  post: PostView;
  onChange: (p: PostView) => void;
  onGone: (id: string, why: PostGone, authorId: string) => void;
  linkToDetail?: boolean;
  openComments?: boolean;
  eager?: boolean;
}) {
  const t = useTranslations('ustaad.feed');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const timeAgo = useTimeAgo();
  const codeLabel = useCodeLabel();
  const name = useMemberName();
  const client = useSocialAction();
  const errorText = useSocialError('feed');
  const [status, setStatus] = useState('');
  const [comments, setComments] = useState(openComments);
  const [menu, setMenu] = useState(false);
  const busy = useRef(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const commentRef = useRef<HTMLButtonElement>(null);
  const author = name(post.author);
  const href = (p: string) => localePath(p, locale);

  async function like() {
    if (busy.current) return;
    busy.current = true;
    const on = !post.likedByMe;
    const before = post;
    onChange({
      ...post,
      likedByMe: on,
      counts: {
        ...post.counts,
        likes: post.counts.likes === null ? null : post.counts.likes + (on ? 1 : -1),
      },
    });
    const r = await (await client()).like(post.id, on);
    busy.current = false;
    if (!r.ok) {
      onChange(before);
      setStatus(errorText(r.code));
      return;
    }
    if (on) track('ustaad_post_liked', {});
    onChange({ ...before, likedByMe: r.data.liked, counts: { ...before.counts, likes: r.data.likes } });
  }

  async function save() {
    if (busy.current) return;
    busy.current = true;
    const on = !post.savedByMe;
    onChange({ ...post, savedByMe: on });
    const r = await (await client()).save(post.id, on);
    busy.current = false;
    if (!r.ok) {
      onChange({ ...post, savedByMe: !on });
      setStatus(errorText(r.code));
      return;
    }
    if (on) track('ustaad_post_saved', {});
  }

  async function share() {
    const r = await (await client()).share(post.id, 'whatsapp');
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    track('ustaad_post_shared', { channel: 'whatsapp' });
    // WhatsApp opens in a new tab (or the app); the member stays on the feed.
    window.open(
      whatsappShareUrl(window.location.origin, r.data.path, t('shareText'), locale),
      '_blank',
      'noopener,noreferrer',
    );
  }

  async function vote(optionId: string) {
    if (!post.poll || busy.current) return;
    busy.current = true;
    const r = await (await client()).vote(post.poll.id, optionId);
    busy.current = false;
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    onChange({
      ...post,
      poll: {
        ...post.poll,
        myOptionId: optionId,
        options: post.poll.options.map((o) => (o.id === optionId ? { ...o, votes: o.votes + 1 } : o)),
      },
    });
  }

  const sponsored = post.contentType === 'sponsored';
  return (
    <article
      aria-label={t('postBy', { name: author })}
      data-post-kind={post.kind}
      className="overflow-hidden rounded-[22px] border border-line-card bg-surface shadow-card"
    >
      <header className="flex items-center gap-3 px-4 pt-4">
        <Avatar name={author} id={post.author.id} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link
              href={href(`/ustaad/u/${post.author.handle}`)}
              data-track="ustaad_post_author"
              data-user-content
              className="rounded font-bold text-ink hover:underline focus-visible:outline-3 focus-visible:outline-focus"
            >
              {author}
            </Link>
            {post.author.official ? (
              <span className="rounded-full bg-navy px-2.5 py-0.5 text-xs font-bold text-white">
                {t('officialBadge')}
              </span>
            ) : l.has(`lvl_${post.author.level}` as 'lvl_naya') ? (
              <span className="rounded-full bg-pill px-2.5 py-0.5 text-xs font-bold text-ink">
                {l(`lvl_${post.author.level}` as 'lvl_naya')}
              </span>
            ) : null}
          </p>
          <p className="text-[13px] text-muted">
            <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
            {post.segmentCode && codeLabel(post.segmentCode) ? ` · ${codeLabel(post.segmentCode) ?? ''}` : ''}
          </p>
        </div>
        <button
          ref={moreRef}
          type="button"
          onClick={() => {
            setMenu(true);
          }}
          aria-label={t('more')}
          aria-haspopup="dialog"
          data-track="ustaad_post_more"
          className="press inline-flex size-12 shrink-0 items-center justify-center rounded-full text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-focus"
        >
          <UstaadIcon name="more" />
        </button>
      </header>

      {sponsored ? (
        <p className="mx-4 mt-3 inline-block rounded-full bg-warning-bg px-3 py-1 text-xs font-bold text-warning">
          {t('sponsored')}
        </p>
      ) : null}
      {post.status === 'held' ? (
        <p role="note" className="mx-4 mt-3 rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning">
          {t('held')}
        </p>
      ) : null}

      <div className="grid gap-3 py-3">
        {post.template ? (
          <p className="mx-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-soft-text">
            {t(`tpl_${post.template}` as 'tpl_tip')}
          </p>
        ) : null}
        {post.body ? (
          <div className="px-4 text-[16px] leading-relaxed text-ink">
            <EditedText body={post.body} bodyOriginal={post.bodyOriginal} />
          </div>
        ) : null}
        {post.fix ? (
          <dl className="mx-4 grid gap-2 rounded-2xl bg-surface-alt p-4 text-[15px]">
            {(
              [
                ['fixSymptom', post.fix.symptom],
                ['fixCause', post.fix.cause],
                ['fixFix', post.fix.fix],
              ] as const
            ).map(([k, v]) =>
              v ? (
                <div key={k}>
                  <dt className="text-xs font-bold text-muted">{t(k)}</dt>
                  <dd data-user-content className="break-words text-ink">
                    {v}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : null}
        <PostMedia post={post} onVote={(id) => void vote(id)} eager={eager} />
        {post.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-2 px-4">
            {post.tags.map((tg) => (
              <li key={tg.slug}>
                <Link
                  href={href(`/ustaad/tags/${tg.slug}`)}
                  onClick={() => {
                    track('ustaad_tag_opened', {});
                  }}
                  className="press inline-flex min-h-11 items-center rounded-full bg-pill px-3.5 text-sm font-bold text-ink hover:bg-accent-soft hover:text-accent-soft-text focus-visible:outline-3 focus-visible:outline-focus"
                >
                  #{locale === 'hi' ? tg.nameHi : tg.nameEn}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {linkToDetail && post.counts.comments > 0 ? (
          <Link
            href={href(`/ustaad/p/${post.id}`)}
            className="mx-4 w-fit rounded text-sm font-bold text-muted hover:text-ink hover:underline focus-visible:outline-3 focus-visible:outline-focus"
          >
            {t('commentsN', { count: post.counts.comments })}
          </Link>
        ) : null}
      </div>

      <div className="flex gap-1 border-t border-line px-2 py-1.5">
        <button
          type="button"
          onClick={() => void like()}
          aria-pressed={post.likedByMe}
          data-track="ustaad_post_like"
          className={`${actionBtn} ${post.likedByMe ? 'text-accent-soft-text' : 'text-ink hover:bg-pill'}`}
        >
          <UstaadIcon name="heart" filled={post.likedByMe} />
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            {post.counts.likes !== null ? <span className="tabular-nums">{post.counts.likes}</span> : null}
            <span>{t('like')}</span>
          </span>
        </button>
        <button
          ref={commentRef}
          type="button"
          onClick={() => {
            setComments(true);
          }}
          aria-haspopup="dialog"
          data-track="ustaad_post_comment"
          className={`${actionBtn} text-ink hover:bg-pill`}
        >
          <UstaadIcon name="comment" />
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="tabular-nums">{post.counts.comments}</span>
            <span>{t('comment')}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void save()}
          aria-pressed={post.savedByMe}
          data-track="ustaad_post_save"
          className={`${actionBtn} ${post.savedByMe ? 'text-accent-soft-text' : 'text-ink hover:bg-pill'}`}
        >
          <UstaadIcon name="saved" filled={post.savedByMe} />
          <span>{t('save')}</span>
        </button>
        {post.status === 'visible' ? (
          <button
            type="button"
            onClick={() => void share()}
            aria-label={t('shareAria')}
            data-track="ustaad_post_share"
            className={`${actionBtn} bg-whatsapp-bg text-whatsapp-text hover:brightness-95`}
          >
            <UstaadIcon name="whatsapp" />
            <span>{t('share')}</span>
          </button>
        ) : null}
      </div>
      <p role="status" className="px-4 text-sm text-muted empty:sr-only">
        {status}
      </p>

      {comments ? (
        <CommentsSheet
          post={post}
          onClose={() => {
            setComments(false);
            commentRef.current?.focus();
          }}
          onCount={(n) => {
            onChange({ ...post, counts: { ...post.counts, comments: n } });
          }}
        />
      ) : null}
      {menu ? (
        <PostMenu
          post={post}
          onClose={(msg) => {
            setMenu(false);
            // Written after the dialog is gone, so screen readers do not drop it.
            if (msg)
              window.setTimeout(() => {
                setStatus(msg);
              }, 150);
            moreRef.current?.focus();
          }}
          onGone={(why) => {
            setMenu(false);
            onGone(post.id, why, post.author.id);
          }}
        />
      ) : null}
    </article>
  );
}
