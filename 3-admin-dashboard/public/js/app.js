/** نقطة الدخول: الراوتر (hash) والإطار العام (الشريط العلوي والقائمة الجانبية حسب الدور). */
import { api, session, lsGet, lsSet } from './api.js';
import { can } from './shared/index.js';
import { h, clear, loading, empty, toast, setDigits, digitsMode } from './ui.js';
import { ROLE_LABEL } from './labels.js';
import { renderLogin } from './pages/login.js';

const ANY = (...p) => p;
const NAV = [
  { items: [['#/dashboard', 'لوحة التحكم', ANY('reports.view', 'reports.view.branch'), 'dashboard']] },
  { group: 'المنتجات', items: [['#/models', 'الموديلات', 'models.manage', 'models'], ['#/template', 'قالب الأكواد', 'codes.manage', 'template'], ['#/labels', 'طباعة الملصقات', 'codes.manage', 'labels']] },
  { group: 'المخازن', items: [['#/stock', 'المخزون', ANY('stock.receive', 'stock.count', 'reports.view.stock', 'reports.view', 'reports.view.branch'), 'stock'], ['#/receipts', 'إدخال بضاعة', 'stock.receive', 'receipts'], ['#/transfers', 'التوزيع والتحويلات', ANY('stock.transfer', 'stock.transfer.receive'), 'transfers']] },
  { group: 'المبيعات', items: [['#/invoices', 'الفواتير', ANY('sales.view', 'reports.view', 'reports.view.branch'), 'invoices'], ['#/orders', 'الطلبات الإلكترونية', 'orders.manage', 'orders'], ['#/customers', 'العملاء', 'customers.view', 'customers']] },
  { group: 'الفريق والحسابات', items: [['#/attendance', 'الحضور والانصراف', ANY('attendance.manage', 'attendance.manage.branch'), 'attendance'], ['#/users', 'المستخدمون', 'users.manage', 'users'], ['#/finance', 'الخزائن والمصروفات', 'finance.view', 'finance']] },
  { group: 'النظام', items: [['#/branches', 'الفروع والأجهزة', ANY('devices.manage', 'settings.manage'), 'branches'], ['#/settings', 'الإعدادات', 'settings.manage', 'settings'], ['#/grants', 'التصاريح', 'grants.request', 'grants'], ['#/audit', 'سجل النشاط', 'audit.view', 'audit'], ['#/usage', 'استهلاك الخدمات', 'super', 'usage']] },
];
const allowed = (user, perm) => (perm === 'super' ? user.role === 'super_admin' : [].concat(perm).some((p) => can(user.role, p)));
const ROUTES = [
  ['models/:id', 'model-detail', 'models.manage'], ['labels', 'labels', 'codes.manage'],
  ...NAV.flatMap((g) => g.items.map(([href, , perm, mod]) => [href.slice(2), mod, perm])),
];
const compile = (p) => { const keys = []; const re = new RegExp('^' + p.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); return { re, keys }; };

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { path: path.replace(/\/$/, ''), query: Object.fromEntries(new URLSearchParams(qs ?? '')) };
}

let navEl; let mainEl;
function shell(user) {
  const app = document.getElementById('app'); clear(app);
  const themeBtn = h('button', { type: 'button', 'aria-label': 'تبديل المظهر', onclick: () => { const cur = document.documentElement.dataset.theme; const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; lsSet('erp.theme', next); } }, 'المظهر');
  const digitsBtn = h('button', { type: 'button', 'aria-label': 'تبديل شكل الأرقام', onclick: () => { setDigits(digitsMode() === 'ar' ? 'en' : 'ar'); route(); } }, '١٢٣ / 123');
  const menuBtn = h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'القائمة', onclick: () => navEl.classList.toggle('open') }, '☰');
  navEl = h('nav', { class: 'nav', 'aria-label': 'القائمة الرئيسية' });
  mainEl = h('main', { id: 'main', tabindex: '-1' });
  app.append(
    h('header', { class: 'topbar' }, menuBtn, h('div', { class: 'brand' }, h('img', { class: 'brand-logo', src: 'assets/logo-white.png', alt: 'BIGGEST' }), h('span', { class: 'brand-sub' }, 'لوحة الإدارة')), h('span', { class: 'spacer' }),
      h('span', { class: 'who' }, `${user.name} · ${ROLE_LABEL[user.role] ?? user.role}`), digitsBtn, themeBtn,
      h('button', { type: 'button', onclick: logout }, 'تسجيل الخروج')),
    h('div', { class: 'tape tape-row', 'aria-hidden': 'true' }), navEl, mainEl);
  for (const g of NAV) {
    const items = g.items.filter(([, , perm]) => allowed(user, perm));
    if (!items.length) continue;
    if (g.group) navEl.append(h('div', { class: 'group' }, g.group));
    items.forEach(([href, label]) => navEl.append(h('a', { href }, label)));
  }
  navEl.addEventListener('click', (e) => { if (e.target.tagName === 'A') navEl.classList.remove('open'); });
}

export function logout() { session.clear(); location.hash = '#/login'; start(); }

async function route() {
  const user = session.user;
  if (!user || !session.token) { renderLogin(() => { location.hash = ''; start(); }); return; }
  if (!mainEl || !document.body.contains(mainEl)) shell(user);
  const { path, query } = parseHash();
  if (path === '' || path === 'login') { const first = NAV.flatMap((g) => g.items).find(([, , perm]) => allowed(user, perm)); location.hash = first ? first[0] : '#/none'; return; }
  let hit = null;
  for (const [p, mod, perm] of ROUTES) { const c = compile(p); const m = c.re.exec(path); if (m) { hit = { mod, perm, params: Object.fromEntries(c.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; } }
  navEl.querySelectorAll('a').forEach((a) => { const on = path === a.getAttribute('href').slice(2) || path.startsWith(a.getAttribute('href').slice(2) + '/'); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  clear(mainEl);
  if (!hit) { mainEl.append(empty('الصفحة غير موجودة', 'اختر صفحة من القائمة الجانبية.')); return; }
  if (!allowed(user, hit.perm)) { mainEl.append(empty('ليست لديك صلاحية لهذه الصفحة', 'اطلب من الأدمن تعديل دورك إن كنت تحتاجها.')); return; }
  const token = (route.n = (route.n ?? 0) + 1);
  mainEl.append(loading());
  try {
    const mod = await import(`./pages/${hit.mod}.js`);
    const node = await mod.default({ params: hit.params, query: query, user });
    if (token !== route.n) return;
    clear(mainEl); mainEl.append(node); document.title = `${node.dataset?.title ?? ''} · لوحة إدارة المحل`.replace(/^ · /, '');
    mainEl.focus({ preventScroll: true });
  } catch (e) {
    if (token !== route.n) return;
    clear(mainEl);
    mainEl.append(h('div', { class: 'notice err' }, h('b', null, 'تعذّر تحميل الصفحة. '), e.message || ''), h('button', { class: 'btn', onclick: route }, 'إعادة المحاولة'));
    if (!e.status) console.error(e);
  }
}

function start() {
  const theme = lsGet('erp.theme'); if (theme) document.documentElement.dataset.theme = theme;
  mainEl = null; route();
}
window.addEventListener('hashchange', route);
window.addEventListener('erp:logout', () => { toast('انتهت الجلسة. سجّل الدخول من جديد', 'err'); mainEl = null; route(); });
start();
