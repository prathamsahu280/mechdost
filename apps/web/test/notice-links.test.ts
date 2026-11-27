/**
 * SIM-P19 (Ustaad QA 2026-11-27): bell notices linked to `/ustaad/notifications`, `/ustaad/me/verify` and
 * `/ustaad/jobs/mine`, none of which was a page. Every catalogued link must resolve to a page in the route tree.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTICE_CATALOGUE, noticeKinds } from '@mechdost/shared/notice-catalogue';

const APP = join(__dirname, '..', 'src', 'app', '[locale]');

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === 'page.tsx') out.push(relative(APP, dir));
  }
  return out;
}

/** Route patterns: `[x]` is any one segment, `[...x]` any rest, `(group)` folders are not in the URL. */
// `[...rest]` at the root only renders the not-found page, so it never counts as a destination.
const PATTERNS = pages(APP)
  .filter((rel) => rel !== '[...rest]')
  .map((rel) => {
    const segs = rel
      .split(sep)
      .filter((s) => s !== '' && !/^\(.*\)$/.test(s))
      .map((s) =>
        s.startsWith('[...') ? '.+' : s.startsWith('[') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      );
    return new RegExp(`^/${segs.join('/')}$`.replace(/^\/\$$/, '^/$'));
  });

const SAMPLE: Record<string, string> = new Proxy({}, { get: () => 'SAMPLE1' });

describe('notice links resolve to real pages (SIM-P19)', () => {
  it.each(noticeKinds())('%s', (kind) => {
    // With every placeholder filled; a reply without a post id has a fallback link, checked with no params too.
    for (const params of kind === 'ustaad.reply' ? [SAMPLE, {}] : [SAMPLE]) {
      const raw = NOTICE_CATALOGUE[kind].link(params);
      const bare = (raw.split('?')[0] ?? '').replace(/\/$/, '');
      const path = bare === '' ? '/' : bare;
      expect(
        PATTERNS.some((re) => re.test(path)),
        `${kind} → ${path}`,
      ).toBe(true);
    }
  });
});
