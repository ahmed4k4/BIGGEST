/**
 * مولّد QR (وضع البايت UTF-8، الإصدارات 1–15، مستويات التصحيح L/M/Q/H) بدون أي مكتبة.
 * يُرجع مصفوفة وحدات (true = أسود). الرسم بمضاعفات صحيحة من البكسل مسؤولية receipt.js.
 */
const ECC_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24],
};
const NUM_BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18],
};
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
export const MAX_VERSION = 15;

// ── حقل غالوا GF(256) و Reed-Solomon
const EXP = new Uint8Array(512); const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    poly.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= gmul(c, EXP[i]); });
    poly = next;
  }
  return poly;
}
function rsRemainder(data, deg) {
  const gen = rsGenerator(deg);
  const rem = new Array(deg).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < deg; i++) rem[i] ^= gmul(gen[i + 1], factor);
  }
  return rem;
}

const rawModules = (v) => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
};
const dataCapacityBytes = (v, ecl) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[ecl][v] * NUM_BLOCKS[ecl][v];

function alignPositions(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2; const size = v * 4 + 17;
  const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const res = [6];
  for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}

function utf8(text) { return [...new TextEncoder().encode(text)]; }

function makeCodewords(bytes, v, ecl) {
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  const cap = dataCapacityBytes(v, ecl) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  const nb = NUM_BLOCKS[ecl][v]; const eccLen = ECC_PER_BLOCK[ecl][v];
  const raw = Math.floor(rawModules(v) / 8); const shortBlocks = nb - (raw % nb); const shortLen = Math.floor(raw / nb);
  const blocks = []; let k = 0;
  for (let i = 0; i < nb; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const d = data.slice(k, k + len); k += len;
    blocks.push({ d, e: rsRemainder(d, eccLen) });
  }
  const out = [];
  for (let i = 0; i < blocks[blocks.length - 1].d.length; i++) blocks.forEach((b) => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < eccLen; i++) blocks.forEach((b) => out.push(b.e[i]));
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function buildMatrix(v, ecl, codewords, mask) {
  const size = v * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx; const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const ap = alignPositions(v);
  ap.forEach((cy, i) => ap.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  // معلومات التنسيق
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  const fmt = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);

  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bitsV = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const b = ((bitsV >>> i) & 1) === 1; const a = size - 11 + (i % 3); const c = Math.floor(i / 3);
      set(a, c, b); set(c, a, b);
    }
  }

  // وضع البيانات بالتعرّج
  let idx = 0; const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j; const upward = ((right + 1) & 2) === 0; const y = upward ? size - 1 - vert : vert;
        if (fn[y][x] || idx >= total) continue;
        m[y][x] = ((codewords[idx >>> 3] >>> (7 - (idx & 7))) & 1) === 1; idx++;
      }
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
  return m;
}

function penalty(m) {
  const n = m.length; let p = 0;
  const runs = (line) => {
    let s = 0; let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++;
      else { if (run >= 5) s += run - 2; run = 1; }
    }
    return s;
  };
  for (let i = 0; i < n; i++) { p += runs(m[i]); p += runs(m.map((r) => r[i])); }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  const pat = '10111010000'; const pat2 = '00001011101';
  const scan = (s) => { let c = 0; for (let i = 0; i + 11 <= s.length; i++) { const w = s.slice(i, i + 11); if (w === pat || w === pat2) c++; } return c * 40; };
  for (let i = 0; i < n; i++) { p += scan(m[i].map(Number).join('')); p += scan(m.map((r) => Number(r[i])).join('')); }
  const dark = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/**
 * @param {string} text
 * @param {{ecl?:'L'|'M'|'Q'|'H', minVersion?:number}} [o]
 * @returns {{size:number, version:number, modules:boolean[][]}}
 */
export function encodeQR(text, { ecl = 'M', minVersion = 1 } = {}) {
  if (!ECC_PER_BLOCK[ecl]) throw new RangeError('مستوى تصحيح غير صالح');
  const bytes = utf8(String(text));
  let v = Math.max(1, minVersion);
  while (v <= MAX_VERSION && dataCapacityBytes(v, ecl) < bytes.length + (v < 10 ? 2 : 3)) v++;
  if (v > MAX_VERSION) throw new RangeError('النص أطول من سعة الـ QR المدعومة، اختصر المحتوى');
  const cw = makeCodewords(bytes, v, ecl);
  let best = null; let bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = buildMatrix(v, ecl, cw, mask); const p = penalty(m);
    if (p < bestP) { bestP = p; best = m; }
  }
  return { size: best.length, version: v, modules: best };
}
