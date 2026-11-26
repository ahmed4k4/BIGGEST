import { get, post, setToken, hasToken } from './api.js';
import { h, clear, run, field, toast, egp, num } from './ui.js';
import { sellView } from './views/sell.js';
import { invoicesView } from './views/invoices.js';
import { stockView } from './views/stock.js';
import { shiftView } from './views/shift.js';
import { settingsView } from './views/settings.js';

const TABS = [['sell', 'البيع', sellView], ['invoices', 'الفواتير والمرتجع', invoicesView], ['stock', 'الجرد والتحويلات', stockView], ['shift', 'الوردية والحضور', shiftView], ['settings', 'الإعدادات', settingsView]];
export const ctx = { user: null, shift: null, status: null, summary: null, settings: {}, tab: 'sell' };
const app = document.getElementById('app');

export async function refreshMe() { const me = await get('/local/me'); Object.assign(ctx, me); return me; }
async function refreshStatus() { try { ctx.status = await get('/local/status'); } catch { ctx.status = null; } paintStatus(); }

function paintStatus() {
  const el = document.getElementById('status-chip'); if (!el) return;
  const s = ctx.status;
  el.className = `chip ${s?.online === false ? 'off' : 'on'}`;
  el.textContent = !s ? 'الخادم المحلي لا يستجيب' : `${s.online === false ? 'بدون إنترنت' : 'متصل'}${s.pending ? ` • ${num(s.pending)} بانتظار الرفع` : ''}${s.failed ? ` • ${num(s.failed)} فشل` : ''}`;
}

function shell() {
  clear(app);
  const nav = h('nav', { 'aria-label': 'الأقسام' }, TABS.map(([id, label]) => h('a', { role: 'link', tabindex: 0, 'aria-current': ctx.tab === id ? 'page' : undefined, onclick: () => { ctx.tab = id; shell(); } }, label)));
  app.append(
    h('header', { class: 'top' }, h('div', { class: 'brand' }, h('img', { class: 'brand-logo', src: 'assets/logo-white.png', alt: 'BIGGEST' }), h('span', { class: 'brand-sub' }, ctx.status?.branch?.name ?? 'كاشير الفرع')), nav, h('span', { id: 'status-chip', class: 'chip' }), h('span', { class: 'chip' }, ctx.user.name),
      h('button', { class: 'btn sm', onclick: async () => { await post('/local/logout').catch(() => {}); setToken(null); boot(); } }, 'خروج')),
    h('div', { class: 'tape', 'aria-hidden': 'true' }),
    h('main', { id: 'view' }));
  paintStatus();
  const view = TABS.find(([id]) => id === ctx.tab)[2];
  run(() => view(document.getElementById('view'), ctx));
}

const logoBlock = () => h('div', { class: 'login-brand' }, h('img', { src: 'assets/logo-black.png', alt: 'BIGGEST Fashion Collection Men\'s Wear', class: 'logo-on-light' }), h('img', { src: 'assets/logo-white.png', alt: '', class: 'logo-on-dark', 'aria-hidden': 'true' }));

function activation() {
  clear(app);
  const url = h('input', { class: 'ltr', placeholder: 'https://your-api.workers.dev', value: '' });
  const tok = h('input', { class: 'ltr', placeholder: 'توكن الجهاز (id.secret)' });
  app.append(h('div', { class: 'login' }, h('div', { class: 'card' }, logoBlock(), h('h1', null, 'تفعيل جهاز الفرع'),
    h('p', { class: 'muted' }, 'من لوحة الإدارة ← الأجهزة، أنشئ جهازًا لهذا الفرع وانسخ التوكن (يظهر مرة واحدة).'),
    field('رابط السحابة', url), field('توكن الجهاز', tok),
    h('button', { class: 'btn primary big', onclick: (e) => { e.target.disabled = true; run(async () => { await post('/local/activate', { cloudUrl: url.value.trim(), deviceToken: tok.value.trim() }); toast('تم التفعيل وتنزيل البيانات'); boot(); }).finally(() => { e.target.disabled = false; }); } }, 'تفعيل'))));
}

function loginScreen() {
  clear(app);
  const u = h('input', { autocomplete: 'username', autofocus: true }); const p = h('input', { type: 'password', autocomplete: 'current-password' });
  const go = () => run(async () => { const r = await post('/local/login', { username: u.value.trim(), password: p.value }); setToken(r.token); await boot(); });
  p.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  app.append(h('div', { class: 'login' }, h('div', { class: 'tape', 'aria-hidden': 'true' }), h('div', { class: 'card' }, logoBlock(), h('h1', null, ctx.status?.branch?.name ?? 'كاشير الفرع'),
    ctx.status?.online === false && h('div', { class: 'banner' }, 'لا يوجد إنترنت: الدخول والبيع يعملان بشكل طبيعي وستُرفع الفواتير لاحقًا.'),
    field('اسم المستخدم', u), field('كلمة السر', p), h('button', { class: 'btn primary big', onclick: go }, 'دخول'))));
}

export async function boot() {
  await refreshStatus();
  if (!ctx.status) { clear(app); app.append(h('div', { class: 'login' }, h('div', { class: 'banner err' }, 'تعذّر الوصول لتطبيق الفرع. شغّله ثم أعد تحميل الصفحة.'))); return; }
  if (!ctx.status.configured) return activation();
  if (!ctx.status.ready) { clear(app); app.append(h('div', { class: 'login' }, h('div', { class: 'banner' }, 'جارٍ تنزيل بيانات الفرع لأول مرة، يلزم إنترنت…'))); await post('/local/sync').catch(() => {}); return setTimeout(boot, 3000); }
  if (!hasToken()) return loginScreen();
  try { await refreshMe(); } catch { return loginScreen(); }
  shell();
}

setInterval(refreshStatus, 10_000);
document.addEventListener('keydown', (e) => { if (e.key === 'F2') { document.getElementById('q')?.focus(); e.preventDefault(); } });
boot();
