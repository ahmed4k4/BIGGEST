import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTemplate, buildCode, parseCode, generateCodes, diffTemplates, computeCheckChar, countPerModel, normalizeCode,
} from '../src/code-builder.js';

const colors = [
  { code: '01', name: 'أسود', active: true },
  { code: '02', name: 'أبيض', active: true },
  { code: '05', name: 'أحمر', active: true },
];
const sizes = ['S', 'M', 'L', 'XL'].map((c) => ({ code: c, name: c, active: true }));
const tpl = () => ({
  version: 1, separator: '-', checkDigit: false,
  parts: [
    { key: 'model', label: 'الموديل', kind: 'sequence', charset: 'digits', length: 4 },
    { key: 'color', label: 'اللون', kind: 'enum', charset: 'digits', length: 2, values: structuredClone(colors) },
    { key: 'size', label: 'المقاس', kind: 'enum', charset: 'alnum', minLength: 1, maxLength: 3, values: structuredClone(sizes) },
  ],
});

test('القالب الصحيح يُقبل', () => assert.equal(validateTemplate(tpl()).ok, true));

test('مثال المستند: 0142-05-M يُفك إلى الموديل 0142 واللون 05 أحمر والمقاس M', () => {
  const r = parseCode(tpl(), '0142-05-M');
  assert.equal(r.ok, true);
  assert.equal(r.parts.model.code, '0142');
  assert.equal(r.parts.color.name, 'أحمر');
  assert.equal(r.parts.size.code, 'M');
});

test('يقبل الأرقام العربية والحروف الصغيرة عند الكتابة اليدوية', () => {
  assert.equal(normalizeCode('٠١٤٢-٠٥-m'), '0142-05-M');
  assert.equal(parseCode(tpl(), '٠١٤٢-٠٥-m').ok, true);
});

test('بناء الكود يملأ الصفرية ويرفض القيم غير المعرّفة والمعطّلة', () => {
  assert.equal(buildCode(tpl(), { model: 142, color: '05', size: 'm' }), '0142-05-M');
  assert.throws(() => buildCode(tpl(), { model: 1, color: '09', size: 'M' }), /غير معرّفة/);
  const t = tpl(); t.parts[1].values[2].active = false;
  assert.throws(() => buildCode(t, { model: 1, color: '05', size: 'M' }), /معطّلة/);
});

test('رفض الحروف المتشابهة O و I وتكرار الأكواد', () => {
  const t = tpl(); t.parts[2].values.push({ code: 'O', name: 'x', active: true }, { code: 'M', name: 'dup', active: true });
  const r = validateTemplate(t);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('O أو I')));
  assert.ok(r.errors.some((e) => e.message.includes('مكرر')));
});

test('بدون فاصل: الأجزاء غير الأخيرة لازم تكون بطول ثابت', () => {
  const t = tpl(); t.separator = '';
  // الجزء الأخير (المقاس) متغير الطول لكنه الأخير، فمسموح
  assert.equal(validateTemplate(t).ok, true);
  assert.equal(parseCode(t, '014205XL').parts.size.code, 'XL');
  assert.equal(parseCode(t, '014205M').parts.size.code, 'M');
  // جزء متغير الطول في المنتصف بدون فاصل = تفكيك غامض، يُرفض
  const bad = tpl(); bad.separator = '';
  delete bad.parts[1].length; bad.parts[1].minLength = 1; bad.parts[1].maxLength = 2;
  const r = validateTemplate(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('بطول ثابت')));
});

test('توليد كل الأكواد: كل لون × كل مقاس بضغطة واحدة', () => {
  const all = generateCodes(tpl(), 142);
  assert.equal(all.length, 3 * 4);
  assert.equal(countPerModel(tpl()), 12);
  assert.equal(new Set(all.map((x) => x.code)).size, 12);
  assert.equal(generateCodes(tpl(), 142, { color: ['05'], size: ['M', 'L'] }).length, 2);
});

test('رقم التحقق يكتشف أخطاء الكتابة', () => {
  const t = tpl(); t.checkDigit = true;
  const code = buildCode(t, { model: 142, color: '05', size: 'M' });
  assert.equal(parseCode(t, code).ok, true);
  const wrong = `${code.slice(0, 1)}9${code.slice(2)}`;
  assert.equal(parseCode(t, wrong).ok, false);
  assert.equal(computeCheckChar('0142'), computeCheckChar('0142'));
});

test('قاعدة 3: لا يُغيَّر معنى قيمة مستخدمة (05 أحمر) ولا تُحذف', () => {
  const next = tpl(); next.parts[1].values[2].name = 'أزرق';
  const d = diffTemplates(tpl(), next, { usedValues: { color: ['05'] } });
  assert.equal(d.ok, false);
  assert.match(d.errors[0], /لا يمكن تغيير معنى/);

  const removed = tpl(); removed.parts[1].values.pop();
  assert.equal(diffTemplates(tpl(), removed, { usedValues: { color: ['05'] } }).ok, false);

  // الحل الصحيح: تعطيل القديم وإضافة قيمة جديدة
  const fixed = tpl(); fixed.parts[1].values[2].active = false;
  fixed.parts[1].values.push({ code: '06', name: 'أزرق', active: true });
  assert.equal(diffTemplates(tpl(), fixed, { usedValues: { color: ['05'] } }).ok, true);
});

test('قاعدة 5: تغيير بنية القالب بعد طباعة أكواد يحتاج تصريحًا', () => {
  const next = tpl(); next.separator = '';
  next.parts[2].minLength = 1; next.parts[2].maxLength = 3;
  assert.equal(diffTemplates(tpl(), next, { hasPrintedCodes: true }).needsGrant, true);
  assert.equal(diffTemplates(tpl(), next, { hasPrintedCodes: false }).needsGrant, false);
  const addValue = tpl(); addValue.parts[1].values.push({ code: '07', name: 'رمادي', active: true });
  assert.equal(diffTemplates(tpl(), addValue, { hasPrintedCodes: true }).needsGrant, false);
});
