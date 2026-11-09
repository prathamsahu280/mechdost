/**
 * Real sign-in (spec 01, Q69 firebase mode) against the Firebase Auth Emulator + the API (runbook
 * docs/runbooks/firebase.md § End-to-end). Skipped unless the web was built with NEXT_PUBLIC_AUTH_MODE=firebase and
 * E2E_AUTH_MODE=firebase is set: sign-up with a phone code → email + password → "account ready" → account area;
 * password sign-in by email and by phone; one answer for a wrong password; reset by phone code; reset by email
 * (the emulator records the reset link). Codes are read from the emulator's REST endpoints, never typed by hand.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const EMULATOR = 'http://127.0.0.1:9099';
/** Real mode chains several network calls (Firebase, Cloudflare, the API) per step. */
const SLOW = { timeout: 30_000 };
const PROJECT = 'demo-mechdost';

test.skip(process.env.E2E_AUTH_MODE !== 'firebase', 'needs a firebase-mode build, the emulator and the API');
test.describe.configure({ mode: 'serial', timeout: 120_000 });
// One real account per run: the flows run once (desktop); the screens themselves are covered at 390 px in demo mode.
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop', 'one real account per run');
});

const run = Date.now().toString().slice(-7);
const phone10 = `98${run.padStart(8, '0').slice(-8)}`;
const email = `real-${run}@example.com`;
const name = 'Real Tester';
const firstPassword = 'chhattisgarh rains 2026';
const secondPassword = 'raipur monsoon mornings';

async function latestCode(request: APIRequestContext, e164: string, after: number): Promise<string> {
  let code = '';
  await expect
    .poll(async () => {
      const res = await request.get(`${EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`);
      const body = (await res.json()) as { verificationCodes?: { phoneNumber: string; code: string }[] };
      const mine = (body.verificationCodes ?? []).filter((c) => c.phoneNumber === e164);
      code = mine.length > after ? (mine.at(-1)?.code ?? '') : '';
      return code;
    })
    .toMatch(/^\d{6}$/);
  return code;
}

async function codesSoFar(request: APIRequestContext, e164: string) {
  const res = await request.get(`${EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`);
  const body = (await res.json()) as { verificationCodes?: { phoneNumber: string }[] };
  return (body.verificationCodes ?? []).filter((c) => c.phoneNumber === e164).length;
}

async function signOut(page: Page) {
  // Customers sign out from the Profile section.
  await page.goto('/account/profile');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page.getByRole('heading', { name: 'Hello, Real Tester' })).toHaveCount(0, SLOW);
}

async function passwordSignIn(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('sign up with a phone code, then email and password; the account area knows the person', async ({
  page,
  request,
}) => {
  const e164 = `+91${phone10}`;
  const before = await codesSoFar(request, e164);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Mobile number').fill(phone10);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(await latestCode(request, e164, before));
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Create password', { exact: true }).fill(firstPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(firstPassword);
  await page.getByRole('button', { name: 'Create account' }).click();

  const ready = page.getByRole('heading', { name: 'Your account is ready' });
  await expect(ready).toBeFocused(SLOW);
  await expect(page.getByText(`We sent a link to ${email}`)).toBeVisible();
  // The emulator recorded the one-time verification email.
  const oob = await request.get(`${EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const codes =
    ((await oob.json()) as { oobCodes?: { email: string; requestType: string }[] }).oobCodes ?? [];
  expect(codes.some((c) => c.email === email && c.requestType === 'VERIFY_EMAIL')).toBe(true);

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account$/, SLOW);
  await expect(page.getByRole('heading', { name: `Hello, ${name}` })).toBeVisible();
});

test('password sign-in by email and by phone; a wrong password gets the one generic answer', async ({
  page,
}) => {
  await passwordSignIn(page, email.toUpperCase(), 'not my password at all');
  await expect(page.getByText(/don't match/).first()).toBeVisible(SLOW);
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

  await passwordSignIn(page, email, firstPassword);
  await expect(page).toHaveURL(/\/account$/, SLOW);
  await signOut(page);

  await passwordSignIn(page, `+91 ${phone10.slice(0, 5)} ${phone10.slice(5)}`, firstPassword);
  await expect(page).toHaveURL(/\/account$/, SLOW);
});

test('forgot password by phone code: new password works, the old one no longer does', async ({
  page,
  request,
}) => {
  const e164 = `+91${phone10}`;
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone10);
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByRole('button', { name: /Send a code to my phone/ }).click();
  // The number typed for sign-in is carried over (WCAG 3.3.7).
  await expect(page.getByLabel('Mobile number')).toHaveValue(phone10);
  const before = await codesSoFar(request, e164);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(await latestCode(request, e164, before));
  await page.getByLabel('Create password', { exact: true }).fill(secondPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(secondPassword);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/account$/, SLOW);

  await signOut(page);
  await passwordSignIn(page, email, firstPassword);
  await expect(page.getByText(/don't match/).first()).toBeVisible(SLOW);
  await passwordSignIn(page, email, secondPassword);
  await expect(page).toHaveURL(/\/account$/, SLOW);
});

test('forgot password by email: the same message for anyone, and the emulator holds the reset link', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByRole('button', { name: /Email me a reset link/ }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  const sent = page.getByRole('heading', { name: 'Check your email' });
  await expect(sent).toBeFocused(SLOW);
  await expect(page.getByText(`If an account uses ${email}`)).toBeVisible();
  await expect
    .poll(async () => {
      const res = await request.get(`${EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`);
      const codes =
        ((await res.json()) as { oobCodes?: { email: string; requestType: string }[] }).oobCodes ?? [];
      return codes.some((c) => c.email === email && c.requestType === 'PASSWORD_RESET');
    })
    .toBe(true);
});
