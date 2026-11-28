'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { ProfileView } from '@mechdost/shared/ustaad/dto/social';
import { localePath } from '@/lib/locale-path';
import { btnPrimary, btnQuiet, card, LoadFailed, LoadingBlock, SampleNote, useCodeLabel } from '../common';
import { PehchaanTag } from '../common/pehchaan-tag';
import { UstaadIcon } from '../shell/icons';
import { PostList } from './feed-list';
import { ReportForm } from './post-menu';
import { Sheet } from './sheet';
import { Avatar, useMemberName, useSocial, useSocialAction, useSocialError } from './social-common';

/** One count of the Me stat row (design § 3.8): the word above, the number below; wraps after three. */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5 px-1 text-center">
      <dt className="text-xs leading-snug break-words text-muted">{label}</dt>
      <dd className="font-heading text-xl font-extrabold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * `/ustaad/u/[handle]` (spec 23 § 4 flow 7, § 5; workstream D web): who this mechanic is (name, level, verified,
 * area, what they work on), what the network says about them (helpful and best answers first; followers only when
 * the admin shows counts), the three actions mechanics expect (Follow, Connect, Message) and their posts. Mute, Block
 * and Report sit behind "More" in one sheet. No phone, garage or location is ever shown (SR-34). Messages and the
 * network lists live on their own screens (`/ustaad/messages`, `/ustaad/network`).
 */
export function ProfileScreen({ handle }: { handle: string }) {
  const t = useTranslations('ustaad.social');
  const f = useTranslations('ustaad.feed');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const codeLabel = useCodeLabel();
  const name = useMemberName();
  const client = useSocialAction();
  const errorText = useSocialError('social');
  const { loaded, reload, sample, set } = useSocial((c) => c.profile(handle), `profile-${handle}`);
  const [status, setStatus] = useState('');
  const [sheet, setSheet] = useState<null | 'menu' | 'report' | 'block'>(null);
  const [gone, setGone] = useState(false);
  const busy = useRef(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const sheetBody = useRef<HTMLDivElement>(null);
  const goneRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (sheet === 'report') sheetBody.current?.querySelector<HTMLElement>('input, button, textarea')?.focus();
    else if (sheet === 'block')
      sheetBody.current?.querySelector<HTMLElement>('[data-confirm-cancel]')?.focus();
  }, [sheet]);
  useEffect(() => {
    if (gone) goneRef.current?.focus();
  }, [gone]);
  const href = (p: string) => localePath(p, locale);

  if (loaded.state === 'loading')
    return (
      <>
        <h1 className="sr-only">@{handle}</h1>
        <LoadingBlock />
      </>
    );
  if (gone || (loaded.state === 'error' && loaded.status === 404))
    return (
      <div className={`${card} grid justify-items-center gap-3 text-center`}>
        <h1 className="sr-only">@{handle}</h1>
        <p
          ref={goneRef}
          tabIndex={-1}
          className="text-[16px] text-ink focus-visible:outline-3 focus-visible:outline-focus"
        >
          {gone ? f('blockDone') : t('profileGone')}
        </p>
        <Link href={href('/ustaad')} className={btnPrimary}>
          {f('backToFeed')}
        </Link>
      </div>
    );
  if (loaded.state === 'error')
    return (
      <>
        <h1 className="sr-only">@{handle}</h1>
        <LoadFailed message={errorText(loaded.code)} onRetry={reload} />
      </>
    );
  const p = loaded.data;
  const who = name(p.member);
  const rel = p.relationship;
  const area = locale === 'hi' && p.member.areaLabelHi ? p.member.areaLabelHi : p.member.areaLabel;
  const update = (next: Partial<ProfileView>) => {
    set({ ...p, ...next });
  };

  async function act<T>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; code: string }>,
    then: (d: T) => void,
  ) {
    if (busy.current) return;
    busy.current = true;
    const r = await fn();
    busy.current = false;
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    then(r.data);
  }

  const follow = () =>
    act(
      async () => (await client()).follow(p.member.id, !(rel?.following ?? false)),
      (d) => {
        if (!rel) return;
        update({
          relationship: { ...rel, following: d.following },
          followers: d.followers ?? (p.followers === null ? null : p.followers + (d.following ? 1 : -1)),
        });
      },
    );
  const connect = () =>
    act(
      async () => (await client()).connect(p.member.id),
      (d) => {
        if (!rel) return;
        update({ relationship: { ...rel, connection: { id: d.id, status: d.status, mine: true } } });
        setStatus(t('requested'));
      },
    );
  const mute = () =>
    act(
      async () => (await client()).mute(p.member.id, !(rel?.muted ?? false)),
      (d) => {
        if (!rel) return;
        update({ relationship: { ...rel, muted: d.muted } });
        setSheet(null);
        window.setTimeout(() => {
          setStatus(d.muted ? f('muteDone') : '');
        }, 150);
        moreRef.current?.focus();
      },
    );
  const block = () =>
    act(
      async () => (await client()).block(p.member.id, true),
      () => {
        setSheet(null);
        setGone(true);
      },
    );

  const conn = rel?.connection;
  const connectBtn = !rel ? null : conn?.status === 'accepted' ? (
    <button type="button" aria-disabled="true" className={btnQuiet}>
      <UstaadIcon name="check" />
      {t('connected')}
    </button>
  ) : conn?.status === 'requested' && conn.mine ? (
    <button type="button" aria-disabled="true" className={btnQuiet}>
      {t('requested')}
    </button>
  ) : conn?.status === 'requested' ? (
    <Link href={href('/ustaad/network')} className={btnQuiet}>
      <UstaadIcon name="users" />
      {t('acceptConnect')}
    </Link>
  ) : (
    <button type="button" onClick={() => void connect()} className={btnQuiet}>
      <UstaadIcon name="users" />
      {t('connect')}
    </button>
  );

  return (
    <div className="grid gap-4">
      <SampleNote show={sample} />
      <section aria-labelledby="profile-name" className={`${card} grid gap-4`}>
        <div className="flex items-start gap-4">
          <Avatar name={who} id={p.member.id} size={72} />
          <div className="grid min-w-0 flex-1 gap-1">
            <h1
              id="profile-name"
              className="font-heading text-base leading-snug font-extrabold break-words text-ink"
            >
              <span data-user-content>{who}</span>
            </h1>
            <p className="text-sm text-muted">
              <span data-user-content>@{p.member.handle}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <PehchaanTag level={p.member.level} size="md" interactive={false} />
              {p.member.verified ? (
                <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-success-bg px-2.5 font-bold text-success">
                  <UstaadIcon name="check" size={16} />
                  {t('verified')}
                </span>
              ) : null}
              {rel?.followsMe ? <span className="text-muted">{t('followsYou')}</span> : null}
            </div>
            <p className="flex items-center gap-1 text-sm text-muted">
              <UstaadIcon name="pin" size={16} />
              <span data-user-content={locale === 'hi' && p.member.areaLabelHi ? undefined : true}>
                {area}
              </span>
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-y-3 rounded-card border border-line-card bg-surface py-3 [&>div]:border-l [&>div]:border-line-card [&>div:nth-child(3n+1)]:border-l-0">
          <Stat value={p.helpfulAnswers} label={t('statHelpful')} />
          <Stat value={p.bestAnswers} label={t('statBest')} />
          <Stat value={p.posts} label={t('statPosts')} />
          {p.followers !== null ? <Stat value={p.followers} label={t('statFollowers')} /> : null}
          {p.following !== null ? <Stat value={p.following} label={t('statFollowing')} /> : null}
        </dl>

        {p.specialities.length > 0 ? (
          <div>
            <h2 className="text-sm font-bold text-muted">{t('worksOn')}</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {p.specialities.map((s) => (
                <li
                  key={s}
                  className="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold text-accent-soft-text"
                >
                  {codeLabel(s) ?? s}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {p.mine ? (
          <div className="grid gap-2">
            <p className="text-[15px] text-muted">{t('mine')}</p>
            <Link href={href('/ustaad/me')} className={btnPrimary}>
              <UstaadIcon name="card" />
              {t('myCard')}
            </Link>
          </div>
        ) : rel ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={rel.following}
                onClick={() => void follow()}
                className={`${rel.following ? btnQuiet : btnPrimary} flex-1`}
              >
                <UstaadIcon name={rel.following ? 'check' : 'plus'} />
                {rel.following ? t('following') : t('follow')}
              </button>
              {connectBtn}
              <Link
                href={
                  rel.threadId
                    ? href(`/ustaad/messages/${rel.threadId}`)
                    : href(`/ustaad/messages?to=${p.member.handle}`)
                }
                className={btnQuiet}
              >
                <UstaadIcon name="message" />
                {t('message')}
              </Link>
              <button
                ref={moreRef}
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setSheet('menu');
                }}
                aria-label={t('moreActions')}
                className={`${btnQuiet} px-3`}
              >
                <UstaadIcon name="more" />
              </button>
            </div>
            {!rel.threadId ? <p className="text-sm text-muted">{t('dmNote')}</p> : null}
          </div>
        ) : null}
        <p role="status" className="text-sm font-bold text-ink empty:sr-only">
          {status}
        </p>
      </section>

      <section aria-labelledby="profile-posts" className="grid gap-3">
        <h2 id="profile-posts" className="font-heading text-lg font-extrabold text-ink">
          {t('postsTitle')}
        </h2>
        <PostList
          listKey={`member-posts-${p.member.id}`}
          load={(c, cursor) => c.memberPosts(p.member.id, cursor)}
          empty={<p className={`${card} text-[15px] text-muted`}>{t('noPosts')}</p>}
        />
      </section>

      {sheet && rel ? (
        <Sheet
          title={
            sheet === 'report'
              ? f('reportTitle')
              : sheet === 'block'
                ? f('block', { name: who })
                : t('moreActions')
          }
          onClose={() => {
            setSheet(null);
            moreRef.current?.focus();
          }}
        >
          <div ref={sheetBody}>
            {sheet === 'menu' ? (
              <ul className="grid gap-1">
                {(
                  [
                    ['bell', rel.muted ? t('unmute') : t('mute'), () => void mute(), false],
                    [
                      'lock',
                      t('block'),
                      () => {
                        setSheet('block');
                      },
                      true,
                    ],
                    [
                      'flag',
                      t('report'),
                      () => {
                        setSheet('report');
                      },
                      false,
                    ],
                  ] as const
                ).map(([icon, label, onClick, danger]) => (
                  <li key={icon}>
                    <button
                      type="button"
                      onClick={onClick}
                      className={`press flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left text-[16px] font-bold hover:bg-pill focus-visible:outline-3 focus-visible:outline-focus ${danger ? 'text-error' : 'text-ink'}`}
                    >
                      <UstaadIcon name={icon} />
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {sheet === 'block' ? (
              <div className="grid gap-4">
                <p className="text-[16px] leading-relaxed text-ink">{f('blockConfirm', { name: who })}</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className={btnPrimary} onClick={() => void block()}>
                    {f('block', { name: who })}
                  </button>
                  <button
                    type="button"
                    data-confirm-cancel
                    className={btnQuiet}
                    onClick={() => {
                      setSheet('menu');
                    }}
                  >
                    {l('cancel')}
                  </button>
                </div>
              </div>
            ) : null}
            {sheet === 'report' ? (
              <ReportForm
                targetType="member"
                targetId={p.member.id}
                onDone={(msg) => {
                  setSheet(null);
                  setStatus(msg);
                  moreRef.current?.focus();
                }}
              />
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
