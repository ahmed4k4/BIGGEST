/** منتقي أصناف مشترك: بحث بالكود/الاسم ثم إضافة سطور بالكمية. */
import { api } from '../api.js';
import { h, inp, field, table, empty, clear, run, toast } from '../ui.js';

export function variantPicker({ withQty = true } = {}) {
  const lines = new Map();   // variantId → {v, qty}
  const q = inp({ type: 'search', placeholder: 'اكتب كود القطعة أو جزءًا منه (مثل 0001-05)' });
  const results = h('div'); const chosen = h('div');
  const drawChosen = () => {
    clear(chosen);
    if (!lines.size) { chosen.append(empty('لم تُضف أصنافًا بعد', 'ابحث بالكود ثم اضغط «إضافة».')); return; }
    chosen.append(table([{ h: 'القطعة', c: ({ v }) => h('span', { class: 'ltr' }, v.sku) }, { h: 'اللون / المقاس', c: ({ v }) => `${v.color_name} / ${v.size_name}` },
      { h: 'الكمية', c: (l) => inp({ type: 'number', min: 1, value: l.qty, 'aria-label': `كمية ${l.v.sku}`, style: 'width:100px', oninput: (e) => { l.qty = Number(e.target.value); } }) },
      { h: '', c: (l) => h('button', { class: 'btn sm danger', type: 'button', onclick: () => { lines.delete(l.v.id); drawChosen(); } }, 'إزالة') }], [...lines.values()]));
  };
  async function search() {
    if (q.value.trim().length < 2) { toast('اكتب حرفين على الأقل للبحث', 'err'); return; }
    const rows = await api.get('/variants', { q: q.value.trim(), limit: 30 });
    clear(results).append(table([{ h: 'القطعة', c: (v) => h('span', { class: 'ltr' }, v.sku) }, { h: 'اللون / المقاس', c: (v) => `${v.color_name} / ${v.size_name}` },
      { h: '', c: (v) => h('button', { class: 'btn sm', type: 'button', onclick: () => { lines.set(v.id, lines.get(v.id) ?? { v, qty: 1 }); drawChosen(); } }, 'إضافة') }], rows, empty('لا توجد قطع بهذا الكود')));
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(search); } });
  drawChosen();
  return {
    node: h('div', { class: 'stack' }, h('div', { class: 'form-row' }, field('بحث عن قطعة', q), h('button', { class: 'btn', type: 'button', onclick: () => run(search) }, 'بحث')), results, h('h3', null, 'الأصناف المختارة'), chosen),
    lines: () => [...lines.values()].map((l) => ({ variantId: l.v.id, qty: l.qty })),
    reset: () => { lines.clear(); drawChosen(); clear(results); },
  };
}
