import { percentOf } from './money.js';

/**
 * حساب مجاميع الفاتورة بالقروش.
 * @param {{qty:number, unitPrice:number, lineDiscount?:number}[]} lines
 * @param {{discountPct?:number, discountAmount?:number, taxRatePct?:number, taxInclusive?:boolean}} [opts]
 */
export function computeInvoice(lines, opts = {}) {
  const { discountPct = 0, discountAmount = 0, taxRatePct = 0, taxInclusive = true } = opts;
  if (!Array.isArray(lines) || lines.length === 0) throw new RangeError('الفاتورة بدون أصناف');

  let gross = 0;
  let lineDiscounts = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new RangeError('الكمية يجب أن تكون عددًا صحيحًا موجبًا');
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new RangeError('سعر الوحدة يجب أن يكون بالقروش (عدد صحيح)');
    const ld = l.lineDiscount ?? 0;
    if (!Number.isInteger(ld) || ld < 0 || ld > l.qty * l.unitPrice) throw new RangeError('خصم الصنف غير صالح');
    gross += l.qty * l.unitPrice;
    lineDiscounts += ld;
  }
  const subtotal = gross - lineDiscounts;
  const invoiceDiscount = Math.min(subtotal, discountAmount > 0 ? discountAmount : percentOf(subtotal, discountPct));
  const net = subtotal - invoiceDiscount;

  let tax;
  let total;
  if (taxInclusive) {
    tax = Math.round(net - net / (1 + taxRatePct / 100));
    total = net;
  } else {
    tax = percentOf(net, taxRatePct);
    total = net + tax;
  }
  return { gross, lineDiscounts, subtotal, invoiceDiscount, discount: lineDiscounts + invoiceDiscount, net, tax, total };
}

/** نسبة الخصم الفعلية (لمقارنتها بالحد الأقصى المسموح للكاشير). */
export function effectiveDiscountPct(totals) {
  return totals.gross === 0 ? 0 : (totals.discount / totals.gross) * 100;
}
