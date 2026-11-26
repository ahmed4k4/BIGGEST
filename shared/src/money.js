import { normalizeDigits } from './digits.js';

// كل المبالغ تُخزَّن أعدادًا صحيحة بالقروش لتفادي أخطاء الكسور العشرية.
export function toPiasters(value) {
  const s = normalizeDigits(value).replace(/[٫,]/g, '.').replace(/[^\d.\-]/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new RangeError('مبلغ غير صالح');
  return Math.round(n * 100);
}

export const fromPiasters = (p) => p / 100;

export function formatEGP(piasters, locale = 'ar-EG') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EGP' }).format(piasters / 100);
}

export const percentOf = (amount, pct) => Math.round((amount * pct) / 100);
