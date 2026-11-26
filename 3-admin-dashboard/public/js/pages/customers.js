import { api } from '../api.js';
import { can, normalizePhone } from '../shared/index.js';
import { h, page, field, inp, table, empty, run, modal, clear, toast } from '../ui.js';

export default async function ({ user }) {
  const q = inp({ type: 'search', placeholder: 'اسم أو رقم هاتف' }); const out = h('div'); const full = can(user.role, 'customers.full');
  async function load() {
    const rows = await api.get('/customers', { q: q.value, limit: 100 });
    clear(out).append(table([{ h: 'الاسم', c: (c) => c.name }, { h: 'الهاتف', c: (c) => h('span', { class: 'ltr' }, c.phone_e164) }, ...(full ? [{ h: 'المحافظة', c: (c) => c.governorate ?? '—' }, { h: 'المصدر', c: (c) => c.source ?? '—' }] : [])], rows, empty('لا يوجد عملاء', 'يُسجَّل العميل تلقائيًا عند أول فاتورة أو طلب.')));
  }
  function add() {
    const name = inp({ required: true }); const phone = inp({ type: 'tel', dir: 'ltr', placeholder: '01012345678' });
    modal({ title: 'عميل جديد', body: h('div', { class: 'stack' }, field('الاسم', name), field('الهاتف', phone, 'يُحفظ بصيغة دولية موحّدة')),
      actions: [{ label: 'حفظ العميل', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { if (!normalizePhone(phone.value)) throw new Error('رقم الهاتف غير صالح'); await api.post('/customers', { name: name.value, phone: phone.value }); close(); await load(); }, { btn: e.currentTarget, ok: 'تم حفظ العميل' }); } }, { label: 'إلغاء' }] });
  }
  async function exportCsv(e) {
    await run(async () => { const csv = await api.text('/customers/export'); const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'customers.csv' }); a.click(); }, { btn: e.currentTarget, ok: 'تم التصدير وسُجّل في سجل النشاط' });
  }
  const node = page('العملاء', h('div', { class: 'form-row' }, can(user.role, 'customers.export') && h('button', { class: 'btn', onclick: exportCsv }, 'تصدير CSV'), can(user.role, 'customers.create') && h('button', { class: 'btn primary', onclick: add }, 'عميل جديد')),
    h('div', { class: 'toolbar' }, field('بحث', q), h('button', { class: 'btn', onclick: () => run(load) }, 'بحث')), out);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(load); });
  await run(load); return node;
}
