/** أدوات الواجهة: بناء العناصر، الإشعارات، النوافذ، التنسيق، وتنفيذ الإجراءات بمعالجة موحّدة للأخطاء والتصاريح. */
import { api, ApiError, lsGet, lsSet } from './api.js';
import { GRANT_STATUS } from './labels.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'indeterminate') el[k] = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (Array.isArray(c)) c.forEach(add); else if (c !== undefined && c !== null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
export const clear = (n) => { while (n.firstChild) n.firstChild.remove(); return n; };

// ───── تنسيق ─────
let _digits = lsGet('erp.digits', 'ar');
export const digitsMode = () => _digits;
export const setDigits = (m) => { _digits = m; lsSet('erp.digits', m); };
const loc = () => (_digits === 'ar' ? 'ar-EG' : 'en-US');
export const num = (n) => new Intl.NumberFormat(loc()).format(n ?? 0);
export const egp = (p) => new Intl.NumberFormat(loc(), { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format((p ?? 0) / 100);
export const dt = (iso) => (iso ? new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(iso)) : '—');
export const dOnly = (iso) => (iso ? new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeZone: 'Africa/Cairo' }).format(new Date(iso)) : '—');
export const toPiastersInput = (v) => Math.round(Number(String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.')) * 100);
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
export const monthStart = () => today().slice(0, 8) + '01';

// ───── إشعارات ─────
export function toast(msg, kind = 'ok') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}

// ───── نوافذ ─────
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const dlg = h('dialog', { class: wide ? 'wide' : '', 'aria-labelledby': 'dlg-title' });
  const close = () => { dlg.close(); dlg.remove(); onClose?.(); };
  dlg.append(
    h('div', { class: 'dlg-head' }, h('h2', { id: 'dlg-title' }, title), h('button', { class: 'btn sm', type: 'button', 'aria-label': 'إغلاق', onclick: close }, '✕')),
    h('div', { class: 'dlg-body' }, body),
  );
  if (actions.length) dlg.append(h('div', { class: 'dlg-foot' }, actions.map((a) => h('button', { class: `btn ${a.kind ?? ''}`, type: 'button', onclick: async (e) => { if (a.keepOpen) return a.onClick(e, close); if ((await a.onClick?.(e, close)) !== false) close(); } }, a.label))));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg); dlg.showModal();
  return { close, el: dlg };
}
export const confirmDialog = (message, okLabel = 'تأكيد', kind = 'primary') => new Promise((resolve) => {
  let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
  modal({ title: 'تأكيد العملية', body: h('p', null, message), onClose: () => fin(false),
    actions: [{ label: okLabel, kind, onClick: () => { fin(true); } }, { label: 'إلغاء', onClick: () => { fin(false); } }] });
});

// ───── تنفيذ إجراء بمعالجة الأخطاء والتصاريح ─────
export async function run(fn, { btn, ok, retry } = {}) {
  if (btn) { btn.disabled = true; btn.dataset.txt = btn.textContent; }
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'NEEDS_GRANT') grantDialog(e.feature, e.message, retry ?? (() => run(fn, { btn, ok })));
    else toast(e.message || 'حدث خطأ غير متوقع', 'err');
    return undefined;
  } finally { if (btn) btn.disabled = false; }
}
/** يُربط بزر: يعطّله أثناء التنفيذ ويعرض أخطاء الـ API. */
export const act = (fn, ok) => (e) => run(fn, { btn: e.currentTarget, ok });

import { GATE_LABEL } from './labels.js';
export function grantDialog(feature, message, retry) {
  const reason = h('textarea', { id: 'g-reason', placeholder: 'اكتب سبب الطلب باختصار (3 أحرف على الأقل)' });
  modal({
    title: 'هذه العملية تحتاج تصريحًا',
    body: h('div', { class: 'stack' },
      h('div', { class: 'notice' }, message || 'اطلب تصريحًا من السوبر أدمن ثم أعد المحاولة.'),
      h('p', null, 'العملية: ', h('b', null, GATE_LABEL[feature] ?? feature)),
      h('div', { class: 'field' }, h('label', { for: 'g-reason' }, 'سبب الطلب'), reason),
      h('p', { class: 'muted' }, 'التصريح يُستخدم مرة واحدة وينتهي بعد مدة يحددها السوبر أدمن. بعد الموافقة أعد المحاولة.')),
    actions: [
      { label: 'إرسال طلب التصريح', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/grants', { feature, reason: reason.value }); close(); }, { btn: e.currentTarget, ok: 'أُرسل الطلب. بانتظار موافقة السوبر أدمن' }); } },
      { label: 'إغلاق' },
    ],
  });
}

// ───── مكوّنات عرض ─────
export const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
export const loading = (t = 'جارٍ التحميل…') => h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' ', t);
export const empty = (title, hint, action) => h('div', { class: 'empty' }, h('strong', null, title), hint && h('div', null, hint), action && h('div', { style: 'margin-top:12px' }, action));
export function field(label, input, hint) {
  const id = input.id || `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('span', { class: 'hint' }, hint));
}
export const inp = (props = {}) => h('input', props);
export const sel = (options, value, props = {}) => h('select', props, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));

/** columns: [{h:'العنوان', c:(row)=>node|text, cls:'num'}] */
export function table(columns, rows, emptyNode) {
  if (!rows?.length) return emptyNode ?? empty('لا توجد بيانات');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col' }, c.h)))),
    h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => h('td', { class: c.cls ?? '' }, c.c(r))))))));
}
export const pageHead = (title, ...actions) => h('div', { class: 'page-head' }, h('h1', null, title), actions);
export const grantBadge = (s) => badge(GRANT_STATUS[s] ?? s, s === 'approved' ? 'ok' : s === 'pending' ? 'warn' : s === 'rejected' ? 'err' : '');

/** منتقي مواقع/فروع مشترك */
export async function branchOptions(filter = () => true, withAll = false) {
  const bs = (await api.get('/branches')).filter((b) => b.is_active && filter(b));
  return { list: bs, opts: [...(withAll ? [['', 'كل المواقع']] : []), ...bs.map((b) => [b.id, b.name])] };
}

/** هيكل صفحة موحّد: العنوان + إجراءات + المحتوى. data-title يُستخدم لعنوان التبويب. */
export const page = (title, actions, ...kids) => h('div', { 'data-title': title }, pageHead(title, actions), h('div', { class: 'stack' }, kids));
export const bar = (value, max, color = 'var(--green)') => h('div', { class: 'bars', role: 'img', 'aria-label': `${Math.round((value / (max || 1)) * 100)}%` }, h('span', { style: `width:${Math.min(100, (value / (max || 1)) * 100)}%;background:${color}` }));
