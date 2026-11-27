/**
 * Video links in Ustaad posts (spec 23 § 10b; founder 2026-11-28). Pure, shared by the DTO, the API and the website.
 * A pasted URL is recognised only when its host is exactly one of the allow-listed YouTube hosts, its path has one of
 * the known shapes and the video id matches `^[A-Za-z0-9_-]{11}$`; anything else is not a video (it may still be a
 * plain link card). Every URL we show or fetch (watch, embed, thumbnail, oEmbed) is rebuilt from the validated id,
 * never from the raw string, so no user-controlled host or path ever reaches a fetch, an iframe or an `<img>`.
 */
import { safeLinkUrl } from './links';

export const VIDEO_PROVIDERS = ['youtube'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** Longest start offset we keep (12 h); anything above is ignored, not refused. */
export const VIDEO_START_MAX_S = 43_200;

export interface VideoLink {
  provider: VideoProvider;
  videoId: string;
  /** Seconds from the start; 0 when the link has none. */
  startS: number;
}

const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const EMBED_HOSTS = new Set([...WATCH_HOSTS, 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
const SHORT_HOST = 'youtu.be';
const PATH_KINDS = new Set(['shorts', 'live', 'embed']);

/** `90`, `90s`, `1m30s`, `1h2m3s` → seconds; null when malformed. */
function parseStart(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const m = /^(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?$/.exec(raw);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return s <= VIDEO_START_MAX_S ? s : null;
}

function idFromPath(u: URL): string | null {
  const parts = u.pathname.split('/').filter((p) => p !== '');
  if (u.hostname === SHORT_HOST) return parts.length === 1 ? (parts[0] ?? null) : null;
  if (parts.length === 1 && parts[0] === 'watch' && WATCH_HOSTS.has(u.hostname))
    return u.searchParams.get('v');
  if (parts.length === 2 && PATH_KINDS.has(parts[0] ?? '') && EMBED_HOSTS.has(u.hostname))
    return parts[1] ?? null;
  return null;
}

/** The video a pasted link points at, or null when it is not a recognised video link. */
export function parseVideoLink(raw: string): VideoLink | null {
  const safe = safeLinkUrl(raw);
  if (!safe) return null;
  const u = new URL(safe);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host !== SHORT_HOST && !EMBED_HOSTS.has(host)) return null;
  const id = idFromPath(u);
  if (id === null || !YOUTUBE_ID_RE.test(id)) return null;
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const startS = parseStart(u.searchParams.get('t') ?? u.searchParams.get('start') ?? hash.get('t')) ?? 0;
  return { provider: 'youtube', videoId: id, startS };
}

function assertId(id: string): string {
  if (!YOUTUBE_ID_RE.test(id)) throw new Error('Invalid video id');
  return id;
}

/** The canonical link: what the blocked-sites list, the preview cache and "Open in YouTube" use. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${assertId(id)}`;
}

/** Privacy-enhanced embed, loaded only after the tap (no YouTube JS before it). */
export function youtubeEmbedUrl(id: string, startS: number): string {
  const start =
    Number.isInteger(startS) && startS > 0 && startS <= VIDEO_START_MAX_S ? `&start=${startS}` : '';
  return `https://www.youtube-nocookie.com/embed/${assertId(id)}?autoplay=1&rel=0${start}`;
}

/** The 480×360 still on YouTube's image host (allowed in `img-src` and `images.remotePatterns`). */
export function youtubeThumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${assertId(id)}/hqdefault.jpg`;
}

/** The oEmbed endpoint on the fixed host; the only URL the preview fetcher ever requests for a video. */
export function youtubeOEmbedUrl(id: string): string {
  return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(id))}`;
}
