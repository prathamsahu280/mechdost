'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { PostView } from '@mechdost/shared/ustaad/dto/feed';
import { REPORT_REASONS, type UstaadReportTarget } from '@mechdost/shared/ustaad/codes';
import { btnPrimary, btnQuiet, fieldClass } from '../common';
import { UstaadIcon, type UstaadIconName } from '../shell/icons';
import type { PostGone } from './post-card';
import { Sheet } from './sheet';
import { useMemberName, useSocialAction, useSocialError } from './social-common';

/**
 * The report form (spec 23 § 13, F2 `POST /ustaad/reports`): one reason from the F2 list as big radio rows, an
 * optional note, one primary "Send report". Used for posts, comments, members and messages; the sheet that opens it
 * swaps its content for this form (no second dialog).
 */
export function ReportForm({
  targetType,
  targetId,
  onDone,
}: {
  targetType: UstaadReportTarget;
  targetId: string;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('ustaad.feed');
  const client = useSocialAction();
  const errorText = useSocialError('feed');
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const errId = useId();
  const legend = useRef<HTMLLegendElement>(null);
  async function send() {
    if (busy) return;
    if (!reason) {
      setError(t('reportPick'));
      return;
    }
    setBusy(true);
    const r = await (
      await client()
    ).report({ targetType, targetId, reasonCode: reason, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.code));
      return;
    }
    onDone(t('reportSent', { code: r.data.code }));
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <fieldset aria-describedby={error ? errId : undefined}>
        <legend ref={legend} className="font-heading text-base font-extrabold text-ink">
          {t('reportWhy')}
        </legend>
        <div className="mt-2 grid gap-2">
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className="press flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line-card px-3 text-[15px] font-bold text-ink has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-focus"
            >
              <input
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => {
                  setReason(r);
                  setError(null);
                }}
                className="size-5 accent-accent-button"
              />
              {t(`reason_${r}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <label htmlFor={noteId} className="text-[15px] font-bold text-ink">
          {t('reportNote')}
        </label>
        <textarea
          id={noteId}
          value={note}
          maxLength={500}
          rows={2}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          className={`${fieldClass} min-h-20`}
        />
      </div>
      <p id={errId} role="alert" className="text-sm font-bold text-error empty:sr-only">
        {error}
      </p>
      <button type="submit" aria-disabled={busy} className={btnPrimary}>
        <UstaadIcon name="flag" />
        {t('reportSend')}
      </button>
    </form>
  );
}

type Step = 'menu' | 'report' | 'block' | 'delete';

/**
 * ⋯ on a post (spec 23 § 4 flow 5, § 7.9): Report, Hide this post (from this screen), Mute and Block the author, or
 * Copy link; Delete for one's own post. Block and delete ask first, inside the same sheet.
 */
export function PostMenu({
  post,
  onClose,
  onGone,
}: {
  post: PostView;
  onClose: (message?: string) => void;
  onGone: (why: PostGone) => void;
}) {
  const t = useTranslations('ustaad.feed');
  const l = useTranslations('ustaad.labels');
  const client = useSocialAction();
  const errorText = useSocialError('feed');
  const name = useMemberName()(post.author);
  const [step, setStep] = useState<Step>('menu');
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (step === 'menu') first.current?.focus();
  }, [step]);

  async function run(fn: () => Promise<{ ok: boolean; code?: string }>, gone: PostGone) {
    const r = await fn();
    if (!r.ok) {
      setError(errorText(r.code ?? 'HTTP_500'));
      return;
    }
    onGone(gone);
  }
  async function copy() {
    const r = await (await client()).share(post.id, 'copy_link');
    if (!r.ok) {
      setError(errorText(r.code));
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}${r.data.path}`).catch(() => undefined);
    onClose(t('copied'));
  }

  const row = (
    icon: UstaadIconName,
    label: string,
    onClick: () => void,
    danger = false,
    ref?: typeof first,
  ) => (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={`press flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left text-[16px] font-bold hover:bg-pill focus-visible:outline-3 focus-visible:outline-focus ${danger ? 'text-error' : 'text-ink'}`}
      >
        <UstaadIcon name={icon} />
        {label}
      </button>
    </li>
  );

  const title =
    step === 'report'
      ? t('reportTitle')
      : step === 'menu'
        ? t('menuTitle')
        : step === 'block'
          ? t('block', { name })
          : t('deletePost');
  return (
    <Sheet
      title={title}
      onClose={() => {
        onClose();
      }}
    >
      {step === 'menu' ? (
        <ul className="grid gap-1">
          {post.status === 'visible'
            ? row('copy', t('copyLink'), () => void copy(), false, post.mine ? first : undefined)
            : null}
          {post.mine ? (
            row(
              'close',
              t('deletePost'),
              () => {
                setStep('delete');
              },
              true,
              post.status === 'visible' ? undefined : first,
            )
          ) : (
            <>
              {row(
                'flag',
                t('report'),
                () => {
                  setStep('report');
                },
                false,
                first,
              )}
              {row('close', t('hidePost'), () => {
                onGone('hidden');
              })}
              {row(
                'bell',
                t('mute', { name }),
                () => void run(async () => (await client()).mute(post.author.id, true), 'muted'),
              )}
              {row(
                'lock',
                t('block', { name }),
                () => {
                  setStep('block');
                },
                true,
              )}
            </>
          )}
        </ul>
      ) : null}
      {step === 'report' ? (
        <ReportForm
          targetType="post"
          targetId={post.id}
          onDone={(msg) => {
            onClose(msg);
          }}
        />
      ) : null}
      {step === 'block' || step === 'delete' ? (
        <div className="grid gap-4">
          <p className="text-[16px] leading-relaxed text-ink">
            {step === 'block' ? t('blockConfirm', { name }) : t('deleteConfirm')}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={btnPrimary}
              onClick={() =>
                void (step === 'block'
                  ? run(async () => (await client()).block(post.author.id, true), 'blocked')
                  : run(async () => (await client()).deletePost(post.id), 'deleted'))
              }
            >
              {t('confirmYes')}
            </button>
            <button
              type="button"
              className={btnQuiet}
              onClick={() => {
                setStep('menu');
              }}
            >
              {l('cancel')}
            </button>
          </div>
        </div>
      ) : null}
      <p role="alert" className="mt-3 text-sm font-bold text-error empty:sr-only">
        {error}
      </p>
    </Sheet>
  );
}
