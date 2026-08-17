/**
 * Minimal ZIP read/write for OOXML (.docx). Stored + deflated entries.
 * Never depends on an extra package.
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}

function u32(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function putU16(buf, off, n) {
  buf[off] = n & 0xff;
  buf[off + 1] = (n >>> 8) & 0xff;
}

function putU32(buf, off, n) {
  buf[off] = n & 0xff;
  buf[off + 1] = (n >>> 8) & 0xff;
  buf[off + 2] = (n >>> 16) & 0xff;
  buf[off + 3] = (n >>> 24) & 0xff;
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  throw new Error("docx is not a valid zip (no EOCD)");
}

/** @returns {Map<string, Buffer>} */
export function unzip(buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const eocd = findEocd(raw);
  const count = u16(raw, eocd + 10);
  let off = u32(raw, eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(raw, off) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = u16(raw, off + 10);
    const compSize = u32(raw, off + 20);
    const nameLen = u16(raw, off + 28);
    const extraLen = u16(raw, off + 30);
    const commentLen = u16(raw, off + 32);
    const localOff = u32(raw, off + 42);
    const name = raw.slice(off + 46, off + 46 + nameLen).toString("utf8");
    const localNameLen = u16(raw, localOff + 26);
    const localExtraLen = u16(raw, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const data = raw.slice(dataStart, dataStart + compSize);
    let out = data;
    if (method === 8) out = inflateRawSync(data);
    else if (method !== 0) throw new Error(`unsupported zip method ${method} for ${name}`);
    files.set(name.replace(/\\/g, "/"), Buffer.from(out));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** @param {Map<string, Buffer|string>|Record<string, Buffer|string>} files */
export function zip(files) {
  const entries = [...(files instanceof Map ? files.entries() : Object.entries(files))].map(([name, data]) => ({
    name: String(name).replace(/\\/g, "/"),
    data: Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8"),
  }));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const ent of entries) {
    const nameBuf = Buffer.from(ent.name, "utf8");
    const crc = crc32(ent.data);
    const compressed = deflateRawSync(ent.data);
    const useStore = compressed.length >= ent.data.length;
    const payload = useStore ? ent.data : compressed;
    const method = useStore ? 0 : 8;
    const local = Buffer.alloc(30);
    putU32(local, 0, 0x04034b50);
    putU16(local, 4, 20);
    putU16(local, 8, method);
    putU32(local, 14, crc);
    putU32(local, 18, payload.length);
    putU32(local, 22, ent.data.length);
    putU16(local, 26, nameBuf.length);
    const central = Buffer.alloc(46);
    putU32(central, 0, 0x02014b50);
    putU16(central, 4, 20);
    putU16(central, 6, 20);
    putU16(central, 10, method);
    putU32(central, 16, crc);
    putU32(central, 20, payload.length);
    putU32(central, 24, ent.data.length);
    putU16(central, 28, nameBuf.length);
    putU32(central, 42, offset);
    locals.push(Buffer.concat([local, nameBuf, payload]));
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += 30 + nameBuf.length + payload.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  putU32(eocd, 0, 0x06054b50);
  putU16(eocd, 8, entries.length);
  putU16(eocd, 10, entries.length);
  putU32(eocd, 12, centralDir.length);
  putU32(eocd, 16, offset);
  return Buffer.concat([...locals, centralDir, eocd]);
}
