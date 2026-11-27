/**
 * Pure parts of the video-link player (spec 23 § 10b): the iframe attributes, built only from the validated id, and the
 * start clock. Kept apart from the component so they are unit-tested without a DOM.
 */
import { youtubeEmbedUrl, type VideoProvider } from '@mechdost/shared/ustaad/video-links';

export interface EmbedVideo {
  provider: VideoProvider;
  videoId: string;
  startS: number;
}

/**
 * The YouTube player needs scripts and its own origin inside its frame, plus presentation (fullscreen) and popups
 * ("Watch on YouTube" in the player). No top navigation, forms or downloads.
 */
const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups';

export function videoFrameProps(video: EmbedVideo, title: string) {
  return {
    src: youtubeEmbedUrl(video.videoId, video.startS),
    title,
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowFullScreen: true,
    loading: 'lazy' as const,
    referrerPolicy: 'strict-origin-when-cross-origin' as const,
    sandbox: SANDBOX,
  };
}

/** `1:30`, `1:02:03`; null when the video starts at the beginning. */
export function startClock(seconds: number): string | null {
  if (seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
