import { api } from '../api.js';
import { encodeQR, encodeCode128 } from '../shared/index.js';
import { h, page, field, inp, sel, egp, empty, run, act, toast, clear, table } from '../ui.js';

export function qrSvg(text) {
  const { size, modules } = encodeQR(text, { ecl: 'M' });
  const rects = []; modules.forEach((row, y) => row.forEach((d, x) => d && rects.push(`M${x + 2} ${y + 2}h1v1h-1z`)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 4} ${size + 4}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${rects.join('')}" fill="#000"/></svg>`;
}
export function barSvg(text) {
  const w = encodeCode128(text); const total = w.reduce((a, b) => a + b, 0) + 20; let x = 10; const out = [];
  w.forEach((n, i) => { if (i % 2 === 0) out.push(`<rect x="${x}" y="0" width="${n}" height="40" fill="#000"/>`); x += n; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 40" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${out.join('')}</svg>`;
}
export const labelNode = (v, model) => h('div', { class: 'label' },
  h('div', { class: 'qr', html: qrSvg(v.sku), role: 'img', 'aria-label': `QR ${v.sku}` }),
  h('div', { class: 'meta' }, h('b', null, model.name), `${v.color_name} · ${v.size_name}`, h('div', null, egp(model.price_piasters))),
  h('div', { class: 'bar', html: barSvg(v.sku), role: 'img', 'aria-label': `باركود ${v.sku}` }), h('div', { class: 'sku' }, v.sku));

export default async function ({ query }) {
  const models = await api.get('/models', { limit: 200 });
  const modelSel = sel([['', 'اختر الموديل'], ...models.map((m) => [m.id, `${m.code} — ${m.name}`])], query.model ?? '', { onchange: (e) => { location.hash = `#/labels?model=${e.target.value}`; } });
  const head = h('div', { class: 'toolbar no-print' }, field('الموديل', modelSel));
  if (!query.model) return page('طباعة الملصقات', null, head, empty('اختر موديلًا', 'ستظهر قطعه هنا لتحدد عدد الملصقات لكل قطعة.'));

  const m = await api.get(`/models/${query.model}`);
  const rows = m.variants.filter((v) => v.is_active).map((v) => ({ v, copies: inp({ type: 'number', min: 0, max: 200, value: v.printed_at ? 0 : 1, 'aria-label': `عدد ملصقات ${v.sku}`, style: 'width:90px' }) }));
  const area = h('div', { class: 'labels', 'aria-label': 'معاينة الملصقات' });
  const draw = () => { clear(area); for (const { v, copies } of rows) for (let i = 0; i < Number(copies.value || 0); i++) area.append(labelNode(v, m)); if (!area.children.length) area.append(h('div', { class: 'empty no-print' }, 'حدد عدد الملصقات لقطعة واحدة على الأقل')); };
  rows.forEach((r) => r.copies.addEventListener('input', draw)); draw();
  const all = (n) => () => { rows.forEach((r) => { r.copies.value = n; }); draw(); };
  const printBtn = h('button', { class: 'btn primary', onclick: act(async () => {
    const skus = rows.filter((r) => Number(r.copies.value) > 0).map((r) => r.v.sku);
    if (!skus.length) { toast('لا توجد ملصقات للطباعة', 'err'); return; }
    window.print();
    await api.post('/labels/printed', { skus });
    toast('تم تسجيل القطع كمطبوعة');
  }) }, 'طباعة الملصقات (50×30 مم)');
  const node = page(`ملصقات ${m.name}`, null, h('div', { class: 'no-print stack' }, head,
    h('div', { class: 'form-row' }, h('button', { class: 'btn sm', onclick: all(1) }, 'ملصق واحد لكل قطعة'), h('button', { class: 'btn sm', onclick: all(0) }, 'تصفير الكل'), printBtn),
    table([{ h: 'القطعة', c: ({ v }) => h('span', { class: 'ltr' }, v.sku), cls: 'num' }, { h: 'اللون / المقاس', c: ({ v }) => `${v.color_name} / ${v.size_name}` }, { h: 'عدد الملصقات', c: ({ copies }) => copies }], rows, empty('لا توجد قطع', 'ولّد أكواد الموديل أولًا من صفحته.')),
    h('p', { class: 'muted' }, 'تحتوي كل ملصقة على QR وباركود Code128 لنفس الكود، ويقرؤهما أي سكانر. ضبط الطابعة على مقاس 50×30 مم وبدون هوامش.')), area);
  return node;
}
