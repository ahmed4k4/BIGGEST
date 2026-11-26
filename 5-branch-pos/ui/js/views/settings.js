import { get, post, api } from '../api.js';
import { h, clear, run, num, toast, field, dt } from '../ui.js';
import { setPaper } from '../print.js';

const TYPES = [['dryrun', 'معاينة فقط (بدون طابعة)'], ['tcp', 'طابعة شبكة (IP)'], ['file', 'جهاز/ملف (USB على لينكس مثلًا)'], ['windows', 'طابعة ويندوز مشتركة']];

export async function settingsView(root, ctx) {
  const st = await get('/local/status');
  const sync = h('div', { class: 'card' }, h('h2', null, 'المزامنة'));
  const paintSync = async () => {
    const s = await get('/local/status'); clear(sync); sync.append(h('h2', null, 'المزامنة'),
      h('div', { class: 'totals' }, [['الحالة', s.online === false ? 'بدون إنترنت' : 'متصل'], ['بانتظار الرفع', num(s.pending)], ['فشلت', num(s.failed)], ['آخر مزامنة', s.lastSyncAt ? dt(s.lastSyncAt) : '—'], ['آخر خطأ', s.lastError ?? '—']].map(([a, b]) => h('div', null, h('span', null, a), h('b', null, b)))),
      h('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; await run(() => post('/local/sync')); paintSync(); } }, 'مزامنة الآن'));
    if (s.failed && isMgr) {
      const o = await run(() => get('/local/outbox'));
      if (o) sync.append(h('p', { class: 'banner err' }, 'عمليات رفضها السيرفر. راجع السبب، وبعد المعالجة أعد المحاولة:'), h('ul', null, o.failed.map((f) => h('li', null, `${f.type}: ${f.error}`))), h('button', { class: 'btn', onclick: async () => { await run(() => post('/local/outbox/retry'), { ok: 'أُعيدت المحاولة' }); paintSync(); } }, 'إعادة المحاولة'));
    }
  };
  const printers = h('div', { class: 'card' }, h('h2', null, 'الطابعات'));
  const isMgr = ['super_admin', 'admin', 'branch_manager'].includes(ctx.user.role);
  const cfg = isMgr ? await api('GET', '/local/printers').catch(() => null) : null;
  if (!cfg) printers.append(h('p', { class: 'muted' }, 'ضبط الطابعات للمدير فقط.'));
  else {
    const forms = {};
    for (const [key, title] of [['receipt', 'طابعة الفواتير (ESC/POS)'], ['label', 'طابعة الملصقات (TSPL)']]) {
      const c = cfg[key] ?? { type: 'dryrun' };
      const type = h('select', null, TYPES.map(([v, l]) => h('option', { value: v, selected: c.type === v }, l)));
      const host = h('input', { class: 'ltr', placeholder: '192.168.1.50', value: c.host ?? '' }); const port = h('input', { class: 'ltr', placeholder: '9100', value: c.port ?? '' });
      const path = h('input', { class: 'ltr', placeholder: '/dev/usb/lp0', value: c.path ?? '' }); const name = h('input', { class: 'ltr', placeholder: 'اسم المشاركة', value: c.name ?? '' });
      forms[key] = () => ({ type: type.value, ...(type.value === 'tcp' ? { host: host.value, port: Number(port.value) || 9100 } : {}), ...(type.value === 'file' ? { path: path.value } : {}), ...(type.value === 'windows' ? { name: name.value } : {}) });
      printers.append(h('h3', null, title), field('النوع', type), h('div', { class: 'row' }, field('العنوان', host), field('المنفذ', port)), field('مسار الجهاز', path), field('اسم الطابعة المشتركة', name));
    }
    const paper = h('select', null, [['80', 'ورق 80 مم'], ['58', 'ورق 58 مم']].map(([v, l]) => h('option', { value: v, selected: (localStorage.getItem('pos.paper') ?? '80') === v }, l)));
    printers.append(field('عرض الورق', paper), h('button', { class: 'btn primary', onclick: async () => { setPaper(paper.value); if (await run(() => api('PUT', '/local/printers', { receipt: forms.receipt(), label: forms.label() }), { ok: 'تم حفظ إعدادات الطباعة' })) toast('جرّب طباعة فاتورة للتأكد'); } }, 'حفظ'));
  }
  root.append(h('div', { class: 'layout-2' }, sync, printers), h('p', { class: 'muted' }, `الفرع: ${st.branch?.name ?? '—'} • الوقت المحلي: ${dt(st.now)}`));
  paintSync();
}
