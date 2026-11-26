import { api } from '../api.js';
import { h, page, field, inp, sel, badge, egp, toPiastersInput, table, empty, run, act, modal, toast, clear } from '../ui.js';

export default async function () {
  const cats = await api.get('/categories');
  const q = inp({ type: 'search', placeholder: 'ابحث باسم الموديل أو كوده' });
  const catSel = sel([['', 'كل التصنيفات'], ...cats.map((c) => [c.id, c.name])], '');
  const out = h('div');
  const catName = (id) => cats.find((c) => c.id === id)?.name ?? '—';
  async function load() {
    const rows = await api.get('/models', { q: q.value, category: catSel.value, limit: 200 });
    clear(out).append(table([
      { h: 'الكود', c: (m) => h('a', { href: `#/models/${m.id}`, class: 'ltr' }, m.code), cls: 'num' }, { h: 'الاسم', c: (m) => h('a', { href: `#/models/${m.id}` }, m.name) },
      { h: 'التصنيف', c: (m) => catName(m.category_id) }, { h: 'سعر البيع', c: (m) => egp(m.price_piasters), cls: 'num' },
      { h: 'التكلفة', c: (m) => (m.cost_piasters == null ? '—' : egp(m.cost_piasters)), cls: 'num' }, { h: 'على الموقع', c: (m) => (m.show_on_web ? badge('ظاهر', 'ok') : badge('مخفي')) },
      { h: 'الحالة', c: (m) => (m.is_active ? badge('فعّال', 'ok') : badge('معطّل', 'err')) },
    ], rows, empty('لا توجد موديلات', 'أنشئ أول موديل، ثم ولّد أكواد ألوانه ومقاساته بضغطة واحدة.')));
  }
  function create() {
    const name = inp({ required: true }); const cat = sel([['', 'بدون تصنيف'], ...cats.map((c) => [c.id, c.name])], '');
    const price = inp({ type: 'number', min: 0, step: '0.01', required: true }); const cost = inp({ type: 'number', min: 0, step: '0.01' }); const desc = h('textarea');
    modal({ title: 'موديل جديد', body: h('div', { class: 'form-grid' }, field('اسم الموديل', name), field('التصنيف', cat), field('سعر البيع (جنيه)', price), field('سعر التكلفة (اختياري)', cost), field('الوصف', desc)),
      actions: [{ label: 'حفظ الموديل', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => {
        const m = await api.post('/models', { name: name.value, categoryId: cat.value || null, pricePiasters: toPiastersInput(price.value), costPiasters: cost.value ? toPiastersInput(cost.value) : undefined, description: desc.value });
        close(); location.hash = `#/models/${m.id}`;
      }, { btn: e.currentTarget, ok: 'تم إنشاء الموديل. ولّد الآن أكواد الألوان والمقاسات' }); } }, { label: 'إلغاء' }] });
  }
  function newCat() {
    const n = inp({ required: true });
    modal({ title: 'تصنيف جديد', body: field('اسم التصنيف', n), actions: [{ label: 'حفظ التصنيف', kind: 'primary', keepOpen: true, onClick: async (e, close) => { await run(async () => { await api.post('/categories', { name: n.value }); close(); location.reload(); }, { btn: e.currentTarget }); } }, { label: 'إلغاء' }] });
  }
  const node = page('الموديلات', h('div', { class: 'form-row' }, h('button', { class: 'btn' , onclick: newCat }, 'تصنيف جديد'), h('button', { class: 'btn primary', onclick: create }, 'موديل جديد')),
    h('div', { class: 'toolbar' }, field('بحث', q), field('التصنيف', catSel), h('button', { class: 'btn', onclick: () => run(load) }, 'بحث')), out);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(load); });
  await run(load);
  return node;
}
