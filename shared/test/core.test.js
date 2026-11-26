import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, maskPhone } from '../src/phone.js';
import { toPiasters, formatEGP } from '../src/money.js';
import { computeInvoice, effectiveDiscountPct } from '../src/invoice.js';
import {
  classifyCheckIn, classifyCheckOut, scorePeriod, evaluateThresholds, hhmmToMin, minutesOfDay, nextExpectedEvent,
} from '../src/attendance.js';
import { computeAvailability, SITE_MODES } from '../src/availability.js';
import { can, levelOf } from '../src/permissions.js';
import { validateOp } from '../src/sync-protocol.js';

test('توحيد الهاتف: كل الصيغ لنفس العميل تعطي نفس المفتاح', () => {
  const same = ['01012345678', '+201012345678', '00201012345678', '201012345678', '٠١٠١٢٣٤٥٦٧٨', '010 1234 5678', '010-1234-5678', '1012345678'];
  for (const s of same) assert.equal(normalizePhone(s), '+201012345678', s);
  assert.equal(normalizePhone('0233445566'), '+20233445566');
  assert.equal(normalizePhone('+971501234567'), '+971501234567');
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(maskPhone('+201012345678', 4).slice(-4), '5678');
});

test('المبالغ بالقروش', () => {
  assert.equal(toPiasters('١٢٣٫٥٠'), 12350);
  assert.equal(toPiasters(99.99), 9999);
  assert.ok(formatEGP(12350).length > 0);
});

test('مجاميع الفاتورة: خصم ونسبة وضريبة شاملة وغير شاملة', () => {
  const lines = [{ qty: 2, unitPrice: 10000 }, { qty: 1, unitPrice: 5000, lineDiscount: 1000 }];
  const a = computeInvoice(lines, { discountPct: 10, taxRatePct: 14, taxInclusive: true });
  assert.equal(a.subtotal, 24000);
  assert.equal(a.invoiceDiscount, 2400);
  assert.equal(a.total, 21600);
  assert.equal(a.tax, Math.round(21600 - 21600 / 1.14));
  const b = computeInvoice(lines, { taxRatePct: 14, taxInclusive: false });
  assert.equal(b.total, 24000 + Math.round(24000 * 0.14));
  assert.ok(effectiveDiscountPct(a) > 10);
  assert.throws(() => computeInvoice([{ qty: 1.5, unitPrice: 1 }]), /عددًا صحيحًا/);
  assert.throws(() => computeInvoice([]), /بدون أصناف/);
});

const shift = { startMin: hhmmToMin('09:00'), endMin: hhmmToMin('17:00'), graceLateMin: 10, graceEarlyLeaveMin: 10, graceLateLeaveMin: 10 };

test('ألوان الدخول: أزرق قبل الموعد، أخضر ضمن السماح، أحمر متأخر', () => {
  assert.equal(classifyCheckIn(shift, hhmmToMin('08:50')).color, 'blue');
  assert.equal(classifyCheckIn(shift, hhmmToMin('09:00')).color, 'green');
  assert.equal(classifyCheckIn(shift, hhmmToMin('09:10')).color, 'green'); // حد السماح بالظبط
  assert.equal(classifyCheckIn(shift, hhmmToMin('09:11')).color, 'red');
});

test('ألوان الانصراف: أحمر مبكر، أخضر في الموعد، أزرق وقت إضافي', () => {
  assert.equal(classifyCheckOut(shift, hhmmToMin('16:49')).color, 'red');
  assert.equal(classifyCheckOut(shift, hhmmToMin('16:50')).color, 'green');
  assert.equal(classifyCheckOut(shift, hhmmToMin('17:10')).color, 'green');
  assert.equal(classifyCheckOut(shift, hhmmToMin('17:30')).color, 'blue');
});

test('وردية ليلية تعبر منتصف الليل', () => {
  const night = { startMin: hhmmToMin('22:00'), endMin: hhmmToMin('06:00'), graceEarlyLeaveMin: 5, graceLateLeaveMin: 5 };
  assert.equal(classifyCheckOut(night, hhmmToMin('06:00')).color, 'green');
  assert.equal(classifyCheckOut(night, hhmmToMin('03:00')).color, 'red');
  assert.equal(classifyCheckOut(night, hhmmToMin('07:00')).color, 'blue');
});

test('مثال المستند: 3 خضراء ونقطة حمراء = +1، وحمراء تُلغى بخضراوين', () => {
  assert.equal(scorePeriod({ events: [{ color: 'green' }, { color: 'green' }, { color: 'green' }, { color: 'red' }] }), 1);
  assert.equal(scorePeriod({ events: [{ color: 'red' }, { color: 'green' }, { color: 'green' }] }), 0);
  assert.equal(scorePeriod({ events: [], unexcusedAbsences: 1 }), -4);
  assert.equal(evaluateThresholds(-7), 'warning');
  assert.equal(evaluateThresholds(1), null);
});

test('الأدمن يغيّر النقاط والألوان (قواعد قابلة للضبط)', () => {
  const rules = { ...{ colors: { green: { points: 0.5 }, blue: { points: 0 }, red: { points: -3 } }, unexcusedAbsencePoints: -4, excusedAbsencePoints: 0, thresholds: [] } };
  assert.equal(classifyCheckIn(shift, hhmmToMin('10:00'), rules).points, -3);
});

test('توقيت القاهرة', () => {
  assert.equal(minutesOfDay(new Date('2026-11-22T07:30:00Z'), 'Africa/Cairo'), 9 * 60 + 30);
});

test('تسلسل تسجيل الحضور: لا دخولان متتاليان', () => {
  assert.equal(nextExpectedEvent(null), 'in');
  assert.equal(nextExpectedEvent({ kind: 'in' }), 'out');
});

test('أوضاع مخزون الموقع الأربعة وهامش الأمان والحجز', () => {
  const stock = { main: 10, b1: 4, b2: 2, web: 6 };
  const base = { stock, mainId: 'main', webId: 'web', safetyMargin: 1 };
  assert.equal(computeAvailability({ ...base, mode: SITE_MODES.MAIN_ONLY }).available, 9);
  assert.equal(computeAvailability({ ...base, mode: SITE_MODES.MAIN_PLUS_BRANCHES, selectedLocations: ['b1'] }).available, 13);
  assert.equal(computeAvailability({ ...base, mode: SITE_MODES.ALL }).available, 21);
  assert.equal(computeAvailability({ ...base, mode: SITE_MODES.SEPARATE, reserved: 2 }).available, 3);
  assert.equal(computeAvailability({ ...base, mode: SITE_MODES.SEPARATE, reserved: 2 }).status, 'last');
  const out = computeAvailability({ stock: { web: 1 }, mainId: 'main', webId: 'web', mode: 4, safetyMargin: 1, hideUnavailable: true });
  assert.deepEqual([out.status, out.visible], ['out', false]);
  assert.equal(computeAvailability({ stock: {}, mainId: 'm', webId: 'w', mode: 4, allowPreorder: true }).status, 'preorder');
});

test('الصلاحيات ومستويات الإعدادات', () => {
  assert.equal(can('super_admin', 'anything'), true);
  assert.equal(can('cashier', 'sales.create'), true);
  assert.equal(can('cashier', 'settings.manage'), false);
  assert.equal(can('nobody', 'x'), false);
  assert.equal(levelOf('site_stock.mode'), 'grant');
  assert.equal(levelOf('unknown.key'), 'free');
  assert.equal(levelOf('site_stock.mode', { 'site_stock.mode': 'free' }), 'free');
});

test('التحقق من شكل عملية المزامنة', () => {
  const ok = { opId: crypto.randomUUID(), type: 'sale.create', payload: {}, deviceTime: new Date().toISOString() };
  assert.equal(validateOp(ok), null);
  assert.ok(validateOp({ ...ok, opId: 'x' }));
  assert.ok(validateOp({ ...ok, type: 'nope' }));
});
