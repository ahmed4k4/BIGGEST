import { normalizeDigits } from './digits.js';

/**
 * توحيد رقم الهاتف إلى صيغة E.164 (مصر افتراضيًا). الرقم هو المفتاح الطبيعي للعميل،
 * فيتجاهل المسافات والشرطات والأرقام العربية ورمز الدولة.
 * @param {string} input
 * @returns {string|null} مثل "+201012345678" أو null لو غير صالح
 */
export function normalizePhone(input) {
  let s = normalizeDigits(input).replace(/[\s\-().]/g, '');
  if (!s) return null;
  let intl = false;
  if (s.startsWith('+')) { intl = true; s = s.slice(1); }
  else if (s.startsWith('00')) { intl = true; s = s.slice(2); }
  if (!/^\d+$/.test(s)) return null;

  if (intl && !s.startsWith('20')) {
    return s.length >= 8 && s.length <= 15 ? `+${s}` : null;
  }
  if (s.startsWith('20') && (intl || s.length >= 12)) s = s.slice(2);
  else if (s.startsWith('0')) s = s.slice(1);

  if (/^1[0125]\d{8}$/.test(s)) return `+20${s}`;   // موبايل
  if (/^[2-9]\d{7,8}$/.test(s)) return `+20${s}`;   // أرضي
  return null;
}

export const phoneLast4 = (e164) => (e164 ? e164.slice(-4) : '');

/** إخفاء الرقم للكاشير: الاسم وآخر 4 أرقام فقط (قابل للضبط من الإعدادات). */
export function maskPhone(e164, visibleDigits = 4) {
  if (!e164) return '';
  const tail = e164.slice(-visibleDigits);
  return `${'•'.repeat(Math.max(0, e164.length - 1 - visibleDigits))}${tail}`;
}

/**
 * معرّف العميل الحتمي: يطابق دالة customer_id_for في قاعدة البيانات
 * (sha256 من "الشركة:الرقم" ثم أول 32 خانة سداسية كـ UUID). كل جهاز يولّد نفس المعرّف لنفس الرقم.
 */
export async function customerIdFor(companyId, phoneE164) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${companyId}:${phoneE164}`));
  const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
