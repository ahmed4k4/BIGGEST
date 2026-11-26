import { html, price, num, colorHex, bySize } from '../util.js';
import { state, available, cartAdd, limitFor, LOW_STOCK } from '../store.js';
import { placeholder, tapePicker, imgUrl, emptyState } from '../components.js';

export function productView(id) {
  const model = state.byModel.get(id);
  if (!model) return { title: 'المنتج غير موجود', html: emptyState('هذا المنتج غير متاح', 'ربما نفدت الكمية أو أُوقف عرضه. تصفح بقية المنتجات.', html`<a class="btn" href="#/">عرض المنتجات</a>`) };

  const colors = [...new Map(model.variants.map((v) => [v.colorCode, v.color])).entries()].map(([code, name]) => ({ code, name }));
  const sizes = [...new Map(model.variants.map((v) => [v.sizeCode, v.size])).entries()].map(([code, name]) => ({ code, name })).sort(bySize);
  const variantOf = (c, s) => model.variants.find((v) => v.colorCode === c && v.sizeCode === s);
  const qtyOf = (c, s) => { const v = variantOf(c, s); return v ? available(v.id) : 0; };
  const colorStock = (c) => { let t = 0; let known = false; for (const s of sizes) { const q = qtyOf(c, s.code); if (q != null) { known = true; t += q; } } return known ? t : null; };

  const s = { color: (colors.find((c) => colorStock(c.code) !== 0) ?? colors[0]).code, size: '', qty: 1, img: 0, msg: '' };

  const gallery = () => {
    const color = colors.find((c) => c.code === s.color);
    if (!model.images.length) return html`<div class="gallery"><div class="gmain">${placeholder(model, color.name)}</div></div>`;
    const cur = model.images[s.img] ?? model.images[0];
    return html`<div class="gallery"><div class="gmain"><img src="${imgUrl(cur.full)}" alt="${model.name}" width="800" height="1000" decoding="async" data-fallback></div>
      ${model.images.length > 1 ? html`<div class="gthumbs">${model.images.map((im, i) => html`<button type="button" data-act="img" data-i="${i}" aria-label="الصورة ${num(i + 1)}" aria-current="${i === s.img}"><img src="${imgUrl(im.thumb)}" alt="" loading="lazy" width="72" height="90"></button>`)}</div>` : ''}</div>`;
  };

  const picker = () => {
    const color = colors.find((c) => c.code === s.color);
    const q = s.size ? qtyOf(s.color, s.size) : null;
    const v = s.size ? variantOf(s.color, s.size) : null;
    const max = v ? limitFor(v.id) : 0;
    s.qty = Math.max(1, Math.min(s.qty, max || 1));
    return html`
      <fieldset class="opt"><legend>اللون: <b>${color.name}</b></legend>
        <div class="swatches" role="radiogroup" aria-label="اللون">${colors.map((c) => {
    const st = colorStock(c.code);
    return html`<button type="button" role="radio" class="swatch ${c.code === s.color ? 'on' : ''} ${st === 0 ? 'out' : ''}" style="--c:${colorHex(c.name)}" data-act="color" data-color="${c.code}" data-focus-key="color-${c.code}" aria-checked="${c.code === s.color}" aria-label="${c.name}${st === 0 ? '، نفدت' : ''}"></button>`;
  })}</div></fieldset>
      <fieldset class="opt"><legend>المقاس${s.size ? html`: <b>${sizes.find((x) => x.code === s.size).name}</b>` : ''}</legend>
        ${tapePicker(sizes, s.size, (code) => qtyOf(s.color, code))}
        <p class="hint" id="size-hint" role="status">${!s.size ? 'اختر المقاس من الشريط.' : q === 0 ? 'هذا المقاس غير متاح بهذا اللون.' : q != null && q <= LOW_STOCK ? `متبقي ${num(q)} فقط.` : 'متوفر.'}</p>
      </fieldset>
      <div class="buyrow">
        <div class="stepper" role="group" aria-label="الكمية">
          <button type="button" data-act="qty" data-d="-1" aria-label="أنقص الكمية" ${s.qty <= 1 ? 'disabled' : ''}>−</button>
          <output aria-live="polite">${num(s.qty)}</output>
          <button type="button" data-act="qty" data-d="1" aria-label="زِد الكمية" ${!v || s.qty >= max ? 'disabled' : ''}>+</button>
        </div>
        <button type="button" class="btn primary grow" data-act="add" data-focus-key="add">أضف إلى السلة · ${price(model.price * s.qty)}</button>
      </div>
      <p class="warn" role="alert">${s.msg}</p>`;
  };

  const markup = html`
    <nav class="crumb" aria-label="مسار التنقل"><a href="#/">كل المنتجات</a>${state.catName.get(model.categoryId) ? html` / <a href="#/?cat=${model.categoryId}">${state.catName.get(model.categoryId)}</a>` : ''}</nav>
    <article class="pdp">
      <div id="pv-gallery">${gallery()}</div>
      <div class="pinfo">
        <h1 tabindex="-1" data-title>${model.name}</h1>
        <p class="pprice big">${price(model.price)}</p>
        ${model.description ? html`<p class="desc">${model.description}</p>` : ''}
        <div id="pv-select">${picker()}</div>
        <p class="note">الشحن والدفع نتفق عليهما معك على واتساب بعد استلام الطلب.</p>
      </div>
    </article>`;

  return { title: model.name, html: markup, bind(root) {
    const sel = () => root.querySelector('#pv-select'); const gal = () => root.querySelector('#pv-gallery');
    const paint = (focusKey) => {
      sel().innerHTML = picker().toString(); gal().innerHTML = gallery().toString();
      if (focusKey) sel().querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
    };
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      const act = el.dataset.act;
      if (act === 'color') { s.color = el.dataset.color; s.img = 0; s.msg = ''; if (s.size && qtyOf(s.color, s.size) === 0) s.size = ''; paint(`color-${s.color}`); }
      else if (act === 'size') { if (el.getAttribute('aria-disabled') === 'true') { s.msg = ''; return; } s.size = el.dataset.size; s.msg = ''; paint(`size-${s.size}`); }
      else if (act === 'img') { s.img = Number(el.dataset.i); gal().innerHTML = gallery().toString(); }
      else if (act === 'qty') { s.qty += Number(el.dataset.d); paint(el.dataset.d === '1' ? undefined : undefined); sel().querySelector(`[data-act="qty"][data-d="${el.dataset.d}"]:not([disabled])`)?.focus(); }
      else if (act === 'add') {
        if (!s.size) { s.msg = 'اختر المقاس أولًا.'; paint(); root.querySelector('.tape button')?.focus(); return; }
        const v = variantOf(s.color, s.size);
        if (!v || (available(v.id) ?? 1) <= 0) { s.msg = 'هذا المقاس غير متاح بهذا اللون.'; paint(); return; }
        const r = cartAdd(v.id, s.qty);
        if (!r.ok) { s.msg = 'نفدت الكمية.'; paint(); return; }
        window.dispatchEvent(new CustomEvent('toast', { detail: { text: r.capped ? `أُضيف حتى الحد المتاح (${num(r.qty)}).` : 'أُضيف إلى السلة.', link: '#/cart', linkText: 'عرض السلة' } }));
        s.msg = ''; s.qty = 1; paint('add');
      }
    });
  } };
}
