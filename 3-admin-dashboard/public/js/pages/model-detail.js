import { api, fileUrl } from '../api.js';
import { h, page, field, inp, egp, toPiastersInput, table, badge, empty, run, act, toast, confirmDialog, dt } from '../ui.js';

/** تصغير الصورة في المتصفح إلى WebP بثلاثة أحجام قبل الرفع لتوفير المساحة والباندويدث. */
async function resize(file, maxSide, quality) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('تعذّر تحويل الصورة'))), 'image/webp', quality));
}

export default async function ({ params }) {
  const [m, tpl] = await Promise.all([api.get(`/models/${params.id}`), api.get('/code-template')]);
  const def = tpl.definition;
  const colors = def.parts.find((p) => p.key === 'color')?.values.filter((v) => v.active !== false) ?? [];
  const sizes = def.parts.find((p) => p.key === 'size')?.values.filter((v) => v.active !== false) ?? [];

  const name = inp({ value: m.name }); const price = inp({ type: 'number', step: '0.01', value: m.price_piasters / 100 });
  const cost = inp({ type: 'number', step: '0.01', value: m.cost_piasters == null ? '' : m.cost_piasters / 100 }); const desc = h('textarea', null, m.description ?? '');
  const web = inp({ type: 'checkbox', checked: m.show_on_web }); const active = inp({ type: 'checkbox', checked: m.is_active });
  const saveBtn = h('button', { class: 'btn primary', onclick: act(async () => {
    await api.patch(`/models/${m.id}`, { name: name.value, pricePiasters: toPiastersInput(price.value), costPiasters: cost.value === '' ? null : toPiastersInput(cost.value), description: desc.value, showOnWeb: web.checked, isActive: active.checked });
  }, 'تم حفظ التعديلات') }, 'حفظ التعديلات');
  const details = h('section', { class: 'panel' }, h('h2', null, 'بيانات الموديل'),
    h('div', { class: 'form-grid' }, field('الاسم', name), field('سعر البيع (جنيه)', price), field('سعر التكلفة (جنيه)', cost), field('الوصف', desc)),
    h('div', { class: 'form-row', style: 'margin-top:12px' }, h('label', { class: 'check' }, web, 'يظهر في المتجر الإلكتروني'), h('label', { class: 'check' }, active, 'الموديل فعّال'), saveBtn));

  // ── الصور
  const fileIn = inp({ type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true });
  const gallery = h('div', { class: 'thumbs' }, m.images.map((i) => h('figure', null, h('img', { src: fileUrl(i.url_card), alt: m.name, loading: 'lazy' }),
    h('button', { class: 'btn sm danger', 'aria-label': 'حذف الصورة', onclick: act(async () => { if (await confirmDialog('حذف هذه الصورة؟', 'حذف', 'danger')) { await api.del(`/model-images/${i.id}`); location.reload(); } }) }, '✕'))));
  const upBtn = h('button', { class: 'btn', onclick: act(async () => {
    if (!fileIn.files.length) { toast('اختر صورة أولًا', 'err'); return; }
    for (const f of fileIn.files) {
      const [t, c, fu] = await Promise.all([resize(f, 160, 0.75), resize(f, 480, 0.8), resize(f, 1200, 0.82)]);
      const [a, b, d] = [await api.upload(t), await api.upload(c), await api.upload(fu)];
      await api.post(`/models/${m.id}/images`, { thumb: a.url, card: b.url, full: d.url });
    }
    location.reload();
  }) }, 'رفع الصور');
  const images = h('section', { class: 'panel' }, h('h2', null, 'الصور'), m.images.length ? gallery : empty('لا توجد صور', 'ارفع صورة للموديل لتظهر في المتجر. تُصغَّر تلقائيًا قبل الرفع.'),
    h('div', { class: 'form-row', style: 'margin-top:12px' }, field('اختر صورًا (JPG أو PNG أو WebP)', fileIn), upBtn));

  // ── توليد القطع
  const pick = (list, name) => list.map((v) => ({ v, box: inp({ type: 'checkbox', checked: true, id: `${name}-${v.code}` }) }));
  const cPick = pick(colors, 'c'); const sPick = pick(sizes, 's');
  const group = (title, picks) => h('fieldset', { style: 'border:1px solid var(--line);border-radius:6px;padding:10px 14px' }, h('legend', null, title),
    h('div', { class: 'form-row' }, picks.map(({ v, box }) => h('label', { class: 'check', for: box.id }, box, v.display && h('span', { class: 'swatch', style: `background:${v.display}` }), v.name))));
  const gen = h('section', { class: 'panel' }, h('h2', null, 'توليد القطع (لون × مقاس)'),
    h('p', { class: 'muted' }, `سيُنشأ لكل لون ومقاس مختار كود فريد بصيغة القالب، مثل ${m.code}-${colors[0]?.code ?? '01'}-${sizes[0]?.code ?? 'M'}. القطع الموجودة لا تتكرر.`),
    h('div', { class: 'stack' }, group('الألوان', cPick), group('المقاسات', sPick),
      h('div', null, h('button', { class: 'btn tape', onclick: act(async () => {
        const r = await api.post(`/models/${m.id}/variants`, { colors: cPick.filter((x) => x.box.checked).map((x) => x.v.code), sizes: sPick.filter((x) => x.box.checked).map((x) => x.v.code) });
        toast(`تم توليد ${r.created} قطعة`); location.reload();
      }) }, 'توليد الأكواد'))));

  const vars = h('section', null, h('h2', null, `قطع الموديل (${m.variants.length})`),
    table([{ h: 'الكود', c: (v) => h('span', { class: 'ltr' }, v.sku), cls: 'num' }, { h: 'اللون', c: (v) => v.color_name }, { h: 'المقاس', c: (v) => v.size_name },
      { h: 'الملصق', c: (v) => (v.printed_at ? badge('طُبع', 'ok') : badge('لم يُطبع', 'warn')) }, { h: 'الحالة', c: (v) => (v.is_active ? badge('فعّال', 'ok') : badge('معطّل', 'err')) }], m.variants,
      empty('لا توجد قطع بعد', 'اختر الألوان والمقاسات ثم اضغط «توليد الأكواد».')));
  const labelsBtn = h('a', { class: 'btn', href: `#/labels?model=${m.id}` }, 'طباعة ملصقات هذا الموديل');
  return page(`${m.name} (${m.code})`, h('div', { class: 'form-row' }, h('a', { class: 'btn', href: '#/models' }, 'كل الموديلات'), labelsBtn), details, h('div', { class: 'cols' }, images, gen), vars);
}
