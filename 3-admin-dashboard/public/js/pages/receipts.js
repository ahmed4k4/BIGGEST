import { api } from '../api.js';
import { lineEditor } from '../pickers.js';
import { h, page, field, sel, table, empty, run, modal, dt, num, branchOptions, clear } from '../ui.js';

export default async function () {
  const { opts } = await branchOptions((b) => b.kind === 'main_warehouse');
  const out = h('div');
  const load = async () => { const rows = await api.get('/receipts', { limit: 50 }); clear(out).append(table([{ h: 'الرقم', c: (r) => r.number, cls: 'ltr' }, { h: 'التاريخ', c: (r) => dt(r.created_at) }, { h: 'ملاحظة', c: (r) => r.note ?? '—' }], rows, empty('لا توجد إيصالات بعد', 'ابدأ بإدخال أول شحنة بضاعة إلى المخزن الرئيسي.'))); };
  function create() {
    const wh = sel(opts, opts[0]?.[0]); const note = h('textarea', { placeholder: 'مثال: شحنة المورد رقم 14' }); const ed = lineEditor();
    modal({ wide: true, title: 'إدخال بضاعة إلى المخزن الرئيسي', body: h('div', { class: 'stack' }, field('المخزن', wh), field('ملاحظة', note), ed.node),
      actions: [{ label: 'حفظ الإدخال', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { if (!ed.size()) throw new Error('أضف صنفًا واحدًا على الأقل'); const r = await api.post('/receipts', { branchId: wh.value, note: note.value, lines: ed.get() }); close(); await load(); return r; }, { btn: e.currentTarget, ok: 'أُضيفت البضاعة للمخزن' }); } }, { label: 'إلغاء' }] });
  }
  const node = page('إدخال بضاعة', h('button', { class: 'btn primary', onclick: create }, 'إدخال جديد'), h('p', { class: 'muted' }, 'البضاعة تدخل المخزن الرئيسي فقط، ثم توزَّع على الفروع بتحويلات.'), out);
  await run(load); return node;
}
