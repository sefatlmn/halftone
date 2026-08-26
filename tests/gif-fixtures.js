const WIDTH = 6;
const HEIGHT = 4;
const RED = 1;
const BLUE = 2;
const GREEN = 3;
const TRANSPARENT = 0;

function pushBytes(target, ...bytes) {
  target.push(...bytes);
}

function pushWord(target, value) {
  pushBytes(target, value & 0xff, (value >> 8) & 0xff);
}

function encodeLzw(indices) {
  const minimumCodeSize = 2;
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  const codeSize = minimumCodeSize + 1;
  // Reset before each pixel so this small fixture never depends on a
  // dictionary-width transition. The resulting stream is intentionally
  // uncompressed but follows the GIF LZW code stream exactly.
  const codes = [];
  for (const index of indices) {
    codes.push({ value: clearCode, size: codeSize });
    codes.push({ value: index, size: codeSize });
  }
  codes.push({ value: endCode, size: codeSize });

  const bytes = [];
  let bit = 0;
  for (const { value, size } of codes) {
    for (let offset = 0; offset < size; offset += 1) {
      if (value & (1 << offset)) {
        bytes[bit >> 3] = (bytes[bit >> 3] || 0) | (1 << (bit & 7));
      } else {
        bytes[bit >> 3] = bytes[bit >> 3] || 0;
      }
      bit += 1;
    }
  }
  return bytes;
}

function addGraphicControlExtension(bytes, disposalType, delay = 10) {
  pushBytes(bytes, 0x21, 0xf9, 0x04, (disposalType << 2) | 0x01);
  pushWord(bytes, delay);
  pushBytes(bytes, TRANSPARENT, 0x00);
}

function addFrame(bytes, {
  left = 0,
  top = 0,
  width,
  height,
  pixels,
  disposalType = 1,
}) {
  addGraphicControlExtension(bytes, disposalType);
  pushBytes(bytes, 0x2c);
  pushWord(bytes, left);
  pushWord(bytes, top);
  pushWord(bytes, width);
  pushWord(bytes, height);
  pushBytes(bytes, 0x00, 0x02);
  const compressed = encodeLzw(pixels);
  for (let offset = 0; offset < compressed.length; offset += 255) {
    const block = compressed.slice(offset, offset + 255);
    pushBytes(bytes, block.length, ...block);
  }
  pushBytes(bytes, 0x00);
}

function makeGif(frames) {
  const bytes = [];
  pushBytes(bytes, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  pushWord(bytes, WIDTH);
  pushWord(bytes, HEIGHT);
  // Global four-color table, 8-bit color resolution, no sorting.
  pushBytes(bytes, 0xf1, 0x00, 0x00);
  pushBytes(
    bytes,
    0x00, 0x00, 0x00, // transparent index
    0xeb, 0x28, 0x23, // red
    0x1e, 0x55, 0xe1, // blue
    0x28, 0xaf, 0x5a, // green
  );
  for (const frame of frames) addFrame(bytes, frame);
  pushBytes(bytes, 0x3b);
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

const solidRed = Array(WIDTH * HEIGHT).fill(RED);
const bluePatch = [BLUE, BLUE, BLUE, BLUE];
const transparentGreenPatch = [
  TRANSPARENT, GREEN,
  GREEN, TRANSPARENT,
];

export function makeDisposal3Gif() {
  return makeGif([
    { width: WIDTH, height: HEIGHT, pixels: solidRed, disposalType: 1 },
    { left: 1, top: 1, width: 2, height: 2, pixels: bluePatch, disposalType: 3 },
    { left: 1, top: 1, width: 2, height: 2, pixels: transparentGreenPatch, disposalType: 1 },
  ]);
}

export function makeDisposal2Gif() {
  return makeGif([
    { width: WIDTH, height: HEIGHT, pixels: solidRed, disposalType: 1 },
    { left: 1, top: 1, width: 2, height: 2, pixels: bluePatch, disposalType: 2 },
    { left: 3, top: 0, width: 2, height: 2, pixels: transparentGreenPatch, disposalType: 1 },
  ]);
}

export const disposalFixtureSize = Object.freeze({ width: WIDTH, height: HEIGHT });