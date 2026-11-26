/**
 * محرك المزامنة: يرفع الـ outbox على دفعات (≤100) ثم يسحب التغييرات بالمؤشر seq.
 * - أي فشل شبكة يترك العمليات pending ويعيد المحاولة لاحقًا (backoff أسّي حتى 5 دقائق).
 * - opId ثابت، فالرفع المتكرر آمن (السيرفر يردّ duplicate).
 * - لو السيرفر قال needsSnapshot أو لم تُنزَّل لقطة قط: تُنزَّل لقطة كاملة.
 */
import { MAX_PUSH_BATCH, MAX_PULL_LIMIT } from './shared/index.js';

export class SyncEngine {
  /** @param {{db:import('./db.js').BranchDb, cloudUrl:string, deviceToken:string, branchId?:string, fetchImpl?:typeof fetch, log?:Function}} o */
  constructor({ db, cloudUrl, deviceToken, branchId, fetchImpl = fetch, log = () => {} }) {
    Object.assign(this, { db, cloudUrl: cloudUrl?.replace(/\/$/, ''), deviceToken, branchId, fetchImpl, log });
    this.state = { online: null, lastSyncAt: db.meta('last_sync_at'), lastError: null, running: false };
    this.failures = 0;
    this.timer = null;
  }

  get configured() { return Boolean(this.cloudUrl && this.deviceToken); }

  async http(path, init = {}) {
    const res = await this.fetchImpl(`${this.cloudUrl}${path}`, {
      ...init, headers: { 'content-type': 'application/json', authorization: `Device ${this.deviceToken}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
    if (!res.ok) { const e = new Error(data.error ?? `HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
  }

  async push() {
    let sent = 0;
    for (;;) {
      const batch = this.db.pendingOps(MAX_PUSH_BATCH);
      if (!batch.length) return sent;
      const ops = batch.map((r) => ({ opId: r.op_id, type: r.type, payload: JSON.parse(r.payload), deviceTime: r.device_time }));
      const { results } = await this.http('/sync/push', { method: 'POST', body: JSON.stringify({ ops }) });
      this.db.markOps(results);
      sent += results.filter((r) => r.status === 'ok' || r.status === 'duplicate').length;
      if (results.some((r) => r.status === 'error') && results.every((r) => r.status === 'error')) return sent; // لا تدور في حلقة على أخطاء دائمة
    }
  }

  async snapshot() {
    const snap = await this.http('/sync/snapshot');
    this.db.applySnapshot(snap, this.branchId);
    this.log('snapshot', snap.seq);
    return snap.seq;
  }

  async pull() {
    if (!this.db.meta('snapshot_at')) await this.snapshot();
    let applied = 0;
    for (;;) {
      const after = this.db.meta('last_seq', 0);
      const r = await this.http(`/sync/pull?after=${after}&limit=${MAX_PULL_LIMIT}`);
      if (r.needsSnapshot) { await this.snapshot(); continue; }
      this.db.tx(() => {
        for (const c of r.changes) if (this.db.applyChange(c.table, c.rowId, c.op, c.data, this.branchId)) applied++;
        this.db.setMeta('last_seq', r.nextSeq);
      });
      if (!r.hasMore) return applied;
    }
  }

  /** دورة كاملة. لا ترمي استثناءً: تحدّث الحالة فقط. */
  async run() {
    if (!this.configured || this.state.running) return this.status();
    this.state.running = true;
    try {
      await this.push();
      await this.pull();
      this.failures = 0;
      Object.assign(this.state, { online: true, lastError: null, lastSyncAt: new Date().toISOString() });
      this.db.setMeta('last_sync_at', this.state.lastSyncAt);
    } catch (e) {
      this.failures++;
      Object.assign(this.state, { online: e.status ? true : false, lastError: e.message });
      this.log('sync-error', e.message);
    } finally { this.state.running = false; }
    return this.status();
  }

  status() { return { ...this.state, configured: this.configured, ...this.db.outboxStats(), lastSeq: this.db.meta('last_seq', 0) }; }

  /** تشغيل دوري + مزامنة سريعة بعد كل عملية (debounce). */
  start(intervalMs = () => 300_000) {
    const loop = async () => {
      await this.run();
      const wait = this.failures ? Math.min(300_000, 5_000 * 2 ** Math.min(this.failures, 6)) : intervalMs();
      this.timer = setTimeout(loop, wait); this.timer.unref?.();
    };
    this.timer = setTimeout(loop, 500); this.timer.unref?.();
  }
  nudge(ms = 1500) {
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => { this.run(); }, ms); this.nudgeTimer.unref?.();
  }
  stop() { clearTimeout(this.timer); clearTimeout(this.nudgeTimer); }
}
