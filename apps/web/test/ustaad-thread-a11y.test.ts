import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Messages thread accessibility follow-ups (spec 23 § 21i-L, WCAG 2.4.11 and 4.1.3; learning L323): focus never lands
 * under the stacked sticky bars (56 px network header + the thread header on top, the composer at the bottom), and the
 * thread announces through one polite region, not two.
 */
const thread = readFileSync(
  new URL('../src/components/ustaad/messages/thread-view.tsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../src/app/[locale]/globals.css', import.meta.url), 'utf8');

describe('thread scroll padding', () => {
  it('marks the thread and clears both sticky bars with scroll-padding', () => {
    expect(thread).toContain('data-ustaad-thread');
    const rule = /html:has\(\[data-ustaad-thread\]\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const top = /scroll-padding-top:\s*(\d+)px/.exec(rule)?.[1];
    expect(Number(top)).toBeGreaterThanOrEqual(130);
    expect(rule).toMatch(/scroll-padding-bottom:/);
  });
});

describe('thread announcements', () => {
  it('has a single polite status region for new messages and loaded-older notes', () => {
    const regions = thread.match(/role="status"/g) ?? [];
    expect(regions).toHaveLength(1);
  });
  it('clears the line after a few seconds so the next arrival is announced again', () => {
    expect(thread).toMatch(/setTimeout\(/);
  });
});
