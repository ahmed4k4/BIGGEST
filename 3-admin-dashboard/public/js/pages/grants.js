import { api } from '../api.js';
import { h, page, field, inp, table, empty, run, modal, dt, clear, grantBadge } from '../ui.js';
import { GATE_LABEL } from '../labels.js';

export default async function ({ user }) {
  const out = h('div'); const sup = user.role === 'super_admin';
  async function load() {
    const [rows, users] = await Promise.all([api.get('/grants'), sup ? api.get('/users') : []]);
    const un = (id) => users.find((u) => u.id === id)?.display_name ?? '';
    clear(out).append(table([{ h: 'العملية', c: (g) => GATE_LABEL[g.feature] ?? g.feature }, ...(sup ? [{ h: 'الطالب', c: (g) => un(g.requested_by) }] : []), { h: 'السبب', c: (g) => g.reason }, { h: 'الحالة', c: (g) => grantBadge(g.status) }, { h: 'التاريخ', c: (g) => dt(g.created_at) },
      { h: 'ينتهي', c: (g) => (g.status === 'approved' ? `${dt(g.expires_at)} · ${g.uses_left} مرة` : '—') },
      ...(sup ? [{ h: '', cls: 'actions', c: (g) => g.status === 'pending' && h('button', { class: 'btn sm primary', onclick: () => decide(g) }, 'مراجعة') }] : [])], rows, empty('لا توجد طلبات تصاريح', sup ? 'عندما يطلب أدمن عملية حساسة ستظهر هنا.' : 'اطلب تصريحًا من نافذة الخطأ عندما تحتاجه.')));
  }
  function decide(g) {
    const min = inp({ type: 'number', min: 1, max: 1440, value: 60 }); const uses = inp({ type: 'number', min: 1, max: 20, value: 1 });
    const go = (approve) => async (e, close) => { await run(async () => { await api.post(`/grants/${g.id}/decide`, { approve, minutes: Number(min.value), uses: Number(uses.value) }); close(); await load(); }, { btn: e.currentTarget, ok: approve ? 'تمت الموافقة' : 'تم الرفض' }); };
    modal({ title: GATE_LABEL[g.feature] ?? g.feature, body: h('div', { class: 'stack' }, h('p', null, 'السبب: ', h('b', null, g.reason)), h('div', { class: 'form-grid' }, field('صالح لمدة (دقيقة)', min), field('عدد مرات الاستخدام', uses))),
      actions: [{ label: 'موافقة', kind: 'primary', keepOpen: true, onClick: go(true) }, { label: 'رفض', kind: 'danger', keepOpen: true, onClick: go(false) }, { label: 'إغلاق' }] });
  }
  const node = page('التصاريح', null, h('p', { class: 'muted' }, 'العمليات الحساسة تحتاج موافقة السوبر أدمن. كل تصريح محدود بمدة وعدد مرات.'), out);
  await run(load); return node;
}
