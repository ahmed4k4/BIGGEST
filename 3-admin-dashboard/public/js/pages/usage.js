import { api } from '../api.js';
import { h, page, badge, num, table, bar, run } from '../ui.js';

export default async function () {
  const u = await api.get('/reports/usage');
  const mb = (b) => `${num(Math.round((b / 1048576) * 10) / 10)} م.ب`;
  const color = u.level === 'critical' ? 'var(--danger)' : u.level === 'warning' ? 'var(--tape)' : 'var(--green)';
  return page('استهلاك الخدمات', null,
    h('section', null, h('h2', null, 'قاعدة البيانات'), h('p', null, `${mb(u.db_bytes)} من ${mb(u.limits.db_bytes)} (${num(u.db_pct)}٪) `, badge(u.level === 'ok' ? 'سليم' : u.level === 'warning' ? 'تنبيه' : 'حرج', u.level === 'ok' ? 'ok' : u.level === 'warning' ? 'warn' : 'err')), bar(u.db_bytes, u.limits.db_bytes, color),
      h('p', { class: 'muted' }, `${num(u.invoices)} فاتورة · ${num(u.change_log_rows)} سجل مزامنة. ${u.note}`)),
    h('section', null, h('h2', null, 'أكبر الجداول'), table([{ h: 'الجدول', c: (t) => t.name, cls: 'ltr' }, { h: 'الحجم', c: (t) => mb(t.bytes), cls: 'num' }, { h: 'عدد الصفوف التقريبي', c: (t) => num(t.approx_rows), cls: 'num' }], u.tables)));
}
