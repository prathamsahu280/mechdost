import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Ustaad Network workstream D web (feed + social, spec 23 § 4 flows 4–7, § 5): Home feed with stories, post cards of
 * every kind, like / save / WhatsApp share / comments / ⋯ menu, the composer, the story viewer, a post, a tag, Saved,
 * a profile and the public share teaser, in the staff preview with the browser demo's sample data. Every screen: its
 * heading, axe clean on `main`, sheets close with Escape and give focus back. With USTAAD_SHOTS set to a folder,
 * review screenshots are written there (390 light, Hindi 390; lead 2026-11-26: no 1440 this round).
 */
const DEMO_PASSWORD = 'Raipur@2026';
const ADMIN = '9000000003';
const SHOTS = process.env.USTAAD_SHOTS;
const POST = '/ustaad/p/0193a000-0000-7000-8000-000000001001';
const TEASER = '/ustaad/s/aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb';

async function signIn(page: Page) {
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(ADMIN);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('One-time code').fill('123456');
  await expect(page).not.toHaveURL(/\/login/);
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

/** 390 light and Hindi 390, then back to English at the default size (L-UCE1, L-UCE5). */
async function shots(page: Page, name: string, path: string, ready: string) {
  if (!SHOTS) return;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await page.locator(ready).first().waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
  await page.goto(`/hi${path}`);
  await page.locator(ready).first().waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}-hi-390.png`, fullPage: true });
  await page.context().clearCookies({ name: 'NEXT_LOCALE' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(path);
  await page.locator(ready).first().waitFor();
}

const firstCard = (page: Page) => page.getByRole('article').first();

test.describe('Ustaad feed and social (workstream D web)', () => {
  test.describe.configure({ timeout: 120_000 });
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Home: stories, feed cards of every kind, like and save toggle with counts; axe clean', async ({
    page,
  }) => {
    await page.goto('/ustaad');
    await expect(page.getByRole('button', { name: /Suresh Verma, new/ })).toBeVisible();
    const card = firstCard(page);
    await expect(card).toBeVisible();
    await expect(page.getByText('Sample data').first()).toBeVisible();
    for (const kind of ['photo', 'voice', 'poll', 'video', 'text', 'link'])
      await expect(page.locator(`article[data-post-kind="${kind}"]`).first()).toBeVisible();
    // The promotion carries the locked label as its first line.
    await expect(page.getByRole('complementary', { name: 'Sponsored' })).toContainText('Sponsored');
    await axe(page);
    const like = card.getByRole('button', { name: /Like/ });
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(like).toContainText('128');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toContainText('129');
    const save = card.getByRole('button', { name: 'Save' });
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    // A poll: vote once, then the results show with the vote counted.
    const poll = page.locator('article[data-post-kind="poll"]').first();
    await poll.getByRole('button', { name: /Vote: Leak test pehle/ }).click();
    await expect(poll.getByText('Your vote')).toBeAttached();
    await expect(poll.getByText(/32 votes/)).toBeVisible();
    // Saved shows it.
    await page.getByRole('link', { name: 'Saved' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Saved posts' })).toBeVisible();
    await expect(page.getByText('Aaj ka kaam: Splendor self start fix')).toBeVisible();
    await shots(page, 'home', '/ustaad', 'article');
  });

  test('Comments sheet: reply in one level, Escape closes and focus returns to Comment', async ({ page }) => {
    await page.goto('/ustaad');
    const card = firstCard(page);
    const comment = card.getByRole('button', { name: /Comment/ });
    await comment.click();
    const sheet = page.getByRole('dialog', { name: 'Comments' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Badhiya! Relay ka part number bhi daal do')).toBeVisible();
    await sheet.getByRole('button', { name: /Reply to Imran Khan/ }).click();
    await expect(sheet.getByText('Replying to Imran Khan')).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Write a comment' }).fill('Mere paas bhi yahi hua tha');
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet.getByText('Mere paas bhi yahi hua tha')).toBeVisible();
    await expect(card.getByRole('button', { name: /Comment/ })).toContainText('4');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(comment).toBeFocused();
  });

  test('⋯ menu: report with a reason, then mute removes every card by that member', async ({ page }) => {
    await page.goto('/ustaad');
    const card = firstCard(page);
    await card.getByRole('button', { name: 'More options' }).click();
    const menu = page.getByRole('dialog', { name: 'Post options' });
    await menu.getByRole('button', { name: 'Report' }).click();
    const report = page.getByRole('dialog', { name: 'Report this' });
    await report.getByRole('button', { name: 'Send report' }).click();
    await expect(report.getByText('Pick a reason.')).toBeVisible();
    await report.getByRole('radio', { name: 'Wrong or unsafe advice' }).check();
    await report.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Report UR-RPR-2026-SAMPLE' })).toBeVisible();
    await card.getByRole('button', { name: 'More options' }).click();
    await page
      .getByRole('dialog', { name: 'Post options' })
      .getByRole('button', { name: 'Mute Suresh Verma' })
      .click();
    await expect(page.getByText('Muted. Their posts leave your feed.')).toBeVisible();
    await expect(page.getByRole('article', { name: 'Post by Suresh Verma' })).toHaveCount(0);
  });

  test('WhatsApp share opens wa.me with the teaser link only', async ({ page, context }) => {
    await page.goto('/ustaad');
    const popup = context.waitForEvent('page');
    await firstCard(page).getByRole('button', { name: 'Share on WhatsApp' }).click();
    const tab = await popup;
    const url = decodeURIComponent(tab.url());
    expect(url).toMatch(/wa\.me|api\.whatsapp\.com/);
    expect(url).toMatch(/\/ustaad\/s\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}/);
    expect(url).not.toContain('Splendor self start');
    await tab.close();
  });

  test('Story viewer: pause, next, close; focus returns to the ring', async ({ page }) => {
    await page.goto('/ustaad');
    // After both stories are seen the ring's name says 'seen', so match the person only.
    const ring = page.getByRole('button', { name: /Suresh Verma, (new|seen)/ });
    await ring.click();
    const viewer = page.getByRole('dialog', { name: 'Story by Suresh Verma' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole('status')).toHaveText(/1 of 2/);
    const pause = viewer.getByRole('button', { name: 'Pause' });
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await viewer.getByRole('button', { name: 'Next story' }).click();
    await expect(viewer.getByRole('status')).toHaveText(/2 of 2/);
    await viewer.getByRole('button', { name: 'Close stories' }).click();
    await expect(viewer).toBeHidden();
    await expect(ring).toBeFocused();
    // My own story shows "Seen by".
    await page.getByRole('button', { name: /^Your story/ }).click();
    await expect(page.getByText('Seen by 14 mechanics')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Composer: a text post with a tag, then a fix log needs its fields; axe clean', async ({ page }) => {
    await page.goto('/ustaad/create');
    await expect(page.getByRole('heading', { level: 1, name: 'Show your work' })).toBeVisible();
    await axe(page);
    await page.getByRole('button', { name: 'Fix log' }).click();
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByText('Fill in the problem and what fixed it.')).toBeVisible();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await page.getByLabel('Write about it').fill('Activa ka carburetor saaf kiya');
    await page.getByRole('searchbox', { name: 'Search tags' }).fill('clu');
    await page.getByRole('button', { name: 'Add tag #Clutch' }).click();
    await expect(page.getByRole('button', { name: 'Remove tag #Clutch' })).toBeVisible();
    await axe(page);
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByText('Posted.')).toBeVisible();
    await page.getByRole('link', { name: 'See your post' }).click();
    await expect(page.getByText('Activa ka carburetor saaf kiya')).toBeVisible();
    await shots(page, 'create', '/ustaad/create', 'main h1');
    await shots(page, 'create-story', '/ustaad/create?story=1', 'main h1');
  });

  test('Post, tag and profile pages; follow toggles; teaser is a generic card without the shell', async ({
    page,
  }) => {
    await page.goto(POST);
    await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();
    await axe(page);
    await shots(page, 'post', POST, 'article');

    await page.goto('/ustaad/tags/splendor');
    await expect(page.getByRole('heading', { level: 1, name: '#Splendor' })).toBeVisible();
    const followTag = page.getByRole('button', { name: 'Follow tag' });
    await expect(followTag).toHaveAttribute('aria-pressed', 'true');
    await followTag.click();
    await expect(followTag).toHaveAttribute('aria-pressed', 'false');
    await axe(page);
    await shots(page, 'tag', '/ustaad/tags/splendor', 'main h1');

    await page.goto('/ustaad/u/imran_ev');
    await expect(page.getByRole('heading', { level: 1, name: 'Imran Khan' })).toBeVisible();
    await expect(page.getByText('Helpful answers')).toBeVisible();
    const follow = page.getByRole('button', { name: 'Follow', exact: true });
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: 'Message', exact: true })).toHaveAttribute(
      'href',
      /\/ustaad\/messages/,
    );
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: 'Block' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await axe(page);
    await shots(page, 'profile', '/ustaad/u/imran_ev', 'main h1');
    await shots(page, 'saved', '/ustaad/saved', 'main h1');

    await page.goto(TEASER);
    await expect(page.getByRole('heading', { level: 1, name: 'A post on Ustaad Network' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('[data-ustaad-dock]')).toHaveCount(0);
    await axe(page);
    await shots(page, 'teaser', TEASER, 'main h1');
  });
});
