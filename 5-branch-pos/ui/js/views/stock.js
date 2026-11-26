import { get, post } from '../api.js';
import { h, clear, run, num, toast, field } from '../ui.js';

export async function stockView(root, ctx) {
  const lines = new Map(); const note = h('input', { placeholder: 'ملاحظة (اختياري)' });
  const q = h('input', { type: 'search', placeholder: 'امسح باركود القطعة المعدودة', 'aria-label': 'جرد', autofocus: true });
  const box = h('div'); const tr = h('div', { class: 'card' });

  const paint = () => {
    clear(box);
    if (!lines.size) return box.append(h('div', { class: 'empty' }, 'امسح القطع واحدة واحدة وسيُحسب العدد تلقائيًا، أو اكتب الكمية.'));
    box.append(h('table', null, h('thead', null, h('tr', null, ['الصنف', 'بالنظام', 'المعدود', 'الفرق'].map((x) => h('th', null, x)))),
      h('tbody', null, [...lines.values()].map((l) => h('tr', null, h('td', null, `${l.model_name} ${l.color_name ?? ''} ${l.size_name ?? ''}`), h('td', null, num(l.stock)),
        h('td', null, h('input', { class: 'num', style: 'width:84px', value: l.counted, onchange: (e) => { l.counted = Math.max(0, Number(e.target.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) || 0); paint(); } })),
        h('td', { style: `font-weight:600;color:${l.counted === l.stock ? 'inherit' : 'var(--red)'}` }, num(l.counted - l.stock)))))),
      h('div', { class: 'row', style: 'margin-top:12px' }, note, h('button', { class: 'btn primary', onclick: submit }, 'اعتماد الجرد وتسوية الفروق')));
  };
  q.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const r = (await run(() => get(`/local/search?q=${encodeURIComponent(q.value)}`))) ?? [];
    if (r.length !== 1) return toast(r.length ? 'اكتب الباركود كاملًا لتحديد قطعة واحدة' : 'لا يوجد صنف بهذا الكود', 'err');
    const l = lines.get(r[0].id) ?? { ...r[0], counted: 0 }; l.counted += 1; lines.set(r[0].id, l); q.value = ''; paint();
  });
  async function submit() {
    const r = await run(() => post('/local/counts', { lines: [...lines.values()].map((l) => ({ variantId: l.id, counted: l.counted })), note: note.value || null }));
    if (r) { toast(`تم الجرد: ${num(r.differences)} فرق`); lines.clear(); paint(); }
  }

  async function loadTransfers() {
    const list = (await run(() => get('/local/transfers/incoming'))) ?? [];
    clear(tr); tr.append(h('h2', null, 'تحويلات في الطريق إلى الفرع'));
    if (!list.length) return tr.append(h('div', { class: 'empty' }, 'لا توجد تحويلات بانتظار الاستلام'));
    for (const t of list) {
      const ins = t.lines.map((l) => ({ l, el: h('input', { class: 'num', style: 'width:80px', value: String(l.qtySent - l.qtyReceived) }) }));
      tr.append(h('h3', null, `${t.number} من ${t.from}`), h('table', null, h('tbody', null, ins.map(({ l, el }) => h('tr', null, h('td', null, l.name), h('td', { class: 'muted' }, `أُرسل ${num(l.qtySent)} • استُلم ${num(l.qtyReceived)}`), h('td', null, el))))),
        h('button', { class: 'btn primary', onclick: async () => {
          const r = await run(() => post(`/local/transfers/${t.id}/receive`, { lines: ins.map(({ l, el }) => ({ variantId: l.variantId, qtyReceived: Number(el.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) || 0 })).filter((x) => x.qtyReceived > 0) }));
          if (r) { toast('تم الاستلام وإضافة الكميات للمخزن'); loadTransfers(); }
        } }, 'تأكيد الاستلام'), h('p', { class: 'muted' }, 'لو الكمية الفعلية أقل، اكتبها: العجز يُسجَّل ويراجعه المدير.'));
    }
  }
  root.append(h('div', { class: 'layout-2' }, h('div', { class: 'card' }, h('h2', null, 'جرد'), field('الباركود', q), box), tr));
  paint(); loadTransfers();
}
