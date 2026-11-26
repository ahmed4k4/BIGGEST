import { api } from '../api.js';
import { h, page, field, inp, table, empty, run, dt, clear } from '../ui.js';

export default async function () {
  const ent = inp({ placeholder: 'مثال: users أو models', dir: 'ltr' }); const out = h('div');
  async function load() {
    const rows = await api.get('/audit', { entity: ent.value.trim(), limit: 150 });
    clear(out).append(table([{ h: 'الوقت', c: (a) => dt(a.created_at) }, { h: 'الإجراء', c: (a) => a.action, cls: 'ltr' }, { h: 'الجدول', c: (a) => a.entity, cls: 'ltr' }, { h: 'السبب', c: (a) => a.reason ?? '—' }, { h: 'تفاصيل', c: (a) => (a.after ? h('code', { class: 'ltr' }, JSON.stringify(a.after).slice(0, 90)) : '—') }], rows, empty('لا يوجد نشاط مسجّل')));
  }
  const node = page('سجل النشاط', null, h('p', { class: 'muted' }, 'سجل للقراءة فقط: لا يُعدَّل ولا يُحذف.'), h('div', { class: 'toolbar' }, field('الجدول', ent), h('button', { class: 'btn', onclick: () => run(load) }, 'تصفية')), out);
  await run(load); return node;
}
