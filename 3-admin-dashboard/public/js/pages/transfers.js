import { api } from '../api.js';
import { can } from '../shared/index.js';
import { lineEditor } from '../pickers.js';
import { h, page, field, sel, badge, table, empty, run, modal, dt, num, branchOptions, clear } from '../ui.js';
import { TRANSFER_STATUS } from '../labels.js';

const NEXT = { draft: [['approved', 'اعتماد']], approved: [['preparing', 'بدء التجهيز'], ['in_transit', 'تم الشحن']], preparing: [['in_transit', 'تم الشحن']], in_transit: [] };
export default async function ({ user }) {
  const { list } = await branchOptions();
  const out = h('div'); const status = sel([['', 'كل الحالات'], ...Object.entries(TRANSFER_STATUS)], '');
  const kind = (s) => (s === 'completed' ? 'ok' : s === 'cancelled' ? 'err' : s === 'in_transit' ? 'warn' : '');
  async function load() {
    const rows = await api.get('/transfers', { status: status.value });
    const name = (id) => list.find((b) => b.id === id)?.name ?? '—';
    clear(out).append(table([{ h: 'الرقم', c: (t) => h('a', { href: '#', class: 'ltr', onclick: (e) => { e.preventDefault(); detail(t.id); } }, t.number) }, { h: 'من', c: (t) => name(t.from_branch_id) }, { h: 'إلى', c: (t) => name(t.to_branch_id) },
      { h: 'الحالة', c: (t) => badge(TRANSFER_STATUS[t.status], kind(t.status)) }, { h: 'التاريخ', c: (t) => dt(t.created_at) }], rows, empty('لا توجد تحويلات', 'أنشئ تحويلًا لنقل بضاعة من المخزن الرئيسي إلى فرع.')));
  }
  async function detail(id) {
    const t = await api.get(`/transfers/${id}`);
    const recv = new Map(t.lines.map((l) => [l.variant_id, inpQty(l)]));
    function inpQty(l) { return h('input', { type: 'number', min: 0, max: l.qty_sent, value: l.qty_sent - l.qty_received, style: 'width:90px', 'aria-label': `المستلم من ${l.sku}` }); }
    const canReceive = ['in_transit', 'partially_received'].includes(t.status) && can(user.role, 'stock.transfer.receive');
    const acts = [];
    if (can(user.role, 'stock.transfer')) for (const [to, label] of NEXT[t.status] ?? []) acts.push({ label, kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post(`/transfers/${id}/transition`, { to }); close(); await load(); }, { btn: e.currentTarget, ok: 'تم تحديث الحالة' }); } });
    if (can(user.role, 'stock.transfer') && ['draft', 'approved', 'preparing'].includes(t.status)) acts.push({ label: 'إلغاء التحويل', kind: 'danger', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post(`/transfers/${id}/transition`, { to: 'cancelled' }); close(); await load(); }, { btn: e.currentTarget, ok: 'أُلغي التحويل' }); } });
    if (canReceive) acts.push({ label: 'تأكيد الاستلام', kind: 'tape', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post(`/transfers/${id}/receive`, { lines: t.lines.map((l) => ({ variantId: l.variant_id, qtyReceived: Number(recv.get(l.variant_id).value) })) }); close(); await load(); }, { btn: e.currentTarget, ok: 'تم تسجيل الاستلام. أي عجز يُسجَّل تلقائيًا' }); } });
    modal({ wide: true, title: `تحويل ${t.number}: ${t.from_name} ← ${t.to_name}`, body: h('div', { class: 'stack' }, badge(TRANSFER_STATUS[t.status], kind(t.status)),
      table([{ h: 'الكود', c: (l) => l.sku, cls: 'ltr' }, { h: 'الصنف', c: (l) => `${l.model_name} ${l.color_name} ${l.size_name}` }, { h: 'المُرسل', c: (l) => num(l.qty_sent), cls: 'num' }, { h: 'المستلم', c: (l) => num(l.qty_received), cls: 'num' },
        ...(canReceive ? [{ h: 'استلام الآن', c: (l) => recv.get(l.variant_id) }] : [])], t.lines)), actions: [...acts, { label: 'إغلاق' }] });
  }
  function create() {
    const from = sel(list.filter((b) => b.kind !== 'web_stock').map((b) => [b.id, b.name]), list.find((b) => b.kind === 'main_warehouse')?.id);
    const to = sel(list.filter((b) => b.kind === 'branch').map((b) => [b.id, b.name]), ''); const ed = lineEditor(); const note = h('textarea');
    modal({ wide: true, title: 'تحويل جديد', body: h('div', { class: 'stack' }, h('div', { class: 'form-grid' }, field('من', from), field('إلى', to)), field('ملاحظة', note), ed.node),
      actions: [{ label: 'حفظ كمسودة', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { if (!ed.size()) throw new Error('أضف صنفًا واحدًا على الأقل'); await api.post('/transfers', { fromBranchId: from.value, toBranchId: to.value, note: note.value, lines: ed.get() }); close(); await load(); }, { btn: e.currentTarget, ok: 'حُفظت المسودة. اعتمدها ثم اشحنها' }); } }, { label: 'إلغاء' }] });
  }
  const node = page('التوزيع والتحويلات', can(user.role, 'stock.transfer') ? h('button', { class: 'btn primary', onclick: create }, 'تحويل جديد') : null,
    h('div', { class: 'toolbar' }, field('الحالة', status), h('button', { class: 'btn', onclick: () => run(load) }, 'تصفية')), out);
  await run(load); return node;
}
