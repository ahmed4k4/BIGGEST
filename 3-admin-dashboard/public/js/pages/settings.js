import { api } from '../api.js';
import { SETTING_META, GATE_LABEL, LEVEL_LABEL, SITE_MODE_LABEL } from '../labels.js';
import { h, page, field, inp, sel, badge, table, empty, run, act, modal, dt, toast, clear, confirmDialog } from '../ui.js';

export default async function ({ user }) {
  let data = await api.get('/settings');
  const branches = await api.get('/branches');
  const isSuper = user.role === 'super_admin';
  const lvl = (k) => badge(LEVEL_LABEL[data.levels[k] ?? 'free'], data.levels[k] ?? 'free');

  function control(key, meta, value) {
    if (meta.type === 'bool') return inp({ type: 'checkbox', checked: !!value });
    if (meta.type === 'select') return sel(Object.entries(meta.options), value);
    if (meta.type === 'json') return h('textarea', { class: 'ltr', style: 'min-height:110px;width:100%' }, JSON.stringify(value ?? null, null, 2));
    return inp({ type: meta.type === 'number' ? 'number' : 'text', value: value ?? '' });
  }
  const read = (meta, el) => (meta.type === 'bool' ? el.checked : meta.type === 'number' || meta.type === 'select' ? Number(el.value) : meta.type === 'json' ? JSON.parse(el.value) : el.value);

  async function history(key) {
    const rows = await api.get(`/settings/${encodeURIComponent(key)}/history`);
    modal({ title: `سجل تغييرات: ${SETTING_META[key]?.label ?? key}`, wide: true, body: table([{ h: 'النسخة', c: (r) => r.version, cls: 'num' }, { h: 'القيمة', c: (r) => h('code', { class: 'ltr' }, JSON.stringify(r.value).slice(0, 80)) }, { h: 'التاريخ', c: (r) => dt(r.changed_at) },
      { h: '', cls: 'actions', c: (r) => h('button', { class: 'btn sm', onclick: async (e) => { if (await confirmDialog(`استرجاع النسخة ${r.version}؟`, 'استرجاع')) await run(async () => { await api.post(`/settings/${encodeURIComponent(key)}/restore`, { version: r.version }); location.reload(); }, { ok: 'تم الاسترجاع' }); } }, 'استرجاع هذه النسخة') }], rows, empty('لا توجد تغييرات مسجّلة بعد')), actions: [{ label: 'إغلاق' }] });
  }

  const groups = {};
  for (const [key, meta] of Object.entries(SETTING_META)) (groups[meta.group] ??= []).push([key, meta]);
  const sections = Object.entries(groups).map(([g, items]) => h('section', { class: 'panel' }, h('h2', null, g),
    h('div', { class: 'stack' }, items.map(([key, meta]) => {
      const el = control(key, meta, data.settings[key]);
      const saveBtn = h('button', { class: 'btn sm primary', onclick: (e) => run(async () => { let v; try { v = read(meta, el); } catch { throw new Error('القيمة ليست JSON صحيحًا'); } await api.put(`/settings/${encodeURIComponent(key)}`, { value: v }); }, { btn: e.currentTarget, ok: 'تم حفظ الإعداد' }) }, 'حفظ');
      return h('div', { class: 'form-row' }, meta.type === 'bool' ? h('label', { class: 'check', style: 'flex:1;min-width:240px' }, el, meta.label) : h('div', { style: 'flex:1;min-width:240px' }, field(meta.label, el, meta.hint)),
        lvl(key), saveBtn, h('button', { class: 'btn sm', onclick: () => run(() => history(key)) }, 'السجل'));
    }))));

  // إيقاف الطوارئ
  const kill = (key, label, on) => h('label', { class: 'check' }, inp({ type: 'checkbox', checked: on, onchange: (e) => run(async () => { await api.put(`/settings/${key}`, { value: e.target.checked }); }, { ok: e.target.checked ? 'تم الإيقاف' : 'تم التشغيل' }) }), label);
  const emergency = h('section', { class: 'panel' }, h('h2', null, 'إيقاف طارئ'), h('p', { class: 'muted' }, 'إيقاف المتجر أو مزامنة فرع بعينه فورًا (مثلًا عند فقد جهاز). يمكن إعادة تشغيله في أي وقت.'),
    h('div', { class: 'stack' }, kill('kill.shop', 'إيقاف استقبال طلبات المتجر الإلكتروني', data.settings['kill.shop'] === true), branches.filter((b) => b.kind === 'branch').map((b) => kill(`kill.branch.${b.id}`, `إيقاف مزامنة فرع ${b.name}`, data.settings[`kill.branch.${b.id}`] === true))));

  // مستويات العمليات الحساسة
  const levels = h('section', { class: 'panel' }, h('h2', null, 'مستوى كل عملية حساسة'),
    h('p', { class: 'muted' }, 'حر: ينفذه من لديه الصلاحية. بتصريح: يحتاج موافقة السوبر أدمن لمرة واحدة. سوبر أدمن فقط: لا يمنح لغيره.'),
    table([{ h: 'العملية', c: (k) => GATE_LABEL[k] ?? k }, { h: 'المستوى الحالي', c: (k) => lvl(k) }, isSuper && { h: 'تغيير المستوى', c: (k) => sel(Object.entries(LEVEL_LABEL), data.levels[k], { 'aria-label': `مستوى ${GATE_LABEL[k]}`, onchange: (e) => run(async () => { await api.put(`/settings-levels/${encodeURIComponent(k)}`, { level: e.target.value }); data.levels[k] = e.target.value; }, { ok: 'تم تغيير المستوى' }) }) }].filter(Boolean), Object.keys(GATE_LABEL)));

  return page('الإعدادات', null, ...sections, emergency, levels);
}
