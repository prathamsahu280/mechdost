/**
 * API-mode hooks for `runCase` (`harness.ts` `ApiHooks`): the signed-in Firebase user, the mocked API, and the page
 * set-up for the real-mode screens (open a refund, a shop, the give-up form). See `session.ts` for why none of this
 * can reach production.
 */
import type { Page } from '@playwright/test';
import type { AuditCase } from '../cases.ts';
import type { ApiHooks } from '../harness.ts';
import { auditMocksFor } from './baseline-fixtures.ts';
import { clickIfPresent } from './hook-click.ts';
import { installApi } from './mock-api.ts';
import { mockFirebase, persistedUser } from './session.ts';

const UID: Readonly<Record<string, string>> = {
  customer: 'audit-customer',
  shop: 'audit-shop',
  workshop: 'audit-workshop',
  admin: 'audit-admin',
};
const PHONE = '9876543210';

const CSV_SAMPLE = ['sku,stock', 'AB-12,1', ''].join(String.fromCharCode(10));
const settleApi = (page: Page) => page.waitForTimeout(500);

/** Opens what the case's state names: a refund's detail, a shop and its panel, the give-up form. */
async function prepareApi(page: Page, c: AuditCase): Promise<string[]> {
  const notes: string[] = [];
  const main = page.locator('main');
  await settleApi(page);

  if (c.code === 'API-ADM-REFUNDQ' && (c.state.detail === 'open' || c.state.form !== 'clean')) {
    await main.locator('section[aria-labelledby="refund-list"] ul li button').first().click();
    await settleApi(page);
    // An unsure refund: open the settle form, then submit it empty (errors) or fill it in (filled).
    if (c.state.refund === 'needs-reconciliation' && c.state.form !== 'clean') {
      await main.locator('[data-testid="refund-settle-open"]').click();
      if (c.state.form === 'errors')
        await main
          .locator('#refund-settle-title')
          .locator('xpath=ancestor::form')
          .locator('button[type="submit"]')
          .click();
      else await main.locator('textarea').fill('Checked the Razorpay dashboard: no refund there');
      await settleApi(page);
    }
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
      await clickIfPresent(
        main.locator(`[role="tab"][id$="-tab-${c.state.panel}"]`),
        notes,
        'panel tab not found',
      );
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
      const opened = await clickIfPresent(section.locator('button'), notes, 'no give-role button');
      if (opened && c.state.form === 'give-error')
        await clickIfPresent(
          section.locator('form button[type="submit"]:visible:enabled'),
          notes,
          'no enabled submit in the give-role form',
        );
    }
    await settleApi(page);
  }

  if (c.code === 'API-ADM-COUPONS' && c.state.form && c.state.form !== 'closed') {
    const section = main.locator('section[aria-labelledby="coupons-admin-title"]');
    await section.locator('button').first().click();
    if (c.state.form === 'errors') await section.locator('form button[type="submit"]').click();
    await settleApi(page);
  }

  // Coupon usage panel (2026-11-16): open the first coupon's report.
  if (c.code === 'API-ADM-COUPONS' && (c.state.usage === 'open' || c.state.usage === 'empty')) {
    const open = main.locator('button[data-disclosure-trigger^="usage-"]').first();
    if ((await open.count()) === 0) notes.push('no coupon to open usage for');
    else {
      await open.click();
      await settleApi(page);
    }
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

  // Exports: ask for the file (done, empty, too large, expired link), or send a range over 180 days.
  if (
    c.code === 'API-ADM-EXPORTS' &&
    ['done', 'done-empty', 'error-large', 'error-link', 'range-error'].includes(String(c.state.exports))
  ) {
    const form = main.locator('form[aria-busy]');
    await form.waitFor({ timeout: 5_000 }).catch(() => notes.push('the export form did not appear'));
    if (c.state.exports === 'range-error') await main.locator('#export-from').fill('2020-01-01');
    await form.locator('button[type="submit"]').click();
    await settleApi(page);
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
      await clickIfPresent(section.locator('button'), notes, 'no button to start from the built-in text');
      await main
        .locator('button[aria-pressed]')
        .first()
        .waitFor({ timeout: 5_000 })
        .catch(() => notes.push('the editor did not open from the built-in text'));
    }
    if (c.state.policies !== 'error') {
      if (c.state.form === 'preview')
        await clickIfPresent(main.locator('button[aria-pressed]'), notes, 'no preview toggle');
      else
        await clickIfPresent(
          section.locator('section[aria-labelledby$="-history"] li button'),
          notes,
          'no version in the history to restore (nothing published)',
        );
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
  if (c.code === 'API-ADM-SUPPORT' || c.code === 'API-ADM-SUPPORT-TOOLS') {
    await main.locator('section[aria-labelledby="inbox-title"] ul li button').first().click();
    await settleApi(page);
  }

  // Support tools: the deletion card (ask, then the inline confirmation, then send) and the guest form's empty submit.
  if (c.code === 'API-ACC-DELETION' && c.state.deletion !== 'card') {
    await main.locator('[data-track="support_deletion_ask"]').click();
    if (c.state.deletion !== 'confirm') {
      await main.locator('[data-track="support_deletion_confirm"]').click();
      await settleApi(page);
    }
  }
  if (c.code === 'API-GUEST-SUPPORT' && c.state.form === 'errors') {
    await main.locator('form#guest-new-form button[type="submit"]').click();
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
        // A person on /hi types Hindi: the reason is shown back on the page (and the Hindi gate reads it).
        await form
          .locator('textarea')
          .fill(
            c.locale === 'hi'
              ? 'बारिश में स्टॉक ख़राब हो गया, इस हफ़्ते सप्लाई नहीं कर सकते'
              : 'Stock damaged in the rain, cannot supply this week',
          );
      } else if (c.state.giveup === 'empty-submit') {
        await form.locator('button[type="submit"]').click();
      }
      await settleApi(page);
    }
  }
  // Shop portal tier 2: choose a file and check it (or apply it), so the card shows the answer of the mocked API.
  if (c.code === 'API-SHOP-TIER2' && c.state.csv && c.state.csv !== 'idle') {
    const card = main.locator('#shop-csv');
    const input = card.locator('input[type="file"]');
    if ((await input.count()) === 0) notes.push('no CSV card');
    else {
      await input.setInputFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_SAMPLE) });
      await card.locator('button.bg-accent-button').first().click();
      await settleApi(page);
      if (c.state.csv === 'applied') {
        await card.locator('button.bg-accent-button').first().click();
        await settleApi(page);
      }
    }
  }
  // Shop portal, staff performance: open the section from its toggle so the mocked API answers it.
  if (c.code === 'API-SHOP-STAFF') {
    const toggle = main.locator('[data-disclosure-trigger="shop-staff-performance"]');
    if ((await toggle.count()) === 0) notes.push('no staff performance toggle');
    else {
      await toggle.click();
      await settleApi(page);
    }
  }
  // Public status form: submit it empty so the field errors show.
  if (c.code === 'API-PARTNER-STATUS' && c.state.form === 'invalid') {
    await main.locator('form button[type="submit"]').first().click();
    await settleApi(page);
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

  // Workshop analytics (design 2026-11-15): open the admin Workshops tab; open Performance (and the 90-day preset).
  if (c.code === 'API-ADM-WORKSHOPS') {
    const tab = main.locator('[data-track="admin_analytics_tab_workshops"]');
    if ((await tab.count()) === 0) notes.push('no Workshops tab');
    else {
      await tab.click();
      await settleApi(page);
    }
  }
  if (c.code === 'API-WS-PERFORMANCE') {
    const open = main.locator('[data-track="workshop_performance_toggle"]');
    if ((await open.count()) === 0) notes.push('no Performance button');
    else {
      await open.click();
      await settleApi(page);
      if (c.state.perf === 'ninety') {
        await main.locator('[data-track="workshop_analytics_preset_90"]').click();
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
        const submit = main.locator('form:has(input[name="odometer"]) button[type="submit"]').first();
        // Since QA pass 3 (bug 6) the button is disabled with its reason while a required before photo is missing, so
        // the API gate is never reached; clicking a disabled button waited out the test timeout (2026-11-16).
        if (await submit.isDisabled()) {
          const reason = await submit.getAttribute('aria-describedby');
          if (!reason || (await page.locator(`[id="${reason}"]`).count()) === 0)
            notes.push('vehicle received disabled without a visible reason');
        } else {
          await submit.click();
          await settleApi(page);
        }
      }
    }
  }
  // Workshops tier 1: open the customer's reschedule form.
  if (c.code === 'API-SVC-RESCHEDULE' && c.state.form === 'open') {
    const link = main.getByRole('button', { name: /change date or time|तारीख़ या समय बदलें/i }).first();
    if ((await link.count()) === 0) notes.push('no reschedule link');
    else await link.click();
  }
  // Workshops tier 3: the tap on "Pay online" answered with BILL_NOT_PAYABLE; the staff cancel form.
  if (c.code === 'API-SVC-PAYBILL' && c.state.pay === 'error') {
    const pay = main.getByRole('button', { name: /pay online|ऑनलाइन भुगतान करें/i }).first();
    if ((await pay.count()) === 0) notes.push('no pay online button');
    else {
      await pay.click();
      await settleApi(page);
    }
  }
  if (c.code === 'API-ADM-SVCROUTE' && c.state.form === 'cancel') {
    const open = main.getByRole('button', { name: /cancel this request|यह अनुरोध रद्द करें/i }).first();
    if ((await open.count()) === 0) notes.push('no staff cancel button');
    else await open.click();
  }
  if (c.code === 'API-PDP-GALLERY' && c.state.viewer === 'open') {
    const big = page
      .locator(
        '[data-product-media] button[aria-label*="larger" i], [data-product-media] button[aria-label*="बड़ी" i]',
      )
      .first();
    if ((await big.count()) === 0) notes.push('no photo to enlarge (none has no viewer)');
    else await big.click();
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
    return installApi(page, c, auditMocksFor(c));
  },
  seed(c, now) {
    const uid = UID[c.auth];
    return uid ? persistedUser(uid, PHONE, now) : {};
  },
  prepare: prepareApi,
};
