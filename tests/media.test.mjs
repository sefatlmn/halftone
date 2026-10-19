import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The app deliberately has no package.json (it is served as browser modules).
// Loading the source as a data URL lets node:test exercise its browser-free API.
const source = await readFile(new URL("../src/media.js", import.meta.url), "utf8");
const media = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("detectMediaKind recognizes MIME types and useful extensions", () => {
  assert.equal(media.detectMediaKind({ type: "image/gif", name: "x.bin" }), "gif");
  assert.equal(media.detectMediaKind({ type: "", name: "clip.WEBM" }), "video");
  assert.equal(media.detectMediaKind({ type: "image/png", name: "x" }), "image");
  assert.equal(media.detectMediaKind({ type: "text/plain", name: "notes.txt" }), null);
});

test("media limits reject over-sized files", () => {
  assert.throws(() => media.validateMediaFile({ size: media.MEDIA_LIMITS.gif.bytes + 1, name: "a.gif" }), RangeError);
  assert.equal(media.validateMediaFile({ size: 1, type: "image/png" }).kind, "image");
});

test("animated limits stay within the conservative browser budget", () => {
  assert.ok(media.MEDIA_LIMITS.gif.frames <= 240);
  assert.ok(media.MEDIA_LIMITS.gif.duration <= 30);
  assert.ok(media.MEDIA_LIMITS.gif.maxEdge <= 1920);
  assert.ok(media.MEDIA_LIMITS.gif.decodedBytes <= 48 * 1024 * 1024);
  assert.ok(media.MEDIA_LIMITS.video.duration <= 60);
  assert.ok(media.MEDIA_LIMITS.video.maxPixels <= 2_100_000);
});

test("GIF decoded patch estimates reject compressed memory bombs before decode", () => {
  const descriptor = (width, height) => ({ image: { descriptor: { width, height } } });
  const estimate = media.estimateGifDecodedBytes({
    frames: [descriptor(100, 50), {}, descriptor(20, 10)],
  });
  assert.deepEqual(estimate, {
    frames: 2,
    pixels: 5200,
    patchBytes: 20_800,
  });
  const fullFrames = Math.floor(
    media.MEDIA_LIMITS.gif.decodedBytes / (1600 * 1200 * 4),
  ) + 1;
  const bomb = media.estimateGifDecodedBytes({
    frames: Array.from({ length: fullFrames }, () => descriptor(1600, 1200)),
  });
  assert.ok(bomb.patchBytes > media.MEDIA_LIMITS.gif.decodedBytes);
});

test("fitWithin preserves aspect and never enlarges", () => {
  assert.deepEqual(media.fitWithin(4000, 2000, 1000), { width: 1000, height: 500, scale: 0.25 });
  assert.deepEqual(media.fitWithin(100, 50, 1000), { width: 100, height: 50, scale: 1 });
});

test("formatMediaTime produces stable minute-second labels", () => {
  assert.equal(media.formatMediaTime(0), "0:00");
  assert.equal(media.formatMediaTime(65.9), "1:05");
  assert.equal(media.formatMediaTime(Infinity), "0:00");
});

test("computeTargetFps enforces constant 15 fps for > 15fps and preserves original <= 15fps", () => {
  // > 15 fps capped to 15
  assert.equal(media.computeTargetFps(30), 15);
  assert.equal(media.computeTargetFps(60), 15);
  assert.equal(media.computeTargetFps(24), 15);
  assert.equal(media.computeTargetFps(15.1), 15);

  // <= 15 fps keeps original
  assert.equal(media.computeTargetFps(15), 15);
  assert.equal(media.computeTargetFps(12), 12);
  assert.equal(media.computeTargetFps(10), 10);
  assert.equal(media.computeTargetFps(8.5), 8.5);
  assert.equal(media.computeTargetFps(1), 1);

  // invalid / non-positive falls back to default 15
  assert.equal(media.computeTargetFps(0), 15);
  assert.equal(media.computeTargetFps(-10), 15);
  assert.equal(media.computeTargetFps(NaN), 15);
  assert.equal(media.computeTargetFps(null), 15);
  assert.equal(media.computeTargetFps(undefined), 15);
  assert.equal(media.computeTargetFps("invalid"), 15);
});

test("parseMp4Fps parses timescale and sample_delta from ISOBMFF boxes", () => {
  function buildMockMp4(timescale, sampleDelta) {
    const stts = Buffer.alloc(24);
    stts.writeUInt32BE(24, 0);
    stts.write("stts", 4);
    stts.writeUInt32BE(0, 8);
    stts.writeUInt32BE(1, 12);
    stts.writeUInt32BE(100, 16);
    stts.writeUInt32BE(sampleDelta, 20);

    const hdlr = Buffer.alloc(32);
    hdlr.writeUInt32BE(32, 0);
    hdlr.write("hdlr", 4);
    hdlr.write("vide", 16);

    const mdhd = Buffer.alloc(32);
    mdhd.writeUInt32BE(32, 0);
    mdhd.write("mdhd", 4);
    mdhd.writeUInt32BE(timescale, 20);

    const stbl = Buffer.concat([Buffer.from([0, 0, 0, stts.length + 8, 115, 116, 98, 108]), stts]);
    const minf = Buffer.concat([Buffer.from([0, 0, 0, stbl.length + 8, 109, 105, 110, 102]), stbl]);
    const mdiaLen = mdhd.length + hdlr.length + minf.length + 8;
    const mdiaHdr = Buffer.alloc(8);
    mdiaHdr.writeUInt32BE(mdiaLen, 0);
    mdiaHdr.write("mdia", 4);
    const mdia = Buffer.concat([mdiaHdr, mdhd, hdlr, minf]);
    const trakLen = mdia.length + 8;
    const trakHdr = Buffer.alloc(8);
    trakHdr.writeUInt32BE(trakLen, 0);
    trakHdr.write("trak", 4);
    const trak = Buffer.concat([trakHdr, mdia]);
    const moovLen = trak.length + 8;
    const moovHdr = Buffer.alloc(8);
    moovHdr.writeUInt32BE(moovLen, 0);
    moovHdr.write("moov", 4);
    return Buffer.concat([moovHdr, trak]);
  }

  assert.equal(Math.round(media.parseMp4Fps(buildMockMp4(30000, 1000))), 30);
  assert.equal(media.parseMp4Fps(buildMockMp4(1000, 100)), 10);
  assert.equal(media.parseMp4Fps(buildMockMp4(1500, 100)), 15);

  // Multi-entry stts (variable frame rate / chunked deltas)
  function buildMultiEntryMp4() {
    const stts = Buffer.alloc(32);
    stts.writeUInt32BE(32, 0);
    stts.write("stts", 4);
    stts.writeUInt32BE(0, 8); // version/flags
    stts.writeUInt32BE(2, 12); // entry count = 2
    stts.writeUInt32BE(10, 16); // 10 samples
    stts.writeUInt32BE(100, 20); // delta 100
    stts.writeUInt32BE(10, 24); // 10 samples
    stts.writeUInt32BE(200, 28); // delta 200 (avg delta = 150)

    const hdlr = Buffer.alloc(32);
    hdlr.writeUInt32BE(32, 0);
    hdlr.write("hdlr", 4);
    hdlr.write("vide", 16);

    const mdhd = Buffer.alloc(32);
    mdhd.writeUInt32BE(32, 0);
    mdhd.write("mdhd", 4);
    mdhd.writeUInt32BE(1500, 20); // timescale 1500 -> 1500 / 150 = 10 fps

    const stbl = Buffer.concat([Buffer.from([0, 0, 0, stts.length + 8, 115, 116, 98, 108]), stts]);
    const minf = Buffer.concat([Buffer.from([0, 0, 0, stbl.length + 8, 109, 105, 110, 102]), stbl]);
    const mdiaLen = mdhd.length + hdlr.length + minf.length + 8;
    const mdiaHdr = Buffer.alloc(8);
    mdiaHdr.writeUInt32BE(mdiaLen, 0);
    mdiaHdr.write("mdia", 4);
    const mdia = Buffer.concat([mdiaHdr, mdhd, hdlr, minf]);
    const trakLen = mdia.length + 8;
    const trakHdr = Buffer.alloc(8);
    trakHdr.writeUInt32BE(trakLen, 0);
    trakHdr.write("trak", 4);
    const trak = Buffer.concat([trakHdr, mdia]);
    const moovLen = trak.length + 8;
    const moovHdr = Buffer.alloc(8);
    moovHdr.writeUInt32BE(moovLen, 0);
    moovHdr.write("moov", 4);
    return Buffer.concat([moovHdr, trak]);
  }
  assert.equal(media.parseMp4Fps(buildMultiEntryMp4()), 10);

  // Unaligned moov inside buffer (e.g. from tail scan)
  const moovAlone = buildMockMp4(1000, 100);
  const unalignedBuf = Buffer.concat([Buffer.from([1, 2, 3, 4, 5, 6, 7]), moovAlone]);
  assert.equal(media.parseMp4Fps(unalignedBuf), 10);

  // Edge cases
  assert.equal(media.parseMp4Fps(null), null);
  assert.equal(media.parseMp4Fps(new ArrayBuffer(0)), null);
  assert.equal(media.parseMp4Fps(new Uint8Array([1, 2, 3, 4])), null);
});

test("parseWebmFps parses frame rate from DefaultDuration, FrameRate float, and clusters", () => {
  // Mock WebM with DefaultDuration (ID 0x23E383, len 4: 0x84, 33333333 ns -> 30 fps)
  const buf30 = Buffer.alloc(8);
  buf30[0] = 0x23; buf30[1] = 0xE3; buf30[2] = 0x83; buf30[3] = 0x84;
  buf30.writeUInt32BE(33333333, 4);
  assert.equal(Math.round(media.parseWebmFps(buf30)), 30);

  // DefaultDuration: 100,000,000 ns -> 10 fps
  const buf10 = Buffer.alloc(8);
  buf10[0] = 0x23; buf10[1] = 0xE3; buf10[2] = 0x83; buf10[3] = 0x84;
  buf10.writeUInt32BE(100000000, 4);
  assert.equal(media.parseWebmFps(buf10), 10);

  // Matroska FrameRate float element (0x2383E3)
  const bufFloat = Buffer.alloc(8);
  bufFloat[0] = 0x23; bufFloat[1] = 0x83; bufFloat[2] = 0xE3; bufFloat[3] = 0x84;
  bufFloat.writeFloatBE(12.0, 4);
  assert.equal(media.parseWebmFps(bufFloat), 12);

  // Forward multi-cluster and multi-track SimpleBlock parsing
  // Cluster 1 (base timecode 0):
  //   Track 1 (audio): block rel tc 0
  //   Track 2 (video): block rel tc 0, block rel tc 100
  // Cluster 2 (base timecode 200):
  //   Track 2 (video): block rel tc 0 (abs 200), block rel tc 100 (abs 300)
  // Total video deltas: 100ms each -> 10 fps
  const c1 = [
    0x1F, 0x43, 0xB6, 0x75, 0x96, // len 22
    0xE7, 0x81, 0x00, // timecode 0
    0xA3, 0x84, 0x81, 0x00, 0x00, 0x80, // track 1 (audio) rel tc 0
    0xA3, 0x84, 0x82, 0x00, 0x00, 0x80, // track 2 (video) rel tc 0
    0xA3, 0x84, 0x82, 0x00, 0x64, 0x80, // track 2 (video) rel tc 100
  ];
  const c2 = [
    0x1F, 0x43, 0xB6, 0x75, 0x91, // len 17
    0xE7, 0x82, 0x00, 0xC8, // timecode 200
    0xA3, 0x84, 0x82, 0x00, 0x00, 0x80, // track 2 (video) rel tc 0 -> abs 200
    0xA3, 0x84, 0x82, 0x00, 0x64, 0x80, // track 2 (video) rel tc 100 -> abs 300
  ];
  const clusterBuf = Buffer.from([...c1, ...c2]);
  assert.equal(media.parseWebmFps(clusterBuf), 10);

  // Edge cases
  assert.equal(media.parseWebmFps(null), null);
  assert.equal(media.parseWebmFps(new ArrayBuffer(0)), null);
  assert.equal(media.parseWebmFps(new Uint8Array([1, 2, 3])), null);
});

test("detectVideoFps extracts frame rate from File/Blob like objects, including non-faststart MP4", async () => {
  const buf = Buffer.alloc(8);
  buf[0] = 0x23; buf[1] = 0xE3; buf[2] = 0x83; buf[3] = 0x84;
  buf.writeUInt32BE(33333333, 4);

  const mockFile = {
    size: buf.length,
    slice: () => ({
      arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    }),
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
  };

  const detected = await media.detectVideoFps(mockFile);
  assert.equal(Math.round(detected), 30);

  // Non-faststart MP4: ftyp (24 bytes) + mdat (3MB) + moov (10 fps)
  const stts = Buffer.alloc(24);
  stts.writeUInt32BE(24, 0); stts.write("stts", 4);
  stts.writeUInt32BE(0, 8); stts.writeUInt32BE(1, 12);
  stts.writeUInt32BE(100, 16); stts.writeUInt32BE(100, 20);
  const hdlr = Buffer.alloc(32);
  hdlr.writeUInt32BE(32, 0); hdlr.write("hdlr", 4); hdlr.write("vide", 16);
  const mdhd = Buffer.alloc(32);
  mdhd.writeUInt32BE(32, 0); mdhd.write("mdhd", 4); mdhd.writeUInt32BE(1000, 20);
  const stbl = Buffer.concat([Buffer.from([0, 0, 0, stts.length + 8, 115, 116, 98, 108]), stts]);
  const minf = Buffer.concat([Buffer.from([0, 0, 0, stbl.length + 8, 109, 105, 110, 102]), stbl]);
  const mdiaLen = mdhd.length + hdlr.length + minf.length + 8;
  const mdiaHdr = Buffer.alloc(8);
  mdiaHdr.writeUInt32BE(mdiaLen, 0); mdiaHdr.write("mdia", 4);
  const mdia = Buffer.concat([mdiaHdr, mdhd, hdlr, minf]);
  const trakLen = mdia.length + 8;
  const trakHdr = Buffer.alloc(8);
  trakHdr.writeUInt32BE(trakLen, 0); trakHdr.write("trak", 4);
  const trak = Buffer.concat([trakHdr, mdia]);
  const moovLen = trak.length + 8;
  const moovHdr = Buffer.alloc(8);
  moovHdr.writeUInt32BE(moovLen, 0); moovHdr.write("moov", 4);
  const moov = Buffer.concat([moovHdr, trak]);

  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0); ftyp.write("ftyp", 4);
  const mdatSize = 3 * 1024 * 1024;
  const mdatHdr = Buffer.alloc(8);
  mdatHdr.writeUInt32BE(mdatSize, 0); mdatHdr.write("mdat", 4);

  const totalSize = 24 + mdatSize + moov.length;
  const mockNonFaststart = {
    size: totalSize,
    slice: (start, end) => {
      const len = Math.min(end, totalSize) - start;
      const b = Buffer.alloc(len);
      if (start < 24) ftyp.copy(b, 0, start, Math.min(24, start + len));
      if (start < 32 && start + len > 24) {
        const srcStart = Math.max(0, start - 24);
        const dstStart = Math.max(0, 24 - start);
        mdatHdr.copy(b, dstStart, srcStart, Math.min(8, srcStart + (len - dstStart)));
      }
      const moovStart = 24 + mdatSize;
      if (start + len > moovStart) {
        const srcStart = Math.max(0, start - moovStart);
        const dstStart = Math.max(0, moovStart - start);
        moov.copy(b, dstStart, srcStart, Math.min(moov.length, srcStart + (len - dstStart)));
      }
      return { arrayBuffer: () => Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
    },
    arrayBuffer: () => Promise.reject(new Error("Should use slice")),
  };

  const detectedNonFaststart = await media.detectVideoFps(mockNonFaststart);
  assert.equal(detectedNonFaststart, 10);

  assert.equal(await media.detectVideoFps(null), null);
  assert.equal(await media.detectVideoFps({}), null);
});