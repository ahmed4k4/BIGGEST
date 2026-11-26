/** مراقبة: هل السحابة تردّ؟ كم المساحة؟ متى آخر نسخة؟ يكتب status.json ويُنبّه (webhook اختياري). */
import { statfsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { listBackups } from './backup.js';

export async function checkHealth({ cloudUrl, deviceToken, dir, fetchImpl = fetch, now = new Date(), maxBackupAgeHours = 36, minFreeGb = 2 }) {
  const warnings = []; const out = { at: now.toISOString() };
  const t0 = Date.now();
  try {
    const r = await fetchImpl(`${cloudUrl.replace(/\/$/, '')}/sync/ping`, { headers: { authorization: `Device ${deviceToken}` }, signal: AbortSignal.timeout(15_000) });
    out.cloud = { ok: r.ok, status: r.status, latencyMs: Date.now() - t0, seq: r.ok ? (await r.json()).seq : null };
    if (!r.ok) warnings.push(`السحابة ردّت ${r.status}`);
  } catch (e) { out.cloud = { ok: false, error: e.message }; warnings.push(`السحابة لا تردّ: ${e.message}`); }
  try { mkdirSync(dir, { recursive: true }); const s = statfsSync(dir); out.diskFreeGb = Math.round((s.bavail * s.bsize) / 1e8) / 10; if (out.diskFreeGb < minFreeGb) warnings.push(`المساحة قليلة: ${out.diskFreeGb} جيجا`); } catch (e) { warnings.push(`تعذّر قراءة المساحة: ${e.message}`); }
  const last = listBackups(dir).at(-1);
  out.lastBackup = last ? { day: last.day, sizeMb: Math.round(last.size / 1e5) / 10 } : null;
  if (!last) warnings.push('لا توجد نسخة احتياطية بعد');
  else if ((now - new Date(`${last.day}T23:59:59Z`)) / 3.6e6 > maxBackupAgeHours) warnings.push(`آخر نسخة قديمة (${last.day})`);
  out.warnings = warnings; out.ok = warnings.length === 0;
  writeFileSync(join(dir, 'status.json'), JSON.stringify(out, null, 2));
  return out;
}

export async function notify(webhook, text, fetchImpl = fetch) {
  if (!webhook) return false;
  try { await fetchImpl(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }) }); return true; } catch { return false; }
}
