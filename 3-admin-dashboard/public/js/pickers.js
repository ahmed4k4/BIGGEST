/** محرر أسطر الأصناف: بحث بالكود أو الاسم، إضافة بضغطة، كمية لكل سطر. يُستخدم في إدخال البضاعة والتحويلات. */
import { api } from './api.js';
import { h, inp, clear, run, empty, egp } from './ui.js';

export function lineEditor() {
  const lines = new Map();   // variantId → {v, qty}
  const q = inp({ type: 'search', placeholder: 'اكتب كود الصنف أو اسم الموديل ثم Enter', 'aria-label': 'بحث عن صنف' });
  const results = h('div', { class: 'picker-results' });
  const list = h('div');
  const draw = () => {
    clear(list);
    if (!lines.size) { list.append(empty('لم تُضف أصنافًا بعد', 'ابحث عن صنف بالأعلى وأضفه.')); return; }
    list.append(h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['الكود', 'الصنف', 'الكمية', ''].map((t) => h('th', null, t)))),
      h('tbody', null, [...lines.values()].map((l) => h('tr', null, h('td', { class: 'ltr' }, l.v.sku), h('td', null, `${l.v.model_name ?? ''} ${l.v.color_name} ${l.v.size_name}`.trim()),
        h('td', null, inp({ type: 'number', min: 1, value: l.qty, style: 'width:90px', 'aria-label': `كمية ${l.v.sku}`, oninput: (e) => { l.qty = Number(e.target.value); } })),
        h('td', null, h('button', { class: 'btn sm danger', type: 'button', onclick: () => { lines.delete(l.v.id); draw(); } }, 'حذف'))))))));
  };
  async function search() {
    const rows = await api.get('/variants', { q: q.value, limit: 12 });
    const models = new Map((await api.get('/models', { limit: 500 })).map((m) => [m.id, m.name]));
    clear(results);
    if (!rows.length) results.append(h('div', { class: 'muted' }, 'لا توجد نتائج. راجع الكود أو ولّد الأكواد من صفحة الموديل.'));
    rows.forEach((v) => results.append(h('button', { class: 'btn sm', type: 'button', onclick: () => { const cur = lines.get(v.id); lines.set(v.id, { v: { ...v, model_name: models.get(v.model_id) }, qty: (cur?.qty ?? 0) + 1 }); draw(); } }, `${v.sku} · ${models.get(v.model_id) ?? ''} ${v.color_name} ${v.size_name}`)));
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(search); } });
  draw();
  return { node: h('div', { class: 'stack' }, q, results, list), get: () => [...lines.values()].map((l) => ({ variantId: l.v.id, qty: l.qty })), size: () => lines.size };
}
