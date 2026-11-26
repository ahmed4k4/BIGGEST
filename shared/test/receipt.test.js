import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutReceipt, layoutLabel, drawOps, toMonoBitmap, escposRaster, tsplBitmap, encodeQR, encodeCode128, code128Values } from '../src/index.js';

const sample = {
  shop: { name: 'محل', phone: '010' }, branchName: 'القاهرة', invoice: { number: 'CAI-000001', createdAt: '2026-11-24T10:00:00Z', kind: 'sale' },
  lines: [{ name: 'قميص', detail: 'أزرق • M', qty: 2, unitPrice: 25000, lineTotal: 50000 }],
  totals: { gross: 50000, discount: 5000, tax: 0, total: 45000, paid: 50000, changeDue: 5000 }, payments: [{ method: 'cash', amount: 50000 }], qrText: 'https://x.test/t/CAI-000001',
};

test('تخطيط الفاتورة يعطي أوامر وارتفاعًا موجبًا ويحتوي QR', () => {
  const l = layoutReceipt(sample);
  assert.ok(l.height > 300 && l.ops.some((o) => o.t === 'qr') && l.ops.some((o) => o.t === 'text' && o.text.includes('CAI-000001')));
});

test('الرسم على canvas مزيّف يستدعي fillRect للـ QR والباركود', () => {
  let rects = 0; const ctx = new Proxy({}, { get: (_, k) => (k === 'fillRect' ? () => { rects++; } : () => {}), set: () => true });
  drawOps(ctx, layoutReceipt(sample)); const r0 = rects;
  drawOps(ctx, layoutLabel({ modelName: 'قميص', colorName: 'أزرق', sizeName: 'M', price: 25000, sku: 'SH-BL-M' }));
  assert.ok(r0 > 100 && rects > r0 + 10);
});

test('1bpp وESC/POS وTSPL', () => {
  const w = 16; const h = 4; const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) { const i = (y * w + 0) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; } // عمود أسود أول
  const bmp = toMonoBitmap(rgba, w, h);
  assert.equal(bmp.wBytes, 2); assert.equal(bmp.data[0], 0x80); assert.equal(bmp.data[1], 0);
  const e = escposRaster(bmp);
  assert.deepEqual([...e.slice(0, 2)], [0x1b, 0x40]); assert.deepEqual([...e.slice(2, 10)], [0x1d, 0x76, 0x30, 0, 2, 0, 4, 0]);
  assert.deepEqual([...e.slice(-4)], [0x1d, 0x56, 0x42, 0]);
  const t = tsplBitmap(bmp); assert.match(new TextDecoder().decode(t.slice(0, 60)), /^SIZE 40 mm,30 mm/); assert.equal(t[t.indexOf(0x2c, 80) + 1] !== undefined, true);
});

test('QR: أبعاد صحيحة ونمط الباحث، وCode128 بالمجموع الاختباري المعروف', () => {
  const q = encodeQR('HELLO'); assert.equal(q.size, 21 + 0); assert.ok(q.modules[0][0] && q.modules[0][6] && !q.modules[1][1]);
  assert.deepEqual(code128Values('PJJ123'), [104, 48, 42, 42, 17, 18, 19, 16]); // حساب يدوي: (104+48+84+126+68+90+114) mod 103 = 16
  const vals = code128Values('PJJ123'); assert.equal(encodeCode128('PJJ123').reduce((a, b) => a + b, 0), vals.length * 11 + 13);
});
