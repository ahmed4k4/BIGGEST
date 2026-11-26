import { get, post } from '../api.js';
import { h, clear, run, egp, num, toast, modal, field, toPiasters } from '../ui.js';
import { printReceipt } from '../print.js';
import { refreshMe } from '../app.js';

export async function sellView(root, ctx) {
  const S = { cart: [], pct: 0, customer: null, quote: null, results: [], training: false, busy: false };
  const q = h('input', { id: 'q', type: 'search', placeholder: 'امسح الباركود أو اكتب اسم الموديل / اللون / المقاس (F2)', autofocus: true, 'aria-label': 'بحث عن صنف' });
  const results = h('div', { class: 'results', role: 'list' });
  const cartBox = h('div');
  const shiftBox = h('div');
  let t;

  const add = (v) => {
    const line = S.cart.find((l) => l.variantId === v.id);
    if (line) line.qty += 1; else S.cart.push({ variantId: v.id, sku: v.sku, name: v.model_name, detail: [v.color_name, v.size_name].filter(Boolean).join(' • '), unitPrice: v.price, qty: 1, stock: v.stock });
    q.value = ''; S.results = []; paintResults(); requote(); q.focus();
  };
  const paintResults = () => {
    clear(results);
    if (!S.results.length && q.value.trim()) results.append(h('div', { class: 'empty' }, 'لا يوجد صنف بهذا الوصف'));
    for (const v of S.results) results.append(h('button', { class: 'res', type: 'button', onclick: () => add(v) },
      h('b', null, v.model_name), h('span', { class: `stock ${v.stock <= 0 ? 'zero' : v.stock <= 2 ? 'low' : ''}` }, `المتاح ${num(v.stock)}`),
      h('span', { class: 'sub' }, `${v.color_name ?? ''} • ${v.size_name ?? ''} • `, h('span', { class: 'ltr' }, v.sku)), h('b', null, egp(v.price))));
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { if (!q.value.trim()) { S.results = []; return paintResults(); } S.results = (await run(() => get(`/local/search?q=${encodeURIComponent(q.value)}`))) ?? []; paintResults(); }, 150); });
  q.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return; clearTimeout(t);
    const r = (await run(() => get(`/local/search?q=${encodeURIComponent(q.value)}`))) ?? [];
    if (r.length === 1) add(r[0]); else { S.results = r; paintResults(); if (!r.length) toast('لا يوجد صنف بهذا الكود', 'err'); }
  });

  async function requote() {
    if (!S.cart.length) { S.quote = null; return paintCart(); }
    S.quote = await run(() => post('/local/quote', { lines: S.cart.map((l) => ({ variantId: l.variantId, qty: l.qty })), discount: { pct: S.pct } }));
    paintCart();
  }

  function paintCart() {
    clear(cartBox);
    if (!S.cart.length) { cartBox.append(h('div', { class: 'empty' }, 'الفاتورة فارغة. امسح باركود أول قطعة.')); return; }
    const tot = S.quote?.totals;
    cartBox.append(
      h('table', null, h('thead', null, h('tr', null, ['الصنف', 'الكمية', 'السعر', ''].map((x) => h('th', null, x)))),
        h('tbody', null, S.cart.map((l, i) => h('tr', null,
          h('td', null, h('b', null, l.name), h('div', { class: 'muted' }, l.detail)),
          h('td', null, h('span', { class: 'qty' }, h('button', { 'aria-label': 'إنقاص', onclick: () => { l.qty = Math.max(1, l.qty - 1); requote(); } }, '−'), h('b', null, num(l.qty)), h('button', { 'aria-label': 'زيادة', onclick: () => { l.qty += 1; requote(); } }, '+'))),
          h('td', null, egp(l.unitPrice * l.qty)),
          h('td', null, h('button', { class: 'btn sm', 'aria-label': `حذف ${l.name}`, onclick: () => { S.cart.splice(i, 1); requote(); } }, '✕')))))),
      S.quote?.warnings?.length > 0 && h('div', { class: 'banner' }, `الرصيد المسجّل أقل من الكمية في ${num(S.quote.warnings.length)} صنف. اكمل البيع لو القطعة معك فعلًا، وسيُسجَّل للمراجعة.`),
      h('div', { class: 'row' }, field('خصم %', h('input', { class: 'num', inputmode: 'decimal', value: S.pct || '', placeholder: '0', onchange: (e) => { S.pct = Number(e.target.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) || 0; requote(); } }),
        `الحد المسموح لك ${num(ctx.settings.cashierMaxDiscountPct)}%`)),
      tot && h('div', { class: 'totals' }, tot.discount > 0 && h('div', null, h('span', null, 'الخصم'), h('span', null, `-${egp(tot.discount)}`)), tot.tax > 0 && h('div', { class: 'muted' }, h('span', null, 'منها ضريبة'), h('span', null, egp(tot.tax))),
        h('div', { class: 'grand' }, h('span', null, 'الإجمالي'), h('span', null, egp(tot.total)))),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: pickCustomer }, S.customer ? `العميل: ${S.customer.name}` : 'إضافة عميل'),
        h('button', { class: 'btn', onclick: () => { S.cart = []; S.pct = 0; S.customer = null; requote(); } }, 'إلغاء الفاتورة')),
      h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn primary big', disabled: !tot, onclick: pay }, tot ? `دفع ${egp(tot.total)}` : 'دفع')));
  }

  function pickCustomer() {
    const box = h('div'); const s = h('input', { placeholder: 'ابحث بالاسم أو الرقم', autofocus: true }); const list = h('div', { class: 'results' });
    s.addEventListener('input', async () => { clear(list); const r = (await run(() => get(`/local/customers?q=${encodeURIComponent(s.value)}`))) ?? []; r.forEach((c) => list.append(h('button', { class: 'res', onclick: () => { S.customer = c; m.close(); paintCart(); } }, h('b', null, c.name), h('span', { class: 'sub ltr' }, c.phone ?? '')))); });
    const name = h('input'); const phone = h('input', { class: 'ltr', inputmode: 'tel' });
    const m = modal({ title: 'العميل', body: h('div', null, field('بحث', s), list, h('hr'), h('h3', null, 'عميل جديد'), field('الاسم', name), field('الهاتف', phone)),
      actions: [{ label: 'حفظ العميل الجديد', kind: 'primary', onClick: async () => { const c = await run(() => post('/local/customers', { name: name.value, phone: phone.value })); if (!c) return false; S.customer = c; paintCart(); } }, { label: 'بدون عميل', onClick: () => { S.customer = null; paintCart(); } }] });
    box.remove();
  }

  function pay() {
    const total = S.quote.totals.total;
    const cash = h('input', { class: 'num', inputmode: 'decimal', value: String(total / 100) }); const card = h('input', { class: 'num', inputmode: 'decimal', placeholder: '0' }); const wallet = h('input', { class: 'num', inputmode: 'decimal', placeholder: '0' });
    const info = h('div', { class: 'change' });
    const paint = () => { const paid = toPiasters(cash.value) + toPiasters(card.value) + toPiasters(wallet.value); info.textContent = paid >= total ? `الباقي ${egp(paid - total)}` : `ناقص ${egp(total - paid)}`; info.style.background = paid >= total ? '' : 'var(--err-bg)'; };
    [cash, card, wallet].forEach((i) => i.addEventListener('input', paint)); paint();
    const quick = h('div', { class: 'quick' }, [50, 100, 200, 500].map((v) => h('button', { class: 'btn', type: 'button', onclick: () => { cash.value = String(v); card.value = ''; wallet.value = ''; paint(); } }, egp(v * 100))), h('button', { class: 'btn', type: 'button', onclick: () => { cash.value = String(total / 100); card.value = ''; wallet.value = ''; paint(); } }, 'المبلغ بالضبط'));
    modal({ title: `الدفع — ${egp(total)}`, body: h('div', null, quick, field('نقدي', cash), field('بطاقة', card), field('محفظة', wallet), info),
      actions: [{ label: 'تأكيد وطباعة', kind: 'primary', onClick: async () => {
        const payments = [['cash', cash], ['card', card], ['wallet', wallet]].map(([method, i]) => ({ method, amount: toPiasters(i.value) })).filter((p) => p.amount > 0);
        const r = await run(() => post('/local/sales', { lines: S.cart.map((l) => ({ variantId: l.variantId, qty: l.qty })), discount: { pct: S.pct }, payments, customerId: S.customer?.id, isTraining: S.training }));
        if (!r) return false;
        toast(S.training ? 'فاتورة تدريب (لم تُسجَّل)' : `تم البيع — ${r.invoice.number}`);
        S.cart = []; S.pct = 0; S.customer = null; S.quote = null; paintCart(); refreshMe().then(paintShift);
        if (!S.training) run(async () => printReceipt(await get(`/local/invoices/${r.invoice.id}/receipt`), { openDrawer: payments.some((p) => p.method === 'cash') }));
        q.focus();
      } }, { label: 'رجوع' }] });
  }

  const paintShift = () => {
    clear(shiftBox);
    if (!ctx.shift) shiftBox.append(h('div', { class: 'banner' }, 'لا توجد وردية مفتوحة. افتحها من «الوردية والحضور» ليُحسب الدرج بدقة.'));
    shiftBox.append(h('div', { class: 'muted' }, `اليوم: ${num(ctx.summary?.invoices ?? 0)} فاتورة • ${egp(ctx.summary?.net ?? 0)}`));
  };

  root.append(h('div', { class: 'sell' },
    h('section', null, h('div', { class: 'card' }, field('البحث', q), results)),
    h('section', null, h('div', { class: 'card' }, shiftBox,
      h('label', { class: 'row', style: 'margin:6px 0' }, h('input', { type: 'checkbox', style: 'width:auto;min-height:0', onchange: (e) => { S.training = e.target.checked; toast(S.training ? 'وضع التدريب: لا تُسجَّل الفواتير' : 'عاد الوضع العادي'); } }), h('span', null, 'وضع التدريب')),
      cartBox))));
  paintShift(); paintCart(); q.focus();
}
