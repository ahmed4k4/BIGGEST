import { html, raw, price, num, colorHex, bySize } from './util.js';
import { state, available, apiUrl, LOW_STOCK } from './store.js';

const SHAPES = {
  tee: 'M30 14 L43 9 Q50 18 57 9 L70 14 L93 33 L83 49 L72 42 L72 113 L28 113 L28 42 L17 49 L7 33 Z',
  pants: 'M31 8 L69 8 L75 116 L55 116 L50 46 L45 116 L25 116 Z',
  jacket: 'M32 10 L44 6 Q50 15 56 6 L68 10 L95 34 L91 100 L79 100 L72 52 L72 114 L28 114 L28 52 L21 100 L9 100 L5 34 Z',
};
const shapeFor = (catName = '') => (/بنط|جينز|شورت/.test(catName) ? 'pants' : /جاكيت|معطف|سترة/.test(catName) ? 'jacket' : 'tee');

/** صورة بديلة مرسومة بـ SVG عند غياب الصور: قطعة ملابس بلون الصنف المختار. */
export function placeholder(model, colorName) {
  const kind = shapeFor(state.catName.get(model.categoryId));
  const fill = colorHex(colorName ?? model.variants[0]?.color);
  return html`<svg class="ph" viewBox="0 0 100 125" role="img" aria-label="${model.name} (صورة توضيحية)" preserveAspectRatio="xMidYMid meet">
    <path d="${SHAPES[kind]}" fill="${fill}" stroke="rgba(20,33,61,.35)" stroke-width="1" stroke-linejoin="round"/>
    ${kind === 'jacket' ? raw('<path d="M50 15 V113" stroke="rgba(244,245,247,.35)" stroke-width="1" stroke-dasharray="2 2"/>') : ''}
    ${kind === 'tee' ? raw('<path d="M30 108 H70" stroke="rgba(244,245,247,.4)" stroke-width="0.8" stroke-dasharray="2 1.6"/>') : ''}
  </svg>`;
}

export const imgUrl = (u) => (u && u.startsWith('/') ? apiUrl + u : u);

export function modelStock(model) {
  let total = 0; let known = false;
  for (const v of model.variants) { const a = available(v.id); if (a != null) { known = true; total += a; } }
  return known ? total : null;
}

export function productCard(model, i) {
  const stock = modelStock(model);
  const out = stock === 0;
  const sizes = [...new Map(model.variants.map((v) => [v.sizeCode, v.size])).entries()].sort(bySize);
  const colors = [...new Map(model.variants.map((v) => [v.colorCode, v.color])).entries()];
  const anyAvailForSize = (code) => model.variants.some((v) => v.sizeCode === code && (available(v.id) ?? 1) > 0);
  const img = model.images[0];
  const cat = state.catName.get(model.categoryId);
  return html`<a class="pcard ${i === 0 ? 'feature' : ''} ${out ? 'is-out' : ''}" href="#/p/${model.id}" aria-label="${model.name}، ${price(model.price)}${out ? '، نفدت الكمية' : ''}">
    <span class="pimg">${img ? html`<img src="${imgUrl(img.card)}" alt="" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" width="480" height="600" data-fallback>` : placeholder(model)}
      ${out ? html`<span class="badge badge-out">نفدت الكمية</span>` : stock != null && stock <= LOW_STOCK ? html`<span class="badge">آخر قطع</span>` : ''}</span>
    <span class="pbody">
      <span class="pname">${model.name}</span>
      <span class="pprice">${price(model.price)}</span>
      <span class="pmeta">
        <span class="dots" aria-hidden="true">${colors.slice(0, 5).map(([, n]) => html`<i style="background:${colorHex(n)}"></i>`)}${colors.length > 5 ? html`<small>+${num(colors.length - 5)}</small>` : ''}</span>
        <span class="sizes">${sizes.map(([c, n]) => html`<span class="${anyAvailForSize(c) ? '' : 'gone'}">${n}</span>`)}</span>
      </span>
      ${cat && i === 0 ? html`<span class="pcat">${cat}</span>` : ''}
    </span></a>`;
}

/** مسطرة القياس: كل مقاس قطعة من الشريط. المحدد يُقصّ بلون الحبر، وما نفد يُشطب. */
export function tapePicker(sizes, selected, getQty) {
  return html`<div class="tape" role="radiogroup" aria-label="المقاس">${sizes.map((s) => {
    const q = getQty(s.code);
    const out = q === 0; const low = q != null && q > 0 && q <= LOW_STOCK;
    return html`<button type="button" role="radio" class="tape-seg ${selected === s.code ? 'on' : ''} ${out ? 'out' : ''}" data-act="size" data-size="${s.code}" data-focus-key="size-${s.code}" aria-checked="${selected === s.code}" ${out ? 'aria-disabled="true"' : ''}>
      <span class="tape-size">${s.name}</span><span class="tape-note">${out ? 'نفدت' : low ? `آخر ${num(q)}` : ''}</span></button>`;
  })}</div>`;
}

export function emptyState(title, text, action) {
  return html`<div class="empty"><h2 tabindex="-1" data-title>${title}</h2><p>${text}</p>${action ?? ''}</div>`;
}
