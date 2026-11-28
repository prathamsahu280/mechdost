/**
 * Page set-up of the Mechanic Network join, welcome, attest and post-sheet rows (spec 23 § 21i-L, batch I): press
 * what the case's state names so the shot shows that state. Every click is bounded (`clickIfPresent`), and a state
 * the screen cannot reach (Block on one's own post) is noted and the page shows as it is. Not run in the worktree
 * (no real-mode build); the first CI run proves the selectors.
 */
import type { Locator, Page } from '@playwright/test';
import type { AuditCase } from '../cases.ts';
import { clickIfPresent } from './hook-click.ts';

const settle = (page: Page) => page.waitForTimeout(500);
const WAIT_MS = 5_000;

async function appears(target: Locator, notes: string[], what: string): Promise<boolean> {
  try {
    await target.first().waitFor({ timeout: WAIT_MS });
    return true;
  } catch {
    notes.push(`${what} did not appear`);
    return false;
  }
}

// ── Join ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Answers of one step, enough for the next check to pass. */
async function fillJoinStep(page: Page, step: number, notes: string[]): Promise<void> {
  const form = page.locator('main form');
  const pick = (name: string) =>
    clickIfPresent(form.locator(`label:has(input[name="${name}"])`), notes, `no ${name} choice`);
  if (step === 1) await pick('track');
  if (step === 2) await pick('specialities');
  if (step === 3) {
    await form.locator('#uj-name').fill('Ramesh Sahu');
    await form.locator('#uj-pincode').fill('492001');
    await form.locator('#uj-years').fill('4');
    await form.locator('#uj-area').fill('Telibandha');
    await pick('workPlace');
  }
}

export async function prepareJoin(page: Page, c: AuditCase, notes: string[]): Promise<void> {
  // Signed out shows the sign-in card only: there is no form to walk through.
  if (c.auth !== 'customer') return;
  const target = Number(c.state.step);
  const form = page.locator('main form');
  if (!(await appears(form, notes, 'the join form'))) return;
  const next = form.locator('button[type="submit"]');
  // `errors` stops one step short of the answers and presses Next with the step still empty.
  const filled = c.state.form === 'errors' ? target - 1 : target;
  for (let step = 1; step <= filled && step < 5; step += 1) {
    await fillJoinStep(page, step, notes);
    await clickIfPresent(next, notes, `no Next on step ${String(step)}`);
    await settle(page);
  }
  if (c.state.form === 'errors') {
    if (target === 4) notes.push('step 4 has no required answer, so no error to show');
    else {
      await clickIfPresent(next, notes, `no Next on step ${String(target)}`);
    }
  }
  await settle(page);
}

// ── Welcome ───────────────────────────────────────────────────────────────────────────────────────────────────

const CARDS_BEFORE: Readonly<Record<string, number>> = { middle: 2, last: 5 };

export async function prepareWelcome(page: Page, c: AuditCase, notes: string[]): Promise<void> {
  const deck = page.locator('section[aria-roledescription="carousel"]');
  if (c.state.tutorial === 'error') return;
  if (!(await appears(deck, notes, 'the guide cards'))) return;
  const next = deck.locator('> div:last-child > button:last-child');
  for (let n = 0; n < (CARDS_BEFORE[String(c.state.tutorial)] ?? 0); n += 1) {
    await clickIfPresent(next, notes, 'no Next button');
    await page.waitForTimeout(150);
  }
  await settle(page);
}

// ── Attest ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A security check that answers at once: the real widget is Cloudflare's script, which a shot never reaches. */
async function stubSecurityCheck(page: Page): Promise<void> {
  await page.evaluate(() => {
    let done: ((token: string) => void) | null = null;
    Object.assign(window, {
      turnstile: {
        render: (_el: HTMLElement, opts: { callback: (token: string) => void }) => {
          done = opts.callback;
          return 'audit-widget';
        },
        execute: () => {
          setTimeout(() => done?.('audit-turnstile-token'), 10);
        },
        reset: () => undefined,
        remove: () => undefined,
      },
    });
  });
}

export async function prepareAttest(page: Page, c: AuditCase, notes: string[]): Promise<void> {
  const mode = String(c.state.attest);
  if (mode === 'loading' || mode === 'gone' || mode === 'ask') return;
  const trigger = (name: string) => page.locator(`[data-disclosure-trigger="attest-${name}"]`);
  if (!(await appears(trigger('confirm'), notes, 'the question'))) return;
  const submit = page.locator('main form button[type="submit"]');
  if (mode === 'confirm-errors') {
    await clickIfPresent(trigger('confirm'), notes, 'no confirm button');
    await clickIfPresent(submit, notes, 'no send button');
  }
  if (mode === 'location-denied') {
    await clickIfPresent(trigger('confirm'), notes, 'no confirm button');
    await clickIfPresent(
      page.locator('button[aria-describedby^="attest-location-hint"]'),
      notes,
      'no location button',
    );
  }
  if (mode === 'decline') await clickIfPresent(trigger('decline'), notes, 'no decline button');
  if (mode === 'done') {
    await clickIfPresent(trigger('decline'), notes, 'no decline button');
    await stubSecurityCheck(page);
    await clickIfPresent(submit, notes, 'no send button');
    notes.push(
      'done needs NEXT_PUBLIC_TURNSTILE_SITE_KEY in the build; without it the form shows the check error',
    );
  }
  await settle(page);
}

// ── Post sheets ───────────────────────────────────────────────────────────────────────────────────────────────

export async function preparePostSheet(page: Page, c: AuditCase, notes: string[]): Promise<void> {
  const sheet = String(c.state.sheet);
  const post = String(c.state.post);
  if (post === 'gone' || sheet === 'none') return;
  const track = (name: string) => page.locator(`[data-track="${name}"]`);
  const dialog = page.locator('dialog[open]');
  if (!(await appears(track('ustaad_post_more'), notes, 'the post'))) return;
  if (sheet === 'comments') {
    await clickIfPresent(track('ustaad_post_comment'), notes, 'no Comment button');
    await appears(dialog, notes, 'the comments sheet');
    await settle(page);
    return;
  }
  await clickIfPresent(track('ustaad_post_more'), notes, 'no More button');
  if (!(await appears(dialog, notes, 'the menu'))) return;
  const rows = dialog.locator('ul li button');
  // A visible post lists Copy link first; a held one does not. Others: Report, Hide, Mute, Block; own: Delete.
  const mine = post === 'mine' || post === 'held';
  const lead = post === 'held' ? 0 : 1;
  const row = (index: number, what: string) => clickIfPresent(rows.nth(index), notes, `no ${what} row`);
  if (sheet === 'report' || sheet === 'report-error') {
    if (mine) notes.push('Report is not offered on one’s own post');
    else await row(lead, 'Report');
  }
  if (sheet === 'report-error' && !mine)
    await clickIfPresent(dialog.locator('form button[type="submit"]'), notes, 'no Send report button');
  if (sheet === 'block') {
    if (mine) notes.push('Block is not offered on one’s own post');
    else await row(lead + 3, 'Block');
  }
  if (sheet === 'delete') {
    if (mine) await row(lead, 'Delete');
    else notes.push('Delete is only offered on one’s own post');
  }
  await settle(page);
}
