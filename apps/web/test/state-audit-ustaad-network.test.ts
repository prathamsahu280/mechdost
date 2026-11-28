import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCases, type AuditCase } from '../e2e/state-audit/cases.ts';
import { mocksFor } from '../e2e/state-audit/api-mode/fixtures.ts';
import { groupByDay } from '../src/components/ustaad/messages/view.ts';

/**
 * API-mode fixtures of the Mechanic Network messages, conversation, My network, Discover, composer and story-viewer
 * rows (spec 23 § 21i-L, batch H). Every fixture is schema-checked by the generic fixture test; here each row must
 * answer the calls its screen makes and cover the states the model names.
 */
const ROWS = [
  'API-USTAAD-MESSAGES',
  'API-USTAAD-THREAD',
  'API-USTAAD-NETWORK',
  'API-USTAAD-DISCOVER',
  'API-USTAAD-CREATE',
  'API-USTAAD-STORY-VIEWER',
] as const;
const cases = buildCases().filter((c) => (ROWS as readonly string[]).includes(c.code));
const ofRow = (code: string) => cases.filter((c) => c.code === code);
const has = (rows: AuditCase[], key: string, values: readonly string[]) => {
  for (const v of values)
    expect(
      rows.some((c) => c.state[key] === v),
      `${key}=${v}`,
    ).toBe(true);
};

interface Out {
  status?: number;
  body?: unknown;
  code?: string;
  delayMs?: number;
}
const call = (
  c: AuditCase,
  method: string,
  path: string,
  query = '',
  body: unknown = null,
): Out | undefined => {
  const mock = mocksFor(c).find((m) => m.method === method && m.path.test(path));
  return mock?.reply({ c, method: mock.method, path, query: new URLSearchParams(query), body });
};
const body = (r: Out | undefined): unknown => r?.body;

const THREAD = '/ustaad/threads/0193a000-0000-7000-8000-000000000301';
interface Thread {
  status: string;
  mine: boolean;
  unread: boolean;
  muted: boolean;
  other: { displayName: string; displayNameHi: string | null };
  last?: { kind: string; text: string | null } | null;
}
interface Msg {
  mine: boolean;
  kind: string;
  text: string | null;
  pending: boolean;
  read: boolean;
  createdAt: string;
}
interface ThreadPage {
  items: Thread[];
  nextCursor: string | null;
}
interface MessagePage {
  thread: Thread;
  items: Msg[];
  nextCursor: string | null;
}
const LONG = 60;

describe('Mechanic Network messages, conversation, network, discover, composer and story rows', () => {
  it('has the six rows with real sign-in, light and dark, en and hi, long names', () => {
    for (const code of ROWS) {
      const rows = ofRow(code);
      expect(rows.length, code).toBeGreaterThan(0);
      expect(new Set(rows.map((c) => c.theme)).size, `${code} themes`).toBe(2);
      expect(new Set(rows.map((c) => c.locale)).size, `${code} locales`).toBe(2);
      for (const c of rows) expect(c.realApi, c.id).toBe(true);
    }
    for (const code of ROWS.filter((r) => r !== 'API-USTAAD-STORY-VIEWER'))
      expect(
        ofRow(code).some((c) => c.state.stress === 'long-text'),
        `${code} long text`,
      ).toBe(true);
  });

  it('every case answers the member gate and the calls its screen makes', () => {
    const wanted: Record<string, string[]> = {
      'API-USTAAD-MESSAGES': ['GET /ustaad/threads', 'GET /ustaad/discover'],
      'API-USTAAD-THREAD': [`GET ${THREAD}/messages`, `POST ${THREAD}/read`, 'GET /ustaad/media/m1/url'],
      'API-USTAAD-NETWORK': ['GET /ustaad/follows', 'GET /ustaad/connections', 'GET /ustaad/blocks'],
      'API-USTAAD-DISCOVER': [
        'GET /ustaad/discover',
        'GET /ustaad/discover/tags',
        'GET /ustaad/discover/top-posts',
      ],
      'API-USTAAD-CREATE': [
        'GET /ustaad/tags',
        'POST /ustaad/correct',
        'POST /ustaad/posts',
        'POST /ustaad/stories',
      ],
      'API-USTAAD-STORY-VIEWER': [
        'GET /ustaad/stories',
        'POST /ustaad/stories/s1/view',
        'GET /ustaad/media/m1/url',
      ],
    };
    for (const c of cases) {
      expect(call(c, 'GET', '/ustaad/me'), `${c.id} me`).toBeDefined();
      for (const w of wanted[c.code] ?? []) {
        const [method = 'GET', path = ''] = w.split(' ');
        expect(
          call(c, method, path, 'box=inbox&kind=followers&q=somebody&tab=for_you'),
          `${c.id} ${w}`,
        ).toBeDefined();
      }
    }
  });

  it('messages: inbox rows with previews and a requests group, requests, sent, empty, more, error', () => {
    const rows = ofRow('API-USTAAD-MESSAGES');
    has(rows, 'box', ['inbox', 'requests', 'sent', 'empty', 'more', 'error']);
    const list = (c: AuditCase, box: string, cursor = '') =>
      call(c, 'GET', '/ustaad/threads', `box=${box}${cursor ? `&cursor=${cursor}` : ''}`);
    for (const c of rows.filter((x) => x.state.to === 'none')) {
      const wantBox = ['requests', 'sent'].includes(String(c.state.box)) ? String(c.state.box) : 'inbox';
      expect(c.path, c.id).toBe(wantBox === 'inbox' ? '/ustaad/messages' : `/ustaad/messages?box=${wantBox}`);
      const r = list(c, wantBox);
      if (c.state.box === 'error') {
        expect(r?.status, c.id).toBe(500);
        continue;
      }
      const page = body(r) as ThreadPage;
      if (c.state.box === 'empty') expect(page.items, c.id).toEqual([]);
      if (c.state.box === 'inbox' || c.state.box === 'more') {
        const kinds = new Set(page.items.map((t) => t.last?.kind ?? 'none'));
        for (const k of ['text', 'voice', 'photo', 'post_share', 'none'])
          expect(kinds.has(k), `${c.id} ${k}`).toBe(true);
        expect(
          page.items.some((t) => t.unread),
          `${c.id} unread`,
        ).toBe(true);
        expect(
          page.items.some((t) => t.muted),
          `${c.id} muted`,
        ).toBe(true);
        expect(
          (body(list(c, 'requests')) as ThreadPage).items.length,
          `${c.id} requests group`,
        ).toBeGreaterThan(0);
        expect(page.nextCursor === null, `${c.id} cursor`).toBe(c.state.box === 'inbox');
      }
      if (c.state.box === 'more') {
        const rest = body(list(c, 'inbox', 'next1')) as ThreadPage;
        expect(rest.items.length, c.id).toBeGreaterThan(0);
        expect(rest.nextCursor, c.id).toBeNull();
      }
      if (c.state.box === 'requests')
        expect(
          page.items.every((t) => t.status === 'requested' && !t.mine),
          c.id,
        ).toBe(true);
      if (c.state.box === 'sent')
        expect(
          page.items.every((t) => t.status === 'requested' && t.mine),
          c.id,
        ).toBe(true);
      if (c.state.stress === 'long-text' && page.items[0])
        expect(page.items[0].other.displayName.length, c.id).toBeGreaterThan(LONG);
    }
  });

  it('messages: the request form, its field error, not found and an existing conversation', () => {
    const rows = ofRow('API-USTAAD-MESSAGES');
    has(rows, 'to', ['none', 'form', 'form-errors', 'not-found', 'existing']);
    for (const c of rows.filter((x) => x.state.to !== 'none')) {
      expect(c.path, c.id).toBe('/ustaad/messages?to=somebody');
      const found = (
        body(call(c, 'GET', '/ustaad/discover', 'q=somebody')) as { items: { id: string; handle: string }[] }
      ).items.find((m) => m.handle === 'somebody');
      expect(found !== undefined, `${c.id} found`).toBe(c.state.to !== 'not-found');
      if (!found) continue;
      const rel = body(call(c, 'GET', `/ustaad/members/${found.id}/relationship`)) as {
        threadId: string | null;
      };
      expect(rel.threadId !== null, `${c.id} thread`).toBe(c.state.to === 'existing');
      if (c.state.to === 'existing')
        expect(call(c, 'GET', `${THREAD}/messages`)?.status ?? 200, `${c.id} opens`).toBe(200);
    }
  });

  it('thread: every state, day separators, every bubble kind, older messages, error, long en and hi', () => {
    const rows = ofRow('API-USTAAD-THREAD');
    has(rows, 'thread', ['open', 'held', 'decide', 'waiting', 'closed', 'blocked', 'older', 'error']);
    has(rows, 'panel', ['text', 'voice', 'photo', 'more', 'report', 'block-confirm']);
    const page = (c: AuditCase, cursor = '') =>
      body(call(c, 'GET', `${THREAD}/messages`, cursor ? `cursor=${cursor}` : '')) as MessagePage;
    for (const c of rows) {
      if (c.state.thread === 'error') {
        expect(call(c, 'GET', `${THREAD}/messages`)?.status, c.id).toBe(500);
        continue;
      }
      const p = page(c);
      const want =
        { decide: 'requested', waiting: 'requested', closed: 'declined' }[String(c.state.thread)] ?? 'open';
      expect(p.thread.status, c.id).toBe(want);
      expect(p.thread.mine, c.id).toBe(c.state.thread !== 'decide');
      if (c.state.thread === 'open') {
        for (const k of ['text', 'voice', 'photo', 'post_share'])
          expect(
            p.items.some((m) => m.kind === k),
            `${c.id} ${k}`,
          ).toBe(true);
        expect(groupByDay([...p.items].reverse()).length, `${c.id} day separators`).toBeGreaterThanOrEqual(3);
        expect(
          p.items.some((m) => m.mine && m.read),
          `${c.id} seen`,
        ).toBe(true);
        expect(
          p.items.some((m) => m.mine && !m.read && !m.pending),
          `${c.id} sent`,
        ).toBe(true);
        expect(
          p.items.some((m) => !m.mine),
          `${c.id} theirs`,
        ).toBe(true);
      }
      expect(
        p.items.some((m) => m.pending),
        `${c.id} held`,
      ).toBe(c.state.thread === 'held');
      expect(p.nextCursor !== null, `${c.id} older`).toBe(c.state.thread === 'older');
      if (c.state.thread === 'older') {
        const older = page(c, 'older1');
        expect(older.items.length, c.id).toBeGreaterThan(0);
        expect(older.nextCursor, c.id).toBeNull();
      }
      if (c.state.stress === 'long-text') {
        expect(p.thread.other.displayName.length, `${c.id} name`).toBeGreaterThan(LONG);
        expect(p.thread.other.displayNameHi?.length ?? 0, `${c.id} name hi`).toBeGreaterThan(LONG);
        expect(
          p.items.some((m) => (m.text?.length ?? 0) > 120),
          `${c.id} text`,
        ).toBe(true);
      }
    }
    // The writes the panels reach: block (More → Block → Yes), report, mute, accept and decline.
    const c = rows[0];
    if (!c) throw new Error('no thread rows');
    expect(call(c, 'PUT', '/ustaad/blocks/m1')?.body).toEqual({ blocked: true });
    expect(call(c, 'POST', '/ustaad/reports')?.body).toHaveProperty('code');
    expect(call(c, 'POST', `${THREAD}/accept`)?.body).toEqual({ status: 'open' });
  });

  it('network: five tabs at their addresses, one, many, empty and error lists', () => {
    const rows = ofRow('API-USTAAD-NETWORK');
    has(rows, 'tab', ['followers', 'following', 'connections', 'requests', 'blocked']);
    has(rows, 'list', ['empty', 'one', 'more', 'error']);
    const count = (c: AuditCase, path: string, query: string) =>
      body(call(c, 'GET', path, query)) as { items: unknown[]; nextCursor: string | null };
    for (const c of rows) {
      expect(c.path, c.id).toBe(
        c.state.tab === 'followers' ? '/ustaad/network' : `/ustaad/network?tab=${c.state.tab}`,
      );
      const tab = String(c.state.tab);
      const [path, query] =
        tab === 'followers' || tab === 'following'
          ? ['/ustaad/follows', `kind=${tab}`]
          : tab === 'connections'
            ? ['/ustaad/connections', 'box=connected']
            : tab === 'requests'
              ? ['/ustaad/connections', 'box=incoming']
              : ['/ustaad/blocks', ''];
      if (!path) continue;
      const r = call(c, 'GET', path, query);
      if (c.state.list === 'error') {
        expect(r?.status, c.id).toBe(500);
        continue;
      }
      if (tab === 'blocked') {
        const b = body(r) as { blocked: unknown[]; muted: unknown[] };
        expect(b.blocked.length === 0, `${c.id} blocked`).toBe(c.state.list === 'empty');
        continue;
      }
      const p = count(c, path, query);
      if (c.state.list === 'empty') expect(p.items, c.id).toEqual([]);
      if (c.state.list === 'one') expect(p.items.length, c.id).toBe(1);
      if (c.state.list === 'more') {
        expect(p.items.length, c.id).toBeGreaterThan(1);
        expect(p.nextCursor, c.id).not.toBeNull();
      }
      if (tab === 'requests' && c.state.list !== 'empty')
        expect(
          count(c, '/ustaad/connections', 'box=outgoing').items.length,
          `${c.id} outgoing`,
        ).toBeGreaterThan(0);
    }
  });

  it('discover: top helpers, search, filters, no match, more, daily cap, error', () => {
    const rows = ofRow('API-USTAAD-DISCOVER');
    has(rows, 'discover', ['top', 'search', 'filters', 'no-match', 'more', 'cap', 'error']);
    interface Person {
      isNew: boolean;
      distanceBand: string | null;
      verified: boolean;
      followers: number | null;
    }
    for (const c of rows) {
      const want =
        { search: '?q=suresh', filters: '?work=battery&level=pakka', 'no-match': '?q=zzzz' }[
          String(c.state.discover)
        ] ?? '';
      expect(c.path, c.id).toBe(`/ustaad/discover${want}`);
      const r = call(c, 'GET', '/ustaad/discover', want.replace('?', ''));
      if (c.state.discover === 'error') {
        expect(r?.status, c.id).toBe(500);
        continue;
      }
      const p = body(r) as { items: Person[]; nextCursor: string | null };
      expect(p.items.length === 0, c.id).toBe(c.state.discover === 'no-match');
      expect(p.nextCursor !== null, c.id).toBe(c.state.discover === 'more');
      if (c.state.discover === 'more')
        expect(
          (body(call(c, 'GET', '/ustaad/discover', 'cursor=next1')) as { nextCursor: string | null })
            .nextCursor,
        ).toBeNull();
      if (c.state.discover === 'top') {
        expect(
          p.items.some((x) => x.isNew),
          `${c.id} new`,
        ).toBe(true);
        expect(
          p.items.some((x) => x.distanceBand !== null),
          `${c.id} band`,
        ).toBe(true);
        expect(
          p.items.some((x) => x.verified),
          `${c.id} verified`,
        ).toBe(true);
        expect(
          (body(call(c, 'GET', '/ustaad/discover/tags')) as { items: unknown[] }).items.length,
        ).toBeGreaterThan(0);
        expect(
          (body(call(c, 'GET', '/ustaad/discover/top-posts')) as { items: unknown[] }).items.length,
        ).toBeGreaterThan(0);
      }
    }
    const cap = rows.find((c) => c.state.discover === 'cap');
    expect(call(cap ?? rows[0]!, 'POST', '/ustaad/connections')).toMatchObject({
      status: 429,
      code: 'USTAAD_DAILY_CAP',
    });
  });

  it('create: the story address, every kind, each result word, upload held back', () => {
    const rows = ofRow('API-USTAAD-CREATE');
    has(rows, 'mode', ['post', 'story']);
    has(rows, 'kind', [
      'none',
      'voice',
      'photo',
      'video',
      'text',
      'poll',
      'link',
      'document',
      'fix_log',
      'tip',
      'before_after',
    ]);
    has(rows, 'result', ['idle', 'uploading', 'posted', 'held', 'daily-cap', 'links-locked', 'tag-unknown']);
    for (const c of rows) {
      expect(c.path, c.id).toBe(c.state.mode === 'story' ? '/ustaad/create?story=1' : '/ustaad/create');
      const url = c.state.mode === 'story' ? '/ustaad/stories' : '/ustaad/posts';
      const r = call(c, 'POST', url);
      const result = String(c.state.result);
      const words = {
        'daily-cap': 'USTAAD_DAILY_CAP',
        'links-locked': 'USTAAD_LINKS_LOCKED',
        'tag-unknown': 'USTAAD_TAG_UNKNOWN',
      }[result];
      if (words) expect(r, c.id).toMatchObject({ code: words });
      else
        expect((body(r) as { status: string }).status, c.id).toBe(result === 'held' ? 'held' : 'published');
      const put = call(c, 'PUT', '/ustaad/media/upload/sink');
      expect(put?.delayMs ?? 0, `${c.id} upload`).toBe(result === 'uploading' ? 15_000 : 0);
    }
    const c = rows[0];
    if (!c) throw new Error('no create rows');
    expect(
      (body(call(c, 'GET', '/ustaad/tags', 'q=bat')) as { tags: unknown[] }).tags.length,
    ).toBeGreaterThan(0);
    expect((body(call(c, 'POST', '/ustaad/correct')) as { changed: boolean }).changed).toBe(false);
    expect(call(c, 'POST', '/ustaad/media')?.body).toHaveProperty('put');
    expect(call(c, 'POST', '/ustaad/media/m1/complete')?.body).toBeDefined();
  });

  it('story viewer: photo, voice, video and own story with Seen by', () => {
    const rows = ofRow('API-USTAAD-STORY-VIEWER');
    has(rows, 'story', ['photo', 'voice', 'video', 'mine']);
    has(rows, 'playback', ['running', 'paused']);
    interface Ring {
      mine: boolean;
      stories: { media: { kind: string }[]; seenBy: number | null }[];
    }
    const kindOf = { photo: 'image', voice: 'audio', video: 'video' } as const;
    for (const c of rows) {
      const rings = (body(call(c, 'GET', '/ustaad/stories')) as { rings: Ring[] }).rings;
      const first = rings[0];
      expect(first, c.id).toBeDefined();
      if (c.state.story === 'mine') {
        expect(first?.mine, c.id).toBe(true);
        expect(first?.stories[0]?.seenBy ?? 0, c.id).toBeGreaterThan(0);
      } else {
        expect(first?.mine, c.id).toBe(false);
        expect(first?.stories[0]?.media[0]?.kind, c.id).toBe(kindOf[c.state.story as keyof typeof kindOf]);
        expect(first?.stories[0]?.seenBy, c.id).toBeNull();
      }
      expect(first?.stories.length, `${c.id} more than one story`).toBeGreaterThan(1);
    }
  });

  it('the page set-up presses what each row needs (hooks.ts)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../e2e/state-audit/api-mode/hooks.ts', import.meta.url)),
      'utf8',
    );
    for (const code of [
      'API-USTAAD-MESSAGES',
      'API-USTAAD-THREAD',
      'API-USTAAD-DISCOVER',
      'API-USTAAD-CREATE',
      'API-USTAAD-STORY-VIEWER',
    ])
      expect(src, code).toContain(`'${code}'`);
  });
});
