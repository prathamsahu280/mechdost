'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import { parseVideoLink } from '@mechdost/shared/ustaad/video-links';
import { track } from '@/lib/analytics';
import { LinkEmbed } from './link-embed';

/**
 * Under the composer's link field (spec 23 § 10b): when the pasted URL is a recognised video, the same facade the feed
 * shows (thumbnail from the id; the title arrives from oEmbed once posted) and a note that it will play in the post.
 * Parsing is the shared allow-list, so what is previewed here is exactly what the API will accept as a video.
 */
export function VideoLinkComposerPreview({ url }: { url: string }) {
  const t = useTranslations('ustaad.videoLink');
  const video = useMemo(() => parseVideoLink(url.trim()), [url]);
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (!video || tracked.current === video.videoId) return;
    tracked.current = video.videoId;
    track('ustaad_video_link_added', { provider: video.provider });
  }, [video]);
  if (!video) return null;
  return (
    <div className="-mx-4 grid gap-2">
      <p role="status" className="mx-4 text-sm font-bold text-ink">
        {t('recognised')}
      </p>
      <LinkEmbed video={{ ...video, title: null, author: null }} />
    </div>
  );
}
