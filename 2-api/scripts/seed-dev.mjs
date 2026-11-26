#!/usr/bin/env node
/**
 * بيانات تجريبية: مستخدمون بكل دور، تصنيفات، موديلات بأكواد مولّدة، بضاعة في المخزن الرئيسي، وجهاز فرع جاهز.
 * يمرّ على نفس الـ API (داخل العملية) فيجرّب القواعد الحقيقية.   node scripts/seed-dev.mjs  (من داخل مجلد 2-api)
 */
import { loadEnv } from './env.mjs';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDbFromEnv } from '../src/db/index.js';
import { hashSecret } from '../src/shared/index.js';

const env = loadEnv();
const config = readConfig(env);
const db = await createDbFromEnv(env);
const app = createApp({ db, config, storage: { put: async () => {}, get: async () => null } });
const MAIN = '00000000-0000-4000-8000-0000000000a1'; const CAI = '00000000-0000-4000-8000-0000000000b1';
const pw = (k, d) => env[k] ?? d;

async function user(username, role, password, branchId = null) {
  const [ex] = await db.rpc('api_list', { p_table: 'users', p_company: config.companyId, p_where: { username }, p_q: null, p_limit: 1, p_offset: 0 });
  if (ex) return ex;
  return db.rpc('api_insert', { p_table: 'users', p_row: { company_id: config.companyId, username, display_name: username, role, branch_id: branchId, password_hash: await hashSecret(password), pin_hash: await hashSecret('1234') } });
}
const creds = [['owner', 'super_admin', pw('SEED_OWNER_PASSWORD', 'Owner#2026'), null], ['admin', 'admin', pw('SEED_ADMIN_PASSWORD', 'Admin#2026'), null],
  ['cairo.manager', 'branch_manager', 'Manager#2026', CAI], ['cairo.cashier', 'cashier', 'Cashier#2026', CAI], ['storekeeper', 'storekeeper', 'Store#2026', MAIN]];
for (const [u, r, p, b] of creds) await user(u, r, p, b);

const call = async (method, path, token, body) => {
  const res = await app.fetch(new Request(`http://seed${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }));
  const data = await res.json(); if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`); return data;
};
const login = await app.fetch(new Request('http://seed/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: pw('SEED_OWNER_PASSWORD', 'Owner#2026') }) }));
const { token } = await login.json();
if (!token) throw new Error('فشل دخول المالك أثناء التهيئة');

const have = await call('GET', '/models?limit=1', token);
if (!have.length) {
  const cats = {};
  for (const name of ['قمصان', 'بناطيل', 'جاكيتات', 'تيشيرتات']) cats[name] = (await call('POST', '/categories', token, { name })).id;
  const demo = [['قميص أكسفورد', 'قمصان', 59900], ['قميص كتان صيفي', 'قمصان', 64900], ['بنطلون جينز', 'بناطيل', 89900], ['بنطلون كلاسيك', 'بناطيل', 79900], ['جاكيت جلد صناعي', 'جاكيتات', 189900], ['تيشيرت قطن', 'تيشيرتات', 24900]];
  const lines = [];
  for (const [name, cat, price] of demo) {
    const m = await call('POST', '/models', token, { name, categoryId: cats[cat], pricePiasters: price, costPiasters: Math.round(price * 0.55), description: `${name} — خامة مريحة وتفصيل عملي.` });
    await call('POST', `/models/${m.id}/variants`, token, { colors: ['01', '03', '04'], sizes: ['S', 'M', 'L', 'XL'] });
    for (const v of (await call('GET', `/models/${m.id}`, token)).variants) lines.push({ variantId: v.id, qty: 8 + (v.sku.length % 5) });
  }
  await call('POST', '/receipts', token, { branchId: MAIN, note: 'رصيد افتتاحي تجريبي', lines });
  const branchLines = lines.slice(0, 24).map((l) => ({ variantId: l.variantId, qty: 3 }));
  const tr = await call('POST', '/transfers', token, { fromBranchId: MAIN, toBranchId: CAI, note: 'تجهيز فرع القاهرة', lines: branchLines });
  for (const to of ['approved', 'in_transit']) await call('POST', `/transfers/${tr.id}/transition`, token, { to });
  await call('POST', `/transfers/${tr.id}/receive`, token, { lines: branchLines.map((l) => ({ variantId: l.variantId, qtyReceived: l.qty })) });
  await call('PUT', '/settings/shop.name', token, { value: 'متجر الخياط' });
  await call('PUT', '/settings/shop.whatsapp', token, { value: '201000000000' });
}

let device = null;
const devs = await call('GET', '/devices', token);
if (!devs.some((d) => d.name === 'كاشير القاهرة 1')) device = (await call('POST', '/devices', token, { name: 'كاشير القاهرة 1', branchId: CAI })).deviceToken;
console.log('\nجاهز ✔\n  المالك      owner          /', pw('SEED_OWNER_PASSWORD', 'Owner#2026'),
  '\n  الأدمن      admin          /', pw('SEED_ADMIN_PASSWORD', 'Admin#2026'), '\n  مدير الفرع  cairo.manager  / Manager#2026  (PIN 1234)\n  الكاشير     cairo.cashier  / Cashier#2026  (PIN 1234)');
if (device) console.log('\n  توكن جهاز الفرع (يظهر مرة واحدة، ضعه في شاشة التفعيل):\n  ' + device);
else console.log('\n  جهاز الفرع مسجّل سابقًا (توكنه يظهر مرة واحدة فقط عند الإنشاء).');
db.close?.();
