import { api } from '../api.js';
import { h, page, field, inp, sel, badge, run, act, toast, empty, confirmDialog } from '../ui.js';

const CHARSETS = [['digits', 'أرقام فقط'], ['alpha', 'حروف إنجليزية'], ['alnum', 'حروف وأرقام']];
const SEPS = [['-', 'شرطة ( - )'], ['_', 'شرطة سفلية ( _ )'], ['.', 'نقطة ( . )'], ['/', 'مائلة ( / )'], ['', 'بدون فاصل']];

export default async function () {
  const cur = await api.get('/code-template');
  let def = structuredClone(cur.definition);
  const root = h('div', { class: 'stack' });
  const previewBox = h('div', { class: 'panel' });
  let timer;

  const lenOf = (p) => (p.length ? [p.length, p.length] : [p.minLength ?? 1, p.maxLength ?? 1]);
  function setLen(p, min, max) { min = Number(min) || 1; max = Number(max) || min; if (min === max) { p.length = min; delete p.minLength; delete p.maxLength; } else { delete p.length; p.minLength = min; p.maxLength = max; } }

  async function preview() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const r = await api.post('/code-template/preview', { definition: def });
        previewBox.replaceChildren(h('h2', null, 'معاينة الأكواد'),
          r.ok ? h('div', null, h('p', { class: 'muted' }, 'أمثلة لأول موديل (0001) بعد الحفظ:'), h('div', { class: 'form-row' }, r.samples.map((s) => h('span', { class: 'badge ltr' }, s))))
               : h('div', { class: 'notice err', role: 'alert' }, h('b', null, 'القالب فيه أخطاء:'), h('ul', null, r.errors.map((e) => h('li', null, e.message ?? e)))));
      } catch (e) { previewBox.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
    }, 250);
  }

  function partCard(p, i) {
    const [min, max] = lenOf(p);
    const children = [h('h3', null, `${p.label} `, badge(p.kind === 'sequence' ? 'تسلسل' : 'قائمة قيم'), ' ', h('span', { class: 'muted ltr' }, p.key))];
    const lenMin = inp({ type: 'number', min: 1, max: 12, value: min, onchange: (e) => { setLen(p, e.target.value, p.kind === 'sequence' ? e.target.value : lenMax.value); preview(); } });
    const lenMax = inp({ type: 'number', min: 1, max: 12, value: max, disabled: p.kind === 'sequence', onchange: (e) => { setLen(p, lenMin.value, e.target.value); preview(); } });
    children.push(h('div', { class: 'form-grid' },
      field('اسم الجزء', inp({ value: p.label, oninput: (e) => { p.label = e.target.value; preview(); } })),
      field('نوع المحارف', sel(CHARSETS, p.charset, { disabled: p.kind === 'sequence', onchange: (e) => { p.charset = e.target.value; preview(); } })),
      field(p.kind === 'sequence' ? 'عدد الخانات' : 'أقل طول', lenMin), p.kind === 'enum' && field('أكبر طول', lenMax)));
    if (p.kind === 'enum') {
      const tbody = h('tbody');
      const draw = () => {
        tbody.replaceChildren(...p.values.map((v) => h('tr', null,
          h('td', null, inp({ class: 'ltr', value: v.code, 'aria-label': 'الكود', oninput: (e) => { v.code = e.target.value.toUpperCase(); preview(); }, style: 'max-width:90px' })),
          h('td', null, inp({ value: v.name, 'aria-label': 'الاسم', oninput: (e) => { v.name = e.target.value; preview(); } })),
          h('td', null, p.key === 'color' ? inp({ type: 'color', value: v.display ?? '#888888', 'aria-label': 'لون العرض', oninput: (e) => { v.display = e.target.value; } }) : ''),
          h('td', null, h('label', { class: 'check' }, inp({ type: 'checkbox', checked: v.active !== false, onchange: (e) => { v.active = e.target.checked; preview(); } }), 'فعّال')),
          h('td', { class: 'actions' }, h('button', { class: 'btn sm danger', type: 'button', onclick: () => { p.values.splice(p.values.indexOf(v), 1); draw(); preview(); } }, 'حذف')))));
      };
      draw();
      children.push(h('div', { class: 'table-wrap', style: 'margin-top:12px' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['الكود', 'الاسم', p.key === 'color' ? 'لون العرض' : '', 'الحالة', ''].map((t) => h('th', null, t)))), tbody)),
        h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { p.values.push({ code: '', name: '', active: true }); draw(); } }, 'إضافة قيمة')),
        h('p', { class: 'muted' }, 'القيمة المستخدمة في موديلات سابقة لا تُحذف ولا يتغير معناها؛ عطّلها وأضف قيمة جديدة.'));
    }
    if (!['model', 'color', 'size'].includes(p.key)) children.push(h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn sm danger', type: 'button', onclick: () => { def.parts.splice(i, 1); draw(); preview(); } }, 'حذف هذا الجزء')));
    return h('div', { class: 'part' }, children);
  }

  function draw() {
    root.replaceChildren(
      h('div', { class: 'notice' }, `النسخة الحالية رقم ${cur.version}. كل موديل جديد يُكتب بالنسخة الأحدث، وتبقى الأكواد القديمة صالحة للقراءة. يمكنك إضافة قيم جديدة بحرية؛ تغيير الشكل بعد طباعة ملصقات يحتاج تصريح السوبر أدمن.`),
      h('div', { class: 'panel form-grid' }, field('الفاصل بين الأجزاء', sel(SEPS, def.separator ?? '', { onchange: (e) => { def.separator = e.target.value; preview(); } })),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'رقم التحقق'), h('label', { class: 'check' }, inp({ type: 'checkbox', checked: !!def.checkDigit, onchange: (e) => { def.checkDigit = e.target.checked; preview(); } }), 'إضافة حرف تحقق في آخر الكود (يكشف أخطاء الكتابة)'))),
      ...def.parts.map(partCard),
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => {
        const key = prompt('مفتاح الجزء الجديد بالإنجليزية (مثل fabric)');
        if (!key) return;
        def.parts.push({ key: key.trim().toLowerCase(), label: 'جزء جديد', kind: 'enum', charset: 'alnum', minLength: 1, maxLength: 3, values: [{ code: 'A', name: 'قيمة', active: true }] });
        draw(); preview();
      } }, 'إضافة جزء جديد للكود')),
      previewBox);
    preview();
  }
  draw();

  const save = h('button', { class: 'btn primary', type: 'button', onclick: (e) => run(async () => {
    try {
      const saved = await api.post('/code-template', { definition: def });
      toast(`تم حفظ قالب الأكواد (النسخة ${saved.version})`);
      location.reload();
    } catch (ex) {
      if (ex.status === 422 && ex.data.errors) { previewBox.replaceChildren(h('h2', null, 'لم يُحفظ القالب'), h('div', { class: 'notice err', role: 'alert' }, h('ul', null, ex.data.errors.map((x) => h('li', null, x.message ?? x))))); return; }
      throw ex;
    }
  }, { btn: e.currentTarget }) }, 'حفظ نسخة جديدة من القالب');
  return page('قالب الأكواد', save, root);
}
