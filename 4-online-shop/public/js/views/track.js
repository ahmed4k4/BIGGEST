import { html, normalizeDigits, STATUS_LABELS, PAY_STATUS_LABELS, price } from '../util.js';
import { api, ApiError, kv } from '../store.js';

const STEPS = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered'];
const SHORT = { pending: 'استلام الطلب', confirmed: 'التأكيد', preparing: 'التجهيز', shipped: 'الشحن', delivered: 'التسليم' };

export function trackView(query) {
  let last = null; try { last = JSON.parse(kv.get('shop.lastOrder.v1')); } catch { /* لا يوجد */ }
  const n = query.get('n') ?? last?.number ?? '';
  const tail = last && last.number === n ? String(last.phone).slice(-4) : '';
  const markup = html`
    <h1 tabindex="-1" data-title>تتبّع طلبك</h1>
    <form class="cform narrow" data-form="track" novalidate>
      <div class="field"><label for="t-num">رقم الطلب</label><input id="t-num" name="number" dir="ltr" placeholder="WEB-000001" autocomplete="off" value="${n}"></div>
      <div class="field"><label for="t-ph">آخر 4 أرقام من موبايلك</label><input id="t-ph" name="phone" inputmode="numeric" maxlength="4" dir="ltr" autocomplete="off" value="${tail}"></div>
      <p class="warn" id="t-err" role="alert"></p>
      <button class="btn primary" type="submit">عرض حالة الطلب</button>
    </form>
    <section id="t-result" aria-live="polite"></section>`;
  return { title: 'تتبّع الطلب', html: markup, bind(root) {
    const form = root.querySelector('form'); const out = root.querySelector('#t-result'); const err = root.querySelector('#t-err');
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = ''; out.innerHTML = '';
      const num = normalizeDigits(form.number.value).trim().toUpperCase();
      const ph = normalizeDigits(form.phone.value).replace(/\D/g, '').slice(-4);
      if (!num || ph.length !== 4) { err.textContent = 'اكتب رقم الطلب وآخر 4 أرقام من الموبايل.'; return; }
      try {
        const o = await api(`/public/orders/${encodeURIComponent(num)}?phone=${ph}`);
        const idx = STEPS.indexOf(o.status);
        out.innerHTML = html`<div class="tracked"><p class="onum">${o.number}</p><p class="lead"><b>${STATUS_LABELS[o.status] ?? o.status}</b></p>
          ${idx >= 0 ? html`<ol class="steps">${STEPS.map((s, i) => html`<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}" ${i === idx ? 'aria-current="step"' : ''}>${SHORT[s]}</li>`)}</ol>` : ''}
          <dl><div><dt>الدفع</dt><dd>${PAY_STATUS_LABELS[o.payment_status] ?? o.payment_status}</dd></div><div><dt>الإجمالي</dt><dd>${price(o.total)}</dd></div></dl></div>`.toString();
      } catch (ex) { err.textContent = ex instanceof ApiError && ex.status === 0 ? `${ex.message}. حاول مرة أخرى.` : (ex.message ?? 'تعذّر العثور على الطلب'); }
    });
    if (n && tail) form.requestSubmit();
  } };
}
