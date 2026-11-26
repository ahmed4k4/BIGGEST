/** فحص دخان لواجهة الكاشير في متصفح حقيقي، مع سحابة اختبار داخلية (يحتاج PGHOST).
 *  node apps/branch-agent/test/e2e.mjs [--shots dir] */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, MAIN, CAI } from '../../2-api/test/helpers.js';
import { startBranchAgent } from '../../5-branch-pos/src/headless.js';
const { chromium } = createRequire('/opt/npm-tools/')('playwright');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;

const t = await makeTestApp();
await t.mkUser('owner', 'super_admin', 'Owner#12345'); await t.mkUser('cash1', 'cashier', 'Cash#12345', CAI);
const owner = await t.login('owner', 'Owner#12345');
const m = await t.call('POST', '/models', { token: owner, body: { name: 'قميص أكسفورد', pricePiasters: 59900, costPiasters: 30000 } });
await t.call('POST', `/models/${m.data.id}/variants`, { token: owner, body: { colors: ['01', '05'], sizes: ['M', 'L', 'XL'] } });
const vs = (await t.call('GET', `/models/${m.data.id}`, { token: owner })).data.variants;
await t.call('POST', '/receipts', { token: owner, body: { branchId: MAIN, lines: vs.map((v) => ({ variantId: v.id, qty: 20 })) } });
const tr = await t.call('POST', '/transfers', { token: owner, body: { fromBranchId: MAIN, toBranchId: CAI, lines: vs.map((v) => ({ variantId: v.id, qty: 8 })) } });
for (const to of ['approved', 'in_transit']) await t.call('POST', `/transfers/${tr.data.id}/transition`, { token: owner, body: { to } });
const token = (await t.call('POST', '/devices', { token: owner, body: { name: 'POS-1', branchId: CAI } })).data.deviceToken;

const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
const ag = await startBranchAgent({ dataDir: dir, port: 0, fetchImpl: (u, i) => t.app.fetch(new Request(u, i)), autoSync: false, log: () => {} });
const URL_ = `http://127.0.0.1:${ag.port}`;
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const problems = [];
page.on('console', (x) => { if (x.type() === 'error' && !/fonts\.g|net::ERR/.test(x.text())) problems.push('console: ' + x.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });
try {
  await page.goto(URL_ + '/'); await page.waitForSelector('text=تفعيل جهاز الفرع');
  await page.fill('input[placeholder^="https"]', 'http://t'); await page.fill('input[placeholder^="توكن"]', token); await shot('1-activate');
  await page.click('text=تفعيل >> nth=-1'); await page.waitForSelector('text=دخول', { timeout: 15000 });
  await page.locator('input').first().fill('cash1'); await page.locator('input[type=password]').fill('Cash#12345'); await page.click('button:has-text("دخول")');
  await page.waitForSelector('#q'); await shot('2-sell-empty');
  await page.fill('#q', 'أكسفورد'); await page.waitForSelector('.res'); await shot('3-search');
  await page.click('.res >> nth=0'); await page.click('.res >> nth=0').catch(() => {});
  await page.fill('#q', '0001-05-M'); await page.press('#q', 'Enter'); await page.waitForSelector('table'); await shot('4-cart');
  await page.click('button:has-text("دفع")'); await page.waitForSelector('dialog[open]'); await shot('5-pay');
  await page.click('button:has-text("تأكيد وطباعة")'); await page.waitForSelector('dialog img', { timeout: 8000 }); await shot('6-receipt-preview');
  const ok = await page.locator('dialog img').getAttribute('src'); if (!ok?.startsWith('data:image/png')) problems.push('لم تظهر معاينة الفاتورة');
  await page.click('dialog button:has-text("إغلاق")');
  for (const tab of ['الفواتير والمرتجع', 'الجرد والتحويلات', 'الوردية والحضور', 'الإعدادات']) { await page.click(`nav a:has-text("${tab}")`); await page.waitForTimeout(400); await shot(tab.slice(0, 5).replace(/ /g, '_')); const txt = await page.locator('main').innerText(); if (!txt.trim()) problems.push(`تبويب فارغ: ${tab}`); }
  if (!ag.db.get('select count(*) n from invoices').n) problems.push('لم تُحفظ الفاتورة');
} catch (e) { problems.push('فشل السيناريو: ' + e.message); await shot('fail'); }
console.log(problems.length ? 'مشاكل:\n  ' + problems.join('\n  ') : 'واجهة الكاشير سليمة ✔');
await browser.close(); await ag.stop(); rmSync(dir, { recursive: true, force: true }); t.drop(); process.exit(problems.length ? 1 : 0);
