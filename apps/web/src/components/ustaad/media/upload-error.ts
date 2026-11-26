'use client';

import { useTranslations } from 'next-intl';
import { useErrorText } from '../common';

/** Upload error text (`ustaad.media.err_MEDIA_*`), else the screen's own error text. Pages using it load `ustaad.media`. */
export function useUploadErrorText(ns: 'qa' | 'local' | 'jobs') {
  const m = useTranslations('ustaad.media');
  const fallback = useErrorText(ns);
  return (code: string): string => {
    const key = `err_${code}` as 'err_MEDIA_TYPE';
    return m.has(key) ? m(key) : fallback(code);
  };
}
