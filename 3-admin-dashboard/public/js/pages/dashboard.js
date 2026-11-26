import { api } from '../api.js';
import { h, page, field, inp, egp, num, table, empty, bar, today, monthStart, run, loading, clear } from '../ui.js';

export default async function ({ user }) {
  const from = inp({ type: 'date', value: monthStart() }); const to = inp({ type: 'date', value: today() });
  const out = h('div', { class: 'stack' }, loading());
  async function load() {
    const q = { from: from.value, to: to.value };
    const [d, top, sales] = await Promise.all([api.get('/reports/dashboard', q), user.role === 'branch_manager' ? [] : api.get('/reports/top-models', { ...q, limit: 8 }), api.get('/reports/sales', q)]);
    clear(out);
    const maxB = Math.max(1, ...d.by_branch.map((b) => Number(b.total)));
    const cell = (k, v, cls = '') => h('div', { class: cls }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));
    out.append(
      h('div', { class: 'ledger' }, cell('إجمالي المبيعات', egp(d.sales_total)), cell('عدد الفواتير', num(d.invoices)), cell('المرتجعات', num(d.returns)),
        cell('طلبات إلكترونية جديدة', num(d.orders_pending), d.orders_pending > 0 ? 'alert' : ''), cell('طلبات قيد التنفيذ', num(d.orders_open)),
        cell('أصناف تحت الحد الأدنى', num(d.low_stock), d.low_stock > 0 ? 'alert' : ''), cell('قطع في المخزون', num(d.stock_units))),
      h('div', { class: 'cols' },
        h('section', null, h('h2', null, 'المبيعات حسب الفرع'),
          table([{ h: 'الفرع', c: (b) => b.name }, { h: 'الفواتير', c: (b) => num(b.count), cls: 'num' }, { h: 'الإجمالي', c: (b) => egp(b.total), cls: 'num' }, { h: '', c: (b) => bar(Number(b.total), maxB, 'var(--ink)') }], d.by_branch,
            empty('لا توجد مبيعات في هذه الفترة', 'ستظهر هنا بعد أن تُزامن الفروع فواتيرها.'))),
        h('section', null, h('h2', null, 'الأكثر مبيعًا'),
          table([{ h: 'الموديل', c: (r) => r.model_name }, { h: 'اللون/المقاس', c: (r) => `${r.color_name} / ${r.size_name}` }, { h: 'الكمية', c: (r) => num(r.qty), cls: 'num' }, { h: 'القيمة', c: (r) => egp(r.total), cls: 'num' }], top,
            empty('لا توجد مبيعات بعد')))),
      h('section', null, h('h2', null, 'المبيعات اليومية'),
        table([{ h: 'اليوم', c: (r) => r.day }, { h: 'الفرع', c: (r) => r.branch_name }, { h: 'الفواتير', c: (r) => num(r.invoices_count), cls: 'num' }, { h: 'المرتجعات', c: (r) => num(r.returns_count), cls: 'num' },
          { h: 'الخصم', c: (r) => egp(r.discount), cls: 'num' }, { h: 'الصافي', c: (r) => egp(r.total), cls: 'num' }], sales.slice(0, 31), empty('لا توجد مبيعات يومية'))));
  }
  const reload = () => run(load).then(() => {});
  const node = page('لوحة التحكم', h('div', { class: 'toolbar' }, field('من', from), field('إلى', to), h('button', { class: 'btn primary', onclick: reload }, 'عرض التقرير')), out);
  await run(load);
  return node;
}
