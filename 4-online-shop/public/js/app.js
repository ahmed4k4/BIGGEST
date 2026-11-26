import { html } from './util.js';
import { state, loadAll, loadAvailability, subscribe, cartCount, captureUtm, ApiError } from './store.js';
import { num } from './util.js';
import { homeView } from './views/home.js';
import { productView } from './views/product.js';
import { cartView } from './views/cart.js';
import { checkoutView } from './views/checkout.js';
import { doneView } from './views/done.js';
import { trackView } from './views/track.js';
import { helpView } from './views/help.js';
import { emptyState } from './components.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
let current = null;      // آخر مسار معروض لإعادة الرسم
let pendingNotices = [];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs), parts: path.split('/').filter(Boolean).map(decodeURIComponent) };
}

function route() {
  const { parts, query } = parseHash();
  const [a, b] = parts;
  if (!a) return homeView(query);
  if (a === 'p' && b) return productView(b);
  if (a === 'cart') { const r = cartView(query, { notices: pendingNotices }); return r; }
  if (a === 'checkout') return checkoutView();
  if (a === 'done' && b) return doneView(b);
  if (a === 'track') return trackView(query);
  if (a === 'help') return helpView();
  return { title: 'الصفحة غير موجودة', html: emptyState('الصفحة غير موجودة', 'ربما تغيّر الرابط.', html`<a class="btn" href="#/">إلى المتجر</a>`) };
}

function render({ focusSel, keepScroll } = {}) {
  const view = route();
  const wrap = document.createElement('div'); wrap.className = 'view';
  wrap.innerHTML = view.html.toString();
  app.replaceChildren(wrap);                 // عنصر جديد لكل عرض: المستمعات القديمة تُهمل مع العنصر القديم
  document.title = view.title === state.config.storeName ? view.title : `${view.title} | ${state.config.storeName}`;
  view.bind?.(wrap);
  wrap.querySelectorAll('img[data-fallback]').forEach((img) => img.addEventListener('error', () => { img.closest('.pimg,.gmain,.cthumb')?.classList.add('noimg'); img.remove(); }, { once: true }));
  current = parseHash().path;
  if (focusSel) wrap.querySelector(focusSel)?.focus();
  else if (!keepScroll) { window.scrollTo(0, 0); wrap.querySelector('[data-title]')?.focus({ preventScroll: true }); }
}

function paintChrome() {
  /* الشعار صورة ثابتة؛ اسم المتجر يظهر في عنوان الصفحة */
  const n = cartCount();
  $('#cartlink').innerHTML = `السلة${n ? ` <b class="pill" aria-label="${num(n)} قطعة">${num(n)}</b>` : ''}`;
  const banners = [];
  if (!navigator.onLine) banners.push('أنت غير متصل بالإنترنت. يمكنك تصفح المنتجات، لكن إتمام الطلب يحتاج اتصالًا.');
  else if (state.stale) banners.push('نعرض آخر نسخة محفوظة من المنتجات لأن الاتصال ضعيف. قد تختلف الكميات.');
  if (state.config.open === false) banners.push('المتجر متوقف مؤقتًا عن استقبال الطلبات. يمكنك التصفح والعودة لاحقًا.');
  $('#banner').innerHTML = banners.map((t) => `<p>${t}</p>`).join('');
  $('#banner').hidden = banners.length === 0;
  const w = String(state.config.whatsapp ?? '').replace(/\D/g, '');
  const f = $('#footwa'); if (f) { f.hidden = !w; f.href = `https://wa.me/${w}`; }
}

function toast({ text, link, linkText }) {
  const t = $('#toast');
  t.innerHTML = '';
  const span = document.createElement('span'); span.textContent = text; t.append(span);
  if (link) { const a = document.createElement('a'); a.href = link; a.textContent = linkText; t.append(a); }
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500);
}

window.addEventListener('toast', (e) => toast(e.detail));
window.addEventListener('rerender', (e) => { if (e.detail?.notices) pendingNotices = e.detail.notices; render({ focusSel: e.detail?.focus, keepScroll: true }); pendingNotices = []; });
window.addEventListener('hashchange', () => { pendingNotices = []; render(); });
window.addEventListener('online', () => { paintChrome(); loadAll().then(() => { paintChrome(); render({ keepScroll: true }); }).catch(() => {}); });
window.addEventListener('offline', paintChrome);
subscribe(paintChrome);
document.addEventListener('submit', (e) => { if (e.target.matches('form[data-form="filter"]')) e.preventDefault(); });

// تحديث التوفر كل دقيقة والصفحة ظاهرة
setInterval(() => { if (!document.hidden && navigator.onLine && ['/', '', 'cart'].includes(parseHash().parts[0] ?? '')) loadAvailability().then(() => render({ keepScroll: true, focusSel: undefined })); }, 60_000);

async function boot() {
  captureUtm();
  paintChrome();
  app.innerHTML = '<p class="loading" role="status">جارٍ تحميل المنتجات…</p>';
  try { await loadAll(); }
  catch (e) {
    app.innerHTML = '';
    app.append(Object.assign(document.createElement('div'), { className: 'view', innerHTML: emptyState('تعذّر تحميل المنتجات', e instanceof ApiError && e.status === 0 ? 'تحقق من اتصالك بالإنترنت ثم أعد المحاولة.' : 'حدث خطأ مؤقت. أعد المحاولة بعد قليل.', html`<button class="btn primary" type="button" id="retry">إعادة المحاولة</button>`).toString() }));
    $('#retry').addEventListener('click', boot);
    return;
  }
  paintChrome();
  render();
}
boot();
