import { normalizeDigits } from './shared/digits.js';
export { normalizeDigits };

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(s);
const render = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(render).join('') : v == null || v === false ? '' : esc(v));
/** قالب HTML آمن: كل قيمة تُهرَّب تلقائيًا إلا ما كان ناتج html`` آخر. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}

const nf0 = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n) => nf0.format(n);
/** قروش → "٥٩٩ ج.م" بأرقام عربية. */
export const price = (p) => `${p % 100 === 0 ? nf0.format(p / 100) : nf2.format(p / 100)} ج.م`;

export const GOVERNORATES = ['القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'البحر الأحمر', 'البحيرة', 'الفيوم', 'الغربية', 'الإسماعيلية', 'المنوفية', 'المنيا', 'القليوبية', 'الوادي الجديد', 'السويس', 'أسوان', 'أسيوط', 'بني سويف', 'بورسعيد', 'دمياط', 'الشرقية', 'جنوب سيناء', 'كفر الشيخ', 'مطروح', 'الأقصر', 'قنا', 'شمال سيناء', 'سوهاج'];
export const PAYMENT_LABELS = { cod: 'الدفع عند الاستلام', transfer: 'تحويل بنكي', instapay: 'إنستاباي' };
export const STATUS_LABELS = { pending: 'تم استلام الطلب وبانتظار التأكيد', confirmed: 'تم تأكيد الطلب', preparing: 'جارٍ تجهيز الطلب', shipped: 'خرج الطلب للشحن', delivered: 'تم تسليم الطلب', cancelled: 'أُلغي الطلب', returned: 'تم إرجاع الطلب' };
export const PAY_STATUS_LABELS = { unpaid: 'لم يُسدَّد بعد', paid: 'تم الدفع', refunded: 'تم الاسترداد' };

const COLOR_MAP = { 'أسود': '#16181d', 'أبيض': '#f4f4f1', 'كحلي': '#1f2a44', 'بيج': '#d8c3a5', 'أحمر': '#b3261e', 'رمادي': '#8a8f98', 'أزرق': '#2f5fb3', 'سماوي': '#7fb7e6', 'أخضر': '#2e7d4f', 'زيتي': '#5b6236', 'بني': '#6b4a35', 'جملي': '#b98a55', 'وردي': '#e8a1b4', 'بنفسجي': '#6a4c93', 'أصفر': '#e6c229', 'برتقالي': '#e47a2e', 'عنابي': '#6e1f3a', 'كاكي': '#a39a74' };
export function colorHex(name) {
  if (COLOR_MAP[name]) return COLOR_MAP[name];
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 35% 45%)`;
}
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL'];
/** ترتيب المقاسات: الحروف بترتيبها المعتاد ثم الأرقام تصاعديًا. */
export const sizeRank = (code) => { const i = SIZE_ORDER.indexOf(String(code).toUpperCase()); return i >= 0 ? i : 100 + (Number.parseFloat(code) || 0); };
export const bySize = (a, b) => sizeRank(a.code ?? a[0]) - sizeRank(b.code ?? b[0]);
