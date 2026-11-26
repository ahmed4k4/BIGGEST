/** فحص دخان للإدارة: يدخل بكل دور ويمر على كل الصفحات ويتأكد من غياب أخطاء الكونسول والطلبات الفاشلة.
 *  ADMIN_URL=http://127.0.0.1:5173 API_URL=http://127.0.0.1:8787 node apps/admin/test/e2e.mjs [--shots dir] */
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/npm-tools/')('playwright');
const ADMIN = process.env.ADMIN_URL ?? 'http://127.0.0.1:5173';
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const PAGES = ['dashboard', 'models', 'template', 'labels', 'stock', 'receipts', 'transfers', 'invoices', 'orders', 'customers', 'attendance', 'users', 'finance', 'branches', 'settings', 'grants', 'audit', 'usage'];
const browser = await chromium.launch();
let failures = 0;
for (const [user, pass] of [['owner', 'Owner#2026'], ['admin', 'Admin#2026']]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes(':8787') && !(user === 'admin' && r.status() === 403)) problems.push(`${r.status()} ${r.url()}`); });
  await page.goto(ADMIN + '/'); await page.fill('input[autocomplete=username], input[name=username], #username', user).catch(async () => { await page.locator('input').first().fill(user); });
  await page.locator('input[type=password]').fill(pass); await page.locator('button[type=submit], form button').first().click();
  await page.waitForSelector('nav.nav a', { timeout: 8000 });
  for (const p of PAGES) {
    if (!(await page.locator(`nav.nav a[href="#/${p}"]`).count()) && p !== 'labels') continue;
    await page.goto(`${ADMIN}/#/${p}`); await page.waitForTimeout(450);
    const txt = await page.locator('main').innerText();
    if (/تعذّر تحميل الصفحة/.test(txt)) problems.push(`صفحة ${p}: ${txt.slice(0, 120)}`);
    if (shots && user === 'owner') await page.screenshot({ path: `${shots}/${p}.png` });
  }
  console.log(`${user}: ${problems.length ? 'مشاكل' : 'سليم ✔'}`); problems.forEach((x) => console.log('  ', x)); failures += problems.length; await ctx.close();
}
await browser.close(); process.exit(failures ? 1 : 0);
