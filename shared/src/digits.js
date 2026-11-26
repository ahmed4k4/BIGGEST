// تحويل الأرقام العربية والفارسية إلى أرقام إنجليزية (يستخدمه الهاتف والكود والمبالغ).
const AR = '٠١٢٣٤٥٦٧٨٩';
const FA = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(input) {
  return String(input ?? '')
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)));
}
