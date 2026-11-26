/** تصدير أسبوعي: يسحب من السحابة (جهاز server_agent فقط) ويكتب XLSX + CSV لكل جدول. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildXlsx, toCsv } from './xlsx.js';

const SHEET_AR = { sales: 'المبيعات', 'stock-movements': 'حركة المخزون', transfers: 'التحويلات', 'stock-receipts': 'إدخال البضاعة', cashbox: 'الخزينة' };
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** الأسبوع المنتهي أمس: من الأحد السابق (قبل 7 أيام) إلى السبت. */
export function lastWeekRange(today = new Date(), tz = 'Africa/Cairo') {
  const t = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(today);
  const dow = new Date(`${t}T00:00:00Z`).getUTCDay(); // 0 = الأحد
  const to = addDays(t, -(dow + 1)); // السبت الأخير
  return { from: addDays(to, -6), to };
}

export async function weeklyExport({ cloudUrl, deviceToken, outDir, from, to, fetchImpl = fetch }) {
  const res = await fetchImpl(`${cloudUrl.replace(/\/$/, '')}/sync/weekly-export?from=${from}&to=${to}`, { headers: { authorization: `Device ${deviceToken}` }, signal: AbortSignal.timeout(120_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `السحابة ردّت ${res.status}`);
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `weekly-${from}_${to}`);
  const sheets = Object.fromEntries(Object.entries(data).map(([k, rows]) => [SHEET_AR[k] ?? k, rows]));
  writeFileSync(`${base}.xlsx`, buildXlsx(sheets));
  const csv = [];
  for (const [k, rows] of Object.entries(data)) { const f = `${base}-${k}.csv`; writeFileSync(f, toCsv(rows)); csv.push(f); }
  return { xlsx: `${base}.xlsx`, csv, counts: Object.fromEntries(Object.entries(data).map(([k, r]) => [k, r.length])) };
}
