import { beforeEach, describe, expect, it, vi } from 'vitest';

const authed = vi.fn();
vi.mock('../src/lib/orders-api', () => ({ authed: (...a: unknown[]): unknown => authed(...a) }));
vi.mock('../src/lib/analytics', () => ({ track: vi.fn() }));

import { apiUstaadClient } from '../src/lib/ustaad/api-client';
import { demoUstaadClient } from '../src/demo/ustaad';

const COLL = '0193a900-0000-7000-8000-000000000001';
const ITEM = '0193a900-0000-7000-8000-000000000002';

describe('real client: the saves and collections API (spec 23 § 21i)', () => {
  beforeEach(() => {
    authed.mockReset();
    authed.mockResolvedValue({ ok: true, data: null });
  });

  it('lists with the filters in the query string and nothing else', async () => {
    await apiUstaadClient('en').savedList({ kind: 'job', collectionId: COLL, q: 'wiring', cursor: 'c1' });
    const [locale, path, , init] = authed.mock.calls[0] as [string, string, unknown, unknown];
    expect(locale).toBe('en');
    expect(path).toBe(`/ustaad/saves?kind=job&collectionId=${COLL}&q=wiring&cursor=c1`);
    expect(init).toBeUndefined();
    await apiUstaadClient('en').savedList({});
    expect((authed.mock.calls[1] as string[])[1]).toBe('/ustaad/saves');
  });

  it('summary, save and unsave use the kind and id in the path', async () => {
    const c = apiUstaadClient('hi');
    await c.savedSummary();
    await c.setSaved('question', ITEM, true);
    await c.setSaved('lesson', ITEM, false);
    const calls = authed.mock.calls as [string, string, unknown, { method?: string } | undefined][];
    expect(calls[0]?.[1]).toBe('/ustaad/saves/summary');
    expect(calls[1]?.[1]).toBe(`/ustaad/saves/question/${ITEM}`);
    expect(calls[1]?.[3]?.method).toBe('PUT');
    expect(calls[2]?.[3]?.method).toBe('DELETE');
  });

  it('creates, renames and deletes a collection', async () => {
    const c = apiUstaadClient('en');
    await c.createCollection('Wiring');
    await c.renameCollection(COLL, 'Tips', 3);
    await c.deleteCollection(COLL);
    const calls = authed.mock.calls as [string, string, unknown, { method?: string; body?: unknown }][];
    expect(calls[0]?.[1]).toBe('/ustaad/save-collections');
    expect(calls[0]?.[3]).toMatchObject({ method: 'POST', body: { name: 'Wiring' } });
    expect(calls[1]?.[1]).toBe(`/ustaad/save-collections/${COLL}`);
    expect(calls[1]?.[3]).toMatchObject({ method: 'PATCH', body: { name: 'Tips', version: 3 } });
    expect(calls[2]?.[3]).toMatchObject({ method: 'DELETE' });
  });

  it('puts an item in and takes it out of a collection', async () => {
    const c = apiUstaadClient('en');
    await c.setInCollection(COLL, { kind: 'answer', id: ITEM }, true);
    await c.setInCollection(COLL, { kind: 'answer', id: ITEM }, false);
    const calls = authed.mock.calls as [string, string, unknown, { method?: string }][];
    expect(calls[0]?.[1]).toBe(`/ustaad/save-collections/${COLL}/items/answer/${ITEM}`);
    expect(calls[0]?.[3].method).toBe('PUT');
    expect(calls[1]?.[3].method).toBe('DELETE');
  });
});

describe('demo client: the same behaviour without an API', () => {
  it('saves, lists newest first, filters by kind and words, counts per kind', async () => {
    const c = demoUstaadClient();
    const q = await c.questions('all', null);
    const jobs = await c.jobs(null, null);
    if (!q.ok || !jobs.ok) throw new Error('seed');
    const question = q.data.items[0];
    const job = jobs.data.items[0];
    if (!question || !job) throw new Error('seed');
    await c.setSaved('question', question.id, true);
    await c.setSaved('job', job.id, true);
    await c.setSaved('job', job.id, true); // repeat changes nothing
    const all = await c.savedList({});
    expect(all.ok && all.data.items.map((i) => i.kind)).toEqual(['job', 'question']);
    const onlyQ = await c.savedList({ kind: 'question' });
    expect(onlyQ.ok && onlyQ.data.items).toHaveLength(1);
    const word = await c.savedList({ q: question.title?.split(' ')[0] ?? '' });
    expect(word.ok && word.data.items.some((i) => i.kind === 'question')).toBe(true);
    const sum = await c.savedSummary();
    expect(sum.ok && sum.data.total).toBe(2);
    expect(sum.ok && sum.data.counts).toMatchObject({ question: 1, job: 1, post: 0 });
  });

  it('collections: unique ignoring case, rename needs the current version, max 20, unsave empties them', async () => {
    const c = demoUstaadClient();
    const made = await c.createCollection('Wiring');
    if (!made.ok) throw new Error('create');
    const dup = await c.createCollection('wiring');
    expect(dup).toMatchObject({ ok: false, status: 409, code: 'UNIQUE_VIOLATION' });
    const stale = await c.renameCollection(made.data.id, 'Tips', made.data.version + 1);
    expect(stale).toMatchObject({ ok: false, status: 409, code: 'CONFLICT' });
    const renamed = await c.renameCollection(made.data.id, 'Tips', made.data.version);
    expect(renamed.ok && renamed.data.name).toBe('Tips');
    expect(renamed.ok && renamed.data.version).toBe(made.data.version + 1);

    const item = '0193a900-0000-7000-8000-0000000000aa';
    expect(await c.setInCollection(made.data.id, { kind: 'lesson', id: item }, true)).toMatchObject({
      ok: false,
      status: 404,
    }); // save it first
    await c.setSaved('lesson', item, true);
    await c.setInCollection(made.data.id, { kind: 'lesson', id: item }, true);
    const inColl = await c.savedList({ collectionId: made.data.id });
    expect(inColl.ok && inColl.data.items).toHaveLength(1);
    await c.setSaved('lesson', item, false);
    const after = await c.savedList({ collectionId: made.data.id });
    expect(after.ok && after.data.items).toHaveLength(0);

    for (let i = 0; i < 19; i++) await c.createCollection(`C${String(i)}`);
    expect(await c.createCollection('One too many')).toMatchObject({
      ok: false,
      status: 422,
      code: 'USTAAD_SAVE_COLLECTIONS_MAX',
    });
    const gone = await c.deleteCollection(made.data.id);
    expect(gone.ok).toBe(true);
  });
});
