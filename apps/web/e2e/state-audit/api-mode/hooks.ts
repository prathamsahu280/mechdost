/**
 * API-mode hooks for `runCase` (`harness.ts` `ApiHooks`): the signed-in Firebase user, the mocked API, and the page
 * set-up for the real-mode screens (open a refund, a shop, the give-up form). See `session.ts` for why none of this
 * can reach production.
 */
import type { Page } from '@playwright/test';
import type { AuditCase } from '../cases.ts';
import type { ApiHooks } from '../harness.ts';
import { mocksFor } from './fixtures.ts';
import { installApi } from './mock-api.ts';
import { mockFirebase, persistedUser } from './session.ts';

const UID: Readonly<Record<string, string>> = {
  customer: 'audit-customer',
  shop: 'audit-shop',
  workshop: 'audit-workshop',
  admin: 'audit-admin',
};
const PHONE = '9876543210';

const settleApi = (page: Page) => page.waitForTimeout(500);

/** Opens what the case's state names: a refund's detail, a shop and its panel, the give-up form. */
async function prepareApi(page: Page, c: AuditCase): Promise<string[]> {
  const notes: string[] = [];
  const main = page.locator('main');
  await settleApi(page);

  if (c.code === 'API-ADM-REFUNDQ' && (c.state.detail === 'open' || c.state.form !== 'clean')) {
    await main.locator('section[aria-labelledby="refund-list"] ul li button').first().click();
    await settleApi(page);
  }

  if (c.code === 'API-ADM-SHOPS' && c.state.panel && c.state.panel !== 'closed') {
    const manage = main.locator('article button[aria-expanded]').first();
    if ((await manage.count()) === 0) notes.push('no shop to open');
    else {
      await manage.click();
      await main
        .locator('[role="tab"]')
        .first()
        .waitFor({ timeout: 5_000 })
        .catch(() => notes.push('shop detail did not load'));
      await main
        .locator(`[role="tab"][id$="-tab-${c.state.panel}"]`)
        .click()
        .catch(() => notes.push('panel tab not found'));
      await settleApi(page);
    }
  }

  if (c.code === 'API-SHOP-PORTAL' && c.state.giveup && c.state.giveup !== 'closed') {
    const open = main.locator('[data-track="shop_order_give_up_open"]').first();
    if ((await open.count()) === 0) notes.push('no give-up button (no confirmed order)');
    else {
      await open.click();
      const form = main.locator('form:has(select[id^="give-up-"])').first();
      if (c.state.giveup === 'filled') {
        await form.locator('select').selectOption({ index: 1 });
        await form.locator('textarea').fill('Stock damaged in the rain, cannot supply this week');
      } else if (c.state.giveup === 'empty-submit') {
        await form.locator('button[type="submit"]').click();
      }
      await settleApi(page);
    }
  }
  return notes;
}

export const apiHooks: ApiHooks = {
  async install(page, c, now) {
    const uid = UID[c.auth] ?? UID.customer ?? 'audit-customer';
    await mockFirebase(page, uid, PHONE, now);
    return installApi(page, c, mocksFor(c));
  },
  seed(c, now) {
    const uid = UID[c.auth];
    return uid ? persistedUser(uid, PHONE, now) : {};
  },
  prepare: prepareApi,
};
