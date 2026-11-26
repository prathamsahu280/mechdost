import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Ustaad Network workstream D2 web: messages (request-only, SR-33), My network and Discover in the staff preview with
 * the browser demo's sample data (spec 23 § 5, § 20 "follow, connect, message request accept; Discover filters").
 * Every screen: heading, axe clean on `main`, no full reload. With USTAAD_SHOTS set to a folder, review screenshots
 * are written there (390 light, Hindi 390).
 */
const DEMO_PASSWORD = 'Raipur@2026';
const ADMIN = '9000000003';
const SHOTS = process.env.USTAAD_SHOTS;
const SURESH_THREAD = '/ustaad/messages/0193a000-0000-7000-8000-000000000301';
const ANIL_THREAD = '/ustaad/messages/0193a000-0000-7000-8000-000000000302';
/** A 4 × 4 red PNG for the photo picker. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGP4z8AARwgWXg4ArpMP8aaUSCMAAAAASUVORK5CYII=',
  'base64',
);

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

/** Marks the document; a full reload would lose the mark (no-reload rule). */
async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
}
async function expectSameDocument(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
}

/** 390 light and Hindi 390; ends where it started, in English (L-UCE1, L-UCE5). */
async function shots(page: Page, name: string, path: string) {
  if (!SHOTS) return;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await page.locator('main h1').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
  await page.goto(`/hi${path}`);
  await page.locator('main h1').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-hi-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().clearCookies({ name: 'NEXT_LOCALE' });
  await page.goto(path);
  await page.locator('main h1').first().waitFor();
}

test.describe('Ustaad messages (D2 web)', () => {
  test.describe.configure({ timeout: 90_000 });
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Chats / Requests / Sent are links; a request is accepted inside the thread; axe clean', async ({
    page,
  }) => {
    await page.goto('/ustaad/messages');
    await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
    await expect(page.getByText('Sample data')).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Message lists' });
    await expect(tabs.getByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
    const suresh = page.getByRole('link', { name: /Suresh Verma/ });
    await expect(suresh).toContainText('New');
    await axe(page);
    await markDocument(page);

    await tabs.getByRole('link', { name: 'Requests' }).click();
    await expect(page).toHaveURL(/box=requests/);
    await page.getByRole('link', { name: /Imran Khan/ }).click();
    await expect(page.getByText('wants to talk to you. Accept to reply')).toBeVisible();
    await expect(page.getByText('battery cell balance')).toBeVisible();
    // No composer before the receiver decides (request-only).
    await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0);
    await axe(page);
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('Accepted. Now you can talk freely.')).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    await expectSameDocument(page);
    await shots(page, 'messages', '/ustaad/messages');
  });

  test('Thread: ticks in words, my held message says "Being checked", send text and a photo', async ({
    page,
  }) => {
    await page.goto(SURESH_THREAD);
    await expect(page.getByRole('heading', { level: 1, name: /Suresh Verma/ })).toBeVisible();
    const convo = page.getByRole('list', { name: 'Conversation' });
    await expect(convo.getByText('Seen').first()).toBeVisible();
    await expect(convo.getByText('Being checked')).toBeVisible();
    await expect(convo.getByText('Only you see this.')).toBeVisible();
    await expect(convo.getByRole('button', { name: /Play voice note/ })).toBeVisible();
    await axe(page);

    const field = page.getByLabel('Message', { exact: true });
    await field.fill('Theek hai bhai, kal milte hain');
    await field.press('Enter');
    await expect(convo.getByText('Theek hai bhai, kal milte hain')).toBeVisible();
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();

    await page.getByRole('button', { name: 'Photo', exact: true }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'gauge.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('Photo ready.')).toBeVisible();
    await page.getByLabel('Photo caption').fill('Yeh dekho');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(convo.getByText('Yeh dekho')).toBeVisible();
    await expect(convo.getByRole('img', { name: 'Photo in the chat' }).last()).toBeVisible();
    await shots(page, 'thread', SURESH_THREAD);
  });

  test('More: mute notices, report with a reason, block and unblock', async ({ page }) => {
    await page.goto(ANIL_THREAD);
    await expect(page.getByRole('img', { name: 'Photo in the chat' })).toBeVisible();
    const more = page.getByRole('button', { name: 'More options' });
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Turn on notices' }).click();
    await expect(page.getByText('Notices from this chat are on again.')).toBeVisible();

    await page.getByRole('button', { name: 'Report' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this chat' });
    await expect(dialog).toBeVisible();
    await axe(page);
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByText('Pick what is wrong.')).toBeVisible();
    await dialog.getByLabel('Spam or selling').check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Report sent. Our team will check it.')).toBeVisible();
    // The dialog closes natively, so focus returns to the Report button that opened it.
    await expect(page.getByRole('button', { name: 'Report' })).toBeFocused();

    await page.getByRole('button', { name: 'Block', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, block' }).click();
    await expect(page.getByText('You blocked Anil Patel.')).toBeVisible();
    // Focus follows the swapped header (never lost to the page).
    await expect(page.getByRole('button', { name: 'Unblock' })).toBeFocused();
    await page.getByRole('button', { name: 'Unblock' }).click();
    await expect(page.getByText('Anil Patel is unblocked.')).toBeVisible();
    await expect(more).toBeFocused();
  });

  test('Start a conversation from ?to=<handle>: the rules, a link refused in words, then waiting', async ({
    page,
  }) => {
    await page.goto('/ustaad/messages?to=nobody_here');
    await expect(page.getByText('We could not find that mechanic.')).toBeVisible();

    await page.goto('/ustaad/messages?to=deepak_2w');
    await expect(page.getByText('You already have a conversation with this mechanic.')).toBeVisible();

    await page.goto('/ustaad/messages?to=raju_chhotu');
    await expect(page.getByRole('note').getByText('How a message request works')).toBeVisible();
    await expect(page.getByText('No links. Phone numbers and UPI ids are hidden as #.')).toBeVisible();
    await axe(page);
    const field = page.getByLabel('Your first message');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Write a message first.')).toBeVisible();
    await field.fill('Raju bhai, see www.example.com');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Links are not allowed before they accept.')).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await markDocument(page);
    await field.fill('Raju bhai, Splendor ka kaam seekhna hai?');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page).toHaveURL(/\/ustaad\/messages\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Request sent. You can send more once')).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0);
    await expectSameDocument(page);
    await shots(page, 'new-request', '/ustaad/messages?to=raju_chhotu');
  });
});

test.describe('Ustaad My network and Discover (D2 web)', () => {
  test.describe.configure({ timeout: 90_000 });
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('My network: tabs, remove a follower, accept and withdraw requests, unblock; axe clean', async ({
    page,
  }) => {
    await page.goto('/ustaad/network');
    await expect(page.getByRole('heading', { level: 1, name: 'My network' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Network lists' });
    await expect(tabs.getByRole('link', { name: 'Followers' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Show more' })).toBeVisible();
    await axe(page);
    await markDocument(page);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(page.getByRole('link', { name: 'Vikas Dewangan' })).toBeVisible();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Raju Nishad' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByText('Raju Nishad no longer follows you.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Followers' })).toBeFocused();

    await tabs.getByRole('link', { name: 'Requests' }).click();
    await expect(page).toHaveURL(/tab=requests/);
    await expect(page.getByText('There is a daily limit on new connect requests.')).toBeVisible();
    await axe(page);
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Raju Nishad' })
      .getByRole('button', { name: 'Accept' })
      .click();
    await expect(page.getByText('You are now connected with Raju Nishad.')).toBeVisible();
    await page.getByRole('button', { name: 'Take back' }).click();
    await expect(page.getByText('Request to Vikas Dewangan taken back.')).toBeVisible();

    await tabs.getByRole('link', { name: 'Connections' }).click();
    await expect(page.getByRole('link', { name: 'Raju Nishad' })).toBeVisible();

    await tabs.getByRole('link', { name: 'Blocked' }).click();
    await page.getByRole('button', { name: 'Unblock' }).click();
    await expect(page.getByText('Manoj Yadav is unblocked.')).toBeVisible();
    await expect(page.getByText('You have not blocked anyone.')).toBeVisible();
    await expectSameDocument(page);

    // The cooldown after a withdrawn request comes back as words on Discover (moved to in the same document: the
    // sample data lives in memory).
    await page.getByRole('link', { name: 'Discover' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Discover' })).toBeVisible();
    await page.getByLabel('Search name, area or work').fill('vikas');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByText('Please wait a few days before asking this mechanic again.')).toBeVisible();
    await shots(page, 'network', '/ustaad/network?tab=requests');
  });

  test('Discover: top helpers, tags and top this week; search and filters in the address; follow', async ({
    page,
  }) => {
    const searched: number[] = [];
    await page.exposeFunction('__searched', (n: number) => searched.push(n));
    await page.addInitScript(() => {
      window.addEventListener('mechdost:track', (e) => {
        const d = (e as CustomEvent<{ event: string; props: { results?: number } }>).detail;
        if (d.event === 'ustaad_discover_searched')
          void (window as unknown as { __searched: (n: number) => Promise<void> }).__searched(
            d.props.results ?? -1,
          );
      });
    });
    await page.goto('/ustaad/discover');
    await expect(page.getByRole('heading', { level: 1, name: 'Discover' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top helpers this month' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Self start/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top this week' })).toBeVisible();
    await expect(page.getByText('under 2 km').first()).toBeVisible();
    await axe(page);
    await markDocument(page);

    await page.getByLabel('Search name, area or work').fill('suresh');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/q=suresh/);
    await expect(page.getByRole('heading', { name: 'Mechanics found' })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect.poll(() => searched).toEqual([1]);

    await page.getByLabel('Search name, area or work').fill('');
    await page.getByLabel('Work', { exact: true }).selectOption('ac');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/work=ac/);
    const anil = page.getByRole('article').filter({ hasText: 'Anil Patel' });
    await expect(anil).toBeVisible();
    await anil.getByRole('button', { name: 'Follow' }).click();
    await expect(page.getByText('Following Anil Patel.')).toBeVisible();
    await expect(anil.getByText('403 followers')).toBeVisible();
    await expectSameDocument(page);
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.getByRole('heading', { name: 'Top helpers this month' })).toBeVisible();
    await shots(page, 'discover', '/ustaad/discover');
  });
});
