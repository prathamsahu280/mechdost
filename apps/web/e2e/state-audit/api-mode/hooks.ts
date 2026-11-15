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

  if (c.code === 'API-ADM-STAFF' && c.state.form && c.state.form !== 'closed') {
    const section = main.locator('section[aria-labelledby="staff-title"]');
    if (c.state.form === 'remove') {
      const remove = section.locator('li li button').first();
      if ((await remove.count()) === 0) notes.push('no role to remove');
      else await remove.click();
    } else {
      await section.locator('button').first().click();
      if (c.state.form === 'give-error') await section.locator('form button[type="submit"]').click();
    }
    await settleApi(page);
  }

  if (c.code === 'API-ADM-CUSTOMERS') {
    await main.locator('#customer-q').fill('asha verma');
    await main.locator('form[role="search"] button[type="submit"]').click();
    await settleApi(page);
    if (c.state.form === 'open') {
      const open = main.locator('ul li button[aria-expanded]').first();
      if ((await open.count()) === 0) notes.push('no result to open');
      else {
        await open.click();
        await settleApi(page);
      }
    }
  }

  if (c.code === 'API-ADM-AUDIT' && c.state.form === 'open') {
    const summary = main.locator('details > summary').first();
    if ((await summary.count()) === 0) notes.push('no entry to open');
    else await summary.click();
    await settleApi(page);
  }

  // Policy editor: with nothing published, start from the built-in text; then open the preview or the restore question.
  if (c.code === 'API-ADM-POLICIES' && c.state.form && c.state.form !== 'closed') {
    const section = main.locator('section[aria-labelledby="policies-title"]');
    if (c.state.policies === 'none') {
      await section.locator('button').first().click();
      await main
        .locator('button[aria-pressed]')
        .first()
        .waitFor({ timeout: 5_000 })
        .catch(() => notes.push('the editor did not open from the built-in text'));
    }
    if (c.state.policies !== 'error') {
      if (c.state.form === 'preview') await main.locator('button[aria-pressed]').first().click();
      else await section.locator('section[aria-labelledby$="-history"] li button').first().click();
    }
    await settleApi(page);
  }

  // Settings: pick the city so the values show as inherited or overridden.
  if (c.code === 'API-ADM-COMPANY' && c.state.city !== 'all') {
    await main.locator('#settings-city').selectOption('RPR');
    await settleApi(page);
  }

  // Support threads: submit the opener empty (its own error), or open the inbox conversation.
  if (c.code === 'API-ACC-SUPPORT' && c.state.form === 'error') {
    await main.locator('form:has(fieldset) button[type="submit"]').first().click();
    await settleApi(page);
  }
  if (c.code === 'API-ADM-SUPPORT') {
    await main.locator('section[aria-labelledby="inbox-title"] ul li button').first().click();
    await settleApi(page);
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
  // Home servicing: switch the finder to "At my home" and pick the first pinned address.
  if (c.code === 'API-SVC-HOMEFIND' && c.state.mode === 'home') {
    await main.locator('input[name="serviceMode"][value="home"]').check({ force: true });
    await settleApi(page);
    const pick = main.locator('#finder-home-address');
    if ((await pick.count()) > 0) {
      await pick.selectOption({ index: 1 });
      await settleApi(page);
    }
  }

  // Workshop job card of a home visit: open the offer-to-move form, or try a wrong code.
  if (c.code === 'API-WS-HOMEJOB') {
    if (c.state.job === 'offer-move') {
      await main.locator('[data-track="workshop_home_move_open"]').first().click();
      await settleApi(page);
    } else if (c.state.job === 'arrival-wrong' || c.state.job === 'arrival-locked') {
      const code = main.locator('input[name="arrivalCode"]').first();
      if ((await code.count()) === 0) notes.push('no arrival form');
      else {
        await code.fill('1111');
        await main.locator('input[name="odometer"]').first().fill('21400');
        await main.locator('form:has(input[name="arrivalCode"]) button[type="submit"]').first().click();
        await settleApi(page);
      }
    }
  }

  // Job photos: an upload the API refuses (workshop), the gate refusing 'vehicle received' (workshop), the viewer (customer).
  if (c.code === 'API-WS-PHOTOS') {
    if (c.state.photos === 'upload-error') {
      const input = main.locator('input[type="file"]').first();
      if ((await input.count()) === 0) notes.push('no photo input');
      else {
        await input.setInputFiles({
          name: 'notes.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('not a picture'),
        });
        await settleApi(page);
      }
    } else if (c.state.photos === 'gate') {
      const km = main.locator('input[name="odometer"]').first();
      if ((await km.count()) === 0) notes.push('no odometer form');
      else {
        await km.fill('21400');
        await main.locator('form:has(input[name="odometer"]) button[type="submit"]').first().click();
        await settleApi(page);
      }
    }
  }
  if (c.code === 'API-SVC-PHOTOS' && c.state.viewer === 'open') {
    const thumb = main.locator('section[aria-labelledby$="-photos-title"] button').first();
    if ((await thumb.count()) === 0) notes.push('no photo thumbnail');
    else await thumb.click();
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
