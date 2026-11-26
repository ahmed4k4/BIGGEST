import { get, post } from '../api.js';
import { h, clear, run, egp, num, dt, toast, field, toPiasters } from '../ui.js';
import { refreshMe } from '../app.js';

export async function shiftView(root, ctx) {
  const box = h('div', { class: 'card' }); const att = h('div', { class: 'card' });
  const paintShift = async () => {
    clear(box); box.append(h('h2', null, 'وردية الدرج'));
    const s = await run(() => get('/local/shift'));
    if (!s) {
      const open = h('input', { class: 'num', inputmode: 'decimal', value: '0' });
      return box.append(h('p', { class: 'muted' }, 'لا توجد وردية مفتوحة.'), field('النقدي الموجود في الدرج الآن', open), h('button', { class: 'btn primary', onclick: async () => { if (await run(() => post('/local/shift/open', { openingCash: toPiasters(open.value) }), { ok: 'تم فتح الوردية' })) { await refreshMe(); paintShift(); } } }, 'فتح وردية'));
    }
    const cnt = h('input', { class: 'num', inputmode: 'decimal', placeholder: 'عدّ النقدي الفعلي' });
    box.append(h('div', { class: 'totals' }, [['فُتحت', dt(s.shift.opened_at)], ['فواتير البيع', num(s.invoices)], ['المرتجعات', num(s.returns)], ['إجمالي المبيعات', egp(s.salesTotal)], ['منها بطاقة/محفظة', egp(s.cardTotal)], ['افتتاحي الدرج', egp(s.shift.opening_cash)], ['المتوقع في الدرج', egp(s.expectedCash)]].map(([a, b]) => h('div', null, h('span', null, a), h('b', null, b)))),
      field('النقدي المعدود عند الإغلاق', cnt, 'عُدّ الدرج بدون النظر للمتوقع أولًا'),
      h('button', { class: 'btn danger', onclick: async () => {
        const r = await run(() => post('/local/shift/close', { closingCash: toPiasters(cnt.value) })); if (!r) return;
        toast(r.difference === 0 ? 'الدرج مضبوط' : `${r.difference > 0 ? 'زيادة' : 'عجز'} ${egp(Math.abs(r.difference))}`, r.difference === 0 ? 'ok' : 'err'); await refreshMe(); paintShift();
      } }, 'إغلاق الوردية'));
  };
  const paintAtt = async () => {
    clear(att); att.append(h('h2', null, 'الحضور والانصراف'));
    const last = await run(() => get('/local/attendance/me'));
    const next = !last || last.kind === 'out' ? 'in' : 'out';
    att.append(last && h('p', { class: 'muted' }, `آخر تسجيل: ${last.kind === 'in' ? 'حضور' : 'انصراف'} ${dt(last.device_time)}`),
      h('button', { class: 'btn primary big', onclick: async () => {
        const r = await run(() => post('/local/attendance')); if (!r) return;
        toast(`${r.kind === 'in' ? 'تم تسجيل الحضور' : 'تم تسجيل الانصراف'} — ${r.label}`, r.color === 'red' ? 'err' : 'ok'); paintAtt();
      } }, next === 'in' ? 'تسجيل حضور' : 'تسجيل انصراف'),
      h('p', { class: 'muted' }, 'الوقت من ساعة الجهاز ويُراجع من الإدارة. النقاط للمتابعة فقط ولا تخصم من الراتب تلقائيًا.'));
  };
  root.append(h('div', { class: 'layout-2' }, box, att)); paintShift(); paintAtt();
}
