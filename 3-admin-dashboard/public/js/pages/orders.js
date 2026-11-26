import { api } from '../api.js';
import { h, page, field, inp, sel, badge, egp, num, dt, table, empty, run, modal, clear } from '../ui.js';
import { ORDER_STATUS, PAY_STATUS, PAY_METHOD } from '../labels.js';

const FLOW = { pending: [['confirmed', 'تأكيد الطلب']], confirmed: [['preparing', 'بدء التجهيز']], preparing: [['shipped', 'تم الشحن']], shipped: [['delivered', 'تم التسليم'], ['returned', 'مرتجع']] };
export default async function () {
  const st = sel([['', 'كل الحالات'], ...Object.entries(ORDER_STATUS)], 'pending'); const q = inp({ type: 'search', placeholder: 'رقم الطلب' }); const out = h('div');
  const kind = (s) => ({ pending: 'warn', delivered: 'ok', cancelled: 'err', returned: 'err' }[s] ?? '');
  async function load() {
    const rows = await api.get('/orders', { status: st.value, q: q.value });
    clear(out).append(table([{ h: 'الرقم', c: (o) => h('a', { href: '#', class: 'ltr', onclick: (e) => { e.preventDefault(); detail(o.id); } }, o.number) }, { h: 'الحالة', c: (o) => badge(ORDER_STATUS[o.status], kind(o.status)) },
      { h: 'الدفع', c: (o) => `${PAY_METHOD[o.payment_method] ?? o.payment_method} · ${PAY_STATUS[o.payment_status]}` }, { h: 'الإجمالي', c: (o) => egp(o.total), cls: 'num' }, { h: 'التاريخ', c: (o) => dt(o.created_at) }], rows, empty('لا توجد طلبات بهذه الحالة', 'الطلبات الجديدة من المتجر تظهر هنا فور وصولها.')));
  }
  async function detail(id) {
    const o = await api.get(`/orders/${id}`);
    const acts = (FLOW[o.status] ?? []).map(([to, label]) => ({ label, kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post(`/orders/${id}/status`, { to, paymentStatus: to === 'delivered' && o.payment_method === 'cod' ? 'paid' : undefined }); close(); await load(); }, { btn: e.currentTarget, ok: 'تم تحديث الطلب' }); } }));
    if (['pending', 'confirmed', 'preparing'].includes(o.status)) acts.push({ label: 'إلغاء الطلب', kind: 'danger', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post(`/orders/${id}/status`, { to: 'cancelled' }); close(); await load(); }, { btn: e.currentTarget, ok: 'أُلغي الطلب وأُفرج عن الحجز' }); } });
    if (o.payment_status === 'unpaid') acts.push({ label: 'تسجيل الدفع', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post(`/orders/${id}/payment`, { paymentStatus: 'paid' }); close(); await load(); }, { btn: e.currentTarget, ok: 'سُجّل الدفع' }); } });
    modal({ wide: true, title: `طلب ${o.number}`, body: h('div', { class: 'stack' }, h('p', null, badge(ORDER_STATUS[o.status], kind(o.status)), ' ', `${PAY_METHOD[o.payment_method] ?? ''} · ${PAY_STATUS[o.payment_status]}`),
      h('p', null, h('b', null, o.customer?.name), ' · ', h('span', { class: 'ltr' }, o.customer?.phone), h('br'), o.customer?.address, ' — ', o.governorate ?? ''),
      table([{ h: 'الكود', c: (l) => l.sku, cls: 'ltr' }, { h: 'الصنف', c: (l) => `${l.model_name} ${l.color_name} ${l.size_name}` }, { h: 'الكمية', c: (l) => num(l.qty), cls: 'num' }, { h: 'السعر', c: (l) => egp(l.unit_price), cls: 'num' }], o.lines),
      h('p', null, `الإجمالي ${egp(o.total)}`), o.note && h('p', { class: 'muted' }, 'ملاحظة العميل: ' + o.note)), actions: [...acts, { label: 'إغلاق' }] });
  }
  const node = page('الطلبات الإلكترونية', null, h('div', { class: 'toolbar' }, field('الحالة', st), field('بحث', q), h('button', { class: 'btn primary', onclick: () => run(load) }, 'عرض')), out);
  await run(load); return node;
}
