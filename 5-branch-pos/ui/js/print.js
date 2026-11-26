/** الطباعة: نرسم الفاتورة على Canvas بخط حقيقي، نحوّلها لنقاط 1 بت، ونرسلها للطابعة عبر الخادم المحلي. */
import { layoutReceipt, layoutLabel, drawOps, toMonoBitmap, escposRaster, tsplBitmap, PAPER } from './shared/index.js';
import { post, get } from './api.js';
import { h, modal, toast } from './ui.js';

const paper = () => { try { return localStorage.getItem('pos.paper') === '58' ? PAPER.mm58 : PAPER.mm80; } catch { return PAPER.mm80; } };
export const setPaper = (mm) => { try { localStorage.setItem('pos.paper', String(mm)); } catch { /* مسموح */ } };

let logoImg;
/** شعار الفاتورة (أسود على شفاف). لو تعذّر تحميله تُطبع الفاتورة باسم المحل نصًا. */
async function loadLogo() {
  if (logoImg !== undefined) return logoImg;
  logoImg = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'assets/logo-black.png'; });
  return logoImg;
}

async function render(layout, images) {
  try { await document.fonts?.ready; } catch { /* مسموح */ }
  const c = document.createElement('canvas'); c.width = layout.width; c.height = layout.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  drawOps(ctx, layout, images);
  return { canvas: c, bmp: toMonoBitmap(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height) };
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

function previewModal(canvas, title) {
  const img = h('img', { src: canvas.toDataURL('image/png'), alt: title, style: 'max-width:100%;background:#fff;border:1px solid var(--line)' });
  modal({ title, body: h('div', { style: 'text-align:center' }, img, h('p', { class: 'muted' }, 'لا توجد طابعة مضبوطة لهذا الجهاز. اضبطها من «الإعدادات» أو اطبع من المتصفح.')),
    actions: [{ label: 'طباعة من المتصفح', kind: 'primary', onClick: () => { const w = window.open('', '_blank'); w.document.write(`<img src="${img.src}" style="width:80mm">`); w.document.close(); w.onload = () => w.print(); return false; } }, { label: 'إغلاق' }] });
}

export async function printReceipt(data, { openDrawer = false } = {}) {
  const logo = await loadLogo();
  const { canvas, bmp } = await render(layoutReceipt(data, { width: paper(), logo: logo ? { w: logo.naturalWidth, h: logo.naturalHeight } : null }), { logo });
  const st = await get('/local/status');
  if (!st.printers?.receipt || st.printers.receipt === 'dryrun') { previewModal(canvas, `فاتورة ${data.invoice.number}`); return { preview: true }; }
  await post('/local/print', { target: 'receipt', data: b64(escposRaster(bmp, { openDrawer })) });
  toast('تمت الطباعة');
  return { printed: true };
}

export async function printLabels(variant, copies = 1) {
  const { canvas, bmp } = await render(layoutLabel({ modelName: variant.model_name, colorName: variant.color_name ?? '', sizeName: variant.size_name ?? '', price: variant.price, sku: variant.sku }));
  const st = await get('/local/status');
  if (!st.printers?.label || st.printers.label === 'dryrun') { previewModal(canvas, `ملصق ${variant.sku}`); return; }
  await post('/local/print', { target: 'label', data: b64(tsplBitmap(bmp, { copies })) });
  toast('تمت طباعة الملصق');
}
