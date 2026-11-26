import { normalizeDigits } from './digits.js';

/**
 * Code Builder: الأدمن يعرّف قالب الكود، والنظام يبني ويفكّ أي كود (حتى Offline).
 *
 * شكل القالب:
 * {
 *   version: 1, separator: '-', checkDigit: false,
 *   parts: [
 *     { key:'model', label:'الموديل', kind:'sequence', charset:'digits', length:4 },
 *     { key:'color', label:'اللون',  kind:'enum', charset:'digits', length:2,
 *       values:[{ code:'01', name:'أسود', active:true, display:'#111' }] },
 *     { key:'size',  label:'المقاس',  kind:'enum', charset:'alnum', minLength:1, maxLength:3, values:[...] }
 *   ]
 * }
 */

const CHARSETS = { digits: /^[0-9]+$/, alpha: /^[A-Z]+$/, alnum: /^[A-Z0-9]+$/ };
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AMBIGUOUS = /[OI]/; // نتجنب الحروف المتشابهة مع 0 و1
const SEPARATORS = ['', '-', '_', '.', '/'];

export function normalizeCode(raw) {
  return normalizeDigits(raw).replace(/\s+/g, '').toUpperCase();
}

const lenRange = (p) => ({ min: p.length ?? p.minLength ?? 1, max: p.length ?? p.maxLength ?? 1 });
const isFixed = (p) => p.length != null || (p.minLength != null && p.minLength === p.maxLength);

/** Luhn mod 36: رقم تحقق اختياري لاكتشاف أخطاء الكتابة اليدوية. */
export function computeCheckChar(str) {
  const n = 36;
  let factor = 2;
  let sum = 0;
  for (let i = str.length - 1; i >= 0; i--) {
    const cp = ALPHABET.indexOf(str[i]);
    if (cp < 0) throw new RangeError(`حرف غير مسموح: ${str[i]}`);
    let add = factor * cp;
    factor = factor === 2 ? 1 : 2;
    add = Math.floor(add / n) + (add % n);
    sum += add;
  }
  return ALPHABET[(n - (sum % n)) % n];
}

const strip = (code, sep) => (sep ? code.split(sep).join('') : code);

/** التحقق من صحة القالب قبل الحفظ. يرفض أي تعارض أو غموض. */
export function validateTemplate(t) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!t || typeof t !== 'object') return { ok: false, errors: [{ path: '', message: 'القالب مفقود' }] };

  if (!SEPARATORS.includes(t.separator ?? '')) err('separator', 'الفاصل يجب أن يكون شرطة أو نقطة أو بدون');
  if (!Array.isArray(t.parts) || t.parts.length < 1 || t.parts.length > 8) {
    err('parts', 'عدد أجزاء الكود من 1 إلى 8');
    return { ok: false, errors };
  }
  const keys = new Set();
  let hasModel = false;
  t.parts.forEach((p, i) => {
    const at = `parts[${i}]`;
    if (!/^[a-z][a-z0-9_]*$/.test(p.key ?? '')) err(`${at}.key`, 'مفتاح الجزء حروف إنجليزية صغيرة وأرقام فقط');
    if (keys.has(p.key)) err(`${at}.key`, `المفتاح ${p.key} مكرر`);
    keys.add(p.key);
    if (!p.label) err(`${at}.label`, 'اسم الجزء مطلوب');
    if (!CHARSETS[p.charset]) err(`${at}.charset`, 'نوع المحارف: digits أو alpha أو alnum');
    const { min, max } = lenRange(p);
    if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min && max <= 12)) err(`${at}.length`, 'طول الجزء غير صالح');

    if (p.kind === 'sequence') {
      if (p.charset !== 'digits') err(`${at}.charset`, 'جزء التسلسل أرقام فقط');
      if (!isFixed(p)) err(`${at}.length`, 'جزء التسلسل بطول ثابت');
      if (p.key === 'model') hasModel = true;
    } else if (p.kind === 'enum') {
      if (!Array.isArray(p.values) || p.values.length === 0) err(`${at}.values`, 'يلزم قيمة واحدة على الأقل');
      const seen = new Set();
      (p.values ?? []).forEach((v, j) => {
        const vp = `${at}.values[${j}]`;
        const c = normalizeCode(v.code);
        if (!c) return err(`${vp}.code`, 'الكود مطلوب');
        if (CHARSETS[p.charset] && !CHARSETS[p.charset].test(c)) err(`${vp}.code`, `الكود ${c} لا يطابق نوع المحارف`);
        if (c.length < min || c.length > max) err(`${vp}.code`, `طول الكود ${c} خارج النطاق ${min}-${max}`);
        if (p.charset !== 'digits' && AMBIGUOUS.test(c)) err(`${vp}.code`, `الكود ${c} فيه حرف O أو I (يُلتبس مع 0 و1)`);
        if (seen.has(c)) err(`${vp}.code`, `الكود ${c} مكرر`);
        seen.add(c);
        if (!String(v.name ?? '').trim()) err(`${vp}.name`, 'اسم القيمة مطلوب');
      });
    } else err(`${at}.kind`, 'نوع الجزء sequence أو enum');
  });
  if (!hasModel) err('parts', 'يلزم جزء باسم model من نوع sequence');

  // بدون فاصل: كل الأجزاء ما عدا الأخير لازم تكون بطول ثابت وإلا لا يمكن التفكيك.
  if ((t.separator ?? '') === '') {
    t.parts.slice(0, -1).forEach((p, i) => {
      if (!isFixed(p)) err(`parts[${i}].length`, 'بدون فاصل يجب أن تكون الأجزاء (غير الأخير) بطول ثابت');
    });
  }
  return { ok: errors.length === 0, errors };
}

const findPart = (t, key) => t.parts.find((p) => p.key === key);

function formatPartValue(part, raw, { allowInactive = false } = {}) {
  let v = normalizeCode(raw);
  const { min, max } = lenRange(part);
  if (part.kind === 'sequence') {
    if (!/^\d+$/.test(v)) throw new RangeError(`${part.label}: رقم غير صالح`);
    if (v.length > max) throw new RangeError(`${part.label}: تجاوز الطول ${max}`);
    v = v.padStart(max, '0');
  } else {
    if (!CHARSETS[part.charset].test(v)) throw new RangeError(`${part.label}: محارف غير مسموحة`);
    if (v.length < min || v.length > max) throw new RangeError(`${part.label}: الطول يجب ${min}-${max}`);
    const val = part.values.find((x) => normalizeCode(x.code) === v);
    if (!val) throw new RangeError(`${part.label}: القيمة ${v} غير معرّفة`);
    if (val.active === false && !allowInactive) throw new RangeError(`${part.label}: القيمة ${v} معطّلة`);
  }
  return v;
}

/** بناء كود من قيم الأجزاء. */
export function buildCode(t, values, opts = {}) {
  const sep = t.separator ?? '';
  const pieces = t.parts.map((p) => formatPartValue(p, values[p.key], opts));
  const base = pieces.join(sep);
  if (!t.checkDigit) return base;
  const chk = computeCheckChar(strip(base, sep));
  return sep ? `${base}${sep}${chk}` : `${base}${chk}`;
}

/** تفكيك كود (ممسوح أو مكتوب يدويًا) إلى أجزائه بالأسماء. */
export function parseCode(t, raw, { allowInactive = true } = {}) {
  const errors = [];
  const sep = t.separator ?? '';
  let code = normalizeCode(raw);
  if (!code) return { ok: false, errors: ['الكود فارغ'], normalized: '', parts: {} };
  const normalized = code;

  if (t.checkDigit) {
    let chk;
    if (sep) {
      const idx = code.lastIndexOf(sep);
      chk = code.slice(idx + 1);
      code = idx >= 0 ? code.slice(0, idx) : '';
    } else { chk = code.slice(-1); code = code.slice(0, -1); }
    if (chk.length !== 1 || !/^[0-9A-Z]$/.test(chk)) errors.push('رقم التحقق غير موجود');
    else {
      try { if (computeCheckChar(strip(code, sep)) !== chk) errors.push('رقم التحقق خاطئ (خطأ في الكتابة)'); }
      catch { errors.push('الكود فيه محارف غير مسموحة'); }
    }
  }

  let pieces;
  if (sep) {
    pieces = code.split(sep);
    if (pieces.length !== t.parts.length) errors.push(`عدد أجزاء الكود ${pieces.length} بدل ${t.parts.length}`);
  } else {
    pieces = [];
    let pos = 0;
    t.parts.forEach((p, i) => {
      const last = i === t.parts.length - 1;
      const len = last ? code.length - pos : lenRange(p).max;
      pieces.push(code.slice(pos, pos + len));
      pos += len;
    });
  }

  const parts = {};
  t.parts.forEach((p, i) => {
    const piece = pieces[i];
    if (piece == null || piece === '') return errors.push(`${p.label}: مفقود`);
    const { min, max } = lenRange(p);
    if (!CHARSETS[p.charset].test(piece)) return errors.push(`${p.label}: محارف غير مسموحة`);
    if (piece.length < min || piece.length > max) return errors.push(`${p.label}: الطول غير صحيح`);
    if (p.kind === 'enum') {
      const val = p.values.find((x) => normalizeCode(x.code) === piece);
      if (!val) return errors.push(`${p.label}: القيمة ${piece} غير معرّفة`);
      if (val.active === false && !allowInactive) return errors.push(`${p.label}: القيمة ${piece} معطّلة`);
      parts[p.key] = { code: piece, name: val.name, active: val.active !== false, display: val.display };
    } else parts[p.key] = { code: piece };
  });
  return { ok: errors.length === 0, errors, normalized, parts };
}

/** عدد الأكواد الممكنة لموديل واحد (حاصل ضرب القيم الفعّالة). */
export function countPerModel(t) {
  return t.parts.filter((p) => p.kind === 'enum').reduce((n, p) => n * p.values.filter((v) => v.active !== false).length, 1);
}

/** سعة التسلسل (كم موديل يتسع). */
export function modelCapacity(t) {
  const m = findPart(t, 'model');
  return m ? 10 ** lenRange(m).max - 1 : 0;
}

/** توليد كل أكواد القطع لموديل: كل لون × كل مقاس. selection = { color:['01','02'], size:['M'] } (الافتراضي كل الفعّال). */
export function generateCodes(t, modelNumber, selection = {}) {
  const enums = t.parts.filter((p) => p.kind === 'enum');
  const lists = enums.map((p) => {
    const chosen = selection[p.key];
    const active = p.values.filter((v) => v.active !== false).map((v) => normalizeCode(v.code));
    return (chosen ? chosen.map(normalizeCode).filter((c) => active.includes(c)) : active);
  });
  let combos = [{}];
  enums.forEach((p, i) => {
    combos = combos.flatMap((c) => lists[i].map((code) => ({ ...c, [p.key]: code })));
  });
  return combos.map((c) => {
    const values = { model: modelNumber, ...c };
    return { code: buildCode(t, values), values: { ...values, model: formatPartValue(findPart(t, 'model'), modelNumber) } };
  });
}

/**
 * مقارنة نسختين من القالب لفرض قواعد الدقة:
 *  - لا يُغيَّر معنى قيمة مستخدمة ولا تُحذف (تُعطَّل بدلًا من ذلك).
 *  - تغيير البنية بعد طباعة أكواد يحتاج تصريح السوبر أدمن لمرة واحدة.
 * @param {object} oldT
 * @param {object} newT
 * @param {{usedValues?:Record<string,string[]>, hasPrintedCodes?:boolean}} ctx
 */
export function diffTemplates(oldT, newT, { usedValues = {}, hasPrintedCodes = false } = {}) {
  const errors = [];
  let structural = false;
  if ((oldT.separator ?? '') !== (newT.separator ?? '') || !!oldT.checkDigit !== !!newT.checkDigit) structural = true;
  if (oldT.parts.length !== newT.parts.length) structural = true;

  oldT.parts.forEach((op, i) => {
    const np = newT.parts.find((x) => x.key === op.key);
    if (!np) { structural = true; return; }
    if (newT.parts[i]?.key !== op.key) structural = true;
    const a = lenRange(op); const b = lenRange(np);
    if (a.min !== b.min || a.max !== b.max || op.charset !== np.charset || op.kind !== np.kind) structural = true;
    if (op.kind !== 'enum' || np.kind !== 'enum') return;
    const used = new Set((usedValues[op.key] ?? []).map(normalizeCode));
    for (const ov of op.values) {
      const c = normalizeCode(ov.code);
      const nv = np.values.find((x) => normalizeCode(x.code) === c);
      if (!nv) {
        if (used.has(c)) errors.push(`${op.label}: القيمة ${c} مستخدمة ولا تُحذف، عطّلها بدلًا من ذلك`);
        continue;
      }
      if (used.has(c) && nv.name !== ov.name) {
        errors.push(`${op.label}: لا يمكن تغيير معنى القيمة ${c} (${ov.name} ← ${nv.name}) لأنها مستخدمة. أنشئ قيمة جديدة وعطّل القديمة`);
      }
    }
  });
  const needsGrant = structural && hasPrintedCodes;
  return { ok: errors.length === 0, errors, structural, needsGrant };
}

export const nextSequence = (current, length) => String(Number(current) + 1).padStart(length, '0');
