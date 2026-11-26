import { html, raw, normalizeDigits, debounce, num, colorHex, bySize } from '../util.js';
import { state, available } from '../store.js';
import { productCard, modelStock, emptyState } from '../components.js';

const norm = (s) => normalizeDigits(String(s ?? '')).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

function readQuery(q) {
  return { q: q.get('q') ?? '', cat: q.get('cat') ?? '', size: q.get('size') ?? '', color: q.get('color') ?? '', sort: q.get('sort') ?? '', stock: q.get('stock') === '1' };
}

export function filterModels(f) {
  const needle = norm(f.q).trim();
  let list = state.models.filter((m) => {
    if (f.cat && m.categoryId !== f.cat) return false;
    if (f.size && !m.variants.some((v) => v.sizeCode === f.size && (available(v.id) ?? 1) > 0)) return false;
    if (f.color && !m.variants.some((v) => v.colorCode === f.color && (available(v.id) ?? 1) > 0)) return false;
    if (f.stock && modelStock(m) === 0) return false;
    if (needle) {
      const hay = norm([m.name, m.code, state.catName.get(m.categoryId), ...new Set(m.variants.map((v) => v.color))].join(' '));
      if (!needle.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  list = list.map((m, i) => ({ m, i, out: modelStock(m) === 0 }));
  list.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;                       // نفد → آخر القائمة
    if (f.sort === 'low') return a.m.price - b.m.price || a.i - b.i;
    if (f.sort === 'high') return b.m.price - a.m.price || a.i - b.i;
    return a.i - b.i;
  });
  return list.map((x) => x.m);
}

function gridHtml(f) {
  const list = filterModels(f);
  if (!state.models.length) return emptyState('لا توجد منتجات معروضة الآن', 'نضيف قطعًا جديدة باستمرار. عُد لاحقًا أو راسلنا على واتساب لنخبرك عند وصولها.');
  if (!list.length) return emptyState('لا توجد نتيجة لهذا البحث', 'جرّب كلمة أقصر أو أزل بعض عوامل التصفية.', html`<a class="btn" href="#/">عرض كل المنتجات</a>`);
  return html`<p class="count" role="status">${num(list.length)} ${list.length === 1 ? 'منتج' : 'منتجات'}</p><div class="grid">${list.map((m, i) => productCard(m, i))}</div>`;
}

export function homeView(query) {
  const f = readQuery(query);
  const sizes = [...new Map(state.models.flatMap((m) => m.variants).map((v) => [v.sizeCode, v.size])).entries()].sort(bySize);
  const colors = [...new Map(state.models.flatMap((m) => m.variants).map((v) => [v.colorCode, v.color])).entries()];
  const active = [f.size, f.color, f.sort, f.stock].filter(Boolean).length;
  const markup = html`
    <h1 class="sr-only" tabindex="-1" data-title>${state.config.storeName}: المنتجات</h1>
    <form class="finder" role="search" data-form="filter" novalidate>
      <label class="sr-only" for="q">ابحث عن منتج</label>
      <input id="q" name="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="ابحث بالاسم أو اللون أو الكود" value="${f.q}">
      ${state.categories.length ? html`<nav class="cats" aria-label="التصنيفات">
        <a href="#/${f.q ? `?q=${encodeURIComponent(f.q)}` : ''}" class="${f.cat ? '' : 'on'}" data-cat="">الكل</a>
        ${state.categories.map((c) => html`<a href="#/?cat=${c.id}" data-cat="${c.id}" class="${f.cat === c.id ? 'on' : ''}">${c.name}</a>`)}
      </nav>` : ''}
      <details class="more" ${active ? 'open' : ''}>
        <summary>تصفية وترتيب${active ? html` <b class="pill">${num(active)}</b>` : ''}</summary>
        <div class="more-body">
          <fieldset><legend>المقاس</legend><div class="chips">${sizes.map(([c, n]) => html`<label class="chip"><input type="radio" name="size" value="${c}" ${f.size === c ? 'checked' : ''}><span>${n}</span></label>`)}
            <label class="chip"><input type="radio" name="size" value="" ${f.size ? '' : 'checked'}><span>أي مقاس</span></label></div></fieldset>
          <fieldset><legend>اللون</legend><div class="chips">${colors.map(([c, n]) => html`<label class="chip"><input type="radio" name="color" value="${c}" ${f.color === c ? 'checked' : ''}><span><i class="sw" style="background:${colorHex(n)}"></i>${n}</span></label>`)}
            <label class="chip"><input type="radio" name="color" value="" ${f.color ? '' : 'checked'}><span>أي لون</span></label></div></fieldset>
          <label class="field-inline">ترتيب
            <select name="sort"><option value="">الافتراضي</option><option value="low" ${f.sort === 'low' ? 'selected' : ''}>الأقل سعرًا</option><option value="high" ${f.sort === 'high' ? 'selected' : ''}>الأعلى سعرًا</option></select></label>
          <label class="check"><input type="checkbox" name="stock" value="1" ${f.stock ? 'checked' : ''}> المتاح فقط</label>
          <a class="link" href="#/">مسح التصفية</a>
        </div>
      </details>
    </form>
    <section id="grid" aria-live="polite">${gridHtml(f)}</section>`;
  return { title: state.config.storeName, html: markup, bind(root) {
    const form = root.querySelector('form.finder');
    const apply = () => {
      const fd = new FormData(form); const p = new URLSearchParams();
      for (const k of ['q', 'size', 'color', 'sort', 'stock']) if (fd.get(k)) p.set(k, fd.get(k));
      const cat = root.querySelector('.cats a.on')?.dataset.cat; if (cat) p.set('cat', cat);
      history.replaceState(null, '', `#/${p.toString() ? `?${p}` : ''}`);
      const nf = readQuery(p);
      root.querySelector('#grid').innerHTML = gridHtml(nf).toString();
      const n = [nf.size, nf.color, nf.sort, nf.stock].filter(Boolean).length;
      root.querySelector('summary').innerHTML = `تصفية وترتيب${n ? ` <b class="pill">${num(n)}</b>` : ''}`;
    };
    const typed = debounce(apply, 150);
    form.addEventListener('input', (e) => (e.target.name === 'q' ? typed() : apply()));
    form.addEventListener('change', apply);
    root.querySelector('.cats')?.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-cat]'); if (!a) return; e.preventDefault();
      root.querySelectorAll('.cats a').forEach((x) => x.classList.toggle('on', x === a));
      apply();
    });
  } };
}
