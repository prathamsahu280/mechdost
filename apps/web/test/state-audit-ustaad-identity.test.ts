import { describe, expect, it } from 'vitest';
import { buildCases, type AuditCase } from '../e2e/state-audit/cases.ts';
import { mocksFor } from '../e2e/state-audit/api-mode/fixtures.ts';

/**
 * API-mode fixtures of the Mechanic Network join, welcome, attest, partner-status, share-teaser, post-sheet and tag
 * rows (spec 23 § 21i-L, batch I). Every fixture is schema-checked by the generic fixture test; here each row must
 * answer the calls its screen makes and cover every state the model declares.
 */
const ROWS = [
  'API-USTAAD-JOIN',
  'API-USTAAD-WELCOME',
  'API-USTAAD-ATTEST',
  'API-USTAAD-PARTNERS-STATUS',
  'API-USTAAD-TEASER',
  'API-USTAAD-POST-SHEETS',
  'API-USTAAD-TAG-SAVED',
] as const;
const cases = buildCases().filter((c) => (ROWS as readonly string[]).includes(c.code));
const ofRow = (code: string) => cases.filter((c) => c.code === code);

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb';
const POST = '00000000-0000-7000-8000-000000000001';

const call = (c: AuditCase, method: string, path: string, query = '', body: unknown = null) => {
  const mock = mocksFor(c).find((m) => m.method === method && m.path.test(path));
  return mock?.reply({ c, method: mock.method, path, query: new URLSearchParams(query), body });
};
const states = (code: string, key: string) => new Set(ofRow(code).map((c) => String(c.state[key])));

describe('Mechanic Network identity, share and tag rows', () => {
  it('has the seven rows with real sign-in', () => {
    for (const code of ROWS) expect(ofRow(code).length, code).toBeGreaterThan(0);
    for (const c of cases) expect(c.realApi, c.id).toBe(true);
  });

  it('every case answers the calls its screen makes', () => {
    for (const c of cases) {
      const need: [string, string, string?][] = {
        'API-USTAAD-JOIN': [['POST', '/ustaad/join']],
        'API-USTAAD-WELCOME': [
          ['GET', '/ustaad/tutorial'],
          ['PUT', '/ustaad/onboarding'],
          ['GET', '/ustaad/media/x/url'],
        ],
        'API-USTAAD-ATTEST': [
          ['GET', `/ustaad-attest/${TOKEN}`],
          ['POST', `/ustaad-attest/${TOKEN}`],
        ],
        'API-USTAAD-PARTNERS-STATUS': [['GET', '/ustaad/verification-status']],
        'API-USTAAD-TEASER': [
          ['GET', `/ustaad/s/${TOKEN}`],
          ['GET', `/ustaad/shares/${TOKEN}`],
          ['GET', '/ustaad/me'],
          ['GET', `/ustaad/posts/${POST}`],
          ['GET', `/ustaad/posts/${POST}/comments`],
        ],
        'API-USTAAD-POST-SHEETS': [
          ['GET', '/ustaad/me'],
          ['GET', `/ustaad/posts/${POST}`],
          ['GET', `/ustaad/posts/${POST}/comments`],
          ['POST', '/ustaad/reports'],
          ['POST', `/ustaad/posts/${POST}/share`],
        ],
        'API-USTAAD-TAG-SAVED': [
          ['GET', '/ustaad/me'],
          ['GET', '/ustaad/tags/battery'],
          ['PUT', '/ustaad/tags/battery/follow'],
          ['DELETE', '/ustaad/tags/battery/follow'],
        ],
      }[c.code] as [string, string, string?][];
      for (const [m, p] of need) expect(call(c, m, p), `${c.id} ${m} ${p}`).toBeDefined();
    }
  });

  it('join: both viewers, five steps, clean and errors', () => {
    expect(states('API-USTAAD-JOIN', 'step')).toEqual(new Set(['1', '2', '3', '4', '5']));
    expect(states('API-USTAAD-JOIN', 'form')).toEqual(new Set(['clean', 'errors']));
    for (const c of ofRow('API-USTAAD-JOIN')) {
      const r = call(c, 'POST', '/ustaad/join');
      expect(r?.status ?? 200, c.id).toBe(200);
    }
  });

  it('welcome: cards in the locale, with and without a recording, a failed list', () => {
    const rows = ofRow('API-USTAAD-WELCOME');
    expect(states('API-USTAAD-WELCOME', 'tutorial')).toEqual(
      new Set(['first', 'middle', 'last', 'no-recording', 'error']),
    );
    const cards = (c: AuditCase, lang = 'en') =>
      (
        call(c, 'GET', '/ustaad/tutorial', `lang=${lang}`)?.body as {
          cards: { title: string; audioMediaId: string | null }[];
        }
      ).cards;
    for (const c of rows.filter((x) => x.state.tutorial === 'error'))
      expect(call(c, 'GET', '/ustaad/tutorial', 'lang=en')?.status, c.id).toBe(500);
    for (const c of rows.filter((x) => x.state.tutorial !== 'error')) {
      expect(cards(c).length, c.id).toBeGreaterThanOrEqual(4);
      expect(cards(c).length, c.id).toBeLessThanOrEqual(6);
      expect(cards(c, 'hi')[0]?.title, c.id).not.toBe(cards(c)[0]?.title);
      const recorded = cards(c).every((x) => x.audioMediaId !== null);
      expect(recorded, `${c.id} recording`).toBe(c.state.tutorial !== 'no-recording');
    }
  });

  it('attest: a held answer, a gone link, the page, and each submit outcome', () => {
    const rows = ofRow('API-USTAAD-ATTEST');
    expect(states('API-USTAAD-ATTEST', 'attest')).toEqual(
      new Set(['loading', 'gone', 'ask', 'confirm-errors', 'location-denied', 'decline', 'done']),
    );
    const page = (c: AuditCase) => call(c, 'GET', `/ustaad-attest/${TOKEN}`);
    for (const c of rows.filter((x) => x.state.attest === 'gone')) expect(page(c)?.status, c.id).toBe(404);
    for (const c of rows.filter((x) => x.state.attest === 'loading'))
      expect(page(c)?.delayMs ?? 0, c.id).toBeGreaterThan(5000);
    for (const c of rows.filter((x) => !['gone', 'loading'].includes(String(x.state.attest)))) {
      expect(page(c)?.status ?? 200, c.id).toBe(200);
      expect(page(c)?.delayMs ?? 0, c.id).toBe(0);
    }
    const c0 = rows[0];
    if (!c0) throw new Error('no attest case');
    const sent = (body: unknown) => call(c0, 'POST', `/ustaad-attest/${TOKEN}`, '', body);
    expect(sent({ decision: 'declined', turnstileToken: 'audit-token-123' })?.body).toEqual({
      outcome: 'declined',
    });
    expect(
      sent({
        decision: 'confirmed',
        turnstileToken: 'audit-token-123',
        businessId: '22AAAAA0000A1Z5',
        shop: { lat: 21.25, lng: 81.63, accuracyM: 20 },
      })?.body,
    ).toEqual({ outcome: 'received' });
    expect(sent({ decision: 'maybe' })?.status).toBe(400);
  });

  it('partner status: nothing, asked, proof in, review, verified, rejected with a reason', () => {
    const rows = ofRow('API-USTAAD-PARTNERS-STATUS');
    expect(states('API-USTAAD-PARTNERS-STATUS', 'verify')).toEqual(
      new Set(['none', 'asked', 'proof', 'review', 'verified', 'rejected']),
    );
    const view = (c: AuditCase) =>
      (
        call(c, 'GET', '/ustaad/verification-status')?.body as {
          verification: {
            status: string;
            attestation: string | null;
            reasonCode: string | null;
            vouchesGiven: number;
          } | null;
        }
      ).verification;
    const by = (k: string) => {
      const c = rows.find((x) => x.state.verify === k);
      if (!c) throw new Error(k);
      return view(c);
    };
    expect(by('none')).toBeNull();
    expect(by('asked')).toMatchObject({ status: 'requested', attestation: 'requested' });
    expect(by('proof')).toMatchObject({ status: 'requested', attestation: 'confirmed' });
    expect(by('review')?.status).toBe('in_review');
    expect(by('verified')?.status).toBe('approved');
    expect(by('rejected')).toMatchObject({ status: 'rejected' });
    expect(by('rejected')?.reasonCode).not.toBeNull();
  });

  it('teaser: live and gone for a visitor, the member is sent to the post', () => {
    expect(states('API-USTAAD-TEASER', 'teaser')).toEqual(new Set(['live', 'gone', 'member-redirect']));
    for (const c of ofRow('API-USTAAD-TEASER')) {
      const teaser = call(c, 'GET', `/ustaad/s/${TOKEN}`);
      expect(teaser?.status ?? 200, `${c.id} public check`).toBe(c.state.teaser === 'gone' ? 404 : 200);
      const open = call(c, 'GET', `/ustaad/shares/${TOKEN}`);
      const sentOn = c.auth === 'customer' && c.state.teaser === 'member-redirect';
      expect(open?.status ?? 200, `${c.id} member check`).toBe(sentOn ? 200 : 404);
    }
  });

  it('post sheets: mine, other, held and gone posts; comments with replies and a held note', () => {
    const rows = ofRow('API-USTAAD-POST-SHEETS');
    expect(states('API-USTAAD-POST-SHEETS', 'post')).toEqual(new Set(['mine', 'other', 'held', 'gone']));
    expect(states('API-USTAAD-POST-SHEETS', 'sheet')).toEqual(
      new Set(['none', 'comments', 'menu', 'report', 'report-error', 'block', 'delete']),
    );
    const post = (c: AuditCase) =>
      call(c, 'GET', `/ustaad/posts/${POST}`) as {
        status?: number;
        body?: { mine: boolean; status: string };
      };
    const comments = (c: AuditCase) =>
      (
        call(c, 'GET', `/ustaad/posts/${POST}/comments`)?.body as {
          items: { parentId: string | null; status: string; mine: boolean; media: unknown }[];
        }
      ).items;
    for (const c of rows) {
      const p = c.state.post;
      if (p === 'gone') expect(post(c).status, c.id).toBe(404);
      if (p === 'mine') expect(post(c).body).toMatchObject({ mine: true, status: 'visible' });
      if (p === 'other') expect(post(c).body).toMatchObject({ mine: false, status: 'visible' });
      if (p === 'held') expect(post(c).body).toMatchObject({ mine: true, status: 'held' });
      if (p === 'gone') continue;
      const list = comments(c);
      expect(
        list.some((x) => x.parentId !== null),
        `${c.id} a reply`,
      ).toBe(true);
      expect(
        list.some((x) => x.media !== null),
        `${c.id} a voice or photo comment`,
      ).toBe(true);
      expect(
        list.some((x) => x.status === 'held'),
        `${c.id} held note`,
      ).toBe(p === 'held');
    }
  });

  it('tag: followed, not followed, empty, unknown', () => {
    expect(states('API-USTAAD-TAG-SAVED', 'list')).toEqual(
      new Set(['tag-followed', 'tag-not-followed', 'tag-empty', 'tag-unknown']),
    );
    for (const c of ofRow('API-USTAAD-TAG-SAVED')) {
      const r = call(c, 'GET', '/ustaad/tags/battery');
      const l = String(c.state.list);
      if (l === 'tag-unknown') {
        expect(r?.status, c.id).toBe(404);
        continue;
      }
      const body = r?.body as { tag: { followed: boolean }; items: unknown[] };
      expect(body.tag.followed, c.id).toBe(l === 'tag-followed');
      expect(body.items.length === 0, c.id).toBe(l === 'tag-empty');
    }
  });
});
