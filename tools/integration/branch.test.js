import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, pgAvailable, MAIN, CAI } from '../../2-api/test/helpers.js';
import { startBranchAgent } from '../../5-branch-pos/src/headless.js';
import { Printer } from '../../5-branch-pos/src/printer.js';
import { openDb } from '../../5-branch-pos/src/db.js';

const skip = pgAvailable() ? false : 'يحتاج PostgreSQL: اضبط PGHOST (راجع tools/README.md)';
let MID; let t; let owner; let ag; let dir; let cloud; let online = true; let token; let V; let cashier; let manager;
const api = async (method, path, body, tok) => {
  const r = await fetch(`http://127.0.0.1:${ag.port}${path}`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
};
const login = async (u, p) => (await api('POST', '/local/login', { username: u, password: p })).data;

before(async () => {
  if (skip) return;
  t = await makeTestApp();
  await t.mkUser('owner', 'super_admin', 'Owner#12345');
  await t.mkUser('cash1', 'cashier', 'Cash#12345', CAI);
  await t.mkUser('mgr1', 'branch_manager', 'Mgr#123456', CAI);
  owner = await t.login('owner', 'Owner#12345');
  const m = await t.call('POST', '/models', { token: owner, body: { name: 'قميص أكسفورد', pricePiasters: 59900, costPiasters: 30000 } });
  MID = m.data.id;
  await t.call('POST', `/models/${m.data.id}/variants`, { token: owner, body: { colors: ['01', '05'], sizes: ['M', 'L'] } });
  V = Object.fromEntries((await t.call('GET', `/models/${m.data.id}`, { token: owner })).data.variants.map((v) => [v.sku, v]));
  await t.call('POST', '/receipts', { token: owner, body: { branchId: MAIN, lines: Object.values(V).map((v) => ({ variantId: v.id, qty: 20 })) } });
  const tr = await t.call('POST', '/transfers', { token: owner, body: { fromBranchId: MAIN, toBranchId: CAI, lines: [{ variantId: V['0001-05-M'].id, qty: 10 }, { variantId: V['0001-01-L'].id, qty: 5 }] } });
  for (const to of ['approved', 'in_transit']) await t.call('POST', `/transfers/${tr.data.id}/transition`, { token: owner, body: { to } });
  token = (await t.call('POST', '/devices', { token: owner, body: { name: 'POS-1', branchId: CAI } })).data.deviceToken;
  dir = mkdtempSync(join(tmpdir(), 'branch-'));
  cloud = (url, init) => (online ? t.app.fetch(new Request(url, init)) : Promise.reject(new TypeError('fetch failed')));
  ag = await startBranchAgent({ dataDir: dir, port: 0, fetchImpl: cloud, autoSync: false, log: () => {} });
});
after(async () => { await ag?.stop(); if (dir) rmSync(dir, { recursive: true, force: true }); t?.drop(); });

test('التفعيل بالتوكن ينزّل لقطة كاملة (أصناف، مخزون، مستخدمون)', { skip }, async () => {
  assert.equal((await api('GET', '/local/search?q=0001')).status, 401, 'محمي بدون دخول');
  assert.equal((await api('POST', '/local/activate', { cloudUrl: 'http://t', deviceToken: 'bad.token' })).status, 400);
  const a = await api('POST', '/local/activate', { cloudUrl: 'http://t', deviceToken: token });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const st = (await api('GET', '/local/status')).data;
  assert.equal(st.ready, true); assert.equal(st.branch.code, 'CAI'); assert.equal(st.online, true);
});

test('سعر التكلفة لا يصل للفرع لا في اللقطة ولا في سجل التغييرات', { skip }, async () => {
  await t.call('PATCH', `/models/${MID}`, { token: owner, body: { name: 'قميص أكسفورد' } });
  const pull = await (await cloud('http://t/sync/pull?after=0&limit=500', { headers: { authorization: `Device ${token}` } })).json();
  assert.ok(pull.changes.some((c) => c.table === 'models'));
  assert.ok(!JSON.stringify(pull).includes('cost_piasters'));
});

test('دخول الكاشير يعمل محليًا ويرفض كلمة السر الخاطئة', { skip }, async () => {
  assert.equal((await api('POST', '/local/login', { username: 'cash1', password: 'wrong' })).status, 401);
  cashier = (await login('cash1', 'Cash#12345')).token; manager = (await login('mgr1', 'Mgr#123456')).token;
  assert.ok(cashier && manager);
});

test('البحث بالباركود وبالنص، والرصيد من التحويل المستلم لاحقًا صفر قبل الاستلام', { skip }, async () => {
  const byCode = (await api('GET', '/local/search?q=0001-05-M', null, cashier)).data;
  assert.equal(byCode.length, 1); assert.equal(byCode[0].price, 59900); assert.equal(byCode[0].stock, 0);
  const byText = (await api('GET', `/local/search?q=${encodeURIComponent('أكسفورد M')}`, null, cashier)).data;
  assert.equal(byText.length, 2);
});

test('استلام التحويل محليًا يرفع الرصيد ثم يتزامن بدون عدّ مزدوج', { skip }, async () => {
  const inc = (await api('GET', '/local/transfers/incoming', null, manager)).data;
  assert.equal(inc.length, 1); assert.equal(inc[0].lines.length, 2);
  assert.equal((await api('POST', `/local/transfers/${inc[0].id}/receive`, { lines: [{ variantId: V['0001-05-M'].id, qtyReceived: 11 }] }, manager)).status, 400, 'أكبر من المرسل');
  assert.equal((await api('POST', `/local/transfers/${inc[0].id}/receive`, { lines: inc[0].lines.map((l) => ({ variantId: l.variantId, qtyReceived: l.qtySent })) }, cashier)).status, 403, 'الكاشير لا يستلم');
  assert.equal((await api('POST', `/local/transfers/${inc[0].id}/receive`, { lines: inc[0].lines.map((l) => ({ variantId: l.variantId, qtyReceived: l.qtySent })) }, manager)).status, 200);
  assert.equal((await api('GET', '/local/search?q=0001-05-M', null, cashier)).data[0].stock, 10);
  const s = (await api('POST', '/local/sync', {}, cashier)).data;
  assert.equal(s.pending, 0, JSON.stringify(s));
  assert.equal((await api('GET', '/local/search?q=0001-05-M', null, cashier)).data[0].stock, 10, 'لا عدّ مزدوج بعد وصول نفس الحركة من السيرفر');
  assert.equal((await t.call('GET', `/stock?branch=${CAI}&q=0001-05-M`, { token: owner })).data[0].qty, 10);
});

test('وردية + بيع بدون إنترنت + خصم يتجاوز حد الكاشير يُرفض', { skip }, async () => {
  online = false; await api('POST', '/local/sync', {}, cashier); // يضبط الحالة: أوفلاين
  assert.equal((await api('GET', '/local/status')).data.online, false);
  assert.equal((await api('POST', '/local/shift/open', { openingCash: 50000 }, cashier)).status, 200);
  const v = V['0001-05-M'].id;
  const bad = await api('POST', '/local/sales', { lines: [{ variantId: v, qty: 1 }], discount: { pct: 30 } }, cashier);
  assert.equal(bad.status, 403); assert.equal(bad.data.code, 'DISCOUNT_LIMIT');
  const lim = await api('POST', '/local/sales', { lines: [{ variantId: v, qty: 6 }] }, cashier);
  assert.equal(lim.data.code, 'OFFLINE_LIMIT', 'حد الكمية بدون إنترنت');
  const ok = await api('POST', '/local/sales', { lines: [{ variantId: v, qty: 2 }], discount: { pct: 10 }, payments: [{ method: 'cash', amount: 110000 }] }, cashier);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.invoice.total, 107820); assert.equal(ok.data.invoice.changeDue, 2180); assert.match(ok.data.invoice.number, /^CAI-000001$/);
  S.inv = ok.data.invoice;
  assert.equal((await api('GET', '/local/search?q=0001-05-M', null, cashier)).data[0].stock, 8);
  const under = await api('POST', '/local/sales', { lines: [{ variantId: v, qty: 1 }], payments: [{ method: 'cash', amount: 100 }] }, cashier);
  assert.equal(under.data.code, 'UNDERPAID');
});
const S = {};

test('مرتجع جزئي: لا يتجاوز المباع، ويرجع الرصيد', { skip }, async () => {
  const v = V['0001-05-M'].id;
  assert.equal((await api('POST', '/local/returns', { refInvoiceId: S.inv.id, lines: [{ variantId: v, qty: 3 }] }, cashier)).status, 400);
  const r = await api('POST', '/local/returns', { refInvoiceId: S.inv.id, lines: [{ variantId: v, qty: 1 }] }, cashier);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.invoice.total, 53910, 'نصف إجمالي الفاتورة بعد الخصم');
  assert.equal((await api('GET', '/local/search?q=0001-05-M', null, cashier)).data[0].stock, 9);
  assert.equal((await api('POST', '/local/returns', { refInvoiceId: S.inv.id, lines: [{ variantId: v, qty: 2 }] }, cashier)).status, 400, 'المتبقي 1 فقط');
});

test('جرد وحضور وإغلاق وردية بدون إنترنت', { skip }, async () => {
  const v = V['0001-01-L'].id;
  const c = await api('POST', '/local/counts', { lines: [{ variantId: v, counted: 4 }], note: 'جرد' }, manager);
  assert.equal(c.data.lines[0].delta, -1);
  const a = await api('POST', '/local/attendance', {}, cashier);
  assert.equal(a.status, 200); assert.equal(a.data.kind, 'in');
  assert.equal((await api('POST', '/local/attendance', {}, cashier)).status, 429, 'تسجيل مكرر');
  const sh = (await api('GET', '/local/shift', null, cashier)).data;
  assert.equal(sh.expectedCash, 50000 + 107820 - 53910);
  const close = await api('POST', '/local/shift/close', { closingCash: 100000 }, cashier);
  assert.equal(close.data.difference, 100000 - sh.expectedCash);
});

test('عند عودة الإنترنت تُرفع كل العمليات مرة واحدة والسيرفر يطابق', { skip }, async () => {
  assert.ok(ag.db.outboxStats().pending >= 5);
  online = true;
  const s = (await api('POST', '/local/sync', {}, cashier)).data;
  assert.equal(s.online, true); assert.equal(s.pending, 0); assert.equal(s.failed, 0, JSON.stringify(ag.db.all("select type,error from outbox where status='failed'")));
  const stock = (await t.call('GET', `/stock?branch=${CAI}&q=0001-`, { token: owner })).data;
  const q = (sku) => stock.find((x) => x.sku === sku)?.qty;
  assert.equal(q('0001-05-M'), 9); assert.equal(q('0001-01-L'), 4);
  const sales = (await t.call('GET', '/invoices?limit=10', { token: owner })).data;
  assert.equal(sales.length, 2);
  // إعادة الرفع بنفس opId آمنة: لا تكرار
  ag.db.run("update outbox set status='pending'");
  await api('POST', '/local/sync', {}, cashier);
  assert.equal((await t.call('GET', '/invoices?limit=10', { token: owner })).data.length, 2);
  assert.equal((await t.call('GET', `/stock?branch=${CAI}&q=0001-05-M`, { token: owner })).data[0].qty, 9);
});

test('أمان الخادم المحلي: Host غريب مرفوض', { skip }, async () => {
  const r = await new Promise((resolve) => { const s = net.connect(ag.port, '127.0.0.1', () => s.write('GET /local/status HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n')); let d = ''; s.on('data', (x) => { d += x; }); s.on('close', () => resolve(d)); });
  assert.match(r, /^HTTP\/1.1 421/);
});

test('إعادة الطباعة محدودة للكاشير', { skip }, async () => {
  const id = S.inv.id;
  for (let i = 0; i < 3; i++) assert.equal((await api('GET', `/local/invoices/${id}/receipt?reprint=1`, null, cashier)).status, 200);
  assert.equal((await api('GET', `/local/invoices/${id}/receipt?reprint=1`, null, cashier)).status, 403);
  assert.equal((await api('GET', `/local/invoices/${id}/receipt?reprint=1`, null, manager)).status, 200);
});
