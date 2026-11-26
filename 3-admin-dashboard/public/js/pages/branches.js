import { api } from '../api.js';
import { can } from '../shared/index.js';
import { h, page, field, inp, sel, badge, table, empty, run, modal, dt, toast, clear, confirmDialog } from '../ui.js';
import { BRANCH_KIND } from '../labels.js';

export default async function ({ user }) {
  const out = h('div', { class: 'stack' });
  async function load() {
    const [branches, devices, settings] = await Promise.all([api.get('/branches'), can(user.role, 'devices.manage') ? api.get('/devices') : [], api.get('/settings')]);
    const killed = (k) => settings.settings[k] === true;
    const bn = (id) => branches.find((b) => b.id === id)?.name ?? '—';
    clear(out).append(
      h('section', null, h('h2', null, 'الفروع والمخازن'), table([{ h: 'الكود', c: (b) => b.code, cls: 'ltr' }, { h: 'الاسم', c: (b) => b.name }, { h: 'النوع', c: (b) => BRANCH_KIND[b.kind] }, { h: 'الحالة', c: (b) => (b.is_active ? badge('فعّال', 'ok') : badge('موقوف', 'err')) },
        { h: 'إيقاف طوارئ', cls: 'actions', c: (b) => b.kind === 'branch' && h('button', { class: `btn sm ${killed(`kill.branch.${b.id}`) ? 'danger' : ''}`, onclick: (e) => run(async () => { await api.put(`/settings/kill.branch.${b.id}`, { value: !killed(`kill.branch.${b.id}`) }); await load(); }, { btn: e.currentTarget, ok: 'تم' }) }, killed(`kill.branch.${b.id}`) ? 'الفرع موقوف: إعادة التشغيل' : 'إيقاف المزامنة') }], branches, empty('لا توجد فروع'))),
      h('section', null, h('h2', null, 'أجهزة الفروع'), h('p', { class: 'muted' }, 'كل جهاز له توكن خاص. إن ضاع جهاز، أوقفه من هنا فتُرفض مزامنته فورًا.'),
        table([{ h: 'الجهاز', c: (d) => d.name }, { h: 'النوع', c: (d) => (d.kind === 'server_agent' ? 'السيرفر المحلي' : 'كاشير فرع') }, { h: 'الفرع', c: (d) => (d.branch_id ? bn(d.branch_id) : '—') }, { h: 'آخر اتصال', c: (d) => dt(d.last_seen) }, { h: 'الحالة', c: (d) => (d.status === 'active' ? badge('فعّال', 'ok') : badge('موقوف', 'err')) },
          { h: '', cls: 'actions', c: (d) => d.status === 'active' && h('button', { class: 'btn sm danger', onclick: async (e) => { if (await confirmDialog(`إيقاف الجهاز «${d.name}» نهائيًا؟`, 'إيقاف', 'danger')) run(async () => { await api.post(`/devices/${d.id}/revoke`); await load(); }, { ok: 'أُوقف الجهاز' }); } }, 'إيقاف') }], devices, empty('لا توجد أجهزة', 'سجّل جهاز الفرع ثم ضع توكنه في تطبيق الفرع.'))),
      h('section', null, h('h2', null, 'إيقاف المتجر'), h('button', { class: `btn ${killed('kill.shop') ? 'danger' : ''}`, onclick: (e) => run(async () => { await api.put('/settings/kill.shop', { value: !killed('kill.shop') }); await load(); }, { btn: e.currentTarget, ok: 'تم' }) }, killed('kill.shop') ? 'المتجر موقوف: اضغط لإعادة التشغيل' : 'إيقاف استقبال الطلبات مؤقتًا')));
  }
  function addBranch() {
    const code = inp({ dir: 'ltr', maxlength: 8, placeholder: 'ALX' }); const name = inp(); const kind = sel(Object.entries(BRANCH_KIND), 'branch');
    modal({ title: 'فرع جديد', body: h('div', { class: 'form-grid' }, field('الكود (حروف إنجليزية)', code), field('الاسم', name), field('النوع', kind)), actions: [{ label: 'حفظ', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/branches', { code: code.value, name: name.value, kind: kind.value }); close(); await load(); }, { btn: e.currentTarget, ok: 'تمت الإضافة' }); } }, { label: 'إلغاء' }] });
  }
  async function addDevice() {
    const branches = (await api.get('/branches')).filter((b) => b.kind === 'branch'); const name = inp({ placeholder: 'كاشير فرع الإسكندرية 1' }); const b = sel(branches.map((x) => [x.id, x.name]), branches[0]?.id);
    modal({ title: 'تسجيل جهاز', body: h('div', { class: 'stack' }, field('اسم الجهاز', name), field('الفرع', b), h('p', { class: 'muted' }, 'سيظهر التوكن مرة واحدة فقط. انسخه فورًا.')),
      actions: [{ label: 'تسجيل', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => {
        const d = await api.post('/devices', { name: name.value, branchId: b.value }); close(); await load();
        const tok = inp({ readonly: true, value: d.deviceToken, dir: 'ltr', onclick: (ev) => ev.target.select() });
        modal({ title: 'توكن الجهاز', body: h('div', { class: 'stack' }, h('div', { class: 'notice warn' }, 'لن يظهر مرة أخرى. ضعه في شاشة تفعيل تطبيق الفرع.'), tok), actions: [{ label: 'نسخ', kind: 'primary', keepOpen: true, onClick: async () => { try { await navigator.clipboard.writeText(d.deviceToken); toast('تم النسخ'); } catch { tok.select(); toast('حدّد النص وانسخه يدويًا', 'err'); } } }, { label: 'تم' }] });
      }, { btn: e.currentTarget }); } }, { label: 'إلغاء' }] });
  }
  const node = page('الفروع والأجهزة', h('div', { class: 'form-row' }, can(user.role, 'settings.manage') && h('button', { class: 'btn', onclick: addBranch }, 'فرع جديد'), can(user.role, 'devices.manage') && h('button', { class: 'btn primary', onclick: addDevice }, 'تسجيل جهاز')), out);
  await run(load); return node;
}
