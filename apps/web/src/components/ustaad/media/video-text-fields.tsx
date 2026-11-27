'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { MEDIA_CAPTIONS_MAX, MEDIA_SUMMARY_MAX } from '@mechdost/shared/ustaad/media-text';
import { summaryLeft } from '@/lib/ustaad/voice-ui';

export interface VideoText {
  summary: string;
  captions: string;
  lang: 'hi' | 'en';
}

export const EMPTY_VIDEO_TEXT: VideoText = { summary: '', captions: '', lang: 'hi' };

/** The declare fields for a video's typed text (omitted when blank). */
export function videoTextDeclare(v: VideoText): {
  summary?: string;
  captions?: { lang: 'hi' | 'en'; text: string };
} {
  const summary = v.summary.trim();
  const captions = v.captions.trim();
  return {
    ...(summary ? { summary } : {}),
    ...(captions ? { captions: { lang: v.lang, text: captions } } : {}),
  };
}

const field =
  'w-full rounded-input border border-input-border bg-surface px-3 py-2 text-[15px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * A video's text alternative (founder 2026-11-27 night; spec 23 § 10a; WCAG 1.2.2): an optional one-line summary and
 * optional captions the author types ("0:05 — text" lines, or one block for the whole clip) with their language.
 * Both are sent with the upload declaration; nothing is transcribed automatically.
 */
export function VideoTextFields({ value, onChange }: { value: VideoText; onChange: (v: VideoText) => void }) {
  const t = useTranslations('ustaad.media');
  const id = useId();
  return (
    <div className="grid gap-3 rounded-2xl border border-line-card bg-surface-alt p-4">
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-s`} className="text-[15px] font-bold text-ink">
          {t('summaryLabel')}
        </label>
        <textarea
          id={`${id}-s`}
          rows={2}
          maxLength={MEDIA_SUMMARY_MAX}
          value={value.summary}
          aria-describedby={`${id}-s-left`}
          data-track="ustaad_video_summary"
          onChange={(e) => {
            onChange({ ...value, summary: e.target.value });
          }}
          className={`min-h-12 ${field}`}
        />
        <p id={`${id}-s-left`} className="text-sm text-muted tabular-nums">
          {t('summaryLeft', { n: summaryLeft(value.summary) })}
        </p>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-c`} className="text-[15px] font-bold text-ink">
          {t('captionsLabel')}
        </label>
        <p id={`${id}-c-hint`} className="text-sm leading-relaxed text-muted">
          {t('captionsHint')}
        </p>
        <textarea
          id={`${id}-c`}
          rows={4}
          maxLength={MEDIA_CAPTIONS_MAX}
          value={value.captions}
          aria-describedby={`${id}-c-hint`}
          data-track="ustaad_video_captions"
          onChange={(e) => {
            onChange({ ...value, captions: e.target.value });
          }}
          className={`min-h-24 ${field}`}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-l`} className="text-[15px] font-bold text-ink">
          {t('captionsLang')}
        </label>
        <select
          id={`${id}-l`}
          value={value.lang}
          onChange={(e) => {
            onChange({ ...value, lang: e.target.value === 'en' ? 'en' : 'hi' });
          }}
          className={`min-h-12 ${field}`}
        >
          <option value="hi">{t('captionsLangHi')}</option>
          <option value="en">{t('captionsLangEn')}</option>
        </select>
      </div>
    </div>
  );
}
