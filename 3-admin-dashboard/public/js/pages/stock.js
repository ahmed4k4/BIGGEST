import { api } from '../api.js';
import { can } from '../shared/index.js';
import { h, page, field, inp, sel, badge, num, table, empty, run, modal, toast, clear, branchOptions } from '../ui.js';

export default async function ({ user }) {
  const { opts } = await branchOptions(() => true, user.role !== 'branch_manager');
  const br = sel(opts, user.role === 'branch_manager' ? user.branchId : ''); if (user.role === 'branch_manager') br.disabled = true;
  const q = inp({ type: 'search', placeholder: 'كود أو اسم موديل' });
  const out = h('div');
  const canEdit = can(user.role, 'stock.count');
  async function load() {
    const rows = await api.get('/stock', { branch: br.value, q: q.value, limit: 300 });
    clear(out).append(table([
      { h: 'الموقع', c: (r) => r.branch_name }, { h: 'الكود', c: (r) => r.sku, cls: 'ltr' }, { h: 'الصنف', c: (r) => `${r.model_name} · ${r.color_name} · ${r.size_name}` },
      { h: 'الرصيد', c: (r) => h('b', null, num(r.qty)), cls: 'num' }, { h: 'محجوز', c: (r) => num(r.reserved), cls: 'num' }, { h: 'الحد الأدنى', c: (r) => num(r.min_qty), cls: 'num' },
      { h: 'الحالة', c: (r) => (r.low && r.min_qty > 0 ? badge('تحت الحد', 'err') : r.qty <= 0 ? badge('نفد', 'warn') : badge('متوفر', 'ok')) },
      ...(canEdit ? [{ h: '', cls: 'actions', c: (r) => h('span', null, h('button', { class: 'btn sm', onclick: () => adjust(r) }, 'تسوية'), ' ', h('button', { class: 'btn sm', onclick: () => minQty(r) }, 'الحد الأدنى')) }] : []),
    ], rows, empty('لا يوجد رصيد', 'أدخل بضاعة من صفحة «إدخال بضاعة» أو استلم تحويلًا.')));
  }
  function adjust(r) {
    const d = inp({ type: 'number', required: true }); const why = h('textarea', { placeholder: 'مثال: عدّ فعلي أظهر نقصًا' });
    modal({ title: `تسوية ${r.sku} في ${r.branch_name}`, body: h('div', { class: 'stack' }, h('p', null, `الرصيد الحالي ${num(r.qty)}. اكتب الفرق بالموجب أو السالب.`), field('الفرق', d), field('السبب (مطلوب)', why)),
      actions: [{ label: 'حفظ التسوية', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/stock/adjust', { branchId: r.branch_id, variantId: r.variant_id, delta: Number(d.value), reason: why.value }); close(); await load(); }, { btn: e.currentTarget, ok: 'سُجّلت التسوية في دفتر الحركات' }); } }, { label: 'إلغاء' }] });
  }
  function minQty(r) {
    const m = inp({ type: 'number', min: 0, value: r.min_qty });
    modal({ title: `الحد الأدنى لـ ${r.sku}`, body: field('أقل رصيد قبل التنبيه', m), actions: [{ label: 'حفظ', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/stock/min', { branchId: r.branch_id, variantId: r.variant_id, min: Number(m.value) }); close(); await load(); }, { btn: e.currentTarget, ok: 'تم الحفظ' }); } }, { label: 'إلغاء' }] });
  }
  const node = page('المخزون', null, h('div', { class: 'toolbar' }, field('الموقع', br), field('بحث', q), h('button', { class: 'btn primary', onclick: () => run(load) }, 'عرض')), out);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(load); });
  await run(load); return node;
}
