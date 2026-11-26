import { api } from '../api.js';
import { h, page, field, inp, badge, egp, num, dt, table, empty, run, modal, clear, sel, branchOptions } from '../ui.js';
import { PAY_METHOD } from '../labels.js';

export default async function ({ user }) {
  const { opts } = await branchOptions(() => true, user.role !== 'branch_manager');
  const br = sel(opts, user.role === 'branch_manager' ? user.branchId : ''); if (user.role === 'branch_manager') br.disabled = true;
  const q = inp({ type: 'search', placeholder: 'رقم الفاتورة' }); const out = h('div');
  async function load() {
    const rows = await api.get('/invoices', { branch: br.value, q: q.value, limit: 100 });
    clear(out).append(table([{ h: 'الرقم', c: (i) => h('a', { href: '#', class: 'ltr', onclick: (e) => { e.preventDefault(); detail(i.id); } }, i.number) }, { h: 'النوع', c: (i) => (i.kind === 'return' ? badge('مرتجع', 'warn') : badge('بيع', 'ok')) },
      { h: 'الإجمالي', c: (i) => egp(i.total), cls: 'num' }, { h: 'الخصم', c: (i) => egp(i.discount), cls: 'num' }, { h: 'التاريخ', c: (i) => dt(i.created_at_device) },
      { h: 'تنبيه', c: (i) => [i.oversold && badge('تجاوز رصيد', 'err'), i.is_training && badge('تدريب')] }], rows, empty('لا توجد فواتير', 'تظهر هنا فواتير الفروع بعد المزامنة.')));
  }
  async function detail(id) {
    const i = await api.get(`/invoices/${id}`);
    modal({ wide: true, title: `فاتورة ${i.number}`, body: h('div', { class: 'stack' },
      table([{ h: 'الصنف', c: (l) => `${l.model_name} ${l.color_name} ${l.size_name}` }, { h: 'الكود', c: (l) => l.sku, cls: 'ltr' }, { h: 'الكمية', c: (l) => num(l.qty), cls: 'num' }, { h: 'السعر', c: (l) => egp(l.unit_price), cls: 'num' }, { h: 'الإجمالي', c: (l) => egp(l.line_total), cls: 'num' }], i.lines),
      h('p', null, `الإجمالي ${egp(i.total)} · المدفوع ${egp(i.paid)} · الباقي ${egp(i.change_due)}`), h('p', { class: 'muted' }, 'طرق الدفع: ' + (i.payments.map((p) => `${PAY_METHOD[p.method] ?? p.method} ${egp(p.amount)}`).join('، ') || '—'))), actions: [{ label: 'إغلاق' }] });
  }
  const node = page('الفواتير', null, h('div', { class: 'toolbar' }, field('الفرع', br), field('بحث', q), h('button', { class: 'btn primary', onclick: () => run(load) }, 'عرض')), out);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(load); });
  await run(load); return node;
}
