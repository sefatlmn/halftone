// zip.js — minimal STORE-only ZIP writer (no compression, no dependency).
//
// PNGs are already DEFLATE-compressed internally, so storing them uncompressed
// adds essentially no size while keeping this tiny. Produces a standard ZIP
// (local file headers + central directory + EOCD) that every OS unzips natively.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

// Fixed MS-DOS timestamp (1980-01-01 00:00) so output is deterministic and the
// month/day fields stay valid (a zero date is technically malformed).
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

// files: [{ name: string, bytes: Uint8Array }] → Blob (application/zip).
export function makeZipBlob(files) {
  const enc = new TextEncoder();
  const parts = [];   // local headers + file data, in order
  const central = []; // central-directory records
  let offset = 0;     // running offset of each local header

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.bytes;
    const crc = crc32(data);
    const size = data.length;

    const lh = new Uint8Array(30 + name.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true); // local file header signature
    ldv.setUint16(4, 20, true);          // version needed
    ldv.setUint16(6, 0, true);           // flags
    ldv.setUint16(8, 0, true);           // method 0 = store
    ldv.setUint16(10, DOS_TIME, true);
    ldv.setUint16(12, DOS_DATE, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true);       // compressed size (== uncompressed)
    ldv.setUint32(22, size, true);       // uncompressed size
    ldv.setUint16(26, name.length, true);
    ldv.setUint16(28, 0, true);          // extra length
    lh.set(name, 30);
    parts.push(lh, data);

    const cd = new Uint8Array(46 + name.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);  // central dir header signature
    cdv.setUint16(4, 20, true);          // version made by
    cdv.setUint16(6, 20, true);          // version needed
    cdv.setUint16(8, 0, true);           // flags
    cdv.setUint16(10, 0, true);          // method
    cdv.setUint16(12, DOS_TIME, true);
    cdv.setUint16(14, DOS_DATE, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, name.length, true);
    cdv.setUint16(30, 0, true);          // extra length
    cdv.setUint16(32, 0, true);          // comment length
    cdv.setUint16(34, 0, true);          // disk number
    cdv.setUint16(36, 0, true);          // internal attrs
    cdv.setUint32(38, 0, true);          // external attrs
    cdv.setUint32(42, offset, true);     // local header offset
    cd.set(name, 46);
    central.push(cd);

    offset += lh.length + data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);    // end of central dir signature
  edv.setUint16(8, files.length, true);  // entries on this disk
  edv.setUint16(10, files.length, true); // total entries
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, cdStart, true);

  return new Blob([...parts, ...central, eocd], { type: "application/zip" });
}
