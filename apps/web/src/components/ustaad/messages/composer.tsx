'use client';

import { Camera, Mic, Send, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import type { SendMessage } from '@mechdost/shared/ustaad/dto/messages';
import { btnPrimary, btnQuiet, card, fieldClass } from '../common';
import type { PreparedImage } from '../media/image-picker';
import { UploadProgress } from '../media/upload-progress';
import type { Recording } from '../media/voice-recorder';
import { useAct, useDmErrorText } from './shared';

// The recorder and the photo picker load only when the member opens them (spec 23 § 17: storefront bundles never
// carry them, and a text-only chat never downloads them).
const VoiceRecorder = dynamic(() => import('../media/voice-recorder').then((m) => m.VoiceRecorder), {
  ssr: false,
  loading: () => <div className="skeleton h-[76px] rounded-2xl" aria-hidden="true" />,
});
const ImagePicker = dynamic(() => import('../media/image-picker').then((m) => m.ImagePicker), {
  ssr: false,
  loading: () => <div className="skeleton h-12 rounded-2xl" aria-hidden="true" />,
});
/** Under both the media API's `media.voice_max_s` (default 120) and the Q&A voice limit used on C screens. */
const VOICE_MAX_S = 90;

type Panel = 'text' | 'voice' | 'photo';

/**
 * The message composer of an open conversation (WhatsApp habit): a text line with Send, a Voice button that opens
 * hold-to-talk (or tap to start / tap to stop), and a Photo button (camera or gallery, cleaned on the phone). Voice and
 * photo upload on send with progress; errors come back as words beside the composer.
 */
export function Composer({ threadId, onSent }: { threadId: string; onSent: () => void }) {
  const t = useTranslations('ustaad.messages');
  const m = useTranslations('ustaad.media');
  const errorText = useDmErrorText();
  const fieldId = useId();
  const errId = useId();
  const [panel, setPanel] = useState<Panel>('text');
  const [text, setText] = useState('');
  const [rec, setRec] = useState<Recording | null>(null);
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const { act, busy, error, setError } = useAct();

  const errorWords = (code: string) => {
    const key = `err_${code}` as 'err_MEDIA_TYPE';
    return m.has(key) ? m(key) : errorText(code);
  };

  async function send(body: SendMessage) {
    const r = await act('send', (c) => c.send(threadId, body));
    if (!r) return false;
    onSent();
    return true;
  }

  async function sendText(e: React.SyntheticEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    if (await send({ kind: 'text', text: v })) {
      setText('');
      field.current?.focus();
    }
  }

  async function sendMedia() {
    if (busy) return;
    const blob = panel === 'voice' ? rec : img;
    if (!blob) return;
    const up = await act('upload', (c) =>
      c.upload(
        blob.blob,
        panel === 'voice' && rec
          ? { kind: 'audio', mime: rec.mime, durationMs: rec.durationMs }
          : { kind: 'image', mime: img?.mime ?? 'image/jpeg', width: img?.width, height: img?.height },
        setPct,
      ),
    );
    setPct(null);
    if (!up) return;
    const caption = text.trim();
    const ok = await send(
      panel === 'voice'
        ? { kind: 'voice', mediaId: up.mediaId }
        : { kind: 'photo', mediaId: up.mediaId, ...(caption ? { text: caption } : {}) },
    );
    if (ok) {
      setRec(null);
      setImg(null);
      setText('');
      setPanel('text');
      field.current?.focus();
    }
  }

  async function sendMediaForm(e: React.SyntheticEvent) {
    e.preventDefault();
    await sendMedia();
  }

  function open(p: Panel) {
    setError(null);
    setRec(null);
    setImg(null);
    setPanel(p);
  }

  return (
    <div className={`${card} grid gap-3`}>
      {panel === 'voice' ? (
        <div className="grid gap-3">
          <VoiceRecorder
            maxSeconds={VOICE_MAX_S}
            onChange={setRec}
            label={t('voiceLabel')}
            hint={t('voiceHint')}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void sendMedia()}
              aria-disabled={!rec || busy !== null}
              aria-busy={busy !== null}
              data-track="ustaad_message_voice_send"
            >
              <Send aria-hidden="true" className="size-5" />
              {t('sendVoice')}
            </button>
            <button
              type="button"
              className={btnQuiet}
              onClick={() => {
                open('text');
              }}
              data-track="ustaad_message_voice_close"
            >
              <X aria-hidden="true" className="size-5" />
              {t('close')}
            </button>
          </div>
        </div>
      ) : null}
      {panel === 'photo' ? (
        <div className="grid gap-3">
          <ImagePicker onChange={setImg} label={t('pickPhoto')} />
        </div>
      ) : null}
      {pct !== null ? <UploadProgress pct={pct} /> : null}

      {panel === 'voice' ? null : (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => void (panel === 'photo' ? sendMediaForm(e) : sendText(e))}
        >
          <div className="grid min-w-0 flex-1 gap-1">
            <label htmlFor={fieldId} className="sr-only">
              {panel === 'photo' ? t('caption') : t('messageLabel')}
            </label>
            <textarea
              ref={field}
              id={fieldId}
              rows={1}
              maxLength={1000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              onKeyDown={(e) => {
                // Enter sends on a keyboard (as in WhatsApp Web); Shift+Enter makes a new line.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={panel === 'photo' ? t('captionPh') : t('messagePh')}
              aria-describedby={errId}
              aria-invalid={error ? true : undefined}
              className={`${fieldClass} max-h-40 resize-none`}
            />
          </div>
          {panel === 'photo' ? (
            <>
              <button
                type="button"
                className={`${btnQuiet} px-3`}
                onClick={() => {
                  open('text');
                }}
                data-track="ustaad_message_photo_close"
              >
                <X aria-hidden="true" className="size-5" />
                <span className="sr-only sm:not-sr-only">{t('close')}</span>
              </button>
              <button
                type="submit"
                className={`${btnPrimary} px-4`}
                aria-disabled={!img || busy !== null}
                aria-busy={busy !== null}
                data-track="ustaad_message_photo_send"
              >
                <Send aria-hidden="true" className="size-5" />
                {t('send')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${btnQuiet} flex-col gap-0.5 px-3 text-xs`}
                onClick={() => {
                  open('photo');
                }}
                data-track="ustaad_message_photo_open"
              >
                <Camera aria-hidden="true" className="size-5" />
                {t('photo')}
              </button>
              {text.trim() ? (
                <button
                  type="submit"
                  className={`${btnPrimary} flex-col gap-0.5 px-4 text-xs`}
                  aria-disabled={busy !== null}
                  aria-busy={busy !== null}
                  data-track="ustaad_message_text_send"
                >
                  <Send aria-hidden="true" className="size-5" />
                  {t('send')}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${btnPrimary} flex-col gap-0.5 px-4 text-xs`}
                  onClick={() => {
                    open('voice');
                  }}
                  data-track="ustaad_message_voice_open"
                >
                  <Mic aria-hidden="true" className="size-5" />
                  {t('voice')}
                </button>
              )}
            </>
          )}
        </form>
      )}
      <p id={errId} role="alert" className="text-sm font-bold text-error empty:sr-only">
        {error ? errorWords(error) : ''}
      </p>
    </div>
  );
}
