/**
 * إرسال بايتات جاهزة (ESC/POS للفواتير، TSPL للملصقات) إلى الطابعة.
 * الناقلات: tcp (طابعات الشبكة، المنفذ 9100) | file (جهاز مثل /dev/usb/lp0 أو مسار) |
 *           windows (طابعة مشتركة \\localhost\NAME عبر copy /b) | dryrun (يحفظ الملف للفحص).
 * ملاحظة: لم تُجرَّب هنا على طابعة فعلية؛ الاختبار يغطي الناقلات والبايتات فقط.
 */
import net from 'node:net';
import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export class Printer {
  /** @param {{receipt?:object,label?:object}} cfg  مثال: {receipt:{type:'tcp',host:'192.168.1.50',port:9100}} @param {{dryDir?:string}} [o] */
  constructor(cfg = {}, { dryDir = join(tmpdir(), 'erp-print') } = {}) { this.cfg = cfg; this.dryDir = dryDir; }

  setConfig(cfg) { this.cfg = cfg; }

  async send(target, bytes) {
    const c = this.cfg[target] ?? { type: 'dryrun' };
    const buf = Buffer.from(bytes);
    switch (c.type) {
      case 'tcp': return this.#tcp(c, buf);
      case 'file': await appendFile(c.path, buf); return { ok: true };
      case 'windows': return this.#windows(c, buf);
      case 'dryrun': default: {
        await mkdir(this.dryDir, { recursive: true });
        const file = join(this.dryDir, `${target}-${Date.now()}.bin`);
        await writeFile(file, buf);
        return { ok: true, dryrun: true, file };
      }
    }
  }

  #tcp(c, buf) {
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: c.host, port: c.port ?? 9100 });
      const t = setTimeout(() => { s.destroy(); reject(new Error('انتهت مهلة الاتصال بالطابعة')); }, c.timeoutMs ?? 8000);
      s.once('error', (e) => { clearTimeout(t); reject(new Error(`تعذّر الاتصال بالطابعة: ${e.message}`)); });
      s.once('connect', () => s.end(buf, () => { clearTimeout(t); resolve({ ok: true }); }));
    });
  }

  async #windows(c, buf) {
    const tmp = join(tmpdir(), `erp-${Date.now()}.bin`);
    await writeFile(tmp, buf);
    await new Promise((resolve, reject) => {
      const p = spawn('cmd', ['/c', 'copy', '/b', tmp, `\\\\localhost\\${c.name}`], { windowsHide: true });
      p.once('error', reject); p.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`فشلت الطباعة (${code})`))));
    });
    return { ok: true };
  }
}
