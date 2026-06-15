// index.js — the effect registry. Order here is the order shown in the UI.
import none from './none.js';
import halftone from './halftone.js';
import dither from './dither.js';
import ascii from './ascii.js';
import riso from './riso.js';
import xerox from './xerox.js';
import stamp from './stamp.js';
import glitch from './glitch.js';
import rgbShift from './rgb-shift.js';
import pixelSort from './pixel-sort.js';
import gradientMap from './gradient-map.js';
import tone from './tone.js';
import hueSat from './hue-sat.js';

export default [
  none,
  halftone, dither, ascii, riso, xerox, stamp,
  glitch, rgbShift, pixelSort,
  gradientMap, tone, hueSat,
];
