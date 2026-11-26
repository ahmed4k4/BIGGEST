#!/usr/bin/env node
/** يبني ملف ZIP للتسليم: كل المشروع بدون الأسرار (.env) والبيانات المحلية وملفات التوليد.  node scripts/make-zip.mjs [out.zip] */
import { readdirSync, statSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { ROOT } from './lib/env.mjs';
import { buildZip, fileEntry } from './lib/zip.mjs';

const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'data', 'dist', 'print-out', '.wrangler', 'coverage', 'out']);
const EXCLUDE_FILE = /(^|\/)(\.env(?!\.example$)(\..*)?|.*\.sqlite(-wal|-shm)?|.*\.dump|.*\.log|\.DS_Store)$/;
const KEEP = new Set(['.env.example']);

export function collectFiles(root = ROOT) {
  const out = [];
  (function walk(d) {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f); const rel = relative(root, p).split(sep).join('/');
      if (statSync(p).isDirectory()) { if (!EXCLUDE_DIRS.has(f)) walk(p); continue; }
      if (EXCLUDE_FILE.test(rel) && !KEEP.has(rel)) continue;
      out.push({ abs: p, rel });
    }
  })(root);
  return out;
}

export function makeZip(outFile, root = ROOT, prefix = 'BIGGEST') {
  const files = collectFiles(root);
  const buf = buildZip(files.map((f) => fileEntry(f.abs, `${prefix}/${f.rel}`)));
  mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, buf);
  return { outFile, files: files.length, bytes: buf.length };
}

if (process.argv[1]?.endsWith('make-zip.mjs')) {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const r = makeZip(process.argv[2] ?? join(ROOT, 'dist', `BIGGEST-v${version}.zip`));
  console.log(`تم: ${r.outFile} (${r.files} ملف، ${(r.bytes / 1e6).toFixed(2)} MB)`);
}
