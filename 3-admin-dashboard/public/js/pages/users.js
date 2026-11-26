import { api } from '../api.js';
import { h, page, field, inp, sel, badge, table, empty, run, modal, dt, clear, branchOptions } from '../ui.js';
import { ROLE_LABEL } from '../labels.js';

export default async function ({ user }) {
  const { list } = await branchOptions(); const out = h('div');
  const roles = Object.entries(ROLE_LABEL).filter(([r]) => r !== 'super_admin' || user.role === 'super_admin');
  const bn = (id) => list.find((b) => b.id === id)?.name ?? '—';
  async function load() {
    const rows = await api.get('/users');
    clear(out).append(table([{ h: 'المستخدم', c: (u) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); form(u); } }, u.display_name) }, { h: 'اسم الدخول', c: (u) => u.username, cls: 'ltr' }, { h: 'الدور', c: (u) => ROLE_LABEL[u.role] }, { h: 'الفرع', c: (u) => bn(u.branch_id) },
      { h: 'الحالة', c: (u) => (u.is_active ? badge('فعّال', 'ok') : badge('موقوف', 'err')) }], rows, empty('لا يوجد مستخدمون')));
  }
  function form(u) {
    const name = inp({ value: u?.display_name ?? '' }); const un = inp({ value: u?.username ?? '', dir: 'ltr', disabled: !!u }); const role = sel(roles, u?.role ?? 'cashier');
    const br = sel([['', 'كل الفروع'], ...list.filter((b) => b.kind !== 'web_stock').map((b) => [b.id, b.name])], u?.branch_id ?? '');
    const pw = inp({ type: 'password', autocomplete: 'new-password', placeholder: u ? 'اتركها فارغة بدون تغيير' : '8 أحرف على الأقل' }); const pin = inp({ inputmode: 'numeric', maxlength: 6, placeholder: 'اختياري' });
    const active = inp({ type: 'checkbox', checked: u?.is_active ?? true });
    modal({ title: u ? `تعديل ${u.display_name}` : 'مستخدم جديد', body: h('div', { class: 'form-grid' }, field('الاسم', name), field('اسم الدخول', un), field('الدور', role, 'إنشاء أو تغيير أدمن يحتاج تصريحًا'), field('الفرع', br), field('كلمة السر', pw), field('PIN الحضور والخصم', pin, 'أرقام فقط'), u && h('label', { class: 'check' }, active, 'الحساب فعّال')),
      actions: [{ label: 'حفظ', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => {
        const b = { displayName: name.value, role: role.value, branchId: br.value || null, password: pw.value || undefined, pin: pin.value || undefined };
        if (u) await api.patch(`/users/${u.id}`, { ...b, isActive: active.checked }); else await api.post('/users', { ...b, username: un.value });
        close(); await load(); }, { btn: e.currentTarget, ok: 'تم الحفظ', retry: () => {} }); } }, { label: 'إلغاء' }] });
  }
  const node = page('المستخدمون', h('button', { class: 'btn primary', onclick: () => form(null) }, 'مستخدم جديد'), out);
  await run(load); return node;
}
