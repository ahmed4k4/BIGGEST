/** كاتب ZIP بدون مكتبات (deflate + UTF-8 للأسماء العربية). */
import { deflateRawSync, crc32 } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';

export function buildZip(entries) { // [{name, data:Buffer, mode?}]
  const parts = []; const central = []; let offset = 0;
  const date = ((2026 - 1980) << 9) | (11 << 5) | 24;
  for (const { name, data, mode = 0o644 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'); const comp = deflateRawSync(data); const crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(8, 8); l.writeUInt16LE(0, 10); l.writeUInt16LE(date, 12);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nameBuf.length, 26);
    parts.push(l, nameBuf, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf); offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
export const fileEntry = (abs, name) => ({ name, data: readFileSync(abs), mode: statSync(abs).mode & 0o777 });
