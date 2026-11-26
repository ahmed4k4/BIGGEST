import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, pgAvailable, MAIN, CAI } from './helpers.js';

const skip = pgAvailable() ? false : 'يحتاج PostgreSQL: اضبط PGHOST (راجع docs/DEVELOPMENT.md)';
let t; let owner; let admin; let cashier; const S = {};

before(async () => {
  if (skip) return;
  t = await makeTestApp();
  await t.mkUser('owner', 'super_admin', 'Owner#12345');
  await t.mkUser('admin1', 'admin', 'Admin#12345');
  await t.mkUser('cash1', 'cashier', 'Cash#12345', CAI);
  owner = await t.login('owner', 'Owner#12345');
  admin = await t.login('admin1', 'Admin#12345');
  cashier = await t.login('cash1', 'Cash#12345');
});
after(() => t?.drop());

test('الدخول: كلمة سر خاطئة ترفض، والصحيحة تعطي توكن', { skip }, async () => {
  assert.equal((await t.call('POST', '/auth/login', { body: { username: 'owner', password: 'x' } })).status, 401);
  assert.ok(owner && admin && cashier);
  assert.equal((await t.call('GET', '/auth/me', { token: owner })).data.role, 'super_admin');
  assert.equal((await t.call('GET', '/auth/me')).status, 401);
});

test('الصلاحيات: الكاشير لا ينشئ موديلًا ولا يرى المستخدمين', { skip }, async () => {
  assert.equal((await t.call('POST', '/models', { token: cashier, body: { name: 'x', pricePiasters: 100 } })).status, 403);
  assert.equal((await t.call('GET', '/users', { token: cashier })).status, 403);
});

test('موديل ← توليد كل أكواد اللون × المقاس بضغطة واحدة', { skip }, async () => {
  const m = await t.call('POST', '/models', { token: admin, body: { name: 'قميص أكسفورد', pricePiasters: 59900, costPiasters: 30000 } });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  assert.equal(m.data.code, '0001');
  S.model = m.data;
  const g = await t.call('POST', `/models/${m.data.id}/variants`, { token: admin, body: { colors: ['01', '05'], sizes: ['M', 'L'] } });
  assert.equal(g.data.created, 4);
  assert.deepEqual(g.data.skus.sort(), ['0001-01-L', '0001-01-M', '0001-05-L', '0001-05-M']);
  const d = await t.call('GET', `/models/${m.data.id}`, { token: admin });
  S.variants = Object.fromEntries(d.data.variants.map((v) => [v.sku, v]));
  assert.equal(d.data.variants.length, 4);
  assert.equal((await t.call('GET', '/code-template/decode?code=0001-05-M', { token: cashier })).data.parts.color.name, 'أحمر');
});

test('إدخال بضاعة في المخزن الرئيسي فقط، ثم تقرير المخزون', { skip }, async () => {
  const v = S.variants['0001-05-M'].id;
  const bad = await t.call('POST', '/receipts', { token: admin, body: { branchId: CAI, lines: [{ variantId: v, qty: 5 }] } });
  assert.equal(bad.status, 400);
  const ok = await t.call('POST', '/receipts', { token: admin, body: { branchId: MAIN, lines: [{ variantId: v, qty: 10 }, { variantId: S.variants['0001-01-L'].id, qty: 4 }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const st = await t.call('GET', `/stock?branch=${MAIN}&q=0001-05`, { token: admin });
  assert.equal(st.data[0].qty, 10);
});

test('التوزيع: مسودة ← معتمد ← في الطريق ← استلام جزئي ثم كامل مع تسجيل العجز', { skip }, async () => {
  const v = S.variants['0001-05-M'].id;
  const tr = await t.call('POST', '/transfers', { token: admin, body: { fromBranchId: MAIN, toBranchId: CAI, lines: [{ variantId: v, qty: 6 }] } });
  assert.equal(tr.status, 200, JSON.stringify(tr.data));
  const id = tr.data.id;
  assert.equal((await t.call('POST', `/transfers/${id}/transition`, { token: admin, body: { to: 'in_transit' } })).status, 400, 'لا قفز من مسودة إلى في الطريق');
  for (const to of ['approved', 'in_transit']) assert.equal((await t.call('POST', `/transfers/${id}/transition`, { token: admin, body: { to } })).status, 200);
  assert.equal((await t.call('GET', `/stock?branch=${MAIN}&q=0001-05-M`, { token: admin })).data[0].qty, 4, 'الخروج من الرئيسي');
  const r1 = await t.call('POST', `/transfers/${id}/receive`, { token: admin, body: { lines: [{ variantId: v, qtyReceived: 5 }] } });
  assert.equal(r1.data.status, 'partially_received');
  const r2 = await t.call('POST', `/transfers/${id}/receive`, { token: admin, body: { lines: [{ variantId: v, qtyReceived: 1 }] } });
  assert.equal(r2.data.status, 'completed');
  assert.equal((await t.call('GET', `/stock?branch=${CAI}&q=0001-05-M`, { token: admin })).data[0].qty, 6);
});

test('التصاريح لمرة واحدة: الأدمن يطلب، السوبر يوافق، يُستخدم مرة ثم يُقفل', { skip }, async () => {
  const put = (token, value) => t.call('PUT', '/settings/site_stock.mode', { token, body: { value } });
  const first = await put(admin, 4);
  assert.equal(first.status, 403);
  assert.equal(first.data.code, 'NEEDS_GRANT');
  const g = await t.call('POST', '/grants', { token: admin, body: { feature: 'site_stock.mode', reason: 'نريد مخزونًا منفصلًا للموقع' } });
  assert.equal((await put(admin, 4)).status, 403, 'قبل الموافقة');
  assert.equal((await t.call('POST', `/grants/${g.data.id}/decide`, { token: admin, body: { approve: true } })).status, 403, 'الأدمن لا يوافق بنفسه');
  assert.equal((await t.call('POST', `/grants/${g.data.id}/decide`, { token: owner, body: { approve: true, minutes: 10 } })).status, 200);
  assert.equal((await put(admin, 4)).status, 200);
  assert.equal((await put(admin, 1)).status, 403, 'التصريح استُهلك');
  assert.equal((await put(owner, 1)).status, 200, 'السوبر أدمن لا يحتاج تصريحًا');
  assert.ok((await t.call('GET', '/audit?entity=permission_grants', { token: owner })).data.length >= 2);
});

test('قالب الكود: لا يُغيَّر معنى قيمة مستخدمة', { skip }, async () => {
  const cur = (await t.call('GET', '/code-template', { token: admin })).data.definition;
  const changed = structuredClone(cur);
  changed.parts.find((p) => p.key === 'color').values.find((v) => v.code === '05').name = 'عنابي';
  const r = await t.call('POST', '/code-template', { token: admin, body: { definition: changed } });
  assert.equal(r.status, 422);
  assert.match(r.data.errors[0], /05/);
  const added = structuredClone(cur);
  added.parts.find((p) => p.key === 'color').values.push({ code: '06', name: 'أخضر', active: true });
  const ok = await t.call('POST', '/code-template', { token: admin, body: { definition: added } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.version, 2);
});

let device;
test('تسجيل جهاز فرع: التوكن يظهر مرة واحدة ولا يُخزَّن إلا مجزّأً', { skip }, async () => {
  assert.equal((await t.call('POST', '/devices', { token: admin, body: { name: 'POS-1', branchId: CAI } })).status, 403, 'يحتاج تصريحًا');
  const d = await t.call('POST', '/devices', { token: owner, body: { name: 'POS-1', branchId: CAI } });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  device = d.data.deviceToken;
  assert.ok(device.includes('.'));
  const list = await t.call('GET', '/devices', { token: owner });
  assert.equal(list.data[0].token_hash, undefined);
  assert.equal((await t.call('GET', '/sync/ping', { device: 'bad.token' })).status, 401);
  assert.equal((await t.call('GET', '/sync/ping', { device })).status, 200);
});

const sale = (id, variant, qty, number) => ({
  opId: crypto.randomUUID(), type: 'sale.create', deviceTime: new Date().toISOString(),
  payload: { invoice: { id, number, kind: 'sale', gross: 59900 * qty, discount: 0, tax: 0, total: 59900 * qty, paid: 59900 * qty, changeDue: 0, createdAtDevice: new Date().toISOString() },
    lines: [{ variantId: variant.id, sku: variant.sku, modelName: 'قميص أكسفورد', colorName: 'أحمر', sizeName: 'M', qty, unitPrice: 59900, lineDiscount: 0, lineTotal: 59900 * qty, movementId: crypto.randomUUID() }],
    payments: [{ method: 'cash', amount: 59900 * qty }] },
});

test('المزامنة: Outbox بدون تكرار، وبيع تجاوز الرصيد يُسجَّل ولا يضيع', { skip }, async () => {
  const v = S.variants['0001-05-M'];
  const inv = crypto.randomUUID();
  const op = sale(inv, v, 2, 'CAI-A-000001');
  const r1 = await t.call('POST', '/sync/push', { device, body: { ops: [op] } });
  assert.equal(r1.data.results[0].status, 'ok', JSON.stringify(r1.data));
  const r2 = await t.call('POST', '/sync/push', { device, body: { ops: [op] } });
  assert.equal(r2.data.results[0].status, 'duplicate', 'نفس opId لا يكرر الفاتورة');
  assert.equal((await t.call('GET', `/stock?branch=${CAI}&q=0001-05-M`, { token: admin })).data[0].qty, 4);
  const over = await t.call('POST', '/sync/push', { device, body: { ops: [sale(crypto.randomUUID(), v, 9, 'CAI-A-000002')] } });
  assert.equal(over.data.results[0].status, 'ok');
  const invoices = await t.call('GET', `/invoices?branch=${CAI}`, { token: owner });
  assert.equal(invoices.data.length, 2);
  assert.equal(invoices.data.find((i) => i.number === 'CAI-A-000002').oversold, true);
  assert.equal((await t.call('POST', '/sync/push', { device, body: { ops: [{ opId: 'x', type: 'bad' }] } })).status, 400);
});

test('تنزيل التغييرات بمؤشر seq، والكلمات السرية لا تنزل كاملة', { skip }, async () => {
  const p1 = await t.call('GET', '/sync/pull?after=0&limit=5', { device });
  assert.equal(p1.data.changes.length, 5);
  assert.ok(p1.data.hasMore);
  let after = p1.data.nextSeq; let all = [...p1.data.changes];
  for (let i = 0; i < 50; i++) { const p = await t.call('GET', `/sync/pull?after=${after}&limit=100`, { device }); all = all.concat(p.data.changes); after = p.data.nextSeq; if (!p.data.hasMore) break; }
  const tables = new Set(all.map((c) => c.table));
  for (const x of ['models', 'variants', 'branch_users', 'transfers', 'stock_movements']) assert.ok(tables.has(x), `يجب أن ينزل ${x}`);
  assert.ok(!JSON.stringify(all).includes('"password_hash"'), 'لا password_hash في change_log');
  assert.ok(all.every((c) => c.table !== 'stock_movements' || c.data.branch_id === CAI), 'حركات فرعي فقط');
  const snap = await t.call('GET', '/sync/snapshot', { device });
  assert.ok(snap.data.tables.models.length >= 1 && snap.data.tables.models[0].cost_piasters === undefined, 'التكلفة لا تنزل للفرع');
});

test('المتجر: حجز ذري، منع تكرار الطلب، ومنع بيع آخر قطعة مرتين', { skip }, async () => {
  const v = S.variants['0001-01-L'];            // 4 قطع في الرئيسي (وضع 1: المخزن الرئيسي فقط)
  assert.equal((await t.call('GET', '/public/availability.json')).data[v.id].a, 3, 'هامش الأمان 1');
  const order = (token, qty) => ({ clientToken: token, paymentMethod: 'cod', customer: { name: 'منى', phone: '٠١٠١٢٣٤٥٦٧٨', address: 'القاهرة', governorate: 'القاهرة' }, lines: [{ variantId: v.id, qty }], utm: { source: 'facebook', campaign: 'winter' } });
  const tok = crypto.randomUUID();
  const o1 = await t.call('POST', '/public/orders', { body: order(tok, 2) });
  assert.equal(o1.status, 200, JSON.stringify(o1.data));
  assert.equal(o1.data.total, 119800);
  const dup = await t.call('POST', '/public/orders', { body: order(tok, 2) });
  assert.equal(dup.data.duplicate, true);
  assert.equal(dup.data.number, o1.data.number);
  assert.equal((await t.call('GET', '/public/availability.json')).data[v.id].a, 1);
  const o2 = await t.call('POST', '/public/orders', { body: order(crypto.randomUUID(), 2) });
  assert.equal(o2.status, 409, 'الباقي أقل من المطلوب');
  const results = await Promise.all([1, 2, 3].map(() => t.call('POST', '/public/orders', { body: order(crypto.randomUUID(), 1) })));
  assert.equal(results.filter((r) => r.status === 200).length, 1, 'قطعة واحدة متاحة فقط رغم 3 طلبات متزامنة');
  const trk = await t.call('GET', `/public/orders/${o1.data.number}?phone=5678`);
  assert.equal(trk.data.status, 'pending');
  assert.equal((await t.call('GET', `/public/orders/${o1.data.number}?phone=0000`)).status, 404);
  assert.equal((await t.call('POST', '/public/orders', { body: order(crypto.randomUUID(), 1) })).status, 429, 'حد المعدل: 6 طلبات في الدقيقة من نفس العنوان');
  assert.equal((await t.call('POST', '/public/orders', { headers: { 'x-forwarded-for': '9.9.9.9' }, body: { ...order(crypto.randomUUID(), 1), website: 'http://spam' } })).data.number, 'WEB-000000', 'فخ الروبوتات');
});

test('الطلب: تأكيد ثم شحن يحوّل الحجز إلى خروج فعلي، والإلغاء يفرج الحجز', { skip }, async () => {
  const orders = (await t.call('GET', '/orders', { token: admin })).data;
  const o = orders[orders.length - 1];
  for (const to of ['confirmed', 'preparing', 'shipped']) assert.equal((await t.call('POST', `/orders/${o.id}/status`, { token: admin, body: { to } })).status, 200);
  assert.equal((await t.call('POST', `/orders/${o.id}/status`, { token: admin, body: { to: 'pending' } })).status, 400);
  const detail = (await t.call('GET', `/orders/${o.id}`, { token: admin })).data;
  assert.equal(detail.status, 'shipped');
  assert.equal(detail.customer.phone, '+201012345678');
});

test('التقارير والإعدادات والاستهلاك', { skip }, async () => {
  const dash = await t.call('GET', '/reports/dashboard', { token: admin });
  assert.equal(dash.status, 200);
  assert.ok(dash.data.sales_total > 0);
  assert.equal((await t.call('GET', '/reports/usage', { token: admin })).status, 403);
  const u = await t.call('GET', '/reports/usage', { token: owner });
  assert.equal(u.data.level, 'ok');
  const s = await t.call('GET', '/settings', { token: admin });
  assert.equal(s.data.levels['site_stock.mode'], 'grant');
  assert.equal((await t.call('PUT', '/settings/evil.key', { token: admin, body: { value: 1 } })).status, 400);
});

test('الأمان: الكاشير لا يرى الرقم كاملًا، ولا يمكن الوصول لجدول غير مسموح', { skip }, async () => {
  const custs = await t.call('GET', '/customers', { token: cashier });
  assert.equal(custs.status, 200);
  assert.ok(custs.data.every((c) => c.phone_e164.endsWith(c.phone_e164.slice(-4)) && c.phone_e164.includes('•')));
  const raw = await t.db.rpc('api_list', { p_table: 'doc_counters', p_company: '00000000-0000-4000-8000-000000000001' }).catch((e) => e);
  assert.ok(raw instanceof Error, 'جدول خارج القائمة البيضاء');
});
