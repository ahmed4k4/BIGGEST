import { html, price, num, PAYMENT_LABELS } from '../util.js';
import { state, kv } from '../store.js';

export function waLink(o) {
  const wa = String(state.config.whatsapp ?? '').replace(/\D/g, '');
  if (!wa) return '';
  const items = o.lines.map((l) => `- ${l.name} (${l.color}، ${l.size}) × ${num(l.qty)}`).join('\n');
  const text = `مرحبًا، أنا ${o.name}. أريد تأكيد طلبي رقم ${o.number} من ${state.config.storeName}:\n${items}\nالإجمالي: ${price(o.total)}\nطريقة الدفع: ${PAYMENT_LABELS[o.payment] ?? o.payment}\nالعنوان: ${o.address}، ${o.governorate}`;
  return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
}

export function doneView(number) {
  let o = null; try { o = JSON.parse(kv.get('shop.lastOrder.v1')); } catch { /* لا يوجد */ }
  if (o && o.number !== number) o = null;
  const link = o ? waLink(o) : '';
  const markup = html`
    <div class="done">
      <h1 tabindex="-1" data-title>تم تسجيل طلبك</h1>
      <p class="onum" aria-label="رقم الطلب">${number}</p>
      <p class="lead">طلبك الآن بحالة <b>بانتظار التأكيد</b>. لم يُحجز الدفع بعد، وسيؤكد الموظف معك التفاصيل.</p>
      ${link ? html`<a class="btn primary block wa" href="${link}" target="_blank" rel="noopener">أكّد الطلب عبر واتساب</a>
        <p class="hint">يفتح واتساب برسالة جاهزة فيها رقم الطلب وقطعك. فتح واتساب ليس إثبات دفع.</p>` : html`<p class="hint">سنتواصل معك على رقم الموبايل الذي سجّلته.</p>`}
      ${o ? html`<section class="summary" aria-label="ملخص الطلب"><h2>ملخص الطلب</h2>
        <ul class="mini">${o.lines.map((l) => html`<li><span>${l.name} <small>${l.color} · ${l.size}</small> × ${num(l.qty)}</span><b>${price(l.unit * l.qty)}</b></li>`)}</ul>
        <dl><div><dt>الإجمالي</dt><dd>${price(o.total)}</dd></div><div><dt>الدفع</dt><dd>${PAYMENT_LABELS[o.payment] ?? o.payment}</dd></div><div><dt>التوصيل إلى</dt><dd>${o.address}، ${o.governorate}</dd></div></dl></section>` : ''}
      <p><a class="link" href="#/track?n=${encodeURIComponent(number)}">تتبّع الطلب</a> · <a class="link" href="#/">متابعة التسوق</a></p>
    </div>`;
  return { title: `طلب ${number}`, html: markup };
}
