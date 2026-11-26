import { api } from '../api.js';
import { can } from '../shared/index.js';
import { CASH_KIND } from '../labels.js';
import { h, page, field, inp, sel, badge, table, empty, run, modal, dt, egp, toPiastersInput, clear, today, monthStart, branchOptions } from '../ui.js';

export default async function ({ user }) {
  const { list: branches } = await branchOptions();
  const manage = can(user.role, 'finance.manage');
  let boxes = await api.get('/cashboxes'); let cur = boxes[0]?.id ?? '';
  const boxSel = sel(boxes.map((b) => [b.id, b.name]), cur, { onchange: (e) => { cur = e.target.value; run(loadEntries); } });
  const from = inp({ type: 'date', value: monthStart() }); const to = inp({ type: 'date', value: today() });
  const entries = h('div'); const sum = h('div');
  async function loadEntries() {
    if (!cur) { clear(entries).append(empty('لا توجد خزينة', 'أنشئ خزينة أولًا ثم سجّل المصروفات والإيرادات.')); return; }
    const rows = await api.get('/cash-entries', { cashbox: cur, limit: 100 });
    clear(entries).append(table([{ h: 'التاريخ', c: (e) => dt(e.created_at) }, { h: 'النوع', c: (e) => badge(CASH_KIND[e.kind], e.kind === 'income' ? 'ok' : e.kind === 'expense' ? 'err' : '') }, { h: 'التصنيف', c: (e) => e.category ?? '—' }, { h: 'المبلغ', c: (e) => egp(e.amount), cls: 'num' }, { h: 'ملاحظة', c: (e) => e.note ?? '' }], rows, empty('لا توجد قيود بعد', 'سجّل أول مصروف أو إيراد. القيود لا تُحذف؛ التصحيح بقيد تسوية.')));
  }
  async function loadSum() {
    const rows = await api.get('/reports/cash', { from: from.value, to: to.value });
    const t = (k) => rows.filter((r) => r.kind === k).reduce((a, r) => a + Number(r.total), 0);
    clear(sum).append(h('div', { class: 'ledger' }, h('div', null, h('div', { class: 'v' }, egp(t('income'))), h('div', { class: 'k' }, 'الإيرادات')), h('div', null, h('div', { class: 'v' }, egp(t('expense') + t('payment'))), h('div', { class: 'k' }, 'المصروفات والمدفوعات')), h('div', null, h('div', { class: 'v' }, egp(t('income') - t('expense') - t('payment') + t('adjustment'))), h('div', { class: 'k' }, 'الصافي'))),
      table([{ h: 'النوع', c: (r) => CASH_KIND[r.kind] }, { h: 'التصنيف', c: (r) => r.category ?? '—' }, { h: 'الإجمالي', c: (r) => egp(r.total), cls: 'num' }], rows, empty('لا توجد حركة في هذه الفترة')));
  }
  function addEntry() {
    const f = { kind: sel(Object.entries(CASH_KIND), 'expense'), amount: inp({ type: 'number', min: 0.01, step: '0.01' }), cat: inp({ placeholder: 'إيجار، كهرباء، رواتب…' }), note: inp() };
    modal({ title: 'قيد جديد', body: h('div', { class: 'form-grid' }, field('النوع', f.kind), field('المبلغ (جنيه)', f.amount), field('التصنيف', f.cat), field('ملاحظة', f.note)),
      actions: [{ label: 'حفظ القيد', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/cash-entries', { cashboxId: cur, kind: f.kind.value, amountPiasters: toPiastersInput(f.amount.value), category: f.cat.value || null, note: f.note.value || null }); close(); await loadEntries(); await loadSum(); }, { btn: e.currentTarget, ok: 'تم حفظ القيد' }); } }, { label: 'إلغاء' }] });
  }
  function addBox() {
    const n = inp(); const b = sel([['', 'عامة'], ...branches.map((x) => [x.id, x.name])], '');
    modal({ title: 'خزينة جديدة', body: h('div', { class: 'form-grid' }, field('الاسم', n), field('الفرع', b)), actions: [{ label: 'حفظ الخزينة', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/cashboxes', { name: n.value, branchId: b.value || null }); close(); location.reload(); }, { btn: e.currentTarget }); } }, { label: 'إلغاء' }] });
  }
  const node = page('الخزائن والمصروفات', manage && h('div', { class: 'form-row' }, h('button', { class: 'btn', onclick: addBox }, 'خزينة جديدة'), h('button', { class: 'btn primary', onclick: addEntry, disabled: !cur }, 'قيد جديد')),
    h('section', null, h('h2', null, 'ملخص الفترة'), h('div', { class: 'toolbar' }, field('من', from), field('إلى', to), h('button', { class: 'btn', onclick: () => run(loadSum) }, 'عرض الملخص')), sum),
    h('section', null, h('h2', null, 'قيود الخزينة'), h('div', { class: 'toolbar' }, field('الخزينة', boxSel)), entries));
  await run(loadEntries); await run(loadSum); return node;
}
