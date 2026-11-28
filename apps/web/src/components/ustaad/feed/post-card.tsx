'use client';

import dynamic from 'next/dynamic';
import { Wrench } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { PostView } from '@mechdost/shared/ustaad/dto/feed';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { whatsappShareUrl } from '@/lib/ustaad/feed-format';
import { doubleTapLike, toggleReaction, type Reaction } from '@/lib/ustaad/reactions';
import { EditedText } from '../correction/edited-text';
import { useCodeLabel, useTimeAgo } from '../common';
import { RulesLink } from '../rules-link';
import { PehchaanTag } from '../common/pehchaan-tag';
import { UstaadIcon } from '../shell/icons';
import { FixLogBody, TipTag } from './fix-log-body';
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
  const locale = useLocale();
  const timeAgo = useTimeAgo();
  const codeLabel = useCodeLabel();
  const name = useMemberName();
  const client = useSocialAction();
  const errorText = useSocialError('feed');
  const [status, setStatus] = useState('');
  const [comments, setComments] = useState(openComments);
  const [menu, setMenu] = useState(false);
  // M1 tick (visual language § 5): counts taps per reaction so the icon springs and the count rolls only after a tap,
  // never on first paint; the number is the React key that restarts the CSS animation (0 KB of motion JS).
  const [taps, setTaps] = useState({ like: 0, useful: 0 });
  const busy = useRef(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const commentRef = useRef<HTMLButtonElement>(null);
  const author = name(post.author);
  const href = (p: string) => localePath(p, locale);

  /**
   * Like / Useful / Save change at once (`toggleReaction`) and roll back to the post as it was if the API says no
   * (U2, E12). One write at a time per card; a failed like says so in words ("Couldn't like. Try again").
   */
  async function react(kind: Reaction, on: boolean, via: 'button' | 'double_tap' = 'button') {
    if (busy.current) return;
    busy.current = true;
    const before = post;
    const next = toggleReaction(post, kind, on);
    if (kind !== 'save') setTaps((n) => ({ ...n, [kind]: n[kind] + 1 }));
    onChange(next);
    const c = await client();
    const r =
      kind === 'like'
        ? await c.like(post.id, on)
        : kind === 'useful'
          ? await c.useful(post.id, on)
          : await c.save(post.id, on);
    busy.current = false;
    if (!r.ok) {
      onChange(before);
      setStatus(kind === 'like' && on ? t('likeFailed') : errorText(r.code));
      return;
    }
    if (!on) return;
    if (kind === 'like') track('ustaad_post_liked', { via });
    else if (kind === 'useful') track('ustaad_post_useful', {});
    else track('ustaad_post_saved', {});
  }
  const like = () => react('like', !post.likedByMe);
  const useful = () => react('useful', !post.usefulByMe);
  const save = () => react('save', !post.savedByMe);

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
              className="rounded text-base font-extrabold text-ink hover:underline focus-visible:outline-3 focus-visible:outline-focus"
            >
              {author}
            </Link>
            {post.author.official ? (
              <span className="rounded-full bg-navy px-2.5 py-0.5 text-xs font-bold text-white">
                {t('officialBadge')}
              </span>
            ) : (
              <PehchaanTag level={post.author.level} />
            )}
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
          {t('held')} <RulesLink place="held_note" inheritColor />
        </p>
      ) : null}

      <div className="grid gap-3 py-3">
        {post.template && post.template !== 'tip' ? (
          <p className="mx-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-soft-text">
            {t(`tpl_${post.template}` as 'tpl_tip')}
          </p>
        ) : null}
        {post.template === 'tip' && post.body ? (
          // U2 (E8): a tip sits in its own tinted panel with the "Tip" tag.
          <div className="mx-4 grid gap-2 rounded-2xl bg-surface-alt p-4">
            <TipTag />
            <div data-post-body className="text-[16px] leading-relaxed text-ink">
              <EditedText body={post.body} bodyOriginal={post.bodyOriginal} />
            </div>
          </div>
        ) : post.body ? (
          <div data-post-body className="px-4 text-[16px] leading-relaxed text-ink">
            <EditedText body={post.body} bodyOriginal={post.bodyOriginal} />
          </div>
        ) : null}
        {post.fix ? <FixLogBody fix={post.fix} /> : null}
        <PostMedia
          post={post}
          onVote={(id) => void vote(id)}
          onDoubleTap={() => {
            if (doubleTapLike(post)) void react('like', true, 'double_tap');
          }}
          eager={eager}
        />
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
            className="mx-4 inline-flex min-h-6 w-fit items-center rounded text-sm font-bold text-muted hover:text-ink hover:underline focus-visible:outline-3 focus-visible:outline-focus"
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
          data-ticked={taps.like > 0 ? '' : undefined}
          className={`${actionBtn} ${post.likedByMe ? 'text-accent-soft-text' : 'text-ink hover:bg-pill'}`}
        >
          <span key={`i${String(taps.like)}`} className="ustaad-tick inline-flex">
            <UstaadIcon name="heart" filled={post.likedByMe} />
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            {post.counts.likes !== null ? (
              <span className="inline-flex h-[1.5em] overflow-hidden">
                <span key={`c${String(taps.like)}`} className="ustaad-count-in tabular-nums">
                  {post.counts.likes}
                </span>
              </span>
            ) : null}
            <span>{t('like')}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void useful()}
          aria-pressed={post.usefulByMe}
          data-track="ustaad_post_useful"
          data-ticked={taps.useful > 0 ? '' : undefined}
          className={`${actionBtn} ${post.usefulByMe ? 'bg-brass/20 text-brass-text' : 'text-ink hover:bg-pill'}`}
        >
          {/* Bench kit (visual language § 4): a wrench in brass for "Kaam ki baat", never the Like heart. */}
          <span key={`i${String(taps.useful)}`} className="ustaad-tick inline-flex">
            <Wrench aria-hidden="true" className="size-5" strokeWidth={2} />
          </span>
          {/* Wraps (never clips) at 360 px: the Hindi word is longer than "Like". */}
          <span className="inline-flex flex-wrap items-center justify-center gap-x-1 text-center">
            <span className="inline-flex h-[1.5em] overflow-hidden">
              <span key={`c${String(taps.useful)}`} className="ustaad-count-in tabular-nums">
                {post.counts.useful}
              </span>
            </span>
            <span>{t('useful')}</span>
            {/* WCAG 2.5.3 (live axe 2026-11-28): the name starts with the visible words; the meaning follows. */}
            <span className="sr-only">, {t('usefulAria')}</span>
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
          <span>{post.savedByMe ? t('saved') : t('save')}</span>
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
