import { html, price, num, colorHex } from '../util.js';
import { state, cartLines, cartTotal, cartSet, cartRemove, loadAvailability, available, LOW_STOCK } from '../store.js';
import { placeholder, imgUrl, emptyState } from '../components.js';

const line = (l) => {
  const img = l.model.images[0]; const a = available(l.vid);
  return html`<li class="cline">
    <a class="cthumb" href="#/p/${l.model.id}" aria-hidden="true" tabindex="-1">${img ? html`<img src="${imgUrl(img.thumb)}" alt="" width="72" height="90" loading="lazy" data-fallback>` : placeholder(l.model, l.variant.color)}</a>
    <div class="cinfo">
      <a class="cname" href="#/p/${l.model.id}">${l.model.name}</a>
      <p class="cvar"><i class="sw" style="background:${colorHex(l.variant.color)}"></i>${l.variant.color} · ${l.variant.size}</p>
      ${a != null && a <= LOW_STOCK ? html`<p class="low">متبقي ${num(a)} فقط</p>` : ''}
      <div class="cctl">
        <div class="stepper sm" role="group" aria-label="الكمية">
          <button type="button" data-act="cqty" data-v="${l.vid}" data-d="-1" aria-label="أنقص الكمية">−</button>
          <output>${num(l.qty)}</output>
          <button type="button" data-act="cqty" data-v="${l.vid}" data-d="1" aria-label="زِد الكمية" ${a != null && l.qty >= Math.min(20, a) ? 'disabled' : ''}>+</button>
        </div>
        <button type="button" class="link danger" data-act="cdel" data-v="${l.vid}">حذف</button>
      </div>
    </div>
    <p class="ctotal">${price(l.total)}</p></li>`;
};

export function cartView(_q, { notices = [] } = {}) {
  const lines = cartLines();
  if (!lines.length) return { title: 'السلة', html: emptyState('السلة فارغة', 'اختر قطعة ومقاسها ثم أضفها إلى السلة.', html`<a class="btn primary" href="#/">تصفح المنتجات</a>`) };
  const ship = Number(state.config.shipping) || 0;
  const markup = html`
    <h1 tabindex="-1" data-title>السلة</h1>
    ${notices.length ? html`<div class="notice" role="alert"><b>تغيّر التوفر</b><ul>${notices.map((n) => html`<li>${n}</li>`)}</ul></div>` : ''}
    <div class="cartwrap">
      <ul class="clines">${lines.map(line)}</ul>
      <aside class="csum" aria-label="ملخص الطلب">
        <dl><div><dt>المجموع</dt><dd>${price(cartTotal())}</dd></div>
        <div><dt>الشحن</dt><dd>${ship > 0 ? `${price(ship)} (تُضاف عند التسليم)` : 'يُحدَّد عند التأكيد'}</dd></div></dl>
        ${state.config.open === false ? html`<p class="warn">المتجر متوقف مؤقتًا عن استقبال الطلبات. يمكنك الاحتفاظ بالسلة والعودة لاحقًا.</p>`
    : html`<a class="btn primary block" href="#/checkout">إتمام الطلب</a>`}
        <a class="link" href="#/">متابعة التسوق</a>
      </aside>
    </div>`;
  return { title: 'السلة', html: markup, bind(root) {
    root.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      if (el.dataset.act === 'cqty') { const cur = cartLines().find((l) => l.vid === el.dataset.v); cartSet(el.dataset.v, cur.qty + Number(el.dataset.d)); }
      else if (el.dataset.act === 'cdel') cartRemove(el.dataset.v);
      else return;
      window.dispatchEvent(new CustomEvent('rerender', { detail: { focus: `[data-v="${el.dataset.v}"][data-act="${el.dataset.act}"]` } }));
    });
    loadAvailability().then((changes) => { if (changes.length) window.dispatchEvent(new CustomEvent('rerender', { detail: { notices: changes } })); });
  } };
}
