/**
 * Runs the `nav` check of an audit case in Playwright: the bar's facts and rules (`nav.ts`), then, for `walk=yes`,
 * clicks every item in turn and checks the page it opens (a heading, no "not found", the bar's current marker moved).
 */
import type { Page } from '@playwright/test';
import type { AuditCase } from './cases.ts';
import type { Finding } from './geometry.ts';
import { navFindings, readNav } from './nav.ts';

/** Most items walked per case (the admin bar has 15 to 18). */
const MAX_WALK = 20;
const NOT_FOUND = /^(404|not found|पेज नहीं मिला|यह पेज नहीं मिला)/i;

const pathOf = (page: Page) => new URL(page.url()).pathname;

export async function navCheck(page: Page, c: AuditCase): Promise<Finding[]> {
  const findings: Finding[] = [];
  const start = page.url();
  // The measurements before this check moved keyboard focus around; a bar scrolled to the focused item is a
  // keyboard user's view, not the resting one (the bar re-centres when focus leaves it).
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const facts = await page.evaluate(readNav, c.scope);
  if (facts.items.length === 0)
    return [{ rule: 'nav-items', severity: 'P0', where: c.scope, detail: 'the navigation has no links' }];
  if (c.nav === 'bar') findings.push(...navFindings(facts, pathOf(page)));
  if (c.state.walk !== 'yes') return findings;

  const count = Math.min(facts.items.length, MAX_WALK);
  for (let i = 0; i < count; i++) {
    const item = facts.items[i];
    if (!item) continue;
    const link = page.locator(c.scope).locator('a[href]:visible').nth(i);
    try {
      await link.scrollIntoViewIfNeeded({ timeout: 3_000 });
      await link.click({ timeout: 5_000 });
    } catch (e) {
      findings.push({
        rule: 'nav-load',
        severity: 'P0',
        where: item.text,
        detail: `cannot click: ${(e instanceof Error ? e.message : String(e)).split('\n')[0] ?? ''}`,
      });
      continue;
    }
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(250);
    const path = pathOf(page);
    // A sign-in redirect is the right answer for a signed-out visitor on a members-only target.
    const landed = path === item.href || (c.auth === 'out' && path.endsWith('/login'));
    if (!landed)
      findings.push({
        rule: 'nav-load',
        severity: 'P0',
        where: item.text,
        detail: `opened ${path}, expected ${item.href}`,
      });
    const heading = await page
      .locator('main h1')
      .first()
      .textContent({ timeout: 8_000 })
      .catch(() => null);
    if (heading === null || NOT_FOUND.test(heading.trim()))
      findings.push({
        rule: 'nav-load',
        severity: 'P0',
        where: item.text,
        detail: `${item.href} shows ${heading === null ? 'no heading' : `"${heading.trim()}"`}`,
      });
    if (c.nav === 'bar' && (await page.locator(c.scope).count()) > 0) {
      const after = navFindings(await page.evaluate(readNav, c.scope), pathOf(page));
      for (const f of after) findings.push({ ...f, detail: `after opening ${item.href}: ${f.detail}` });
    }
    if ((await page.locator(c.scope).count()) === 0 || c.nav === 'links') await page.goto(start);
  }
  return findings;
}
