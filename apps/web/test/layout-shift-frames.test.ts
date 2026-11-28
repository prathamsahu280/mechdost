import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * LV-6 (live lab CLS 0.27-0.51 on /partner/delivery, /partner/workshop/profile, /notifications) and the V9 lane tabs
 * (visual language § 3.8 item 7). Source and CSS reads, like the other portal tests; the live re-measure is the
 * PerformanceObserver script on the deployed site.
 *
 * Root cause: these pages are client-loaded. While data loads they render a short body, so the site footer sits in the
 * first viewport; when the data arrives the body grows and shoves the footer (and `PushDevice` returned null until
 * mounted, then appeared and pushed the preferences below it).
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const src = (p: string) => read(`../src/${p}`);
const frame = src('components/partner/partner-frame.tsx');
const notifications = src('app/[locale]/notifications/page.tsx');
const push = src('components/notices/push-card.tsx');
const lane = src('components/partner/lane-tabs.tsx');
const css = src('app/[locale]/globals.css');
const tokens = read('../../../packages/ui/src/tokens.css');

describe('client-loaded frames keep the footer below the first viewport while loading', () => {
  it('the partner frame root reserves at least one viewport of height', () => {
    const root = /data-partner-frame=\{portal\}[\s\S]*?className="([^"]+)"/.exec(frame)?.[1] ?? '';
    expect(root).toMatch(/\bmin-h-dvh\b/);
  });

  // Live 2026-11-28 (lead): /shop 1280 lab CLS 0.18 — the one-row loading skeleton left the footer at y 738, then
  // the streamed catalogue pushed it out of view.
  it('the catalogue loading skeleton reserves at least one viewport of height', () => {
    const cls = /<Container className="([^"]+)"/.exec(src('app/[locale]/shop/loading.tsx'))?.[1] ?? '';
    expect(cls).toMatch(/\bmin-h-dvh\b/);
  });

  it('the notification centre page reserves at least one viewport of height', () => {
    const cls = /<Container className="([^"]+)"/.exec(notifications)?.[1] ?? '';
    expect(cls).toMatch(/\bmin-h-dvh\b/);
  });
});

describe('PushDevice ("This device") does not jump in late', () => {
  const body = push.slice(push.indexOf('export function PushDevice'));

  it('renders a stable placeholder card while the browser is probed, not null', () => {
    expect(body).not.toMatch(/phase\.kind !== 'ready'\) return null/);
    expect(body).toMatch(/phase\.kind === 'checking'/);
  });

  it('keeps one minimum height in every state so the preferences below never move', () => {
    const cls = /aria-labelledby="push-device-title" className=\{`([^`]+)`\}/.exec(body)?.[1] ?? '';
    expect(cls).toMatch(/\bmin-h-\d+\b/);
  });
});

describe('lane tabs carry the V9 segmented treatment (light), dark unchanged', () => {
  it('the nav is the track and each tab a thumb, via the lane classes', () => {
    expect(lane).toMatch(/lane-seg/);
    expect(lane).toMatch(/lane-tab\b/);
    expect(lane).toMatch(/min-h-11/);
    expect(lane).toMatch(/focus-visible:outline-3/);
  });

  it('styles the selected tab from tokens in globals.css', () => {
    const rule = /\.lane-tab\[aria-current='page'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('var(--lane-thumb-bg)');
    expect(rule).toContain('var(--lane-thumb-shadow)');
    expect(css).toMatch(/\.lane-seg\s*\{[^}]*var\(--lane-track\)/);
  });

  it('light uses the tinted track and white thumb with the lift shadow; dark keeps today (no track, navy thumb)', () => {
    const lightBlock = tokens.slice(tokens.indexOf('@theme'), tokens.indexOf(":root[data-theme='dark']"));
    expect(lightBlock).toContain('--lane-track: var(--color-lift-track);');
    expect(lightBlock).toContain('--lane-thumb-bg: var(--color-surface-raised);');
    expect(lightBlock).toContain('--lane-thumb-shadow: var(--shadow-lift);');
    const dark = [...tokens.matchAll(/--lane-track: transparent;/g)];
    expect(dark).toHaveLength(2); // explicit toggle + system preference
    expect([...tokens.matchAll(/--lane-thumb-bg: var\(--color-navy\);/g)]).toHaveLength(2);
    expect([...tokens.matchAll(/--lane-thumb-fg: #ffffff;/g)]).toHaveLength(2);
    expect([...tokens.matchAll(/--lane-thumb-shadow: none;/g)]).toHaveLength(2);
  });
});
