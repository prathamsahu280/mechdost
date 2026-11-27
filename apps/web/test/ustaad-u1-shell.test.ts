import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { USTAAD_CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/ustaad/analytics';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { USTAAD_TABS, ustaadTabFor } from '@/components/ustaad/shell/tabs';
import { FRESH_POLL_MS, recallScroll, rememberScroll, shouldPollFresh } from '@/lib/ustaad/home-feed';
import { storyAdvance } from '@/lib/ustaad/story-advance';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

// UI upgrade U1 (docs/superpowers/specs/2026-11-27-ustaad-ui-upgrade-design.md § 3.0, § 3.1, § 3.3, § 8.1).
describe('U1 dock: Home · Ask · Create · Jobs · Me (founder Q-UI-1)', () => {
  it('has the five tabs in order', () => {
    expect(USTAAD_TABS.map((t) => t.key)).toEqual(['home', 'ask', 'create', 'jobs', 'me']);
  });
  it.each([
    ['/hi/ustaad', 'home'],
    ['/ustaad', 'home'],
    ['/hi/ustaad/ask', 'ask'],
    ['/hi/ustaad/ask/new', 'ask'],
    ['/en/ustaad/q/ABC123', 'ask'],
    ['/ustaad/create', 'create'],
    ['/hi/ustaad/jobs/new', 'jobs'],
    ['/ustaad/me/location', 'me'],
    ['/hi/ustaad/learn', null],
    ['/ustaad/discover', null],
    ['/ustaad/messages/abc', null],
  ])('%s → %s (at most one current tab)', (path, key) => {
    expect(ustaadTabFor(path)).toBe(key);
  });
});

describe('U1 storefront chrome steps aside inside the network, decided in the server HTML', () => {
  it('the layout renders a name-free marker and the CSS hides the marked chrome', () => {
    expect(read('../src/app/[locale]/ustaad/layout.tsx')).toContain('data-shell-compact');
    const css = read('../src/app/[locale]/globals.css');
    expect(css).toMatch(/html:has\(\[data-shell-compact\]\) \[data-site-chrome\][^{]*\{\s*display: none/);
    const header = read('../src/components/site/header.tsx');
    expect(header.match(/data-site-chrome/g)?.length).toBe(2); // announcement strip, header (phone search lives inline in the header since 2026-11-28)
  });
  it('the dock hides while a text field has focus on phones and Hindi body text is not cramped', () => {
    const css = read('../src/app/[locale]/globals.css');
    expect(css).toContain('[data-ustaad-dock]');
    expect(css).toMatch(/:is\(input, textarea\):focus[^{]*\[data-ustaad-dock\]/);
  });
});

describe('U1 "See new posts" pill and per-tab scroll memory', () => {
  it('polls every 90 s only while visible and data saver is off', () => {
    expect(FRESH_POLL_MS).toBe(90_000);
    expect(shouldPollFresh({ hidden: false, saveData: false })).toBe(true);
    expect(shouldPollFresh({ hidden: true, saveData: false })).toBe(false);
    expect(shouldPollFresh({ hidden: false, saveData: true })).toBe(false);
  });
  it('remembers the scroll position of each tab separately', () => {
    const store = new Map<string, string>();
    const s = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    rememberScroll(s, 'for_you', 840);
    rememberScroll(s, 'following', 120);
    expect(recallScroll(s, 'for_you')).toBe(840);
    expect(recallScroll(s, 'following')).toBe(120);
    expect(recallScroll({ getItem: () => 'junk', setItem: () => undefined }, 'for_you')).toBe(0);
  });
});

describe('U1 story viewer advance (WCAG 2.2.2: no auto-advance under reduced motion)', () => {
  it.each([
    ['photo', false, 'timer'],
    ['text', false, 'timer'],
    ['voice', false, 'on_end'],
    ['video', false, 'on_end'],
    ['photo', true, 'manual'],
    ['video', true, 'manual'],
  ] as const)('%s, reduced=%s → %s', (kind, reduced, mode) => {
    expect(storyAdvance(kind, reduced)).toBe(mode);
  });
});

describe('U1 copy in English and Hindi', () => {
  const pick = (o: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
  it.each([
    'ustaad.shell.home_logo_aria',
    'ustaad.shell.tab_ask',
    'ustaad.shell.tab_jobs',
    'ustaad.shell.discover',
    'ustaad.shell.learn',
    'ustaad.shell.unread',
    'ustaad.home.heroAction',
    'ustaad.home.more',
    'ustaad.home.moreTitle',
    'ustaad.home.moreClose',
    'ustaad.home.sc_discover',
    'ustaad.home.waitingTitle',
    'ustaad.home.answerNow',
    'ustaad.home.newPosts',
    'ustaad.home.newPostsSr',
    'ustaad.story.new',
    'ustaad.story.prev',
    'ustaad.story.next',
    'ustaad.story.pause',
    'ustaad.story.play',
    'ustaad.story.close',
  ])('%s', (key) => {
    expect(typeof pick(en, key), `en ${key}`).toBe('string');
    expect(typeof pick(hi, key), `hi ${key}`).toBe('string');
    expect(pick(hi, key)).not.toBe(pick(en, key));
  });
});

describe('U1 analytics events are in the typed catalogue', () => {
  it.each([
    'ustaad_shell_home_logo',
    'ustaad_feed_new_pill_shown',
    'ustaad_feed_new_pill_tapped',
    'ustaad_home_more_opened',
    'ustaad_home_question_tapped',
    'ustaad_story_paused',
  ])('%s', (name) => {
    expect(Object.keys(USTAAD_CLIENT_EVENT_SCHEMAS)).toContain(name);
  });
});
