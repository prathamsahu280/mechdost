// Capture every visible + hidden view/modal of the MechDost concept site.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://automart-concept-preview.aliveamber4.chatgpt.site';
const OUT = path.resolve(process.argv[2] || './shots');
fs.mkdirSync(OUT, { recursive: true });

const log = [];
const note = (m) => { console.log(m); log.push(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-IN' });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE ERROR: ' + m.text()); });
page.on('pageerror', (e) => log.push('PAGE ERROR: ' + e.message));

async function shot(name, opts = {}) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: !!opts.full, ...(opts.clip ? { clip: opts.clip } : {}) });
  note('shot ' + name);
}
async function closeModal() {
  await page.evaluate(() => { const d = document.getElementById('modal'); if (d && d.open) d.close(); });
}
async function modalShot(name, fn) {
  try {
    await page.evaluate(fn);
    await page.waitForTimeout(500);
    const dlg = page.locator('#modal');
    if (await dlg.evaluate((d) => d.open)) {
      const title = await page.locator('#modalTitle').innerText().catch(() => '');
      note(`modal ${name}: "${title}"`);
      await dlg.screenshot({ path: path.join(OUT, 'modal-' + name + '.png') });
    } else {
      note(`modal ${name}: did not open`);
      await shot('after-' + name);
    }
  } catch (e) { note(`modal ${name}: ERROR ${e.message}`); }
  await closeModal();
}

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('01-home-top');
await shot('01-home-full', { full: true });

for (const h of ['catalogue', 'service-packages', 'partners']) {
  await page.evaluate((h) => { location.hash = h; }, h);
  await page.waitForTimeout(1500);
  await shot('02-view-' + h, { full: true });
}

// Disable the route guard + reveal every section
await page.evaluate(() => {
  window.launchRouteGuard = () => {};
  window.premiumRoute = () => {};
  document.querySelectorAll('main > section').forEach((s) => s.classList.remove('premium-hidden'));
  const st = document.createElement('style');
  st.textContent = `main>section{display:block!important}#service-packages>*{display:block!important}.premium-trust+section{display:block!important}.vehicle-quickbar{display:flex!important}.mobile-tabs{display:none}`;
  document.head.appendChild(st);
});
await page.waitForTimeout(800);
const ids = await page.evaluate(() => [...document.querySelectorAll('main > section')].map((s, i) => s.id || ('noid-' + i + '-' + (s.className || '').split(' ')[0])));
note('sections: ' + ids.join(', '));
const sections = page.locator('main > section');
const n = await sections.count();
for (let i = 0; i < n; i++) {
  const el = sections.nth(i);
  const id = ids[i];
  try {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await el.boundingBox();
    if (box && box.height > 10) await el.screenshot({ path: path.join(OUT, `03-section-${String(i).padStart(2, '0')}-${id}.png`) });
    else note('section ' + id + ' has no box');
  } catch (e) { note('section ' + id + ' ERROR ' + e.message); }
}
await shot('03-all-sections-full', { full: true });

// Modals and legacy flows (call global functions)
const calls = [
  ['cart', () => showCart()],
  ['account', () => account()],
  ['launchRequest-seller', () => launchRequest('Seller application')],
  ['launchRequest-garage', () => launchRequest('Garage application')],
  ['launchRequest-mechanic', () => launchRequest('Mechanic application')],
  ['launchRequest-sourcing', () => launchRequest('Product sourcing')],
  ['launchRequest-workshop', () => launchRequest('Workshop request')],
  ['whatsapp', () => whatsAppEnquiry('Vehicle service')],
  ['policy-contact', () => launchPolicy('contact')],
  ['policy-privacy', () => launchPolicy('privacy')],
  ['policy-delivery', () => launchPolicy('delivery')],
  ['policy-returns', () => launchPolicy('returns')],
  ['policy-service', () => launchPolicy('service')],
  ['shopOrders', () => shopOrders()],
  ['supportDesk', () => typeof supportDesk === 'function' && supportDesk()],
  ['vehiclesHome', () => vehiclesHome()],
  ['vehiclePassport', () => vehiclePassport()],
  ['servicePanel-customer', () => servicePanel('customer')],
  ['servicePanel-garage', () => servicePanel('garage')],
  ['mechanicRegistration', () => mechanicRegistration()],
  ['mechanicDirectory', () => mechanicDirectory()],
  ['mechanicAdmin', () => mechanicAdmin()],
  ['findMyPart', () => findMyPart()],
  ['productLens', () => productLens()],
  ['assistance-roadside', () => assistanceRequest('roadside')],
  ['assistance-pickup', () => assistanceRequest('pickup')],
  ['assistanceHistory', () => assistanceHistory()],
  ['discovery-compare', () => discoveryTool('compare')],
  ['discovery-calculator', () => discoveryTool('calculator')],
  ['discovery-testdrive', () => discoveryTool('testdrive')],
  ['discoverEnquiryHistory', () => discoverEnquiryHistory()],
  ['showrooms', () => showrooms()],
  ['openVehicleCategory-car', () => openVehicleCategory('Car')],
  ['supplier', () => supplier()],
  ['supplierWorkspace', () => supplierWorkspace()],
  ['garageProfileForm', () => garageProfileForm()],
  ['partnerGarage', () => partnerGarage()],
  ['trainingLinkForm', () => trainingLinkForm()],
  ['browseServiceCategory-Routine', () => browseServiceCategory('Routine')],
  ['bookService', () => bookService()],
];
for (const [name, fn] of calls) await modalShot(name, fn);

// Hub: mode demo + tabs if present
await page.evaluate(() => { try { serviceHubMode = 'demo'; serviceHubTab = 'find'; renderServiceHub(); } catch (e) {} });
await page.waitForTimeout(800);
try { await page.locator('#service-packages').screenshot({ path: path.join(OUT, '04-hub-demo-find.png') }); } catch {}
for (const tab of ['bookings', 'vehicles']) {
  await page.evaluate((t) => { try { serviceHubTab = t; renderServiceHub(); } catch (e) {} }, tab);
  await page.waitForTimeout(600);
  try { await page.locator('#service-packages').screenshot({ path: path.join(OUT, `04-hub-demo-${tab}.png`) }); } catch {}
}

// Other pages
for (const [name, url] of [
  ['account', '/account'], ['support', '/support.html'], ['admin', '/admin'],
  ['product-castrol', '/products/faa9f4e2-47df-497a-8a4b-ce66079444a6'], ['product-exide', '/products/a4f70ea9-0abf-4903-a443-25f4b245beba'],
]) {
  try {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot('05-page-' + name, { full: true });
  } catch (e) { note('page ' + name + ' ERROR ' + e.message); }
}
// account register view
try {
  await page.goto(BASE + '/account', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const link = page.getByText('Create account', { exact: true }).first();
  if (await link.count()) { await link.click(); await page.waitForTimeout(500); await shot('05-page-account-register', { full: true }); }
} catch (e) { note('account register ERROR ' + e.message); }

// Mobile pass
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = mctx.pages()[0] || await mctx.newPage();
await mp.goto(BASE + '/', { waitUntil: 'networkidle' });
await mp.waitForTimeout(1500);
await mp.screenshot({ path: path.join(OUT, '06-mobile-home.png') });
await mp.screenshot({ path: path.join(OUT, '06-mobile-home-full.png'), fullPage: true });
for (const h of ['catalogue', 'service-packages', 'partners']) {
  await mp.evaluate((h) => { location.hash = h; }, h);
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: path.join(OUT, `06-mobile-${h}.png`), fullPage: true });
}
await mp.evaluate(() => showCart());
await mp.waitForTimeout(500);
await mp.screenshot({ path: path.join(OUT, '06-mobile-cart.png') });
await mp.goto(BASE + '/account', { waitUntil: 'networkidle' });
await mp.waitForTimeout(800);
await mp.screenshot({ path: path.join(OUT, '06-mobile-account.png'), fullPage: true });

fs.writeFileSync(path.join(OUT, 'capture-log.txt'), log.join('\n'));
await browser.close();
console.log('DONE');
