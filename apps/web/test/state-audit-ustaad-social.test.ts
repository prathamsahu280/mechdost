import { describe, expect, it } from 'vitest';
import { buildCases, type AuditCase } from '../e2e/state-audit/cases.ts';
import { mocksFor } from '../e2e/state-audit/api-mode/fixtures.ts';

/**
 * API-mode fixtures of the Mechanic Network feed, profile and my-card rows (spec 23 § 21i-L, batch G). Every fixture
 * is schema-checked by the generic fixture test; here each row must answer the calls its screen makes and cover the
 * states the model names.
 */
const ROWS = ['API-USTAAD-FEED', 'API-USTAAD-PROFILE', 'API-USTAAD-ME'] as const;
const cases = buildCases().filter((c) => (ROWS as readonly string[]).includes(c.code));
const ofRow = (code: string) => cases.filter((c) => c.code === code);

const call = (c: AuditCase, method: string, path: string, query = '') => {
  const mock = mocksFor(c).find((m) => m.method === method && m.path.test(path));
  return mock?.reply({ c, method: mock.method, path, query: new URLSearchParams(query), body: null });
};

interface Post {
  kind: string;
  template: string | null;
  status: string;
  mine: boolean;
  counts: { likes: number | null };
  media: { kind: string; role: string | null }[];
  poll: unknown;
  fix: unknown;
  link: { video?: { provider: string } | null } | null;
}
const feed = (c: AuditCase) => call(c, 'GET', '/ustaad/feed', `tab=${String(c.state.tab)}`);
const posts = (c: AuditCase) => (feed(c)?.body as { items: Post[] }).items;

describe('Mechanic Network feed, profile and card rows', () => {
  it('every case answers the member gate and its screen calls', () => {
    for (const c of cases) {
      expect(call(c, 'GET', '/ustaad/me'), `${c.id} me`).toBeDefined();
      const wanted =
        c.code === 'API-USTAAD-FEED'
          ? ['/ustaad/feed', '/ustaad/stories', '/ustaad/promotions', '/ustaad/feed/fresh']
          : c.code === 'API-USTAAD-PROFILE'
            ? ['/ustaad/profiles/somebody', '/ustaad/members/x/posts']
            : ['/ustaad/me/card'];
      for (const p of wanted)
        expect(call(c, 'GET', p, 'tab=for_you&slot=feed&since=x'), `${c.id} ${p}`).toBeDefined();
    }
  });

  it('feed: every post kind, held own post, empty, error, expired, not a member, counts, promotion', () => {
    const rows = ofRow('API-USTAAD-FEED');
    for (const c of rows.filter((x) => x.state.feed === 'kinds')) {
      const p = posts(c);
      const has = (f: (x: Post) => boolean) => p.some(f);
      expect(
        has((x) => x.media.some((m) => m.kind === 'audio')),
        `${c.id} voice`,
      ).toBe(true);
      expect(
        has((x) => x.media.some((m) => m.kind === 'video')),
        `${c.id} video`,
      ).toBe(true);
      expect(
        has((x) => x.media.some((m) => m.kind === 'image')),
        `${c.id} photo`,
      ).toBe(true);
      expect(
        has((x) => x.kind === 'text' && x.template === null),
        `${c.id} text`,
      ).toBe(true);
      expect(
        has((x) => x.poll !== null),
        `${c.id} poll`,
      ).toBe(true);
      expect(
        has((x) => x.link?.video?.provider === 'youtube'),
        `${c.id} youtube`,
      ).toBe(true);
      expect(
        has((x) => x.link !== null && !x.link.video),
        `${c.id} link`,
      ).toBe(true);
      expect(
        has((x) => x.template === 'fix_log' && x.fix !== null),
        `${c.id} fix log`,
      ).toBe(true);
      expect(
        has((x) => x.template === 'tip'),
        `${c.id} tip`,
      ).toBe(true);
      expect(
        has((x) => x.template === 'before_after' && x.media.some((m) => m.role === 'before')),
        `${c.id} before/after`,
      ).toBe(true);
      expect(
        p.every((x) => (x.counts.likes === null) === (c.state.counts === 'hidden')),
        `${c.id} counts`,
      ).toBe(true);
      const promo = (call(c, 'GET', '/ustaad/promotions', 'slot=feed')?.body as { promotion: unknown })
        .promotion;
      expect(promo !== null, `${c.id} promo`).toBe(c.state.promo !== 'none');
    }
    for (const c of rows.filter((x) => x.state.feed === 'held-own'))
      expect(
        posts(c).some((x) => x.mine && x.status === 'held'),
        c.id,
      ).toBe(true);
    for (const c of rows.filter((x) => x.state.feed === 'empty')) expect(posts(c)).toEqual([]);
    for (const c of rows.filter((x) => x.state.feed === 'error')) expect(feed(c)?.status).toBe(500);
    for (const c of rows.filter((x) => x.state.feed === 'loading'))
      expect(feed(c)?.delayMs ?? 0, c.id).toBeGreaterThan(1000);
    for (const c of rows.filter((x) => x.state.feed === 'not-member')) {
      const me = call(c, 'GET', '/ustaad/me')?.body as { member: unknown };
      expect(me.member).toBeNull();
    }
    // The "expired" answer is counted per page install: one set of mocks, asked twice (no state between tests).
    for (const c of rows.filter((x) => x.state.feed === 'expired')) {
      const mock = mocksFor(c).find((m) => m.method === 'GET' && m.path.test('/ustaad/feed'));
      const ask = () =>
        mock?.reply({ c, method: 'GET', path: '/ustaad/feed', query: new URLSearchParams(), body: null });
      expect(ask()).toMatchObject({ status: 410, code: 'USTAAD_FEED_EXPIRED' });
      expect(ask()?.status ?? 200, `${c.id} then ok`).toBe(200);
      const again = mocksFor(c).find((m) => m.method === 'GET' && m.path.test('/ustaad/feed'));
      expect(
        again?.reply({ c, method: 'GET', path: '/ustaad/feed', query: new URLSearchParams(), body: null }),
        `${c.id} a retry starts again`,
      ).toMatchObject({ status: 410 });
    }
    for (const k of ['kinds', 'empty', 'error', 'expired', 'not-member', 'held-own', 'loading'])
      expect(
        rows.some((c) => c.state.feed === k),
        k,
      ).toBe(true);
  });

  it('profile: own and other, each relationship, muted, gone, hidden counts, verified and long names', () => {
    const rows = ofRow('API-USTAAD-PROFILE');
    interface Profile {
      mine: boolean;
      followers: number | null;
      member: { verified: boolean; displayName: string };
      relationship: {
        following: boolean;
        muted: boolean;
        connection: { status: string; mine: boolean } | null;
      } | null;
    }
    const prof = (c: AuditCase) => call(c, 'GET', '/ustaad/profiles/somebody');
    for (const c of rows) {
      const r = prof(c);
      if (c.state.profile === 'gone') {
        expect(r?.status).toBe(404);
        continue;
      }
      const b = r?.body as Profile;
      expect(b.mine, c.id).toBe(c.state.profile === 'mine');
      expect(b.relationship === null, c.id).toBe(c.state.profile === 'mine');
      expect(b.followers === null, c.id).toBe(c.state.counts === 'hidden');
      if (c.state.profile === 'following') expect(b.relationship?.following).toBe(true);
      if (c.state.profile === 'muted') expect(b.relationship?.muted).toBe(true);
      if (c.state.profile === 'requested')
        expect(b.relationship?.connection).toMatchObject({ status: 'requested', mine: true });
      if (c.state.profile === 'incoming')
        expect(b.relationship?.connection).toMatchObject({ status: 'requested', mine: false });
      if (c.state.profile === 'connected') expect(b.relationship?.connection?.status).toBe('accepted');
      if (c.state.stress === 'long-text') expect(b.member.displayName.length).toBeGreaterThan(60);
    }
    for (const k of ['other', 'mine', 'following', 'requested', 'incoming', 'connected', 'muted', 'gone'])
      expect(
        rows.some((c) => c.state.profile === k),
        k,
      ).toBe(true);
    const verified = (c: AuditCase) => (prof(c)?.body as Partial<Profile>).member?.verified;
    expect(rows.some((c) => verified(c) === true)).toBe(true);
    expect(rows.some((c) => verified(c) === false)).toBe(true);
  });

  it('me: each level, helped N, no badges, error', () => {
    const rows = ofRow('API-USTAAD-ME');
    interface Card {
      current: string;
      helpedThisWeek: number;
      badges: { held: boolean }[];
      ladder: unknown[];
    }
    const card = (c: AuditCase) => call(c, 'GET', '/ustaad/me/card')?.body as Card;
    const levelOf: Record<string, string> = {
      chhotu: 'apprentice',
      pending: 'ustaad_pending',
      pakka: 'pakka',
      master: 'master',
    };
    const ok = rows.filter((x) => x.state.card !== 'error');
    for (const c of ok) {
      const b = card(c);
      const want = levelOf[String(c.state.card)];
      if (want) expect(b.current, c.id).toBe(want);
      if (c.state.card === 'no-badges') expect(b.badges.every((x) => !x.held)).toBe(true);
      else
        expect(
          b.badges.some((x) => x.held),
          c.id,
        ).toBe(true);
      expect(b.ladder.length, c.id).toBeGreaterThan(0);
    }
    for (const c of rows.filter((x) => x.state.card === 'error'))
      expect(call(c, 'GET', '/ustaad/me/card')?.status).toBe(500);
    expect(ok.some((c) => card(c).helpedThisWeek > 0)).toBe(true);
    expect(ok.some((c) => card(c).helpedThisWeek === 0)).toBe(true);
    for (const k of ['chhotu', 'pending', 'pakka', 'master', 'no-badges', 'error'])
      expect(
        rows.some((c) => c.state.card === k),
        k,
      ).toBe(true);
  });
});
