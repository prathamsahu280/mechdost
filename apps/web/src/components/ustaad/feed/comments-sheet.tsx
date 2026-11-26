'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { CommentView, PostView } from '@mechdost/shared/ustaad/dto/feed';
import { ustaadClient } from '@/lib/ustaad/client';
import { btnPrimary, fieldClass, LoadFailed, LoadingBlock, SampleNote, useTimeAgo } from '../common';
import { correctForSend } from '../correction/smart-correction';
import { EditedText } from '../correction/edited-text';
import { ImagePicker, type PreparedImage } from '../media/image-picker';
import { UploadProgress } from '../media/upload-progress';
import { VoiceNote } from '../media/voice-note';
import { VoiceRecorder, type Recording } from '../media/voice-recorder';
import { UstaadIcon } from '../shell/icons';
import { Sheet } from './sheet';
import {
  Avatar,
  SignedImage,
  useMemberName,
  useSocial,
  useSocialAction,
  useSocialError,
} from './social-common';

/** Voice comments are short (spec 23 § 4 flow 5): the same 60 s cap as answers. */
const VOICE_MAX_S = 60;

function CommentItem({
  c,
  onReply,
  onDelete,
}: {
  c: CommentView;
  onReply: ((c: CommentView) => void) | null;
  onDelete: (c: CommentView) => void;
}) {
  const t = useTranslations('ustaad.feed');
  const name = useMemberName()(c.author);
  const timeAgo = useTimeAgo();
  return (
    <div className="flex gap-3">
      <Avatar name={name} id={c.author.id} size={36} />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-surface-alt px-3.5 py-2.5">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span data-user-content className="font-bold text-ink">
              {name}
            </span>
            <time dateTime={c.createdAt} className="text-muted">
              {timeAgo(c.createdAt)}
            </time>
          </p>
          {c.body ? (
            <div className="mt-1 text-[15px] leading-relaxed text-ink">
              <EditedText body={c.body} bodyOriginal={c.bodyOriginal} />
            </div>
          ) : null}
          {c.media?.kind === 'audio' ? (
            <div className="mt-2">
              <VoiceNote mediaId={c.media.mediaId} />
            </div>
          ) : null}
          {c.media?.kind === 'image' ? (
            <div className="mt-2 max-w-60 overflow-hidden rounded-xl">
              <SignedImage
                mediaId={c.media.mediaId}
                width={c.media.width}
                height={c.media.height}
                alt={t('commentPhotoAlt')}
              />
            </div>
          ) : null}
          {c.status === 'held' ? <p className="mt-1 text-sm text-warning">{t('commentHeld')}</p> : null}
        </div>
        <div className="mt-1 flex gap-1">
          {onReply ? (
            <button
              type="button"
              onClick={() => {
                onReply(c);
              }}
              aria-label={t('replyTo', { name })}
              className="press inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-bold text-muted hover:text-ink focus-visible:outline-3 focus-visible:outline-focus"
            >
              {t('reply')}
            </button>
          ) : null}
          {c.mine ? (
            <button
              type="button"
              onClick={() => {
                onDelete(c);
              }}
              className="press inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-bold text-muted hover:text-error focus-visible:outline-3 focus-visible:outline-focus"
            >
              {t('deleteComment')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Comments on a post (spec 23 § 4 flow 5): the list with one level of replies, and a composer that takes text (with
 * smart correction on send), a voice note or a photo. Opens as a sheet from the card; the post page shows it inline.
 */
export function CommentsPanel({ post, onCount }: { post: PostView; onCount: (n: number) => void }) {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const client = useSocialAction();
  const errorText = useSocialError('feed');
  const name = useMemberName();
  const { loaded, reload, refresh, sample } = useSocial(
    (c) => c.comments(post.id, null),
    `comments-${post.id}`,
  );
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'text' | 'voice' | 'photo'>('text');
  const [voice, setVoice] = useState<Recording | null>(null);
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const focusField = useRef(false);
  useEffect(() => {
    if (mode === 'text' && focusField.current) {
      focusField.current = false;
      field.current?.focus();
    }
  });
  const fieldId = useId();
  const errId = useId();
  const idem = useRef(`c${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`);

  async function send() {
    if (busy) return;
    setError(null);
    const body = text.trim();
    if (mode === 'text' && !body) {
      setError(t('err_body_required'));
      field.current?.focus();
      return;
    }
    if ((mode === 'voice' && !voice) || (mode === 'photo' && !photo)) {
      setError(t('err_media_required'));
      return;
    }
    setBusy(true);
    let mediaId: string | undefined;
    const file = mode === 'voice' ? voice : mode === 'photo' ? photo : null;
    if (file) {
      setProgress(0);
      const up = await (
        await ustaadClient(locale)
      ).upload(
        file.blob,
        voice && mode === 'voice'
          ? { kind: 'audio', mime: voice.mime, durationMs: voice.durationMs }
          : { kind: 'image', mime: photo?.mime ?? 'image/webp', width: photo?.width, height: photo?.height },
        setProgress,
      );
      setProgress(null);
      if (!up.ok) {
        setBusy(false);
        setError(errorText(up.code));
        return;
      }
      mediaId = up.data.mediaId;
    }
    let sendText = body;
    let correction: { correction: 'none' | 'suggested_used' | 'auto'; original: string | null } = {
      correction: 'none',
      original: null,
    };
    if (sendText) {
      const fixed = await correctForSend(locale, sendText);
      sendText = fixed.text;
      correction = fixed.meta;
    }
    const r = await (
      await client()
    ).comment(post.id, {
      ...(sendText ? { body: sendText } : {}),
      ...(correction.original ? { bodyOriginal: correction.original.slice(0, 1000) } : {}),
      correction: correction.correction,
      ...(mediaId ? { mediaId } : {}),
      ...(replyTo ? { parentId: replyTo.parentId ?? replyTo.id } : {}),
      idemKey: idem.current,
    });
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.code));
      return;
    }
    idem.current = `c${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    setText('');
    setVoice(null);
    setPhoto(null);
    setMode('text');
    setReplyTo(null);
    setStatus(r.data.status === 'held' ? t('commentHeld') : t('posted'));
    onCount(post.counts.comments + 1);
    refresh();
  }

  async function remove(c: CommentView) {
    const r = await (await client()).deleteComment(c.id);
    if (!r.ok) {
      setError(errorText(r.code));
      return;
    }
    onCount(Math.max(0, post.counts.comments - 1));
    setStatus(t('deleteDone'));
    setMode('text');
    focusField.current = true;
    refresh();
  }

  const items = loaded.state === 'ok' ? loaded.data.items : [];
  const top = items.filter((c) => c.parentId === null);
  return (
    <div className="grid gap-4">
      <SampleNote show={sample} />
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && top.length === 0 ? (
        <p className="text-[15px] text-muted">{t('commentsEmpty')}</p>
      ) : null}
      <ul className="grid gap-4">
        {top.map((c) => (
          <li key={c.id} className="grid gap-3">
            <CommentItem
              c={c}
              onReply={(x) => {
                setReplyTo(x);
                setMode('text');
                focusField.current = true;
              }}
              onDelete={(x) => void remove(x)}
            />
            {items.some((r) => r.parentId === c.id) ? (
              <ul className="ml-12 grid gap-3">
                {items
                  .filter((r) => r.parentId === c.id)
                  .map((r) => (
                    <li key={r.id}>
                      <CommentItem c={r} onReply={null} onDelete={(x) => void remove(x)} />
                    </li>
                  ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <form
        className="grid gap-3 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {replyTo ? (
          <p className="flex items-center justify-between gap-2 rounded-xl bg-accent-soft px-3 py-1.5 text-sm font-bold text-accent-soft-text">
            {t('replyingTo', { name: name(replyTo.author) })}
            <button
              type="button"
              onClick={() => {
                setReplyTo(null);
              }}
              className="press inline-flex min-h-11 items-center rounded-lg px-2 underline focus-visible:outline-3 focus-visible:outline-focus"
            >
              {t('cancelReply')}
            </button>
          </p>
        ) : null}
        <div role="group" aria-label={t('writeComment')} className="flex gap-2">
          {(['text', 'voice', 'photo'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
              }}
              className={`press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold focus-visible:outline-3 focus-visible:outline-focus ${mode === m ? 'bg-navy text-white' : 'bg-pill text-ink'}`}
            >
              <UstaadIcon name={m === 'text' ? 'comment' : m === 'voice' ? 'mic' : 'photo'} size={18} />
              {m === 'text' ? t('writeComment') : m === 'voice' ? t('addVoice') : t('addPhoto')}
            </button>
          ))}
        </div>
        {mode === 'text' ? (
          <div className="grid gap-1.5">
            <label htmlFor={fieldId} className="sr-only">
              {t('writeComment')}
            </label>
            <textarea
              id={fieldId}
              ref={field}
              value={text}
              rows={2}
              maxLength={1000}
              placeholder={t('writeComment')}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errId : undefined}
              onChange={(e) => {
                setText(e.target.value);
              }}
              className={`${fieldClass} min-h-16`}
            />
          </div>
        ) : null}
        {mode === 'voice' ? (
          <VoiceRecorder maxSeconds={VOICE_MAX_S} onChange={setVoice} label={t('addVoice')} hint="" />
        ) : null}
        {mode === 'photo' ? <ImagePicker onChange={setPhoto} /> : null}
        {progress !== null ? <UploadProgress pct={progress} /> : null}
        <p id={errId} role="alert" className="text-sm font-bold text-error empty:sr-only">
          {error}
        </p>
        <p role="status" className="text-sm text-muted empty:sr-only">
          {status}
        </p>
        <div className="flex justify-end gap-2">
          <button type="submit" aria-disabled={busy} className={btnPrimary}>
            <UstaadIcon name="send" />
            {busy ? t('sending') : t('send')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function CommentsSheet({
  post,
  onClose,
  onCount,
}: {
  post: PostView;
  onClose: () => void;
  onCount: (n: number) => void;
}) {
  const t = useTranslations('ustaad.feed');
  return (
    <Sheet title={t('commentsTitle')} onClose={onClose} wide>
      <CommentsPanel post={post} onCount={onCount} />
    </Sheet>
  );
}
