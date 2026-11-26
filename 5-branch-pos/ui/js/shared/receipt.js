/**
 * مولّد الفاتورة والملصقات — مستقل عن الطابعة والمتصفح.
 *
 *   بيانات  --layoutReceipt()-->  قائمة أوامر رسم (نص/خط/QR/باركود)
 *   أوامر   --drawOps(ctx)----->  Canvas (معاينة على الشاشة أو للطباعة)
 *   Canvas  --toMonoBitmap()---->  صورة 1 بت  --escposRaster()/tsplBitmap()--> بايتات الطابعة
 *
 * لماذا صورة؟ طابعات الحرارة لا تدعم العربية المتصلة بشكل موحّد (أكواد الخطوط تختلف بين الموديلات)،
 * فنرسم النص في المتصفح بخط حقيقي ونرسل نقاطًا. هذا يعمل على أي طابعة ESC/POS أو TSPL.
 */
import { encodeQR } from './qr.js';
import { encodeCode128 } from './code128.js';

export const PAPER = Object.freeze({ mm80: 576, mm58: 384 });
export const FONT = '"IBM Plex Sans Arabic", Tahoma, Arial, sans-serif';

const money = (p) => (p / 100).toLocaleString('ar-EG', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });
const pad2 = (n) => String(n).padStart(2, '0');
export function formatDateTime(iso, timeZone = 'Africa/Cairo') {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}/${p.month}/${p.day}  ${pad2(p.hour)}:${p.minute}`;
}

/**
 * @param {object} r  { shop:{name,phone,address}, branchName, invoice:{number,createdAt,kind}, cashierName,
 *                      customerName?, lines:[{name,detail?,qty,unitPrice,lineTotal}], totals:{gross,discount,tax,total,paid,changeDue},
 *                      payments?:[{method,amount}], footer?, qrText? }
 * @param {{width?:number}} [o]
 */
export function layoutReceipt(r, { width = PAPER.mm80, logo = null } = {}) {
  const ops = []; let y = 10; const m = 12; const R = width - m; const L = m;
  const text = (t, { size = 24, bold = false, align = 'right', x, gap = 8 } = {}) => {
    ops.push({ t: 'text', text: String(t), size, bold, align, x: x ?? (align === 'center' ? width / 2 : align === 'left' ? L : R), y: y + size });
    y += size + gap;
  };
  const row = (right, left, { size = 24, bold = false, gap = 8 } = {}) => {
    ops.push({ t: 'text', text: String(right), size, bold, align: 'right', x: R, y: y + size, maxWidth: width * 0.62 });
    ops.push({ t: 'text', text: String(left), size, bold, align: 'left', x: L, y: y + size });
    y += size + gap;
  };
  const rule = (dash = false) => { ops.push({ t: 'line', y: y + 2, x1: L, x2: R, dash }); y += 12; };

  if (logo) { // شعار الماركة (صورة): يُمرَّر {w,h} بأبعاد الصورة الأصلية ويُرسم عبر drawOps(…, {logo: img})
    const w = Math.min(width * 0.5, 240); const hgt = Math.round((w * logo.h) / logo.w);
    ops.push({ t: 'image', key: 'logo', x: Math.round((width - w) / 2), y, w: Math.round(w), h: hgt }); y += hgt + 10;
  } else text(r.shop?.name ?? '', { size: 34, bold: true, align: 'center', gap: 6 });
  if (r.branchName && r.branchName !== r.shop?.name) text(r.branchName, { size: 24, align: 'center', gap: 4 });
  if (r.shop?.address) text(r.shop.address, { size: 20, align: 'center', gap: 2 });
  if (r.shop?.phone) text(r.shop.phone, { size: 20, align: 'center', gap: 6 });
  rule();
  const kindLabel = r.invoice.kind === 'return' ? 'فاتورة مرتجع' : 'فاتورة بيع';
  text(`${kindLabel}  ${r.invoice.number}`, { size: 26, bold: true, gap: 4 });
  text(formatDateTime(r.invoice.createdAt), { size: 20, gap: 6 });
  if (r.cashierName) text(`الكاشير: ${r.cashierName}`, { size: 20, gap: 6 });
  if (r.customerName) text(`العميل: ${r.customerName}`, { size: 20, gap: 6 });
  rule(true);
  for (const l of r.lines) {
    row(l.name, money(l.lineTotal), { size: 24, bold: true, gap: 2 });
    row(l.detail ?? '', `${l.qty} × ${money(l.unitPrice)}`, { size: 20, gap: 10 });
  }
  rule(true);
  const t = r.totals;
  if (t.discount > 0) { row('الإجمالي قبل الخصم', money(t.gross), { size: 22, gap: 4 }); row('الخصم', `-${money(t.discount)}`, { size: 22, gap: 4 }); }
  if (t.tax > 0) row('منها ضريبة', money(t.tax), { size: 20, gap: 4 });
  row('الإجمالي', money(t.total), { size: 32, bold: true, gap: 8 });
  for (const p of r.payments ?? []) row(p.method === 'cash' ? 'نقدي' : p.method === 'card' ? 'بطاقة' : 'محفظة', money(p.amount), { size: 22, gap: 6 });
  if (t.changeDue > 0) row('الباقي', money(t.changeDue), { size: 24, bold: true, gap: 8 });
  rule();
  if (r.qrText) {
    const qr = encodeQR(r.qrText, { ecl: 'M' });
    const scale = Math.max(3, Math.floor(Math.min(width * 0.45, 220) / (qr.size + 8)));
    const px = (qr.size + 8) * scale;
    ops.push({ t: 'qr', x: Math.round((width - px) / 2), y, scale, quiet: 4, modules: qr.modules });
    y += px + 6;
    text('تتبّع طلبك أو راجع فاتورتك', { size: 18, align: 'center', gap: 6 });
  }
  text(r.footer ?? 'شكرًا لتعاملكم معنا', { size: 22, align: 'center', gap: 4 });
  text('الاستبدال والاسترجاع بالفاتورة خلال المدة المحددة', { size: 18, align: 'center', gap: 24 });
  return { width, height: Math.ceil(y), ops };
}

/** ملصق باركود لمنتج. الأبعاد بالنقاط (203dpi: 40×30مم ≈ 320×240). */
export function layoutLabel(v, { width = 320, height = 240 } = {}) {
  const ops = []; const m = 10;
  ops.push({ t: 'text', text: v.modelName, size: 26, bold: true, align: 'center', x: width / 2, y: 34, maxWidth: width - 2 * m });
  ops.push({ t: 'text', text: `${v.colorName} • ${v.sizeName}`, size: 22, align: 'center', x: width / 2, y: 64, maxWidth: width - 2 * m });
  ops.push({ t: 'text', text: money(v.price), size: 34, bold: true, align: 'center', x: width / 2, y: 106 });
  const widths = encodeCode128(v.sku);
  const modules = widths.reduce((a, b) => a + b, 0);
  const unit = Math.max(1, Math.floor((width - 2 * m) / modules));
  const bw = modules * unit;
  ops.push({ t: 'bars', x: Math.round((width - bw) / 2), y: 122, h: height - 122 - 40, unit, widths });
  ops.push({ t: 'text', text: v.sku, size: 20, align: 'center', x: width / 2, y: height - 12 });
  return { width, height, ops };
}

/** يرسم الأوامر على سياق Canvas 2D (متصفح أو canvas مزيّف في الاختبار). */
export function drawOps(ctx, layout, images = {}) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.textBaseline = 'alphabetic';
  for (const o of layout.ops) {
    if (o.t === 'text') {
      ctx.font = `${o.bold ? 700 : 400} ${o.size}px ${FONT}`;
      ctx.direction = 'rtl'; ctx.textAlign = o.align;
      if (o.maxWidth) ctx.fillText(o.text, o.x, o.y, o.maxWidth); else ctx.fillText(o.text, o.x, o.y);
    } else if (o.t === 'image') {
      if (images[o.key]) ctx.drawImage(images[o.key], o.x, o.y, o.w, o.h);
    } else if (o.t === 'line') {
      ctx.lineWidth = 2; ctx.setLineDash?.(o.dash ? [6, 6] : []);
      ctx.beginPath(); ctx.moveTo(o.x1, o.y); ctx.lineTo(o.x2, o.y); ctx.stroke(); ctx.setLineDash?.([]);
    } else if (o.t === 'qr') {
      const n = o.modules.length;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (o.modules[r][c]) ctx.fillRect(o.x + (c + o.quiet) * o.scale, o.y + (r + o.quiet) * o.scale, o.scale, o.scale);
    } else if (o.t === 'bars') {
      let x = o.x; let black = true;
      for (const w of o.widths) { if (black) ctx.fillRect(x, o.y, w * o.unit, o.h); x += w * o.unit; black = !black; }
    }
  }
}

/** RGBA → صورة 1 بت (1 = أسود)، بعرض مضاعف 8. */
export function toMonoBitmap(rgba, width, height, threshold = 160) {
  const wBytes = Math.ceil(width / 8);
  const data = new Uint8Array(wBytes * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const a = rgba[i + 3] / 255;
    const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
    if (lum < threshold) data[y * wBytes + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return { wBytes, width, height, data };
}

const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** ESC/POS: تهيئة + صورة (GS v 0) على شرائح ≤ 255 سطرًا + قص ورق اختياري + فتح الدرج اختياريًا. */
export function escposRaster(bmp, { cut = true, openDrawer = false, feed = 4 } = {}) {
  const parts = [Uint8Array.of(0x1b, 0x40)];
  for (let y = 0; y < bmp.height; y += 255) {
    const h = Math.min(255, bmp.height - y);
    parts.push(Uint8Array.of(0x1d, 0x76, 0x30, 0x00, bmp.wBytes & 255, bmp.wBytes >> 8, h & 255, h >> 8), bmp.data.subarray(y * bmp.wBytes, (y + h) * bmp.wBytes));
  }
  parts.push(Uint8Array.of(0x1b, 0x64, feed));
  if (openDrawer) parts.push(Uint8Array.of(0x1b, 0x70, 0x00, 0x19, 0xfa));
  if (cut) parts.push(Uint8Array.of(0x1d, 0x56, 0x42, 0x00));
  return concat(...parts);
}

/** أمر فتح الدرج فقط. */
export const escposOpenDrawer = () => Uint8Array.of(0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa);

/** TSPL: صورة BITMAP. في TSPL البت 0 = أسود لذا نعكس. mm = {w,h}. */
export function tsplBitmap(bmp, { mm = { w: 40, h: 30 }, gapMm = 2, copies = 1 } = {}) {
  const inv = bmp.data.map((b) => (~b) & 0xff);
  const head = new TextEncoder().encode(`SIZE ${mm.w} mm,${mm.h} mm\r\nGAP ${gapMm} mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,${bmp.wBytes},${bmp.height},0,`);
  return concat(head, inv, new TextEncoder().encode(`\r\nPRINT ${copies},1\r\n`));
}
