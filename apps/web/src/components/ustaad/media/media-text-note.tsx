'use client';

import { useTranslations } from 'next-intl';

/**
 * The text under a video (spec 23 § 10a; WCAG 1.2.2): the author's typed summary as a labelled card, and a visible
 * "No captions" note when the video has none, so nobody has to discover it by playing.
 */
export function MediaTextNote({
  summary,
  captioned,
  video,
}: {
  summary: string | null;
  captioned: boolean;
  video?: boolean;
}) {
  const t = useTranslations('ustaad.media');
  const text = summary?.trim() ? summary.trim() : null;
  if (!text && (!video || captioned)) return null;
  return (
    <div className="grid gap-1 px-4 pt-2 text-[15px] leading-relaxed">
      {text ? (
        <p className="text-ink" data-user-content>
          <span className="font-bold">{t('summaryOf')}: </span>
          {text}
        </p>
      ) : null}
      {video && !captioned ? <p className="text-sm text-muted">{t('noCaptions')}</p> : null}
    </div>
  );
}
