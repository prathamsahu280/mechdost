/**
 * YouTube oEmbed for video-link posts (spec 23 § 10b; SSRF note in spec 13). Requests only the fixed URL
 * `https://www.youtube.com/oembed?format=json&url=<canonical watch URL>`, built from a validated 11-character id, so no
 * user-controlled host, path or port is ever fetched; redirects are refused, 3 s in total, 64 KB of body, JSON checked
 * with Zod, and only `title` and `author_name` are kept as plain text (the returned `html` and `thumbnail_url` are
 * ignored: the player and thumbnail URLs are rebuilt from the id). Never throws: failures are null and the post goes
 * up with the id only. No duration: oEmbed does not return one and we do not scrape the watch page.
 */
import { z } from 'zod';
import { YOUTUBE_ID_RE, youtubeOEmbedUrl } from '@mechdost/shared/ustaad/video-links';

export const OEMBED_TIMEOUT_MS = 3000;
export const OEMBED_MAX_BYTES = 64 * 1024;

export interface OEmbedDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export interface VideoMeta {
  title: string | null;
  author: string | null;
}

const OEmbedJson = z.object({
  title: z.string().optional(),
  author_name: z.string().optional(),
});

const clean = (s: string | undefined, max: number): string | null => {
  if (s === undefined) return null;
  const v = s
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return v ? v.slice(0, max) : null;
};

async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > max) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > max ? null : buf.toString('utf8');
}

export async function fetchYouTubeOEmbed(videoId: string, deps: OEmbedDeps): Promise<VideoMeta | null> {
  if (!YOUTUBE_ID_RE.test(videoId)) return null;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, deps.timeoutMs ?? OEMBED_TIMEOUT_MS);
  });
  const run = async (): Promise<VideoMeta | null> => {
    const res = await deps.fetch(youtubeOEmbedUrl(videoId), {
      redirect: 'error',
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (res.status !== 200) return null;
    if (!(res.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return null;
    const text = await readCapped(res, OEMBED_MAX_BYTES);
    if (text === null) return null;
    const parsed = OEmbedJson.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    return { title: clean(parsed.data.title, 200), author: clean(parsed.data.author_name, 100) };
  };
  try {
    return await Promise.race([run().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The real fetcher: global fetch (no cookies, redirects refused by the caller's init). */
export function defaultOEmbedDeps(): OEmbedDeps {
  return { fetch: (url, init) => fetch(url, init) };
}
