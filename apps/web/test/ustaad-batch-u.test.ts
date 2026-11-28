import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

/**
 * Batch U (Mechanic Network sim rows, 2026-11-28). Source-level checks like the other Mechanic Network view tests:
 * one `describe` per row id.
 */
const read = (p: string) => readFileSync(new URL(`../src/components/${p}`, import.meta.url), 'utf8');

type Tree = Record<string, unknown>;
const at = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Tree | undefined)?.[k], tree);

function bothLocales(path: string) {
  expect(typeof at(en as Tree, path), `en ${path}`).toBe('string');
  expect(typeof at(hi as Tree, path), `hi ${path}`).toBe('string');
}

describe('SIM-P12: follow states are words, not only aria-pressed', () => {
  it('the profile Follow button reads Following when on', () => {
    const s = read('ustaad/feed/profile-screen.tsx');
    expect(s).toMatch(/rel\.following \? t\('following'\) : t\('follow'\)/);
    bothLocales('ustaad.social.following');
  });
  it('the tag Follow button reads Following tag when on', () => {
    const s = read('ustaad/feed/feed-screens.tsx');
    expect(s).toMatch(/tag\.followed \? t\('tagFollowing'\) : t\('tagFollow'\)/);
    bothLocales('ustaad.feed.tagFollowing');
  });
});

describe('SIM-P14: a message to a connection shows no request-only rules', () => {
  const s = read('ustaad/messages/new-thread.tsx');
  it('reads the relationship and drops the rules and "Send request" for an accepted connection', () => {
    expect(s).toContain("rel.data.connection?.status === 'accepted'");
    expect(s).toMatch(/connected \? \(/);
    expect(s).toMatch(/connected \? t\('sendMessage'\) : t\('sendRequest'\)/);
    bothLocales('ustaad.messages.connectedNote');
    bothLocales('ustaad.messages.sendMessage');
  });
});

describe('SIM-P15: phone-number and number-plate blocks have their own words', () => {
  it('both codes have en + hi messages in the shared labels', () => {
    bothLocales('ustaad.labels.err_USTAAD_CONTENT_PHONE');
    bothLocales('ustaad.labels.err_USTAAD_CONTENT_PLATE');
  });
});

describe('SIM-B10: a level review is marked apart from a first verification', () => {
  it('the queue card shows the kind', () => {
    const s = read('portal/admin-ustaad/console-verify.tsx');
    expect(s).toContain("'v_kind_first'");
    expect(s).toContain("'v_kind_level'");
    bothLocales('ustaad.console.v_kind_first');
    bothLocales('ustaad.console.v_kind_level');
  });
});

describe('SIM-B11: ban confirm has a summary and the member card shows a pending ban', () => {
  const s = read('portal/admin-ustaad/console-members.tsx');
  it('the confirm names the member, action, reason and length', () => {
    expect(s).toContain("c('act_confirm_summary'");
    bothLocales('ustaad.console.act_confirm_summary');
    bothLocales('ustaad.console.act_days_n');
  });
  it('the card says a ban is waiting', () => {
    expect(s).toContain('m.pendingBan');
    bothLocales('ustaad.console.m_ban_waiting');
    bothLocales('ustaad.console.m_ban_waiting_yours');
  });
});

describe('SIM-B12: the takedown form pre-fills no legal basis', () => {
  const s = read('portal/admin-ustaad/console-records.tsx');
  it('basis starts empty and is required before the confirm opens', () => {
    expect(s).toContain("useState<string>('')");
    expect(s).not.toContain("useState<string>('court_order')");
    expect(s).toContain("'td_bad_basis'");
    bothLocales('ustaad.console.td_bad_basis');
    bothLocales('ustaad.console.td_basis_choose');
  });
});

describe('SIM-P6 / SIM-P29: the composer asks the live limits and refuses before any upload', () => {
  const s = read('ustaad/feed/composer.tsx');
  it('has no hard-coded photo limit of 10 and reads the setting', () => {
    expect(s).not.toMatch(/MAX_PHOTOS = 10/);
    expect(s).toContain('limits?.maxPhotos ?? FALLBACK_MAX_PHOTOS');
  });
  it('checks the locks in submit() before the first upload call', () => {
    const submit = s.slice(s.indexOf('async function submit()'));
    expect(submit.indexOf('lockCode(limits, story)')).toBeGreaterThan(-1);
    expect(submit.indexOf('lockCode(limits, story)')).toBeLessThan(submit.indexOf('await upload('));
  });
  it('the story-locked and switched-off words exist in en + hi', () => {
    bothLocales('ustaad.feed.err_USTAAD_STORIES_LOCKED');
    bothLocales('ustaad.feed.err_USTAAD_POST_TYPE_OFF');
  });
});

describe('SIM-P25: long post text is clamped in a card with an accessible Read more', () => {
  const clamp = read('ustaad/feed/clamped-body.tsx');
  const card = read('ustaad/feed/post-card.tsx');
  it('clamps only past a length, only in lists, and keeps the full text in the page', () => {
    expect(clamp).toContain('CLAMP_FROM_CHARS');
    expect(clamp).toContain('line-clamp-8');
    expect(card).toMatch(/clamp=\{linkToDetail\}/);
  });
  it('the button names what it does, exposes aria-expanded and moves focus to the text', () => {
    expect(clamp).toContain('aria-expanded="false"');
    expect(clamp).toContain('aria-controls={id}');
    expect(clamp).toContain('box.current?.focus()');
    bothLocales('ustaad.feed.readMore');
  });
});

describe('SIM-P30: the author sees how many members saved the post', () => {
  it('the card prints savedByN from counts.saves for the author only', () => {
    const card = read('ustaad/feed/post-card.tsx');
    expect(card).toMatch(/post\.mine && post\.counts\.saves !== null/);
    expect(card).toContain("t('savedByN'");
    bothLocales('ustaad.feed.savedByN');
  });
});

describe('SIM-P7 / SIM-P9: more coach-mark targets, and no answerer block for a Chhotu', () => {
  it('Discover, Jobs and Pin carry their own coach mark and load the tutorial strings', () => {
    for (const [file, target] of [
      ['ustaad/discover/discover-view.tsx', 'discover'],
      ['ustaad/jobs/jobs-view.tsx', 'jobs'],
      ['ustaad/local/pin-garage.tsx', 'pin'],
    ] as const)
      expect(read(file)).toContain(`<CoachMark target="${target}"`);
    for (const page of [
      '../app/[locale]/ustaad/discover/page.tsx',
      '../app/[locale]/ustaad/jobs/page.tsx',
      '../app/[locale]/ustaad/me/location/page.tsx',
    ])
      expect(read(page)).toContain("'ustaad.tutorial'");
  });
  it('the Home questions block hides for an apprentice', () => {
    expect(read('ustaad/common.tsx')).toContain('canAnswer === false');
    expect(read('../app/[locale]/ustaad/page.tsx')).toContain('<AnswererOnly>');
  });
});

describe('SIM-RT3: copy', () => {
  it('(a) the jobs intro includes garages, (b) a comment says Comment posted, (c) a closed chat has its own code', () => {
    expect(at(en as Tree, 'ustaad.jobs.postIntro')).toMatch(/garages/);
    expect(read('ustaad/feed/comments-sheet.tsx')).toContain("t('commentPosted')");
    bothLocales('ustaad.feed.commentPosted');
    bothLocales('ustaad.messages.err_USTAAD_DM_CLOSED');
    expect(read('ustaad/messages/view.ts')).toContain("'USTAAD_DM_CLOSED'");
  });
});

describe('SIM-P3: the media "complete" step is retried on its own', () => {
  it('retries a lost answer or a gateway error, never a real refusal', async () => {
    const { retryTransient } = await import('../src/lib/ustaad/media-core');
    const noWait = () => Promise.resolve();
    let calls = 0;
    const flaky = await retryTransient(() => {
      calls += 1;
      return Promise.resolve(calls < 3 ? { ok: false as const, status: 504 } : { ok: true as const });
    }, noWait);
    expect(flaky.ok).toBe(true);
    expect(calls).toBe(3);
    let refused = 0;
    const r = await retryTransient(() => {
      refused += 1;
      return Promise.resolve({ ok: false as const, status: 404 });
    }, noWait);
    expect(r.ok).toBe(false);
    expect(refused).toBe(1);
  });
  it('the upload uses it only for the complete step', () => {
    const s = readFileSync(new URL('../src/lib/ustaad/api-client.ts', import.meta.url), 'utf8');
    expect(s).toMatch(
      /retryTransient\(\(\) =>\s*send\(`\/ustaad\/media\/\$\{declared\.data\.mediaId\}\/complete`/,
    );
  });
});
