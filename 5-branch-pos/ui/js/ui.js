/** أدوات واجهة صغيرة: بناء عناصر، تنسيق، إشعارات، نوافذ. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (Array.isArray(c)) c.forEach(add); else if (c !== undefined && c !== null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
export const clear = (n) => { while (n.firstChild) n.firstChild.remove(); return n; };
export const num = (n) => new Intl.NumberFormat('ar-EG').format(n ?? 0);
export const egp = (p) => new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format((p ?? 0) / 100);
export const dt = (iso) => (iso ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(iso)) : '—');
export const toPiasters = (v) => Math.round(Number(String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫,]/g, '.')) * 100) || 0;

export function toast(msg, kind = 'ok') {
  const t = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3000);
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const dlg = h('dialog', { class: wide ? 'wide' : '', 'aria-label': title });
  const close = () => { dlg.close(); dlg.remove(); onClose?.(); };
  dlg.append(h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { class: 'btn sm', type: 'button', 'aria-label': 'إغلاق', onclick: close }, '✕')), h('div', { class: 'dlg-body' }, body));
  if (actions.length) dlg.append(h('div', { class: 'dlg-foot' }, actions.map((a) => h('button', { class: `btn ${a.kind ?? ''}`, type: 'button', onclick: async (e) => { if ((await a.onClick?.(e, close)) !== false) close(); } }, a.label))));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg); dlg.showModal();
  return { close, el: dlg };
}

/** يشغّل إجراءً مع تعطيل الزر ومعالجة الخطأ برسالة عربية واضحة. */
export async function run(fn, { ok } = {}) {
  try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message || 'حدث خطأ', 'err'); return undefined; }
}

export const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint && h('small', null, hint));
