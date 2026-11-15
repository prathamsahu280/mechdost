/**
 * Check `dismiss` (bug class "opened panel cannot be closed", user 2026-11-16, `docs/qa/bug-catalogue.md`): every
 * button that opens a panel in place (`data-disclosure-trigger="<key>"`, contract in `src/lib/panel-dismiss.ts`) must,
 * once clicked, show a visible Cancel/close control (`data-panel-cancel="<key>"`, at least 44 px high); Escape must
 * close the panel (the Cancel control goes away) and put focus back on an opener with the same key.
 *
 * The browser part lives in `dismissCheck`; the verdict is a pure function (`dismissVerdict`) so it is unit-tested
 * in `test/state-audit-checker.test.ts` without a browser.
 */
import type { Page } from '@playwright/test';

export interface PanelFacts {
  key: string;
  /** After clicking the opener: is a visible Cancel control with this key in the page? And how tall is it. */
  cancelVisible: boolean;
  cancelHeight: number;
  /** After Escape: is the Cancel control gone (or hidden)? Is focus on an opener with this key? */
  closedByEscape: boolean;
  focusOnOpener: boolean;
}

export interface DismissFinding {
  rule: 'dismiss';
  severity: 'P0' | 'P1';
  where: string;
  detail: string;
}

/** The smallest height of a close control (WCAG 2.5.8 asks 24 px; this project's target is 44 px). */
export const MIN_CLOSE_HEIGHT = 44;

export function dismissVerdict(facts: readonly PanelFacts[]): DismissFinding[] {
  const out: DismissFinding[] = [];
  for (const f of facts) {
    if (!f.cancelVisible) {
      out.push({
        rule: 'dismiss',
        severity: 'P0',
        where: f.key,
        detail: 'opened, but no visible Cancel/close control (data-panel-cancel) appeared',
      });
      continue;
    }
    if (f.cancelHeight < MIN_CLOSE_HEIGHT - 0.5)
      out.push({
        rule: 'dismiss',
        severity: 'P1',
        where: f.key,
        detail: `close control is ${String(Math.round(f.cancelHeight))} px high (needs ${String(MIN_CLOSE_HEIGHT)})`,
      });
    if (!f.closedByEscape)
      out.push({
        rule: 'dismiss',
        severity: 'P0',
        where: f.key,
        detail: 'Escape did not close the panel',
      });
    else if (!f.focusOnOpener)
      out.push({
        rule: 'dismiss',
        severity: 'P1',
        where: f.key,
        detail: 'after closing, focus did not return to the button that opened the panel',
      });
  }
  return out;
}

/** In-page: the keys of visible, enabled openers inside the scope (first of each key; capped). */
function openerKeys(args: { scope: string; max: number }): string[] {
  const keys: string[] = [];
  for (const root of Array.from(document.querySelectorAll(args.scope))) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-disclosure-trigger]'))) {
      const key = el.getAttribute('data-disclosure-trigger') ?? '';
      const box = el.getBoundingClientRect();
      const disabled = el instanceof HTMLButtonElement && el.disabled;
      // A toggle that is already open carries its cancel attribute: nothing to open.
      if (!key || keys.includes(key) || disabled || box.width === 0 || el.hasAttribute('data-panel-cancel'))
        continue;
      keys.push(key);
      if (keys.length >= args.max) return keys;
    }
  }
  return keys;
}

const sel = (attr: string, key: string) => `[${attr}="${key.replace(/["\\]/g, '\\$&')}"]`;

/** Opens each panel in the scope, checks the close control and Escape; returns findings. */
export async function dismissCheck(page: Page, scope: string): Promise<DismissFinding[]> {
  const keys = await page.evaluate(openerKeys, { scope, max: 6 });
  const facts: PanelFacts[] = [];
  for (const key of keys) {
    const opener = page.locator(sel('data-disclosure-trigger', key)).first();
    try {
      await opener.scrollIntoViewIfNeeded({ timeout: 2_000 });
      await opener.click({ timeout: 2_000 });
    } catch {
      continue;
    }
    const cancel = page.locator(sel('data-panel-cancel', key)).first();
    const cancelVisible = await cancel
      .waitFor({ state: 'visible', timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    const cancelHeight = cancelVisible ? ((await cancel.boundingBox())?.height ?? 0) : 0;
    let closedByEscape = false;
    let focusOnOpener = false;
    if (cancelVisible) {
      await page.keyboard.press('Escape');
      closedByEscape = await cancel
        .waitFor({ state: 'hidden', timeout: 1_500 })
        .then(() => true)
        .catch(() => false);
      // Focus returns after two animation frames.
      await page.waitForTimeout(150);
      focusOnOpener = await page.evaluate(
        (s) => document.activeElement?.matches(s) ?? false,
        sel('data-disclosure-trigger', key),
      );
    }
    facts.push({ key, cancelVisible, cancelHeight, closedByEscape, focusOnOpener });
  }
  return dismissVerdict(facts);
}
