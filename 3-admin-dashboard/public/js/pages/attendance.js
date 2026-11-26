import { api } from '../api.js';
import { can } from '../shared/index.js';
import { ACTION_LABEL, COLOR_LABEL, WEEKDAYS, ROLE_LABEL } from '../labels.js';
import { h, page, field, inp, sel, badge, table, empty, run, modal, dt, num, clear, branchOptions } from '../ui.js';

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
const dot = (c) => h('span', { class: `dot ${c}`, 'aria-hidden': 'true' });

export default async function ({ user }) {
  const [{ list: branches, opts }, users] = await Promise.all([branchOptions((b) => b.kind === 'branch'), api.get('/users').catch(() => [])]);
  const uname = (id) => users.find((u) => u.id === id)?.display_name ?? '—';
  const tabs = [['summary', 'ملخص الشهر'], ['shifts', 'الورديات'], ['schedule', 'جداول المواعيد']]; let cur = 'summary';
  const body = h('div'); const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const monthIn = inp({ type: 'month', value: new Date().toISOString().slice(0, 7) });
  const branchSel = sel([['', 'كل الفروع'], ...opts], user.role === 'branch_manager' ? user.branchId : '', { disabled: user.role === 'branch_manager' });

  async function summary() {
    const d = await api.get('/attendance', { month: monthIn.value, branch: branchSel.value });
    const th = d.rules.thresholds;
    const evs = d.events.filter((e) => !e.corrects_event_id).slice(-60).reverse();
    return h('div', { class: 'stack' },
      h('div', { class: 'toolbar' }, field('الشهر', monthIn), field('الفرع', branchSel), h('button', { class: 'btn primary', onclick: () => show() }, 'عرض'), can(user.role, 'attendance.manage') && h('button', { class: 'btn', onclick: () => correct() }, 'تصحيح تسجيل حضور')),
      h('div', { class: 'notice' }, `الأخضر ${d.rules.colors.green.points} نقطة، الأزرق ${d.rules.colors.blue.points}، الأحمر ${d.rules.colors.red.points}. حدود الإجراءات: `, th.map((t) => `${t.at} نقطة ← ${ACTION_LABEL[t.action]}`).join('، '), '. النظام يحسب النقاط فقط ولا يخصم من الراتب تلقائيًا.'),
      table([{ h: 'الموظف', c: (s) => s.name }, { h: 'أخضر', c: (s) => h('span', null, dot('green'), num(s.green)), cls: 'num' }, { h: 'أزرق', c: (s) => h('span', null, dot('blue'), num(s.blue)), cls: 'num' }, { h: 'أحمر', c: (s) => h('span', null, dot('red'), num(s.red)), cls: 'num' },
        { h: 'النقاط', c: (s) => h('b', null, num(s.score)), cls: 'num' }, { h: 'الإجراء المقترح', c: (s) => (s.action ? badge(ACTION_LABEL[s.action], s.action === 'notice' ? 'warn' : 'err') : badge('سليم', 'ok')) }], d.summary, empty('لا توجد تسجيلات في هذا الشهر', 'تظهر عندما يسجّل الموظفون دخولهم وانصرافهم من أجهزة الفروع.')),
      h('section', null, h('h2', null, 'آخر التسجيلات'), table([{ h: 'الموظف', c: (e) => e.name }, { h: 'النوع', c: (e) => (e.kind === 'in' ? 'دخول' : 'انصراف') }, { h: 'اللون', c: (e) => h('span', null, dot(e.color), COLOR_LABEL[e.color]) }, { h: 'الوقت', c: (e) => dt(e.device_time) },
        { h: 'مصدر الوقت', c: (e) => (e.clock_source === 'server' ? badge('الخادم', 'ok') : badge('وقت الجهاز', 'warn')) }], evs, empty('لا توجد تسجيلات'))));
  }
  function correct() {
    const f = { u: sel(users.filter((x) => x.is_active).map((x) => [x.id, `${x.display_name} (${ROLE_LABEL[x.role]})`]), ''), b: sel(opts, opts[0]?.[0]), kind: sel([['in', 'دخول'], ['out', 'انصراف']], 'in'), color: sel(Object.entries(COLOR_LABEL), 'green'), time: inp({ type: 'datetime-local' }), reason: h('textarea', { placeholder: 'سبب التصحيح (إلزامي)' }) };
    modal({ title: 'تصحيح تسجيل حضور', body: h('div', { class: 'stack' }, h('div', { class: 'notice' }, 'التصحيح يُضاف كسجل جديد مع السبب، والسجل الأصلي لا يُعدَّل. تعديل شهر مغلق يحتاج تصريحًا.'), h('div', { class: 'form-grid' }, field('الموظف', f.u), field('الفرع', f.b), field('النوع', f.kind), field('اللون', f.color), field('الوقت', f.time)), field('السبب', f.reason)),
      actions: [{ label: 'حفظ التصحيح', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/attendance/correct', { userId: f.u.value, branchId: f.b.value, kind: f.kind.value, color: f.color.value, time: f.time.value ? new Date(f.time.value).toISOString() : '', reason: f.reason.value }); close(); await show(); }, { btn: e.currentTarget, ok: 'تم حفظ التصحيح' }); } }, { label: 'إلغاء' }] });
  }
  async function shifts() {
    const rows = await api.get('/shift-templates');
    const add = () => { const f = { n: inp(), s: inp({ type: 'time', value: '09:00' }), e: inp({ type: 'time', value: '17:00' }), l: inp({ type: 'number', value: 10, min: 0 }) };
      modal({ title: 'وردية جديدة', body: h('div', { class: 'form-grid' }, field('الاسم', f.n), field('بداية الوردية', f.s), field('نهايتها', f.e), field('سماح التأخير (دقيقة)', f.l)),
        actions: [{ label: 'حفظ الوردية', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/shift-templates', { name: f.n.value, startMin: toMin(f.s.value), endMin: toMin(f.e.value), graceLateMin: Number(f.l.value) }); close(); await show(); }, { btn: e.currentTarget, ok: 'تم حفظ الوردية' }); } }, { label: 'إلغاء' }] }); };
    return h('div', { class: 'stack' }, can(user.role, 'attendance.manage') && h('div', null, h('button', { class: 'btn primary', onclick: add }, 'وردية جديدة')),
      table([{ h: 'الوردية', c: (t) => t.name }, { h: 'من', c: (t) => hhmm(t.start_min), cls: 'num' }, { h: 'إلى', c: (t) => hhmm(t.end_min), cls: 'num' }, { h: 'سماح التأخير', c: (t) => `${num(t.grace_late_min)} دقيقة` }, { h: 'الحالة', c: (t) => (t.is_active ? badge('فعّالة', 'ok') : badge('معطّلة')) }], rows, empty('لا توجد ورديات', 'أنشئ وردية ليُحسب اللون على أساسها.')));
  }
  async function schedule() {
    const bid = branchSel.value || opts[0]?.[0];
    const [tpls, sch] = await Promise.all([api.get('/shift-templates'), api.get('/schedules', { branch: bid })]);
    const staff = users.filter((u) => u.is_active && u.branch_id === bid);
    const tOpts = [['', '—'], ...tpls.filter((t) => t.is_active).map((t) => [t.id, `${t.name} (${hhmm(t.start_min)}-${hhmm(t.end_min)})`])];
    return h('div', { class: 'stack' }, h('div', { class: 'toolbar' }, field('الفرع', branchSel), h('button', { class: 'btn', onclick: () => show() }, 'عرض')),
      table([{ h: 'الموظف', c: (u) => u.display_name }, ...WEEKDAYS.map((d, w) => ({ h: d, c: (u) => sel(tOpts, sch.find((s) => s.user_id === u.id && s.weekday === w)?.template_id ?? '', { 'aria-label': `${u.display_name} ${d}`, onchange: (e) => run(async () => { await api.put('/schedules', { userId: u.id, branchId: bid, weekday: w, templateId: e.target.value || null }); }, { ok: 'تم حفظ الموعد' }) }) }))], staff, empty('لا يوجد موظفون في هذا الفرع', 'أضف مستخدمين للفرع من صفحة المستخدمين.')));
  }
  async function show() { clear(body).append(await run(async () => ({ summary, shifts, schedule })[cur]()) ?? ''); tabBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === cur))); }
  tabs.forEach(([k, t]) => tabBar.append(h('button', { role: 'tab', 'data-k': k, onclick: () => { cur = k; show(); } }, t)));
  const node = page('الحضور والانصراف', null, tabBar, body);
  await show(); return node;
}
