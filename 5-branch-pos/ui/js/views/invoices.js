import { get, post } from '../api.js';
import { h, clear, run, egp, num, dt, modal, toast, field } from '../ui.js';
import { printReceipt } from '../print.js';

export async function invoicesView(root) {
  const q = h('input', { type: 'search', placeholder: 'رقم الفاتورة', 'aria-label': 'بحث برقم الفاتورة' });
  const box = h('div', { class: 'card' });
  const load = async () => {
    const rows = (await run(() => get(`/local/invoices?q=${encodeURIComponent(q.value)}`))) ?? [];
    clear(box);
    if (!rows.length) return box.append(h('div', { class: 'empty' }, 'لا توجد فواتير مطابقة'));
    box.append(h('table', null, h('thead', null, h('tr', null, ['الرقم', 'النوع', 'الإجمالي', 'الوقت', ''].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((r) => h('tr', null, h('td', { class: 'ltr' }, r.number), h('td', null, h('span', { class: `pill ${r.kind === 'return' ? 'red' : 'green'}` }, r.kind === 'return' ? 'مرتجع' : 'بيع')),
        h('td', null, egp(r.total)), h('td', null, dt(r.created_at)), h('td', null, h('button', { class: 'btn sm', onclick: () => open(r.id) }, 'فتح')))))));
  };
  q.addEventListener('input', () => { clearTimeout(q.t); q.t = setTimeout(load, 200); });

  async function open(id) {
    const inv = await run(() => get(`/local/invoices/${id}`)); if (!inv) return;
    const body = h('div', null, h('p', null, `${dt(inv.created_at)} • الإجمالي ${egp(inv.total)}`),
      h('table', null, h('tbody', null, inv.lines.map((l) => h('tr', null, h('td', null, `${l.model_name} ${l.color_name ?? ''} ${l.size_name ?? ''}`), h('td', null, `× ${num(l.qty)}`), h('td', null, egp(l.line_total)), h('td', { class: 'muted' }, l.returnable < l.qty ? `رُجع ${num(l.qty - l.returnable)}` : ''))))));
    modal({ title: `فاتورة ${inv.number}`, body, wide: true, actions: [
      { label: 'إعادة طباعة', onClick: async () => { await run(async () => printReceipt(await get(`/local/invoices/${inv.id}/receipt?reprint=1`))); return false; } },
      ...(inv.kind === 'sale' && inv.lines.some((l) => l.returnable > 0) ? [{ label: 'مرتجع', kind: 'danger', onClick: () => { setTimeout(() => refund(inv), 0); } }] : []), { label: 'إغلاق' }] });
  }

  function refund(inv) {
    const inputs = inv.lines.filter((l) => l.returnable > 0).map((l) => ({ l, el: h('input', { class: 'num', inputmode: 'numeric', value: '0', style: 'width:80px' }) }));
    modal({ title: `مرتجع من ${inv.number}`, body: h('div', null, h('p', { class: 'muted' }, 'اكتب الكمية المرتجعة لكل صنف. سيُسترد المبلغ نقدًا بعد الخصم النسبي.'),
      h('table', null, h('tbody', null, inputs.map(({ l, el }) => h('tr', null, h('td', null, `${l.model_name} ${l.color_name ?? ''} ${l.size_name ?? ''}`), h('td', { class: 'muted' }, `المتاح ${num(l.returnable)}`), h('td', null, el)))))),
      actions: [{ label: 'تأكيد المرتجع', kind: 'danger', onClick: async () => {
        const lines = inputs.map(({ l, el }) => ({ variantId: l.variant_id, qty: Number(el.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) || 0 })).filter((x) => x.qty > 0);
        const r = await run(() => post('/local/returns', { refInvoiceId: inv.id, lines })); if (!r) return false;
        toast(`تم المرتجع — ${egp(r.invoice.total)}`); run(async () => printReceipt(await get(`/local/invoices/${r.invoice.id}/receipt`), { openDrawer: true })); load();
      } }, { label: 'رجوع' }] });
  }

  root.append(h('div', { class: 'card', style: 'margin-bottom:12px' }, field('بحث', q)), box); load();
}
