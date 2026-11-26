'use client';

import { useTranslations } from 'next-intl';

/**
 * Upload progress for a voice note or photo (spec 23 § 10): a native `<progress>` with the percentage in words, so
 * the state is never colour alone. Shown by composers while `ustaadClient().upload` runs.
 */
export function UploadProgress({ pct }: { pct: number }) {
  const t = useTranslations('ustaad.media');
  const text = pct >= 100 ? t('uploadDone') : t('uploading', { pct });
  return (
    <div className="grid gap-1.5">
      <progress
        max={100}
        value={pct}
        aria-label={text}
        className="h-2 w-full overflow-hidden rounded-full accent-accent-button [&::-webkit-progress-bar]:bg-pill [&::-webkit-progress-value]:bg-accent-button"
      />
      <p className="text-sm font-bold text-ink" aria-hidden="true">
        {text}
      </p>
    </div>
  );
}
