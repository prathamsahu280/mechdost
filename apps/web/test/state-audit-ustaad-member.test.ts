import { describe, expect, it } from 'vitest';
import { buildCases, type AuditCase } from '../e2e/state-audit/cases.ts';
import { mocksFor } from '../e2e/state-audit/api-mode/fixtures.ts';
import { serverReply } from '../e2e/state-audit/api-mode/server-mock.ts';

/**
 * State-audit rows and API-mode fixtures of the Mechanic Network Learn, Jobs and Saved screens (spec 23 § 21i-L,
 * batch D1). Every fixture is parsed with the shared schema the screen parses with (the generic fixture test does it
 * for all API rows; here the rows must exist, answer every call the screen makes and cover the named states).
 */
const ROWS = ['API-USTAAD-LEARN', 'API-USTAAD-JOBS', 'API-USTAAD-SAVED'] as const;
const cases = buildCases().filter((c) => (ROWS as readonly string[]).includes(c.code));
const ofRow = (code: string) => cases.filter((c) => c.code === code);

const call = (c: AuditCase, method: string, path: string, query = '') => {
  const mock = mocksFor(c).find((m) => m.method === method && m.path.test(path));
  return mock?.reply({ c, method: mock.method, path, query: new URLSearchParams(query), body: null });
};

describe('Mechanic Network member rows', () => {
  it('has the three rows, real sign-in, at the screens paths', () => {
    for (const code of ROWS) expect(ofRow(code).length, code).toBeGreaterThan(0);
    expect(ofRow('API-USTAAD-LEARN')[0]?.path).toBe('/ustaad/learn');
    expect(ofRow('API-USTAAD-JOBS')[0]?.path).toBe('/ustaad/jobs');
    expect(ofRow('API-USTAAD-SAVED')[0]?.path).toBe('/ustaad/saved');
    for (const c of cases) expect(c.realApi, c.id).toBe(true);
  });

  it('runs every row at the four widths, light and dark, English and Hindi', () => {
    for (const code of ROWS) {
      const rows = ofRow(code);
      for (const w of [320, 390, 768, 1280])
        expect(
          rows.some((c) => c.width === w),
          `${code} ${w}`,
        ).toBe(true);
      expect(new Set(rows.map((c) => c.theme)).size, code).toBe(2);
      expect(new Set(rows.map((c) => c.locale)).size, code).toBe(2);
      expect(
        rows.some((c) => c.state.stress === 'long-text'),
        `${code} long names`,
      ).toBe(true);
    }
  });

  it('every case answers the member gate, the card strip and the screen data', () => {
    for (const c of cases) {
      expect(call(c, 'GET', '/ustaad/me')?.status ?? 200, `${c.id} me`).toBe(200);
      const wanted =
        c.code === 'API-USTAAD-LEARN'
          ? ['/ustaad/learn', '/ustaad/me/card']
          : c.code === 'API-USTAAD-JOBS'
            ? ['/ustaad/jobs']
            : ['/ustaad/saves/summary', '/ustaad/saves'];
      for (const p of wanted) expect(call(c, 'GET', p), `${c.id} ${p}`).toBeDefined();
    }
  });

  it('Learn: sizes, a Continue lesson and the saved flag on and off', () => {
    const lessons = (c: AuditCase) => {
      const body = call(c, 'GET', '/ustaad/learn')?.body as {
        courses: { resources: Record<string, unknown>[] }[];
        loose: Record<string, unknown>[];
      };
      return [...body.courses.flatMap((x) => x.resources), ...body.loose];
    };
    const rows = ofRow('API-USTAAD-LEARN');
    const filled = rows.filter((c) => c.state.lessons === 'list');
    expect(filled.length).toBeGreaterThan(0);
    for (const c of filled) {
      const l = lessons(c);
      expect(
        l.some((r) => typeof r.sizeBytes === 'number'),
        `${c.id} sizes`,
      ).toBe(true);
      expect(
        l.some((r) => r.url !== null && r.sizeBytes === null),
        `${c.id} a link has no size`,
      ).toBe(true);
      expect(
        l.every((r) => r.savedByMe === (c.state.saved === 'on')),
        `${c.id} flag`,
      ).toBe(true);
      const cont = l.some((r) => r.mediaId !== null && !r.completed && r.lastWatchedAt !== null);
      expect(cont, `${c.id} continue`).toBe(c.state.continue === 'yes');
    }
    expect(rows.some((c) => c.state.saved === 'on')).toBe(true);
    expect(rows.some((c) => c.state.saved === 'off')).toBe(true);
    for (const c of rows.filter((x) => x.state.lessons === 'empty')) expect(lessons(c)).toEqual([]);
  });

  it('Jobs: employer with and without Verified garage, saved flag, empty list', () => {
    const rows = ofRow('API-USTAAD-JOBS');
    const items = (c: AuditCase) =>
      (
        call(c, 'GET', '/ustaad/jobs')?.body as {
          items: { savedByMe: boolean; employer: { verified: boolean } | null }[];
        }
      ).items;
    for (const c of rows.filter((x) => x.state.list === 'few')) {
      const jobs = items(c);
      expect(jobs.length, c.id).toBeGreaterThan(0);
      expect(
        jobs.every((j) => j.savedByMe === (c.state.saved === 'on')),
        `${c.id} flag`,
      ).toBe(true);
      const verified = jobs.some((j) => j.employer?.verified === true);
      expect(verified, `${c.id} verified`).toBe(c.state.employer === 'verified');
      if (c.state.employer === 'none') expect(jobs.every((j) => j.employer === null)).toBe(true);
    }
    for (const c of rows.filter((x) => x.state.list === 'empty')) expect(items(c)).toEqual([]);
    expect(rows.some((c) => c.state.employer === 'verified')).toBe(true);
    expect(rows.some((c) => c.state.employer === 'unverified')).toBe(true);
    expect(rows.some((c) => c.state.employer === 'none')).toBe(true);
  });

  it('Saved: every kind, an empty list, a collection', () => {
    const rows = ofRow('API-USTAAD-SAVED');
    const page = (c: AuditCase, q = '') =>
      call(c, 'GET', '/ustaad/saves', q)?.body as { items: { kind: string; collectionIds: string[] }[] };
    for (const c of rows.filter((x) => x.state.list === 'items')) {
      const kinds = new Set(page(c).items.map((i) => i.kind));
      for (const k of ['post', 'question', 'answer', 'job', 'lesson'])
        expect(kinds.has(k), `${c.id} ${k}`).toBe(true);
    }
    for (const c of rows.filter((x) => x.state.list === 'empty')) {
      expect(page(c).items).toEqual([]);
      const s = call(c, 'GET', '/ustaad/saves/summary')?.body as { total: number };
      expect(s.total).toBe(0);
    }
    const withCollection = rows.filter((x) => x.state.list === 'collection');
    expect(withCollection.length).toBeGreaterThan(0);
    for (const c of withCollection) {
      const s = call(c, 'GET', '/ustaad/saves/summary')?.body as { collections: { id: string }[] };
      expect(s.collections.length, c.id).toBeGreaterThan(0);
      const id = s.collections[0]?.id ?? '';
      const inside = page(c, `collectionId=${id}`).items;
      expect(inside.length).toBeGreaterThan(0);
      expect(inside.every((i) => i.collectionIds.includes(id))).toBe(true);
    }
  });

  it('the server render may open the network: /ustaad-access answers open', () => {
    const r = serverReply('GET', '/v1/ustaad-access', new URLSearchParams());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ access: 'open' });
  });
});
