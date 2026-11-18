// THE WORLD IN ONE DAY — Tuesday 17 November 2026.
// A code-drawn newspaper poster: 34 verified stories from one day.
// Written fresh from scratch: own PNG encoder, own supersampled rasterizer,
// and two original typefaces (a Didone-style serif display face and a clean
// grotesque sans) built from outline geometry. Stdlib only, no network,
// deterministic: the same bytes on every run.
import * as fs from "node:fs";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- canvas ----
// Everything is drawn at 4x supersampling into an RGB buffer, then box
// downsampled to 1024x1024. The supersampling is what makes the type edges
// genuinely smooth instead of stair-stepped.
const W = 1024;
const H = 1024;
const SS = 4;
const CW = W * SS;
const CH = H * SS;
const canvas = Buffer.alloc(CW * CH * 3);

type RGB = [number, number, number];
const C = (r: number, g: number, b: number): RGB => [r, g, b];

function fillCanvas(rgb: RGB): void {
  for (let i = 0; i < CW * CH; i++) {
    canvas[i * 3] = rgb[0];
    canvas[i * 3 + 1] = rgb[1];
    canvas[i * 3 + 2] = rgb[2];
  }
}

// Fill an axis-aligned rect given in 1024-space coordinates.
function rectFill(x0: number, y0: number, x1: number, y1: number, rgb: RGB): void {
  const ax = Math.max(0, Math.round(x0 * SS));
  const ay = Math.max(0, Math.round(y0 * SS));
  const bx = Math.min(CW, Math.round(x1 * SS));
  const by = Math.min(CH, Math.round(y1 * SS));
  for (let y = ay; y < by; y++) {
    let p = (y * CW + ax) * 3;
    for (let x = ax; x < bx; x++) {
      canvas[p] = rgb[0]; canvas[p + 1] = rgb[1]; canvas[p + 2] = rgb[2];
      p += 3;
    }
  }
}

// Vertical gradient rect (1024-space coords), top color -> bottom color.
function rectGradient(x0: number, y0: number, x1: number, y1: number, top: RGB, bot: RGB): void {
  const ax = Math.max(0, Math.round(x0 * SS));
  const ay = Math.max(0, Math.round(y0 * SS));
  const bx = Math.min(CW, Math.round(x1 * SS));
  const by = Math.min(CH, Math.round(y1 * SS));
  const span = Math.max(1, by - ay);
  for (let y = ay; y < by; y++) {
    const t = (y - ay) / span;
    const r = Math.round(top[0] + (bot[0] - top[0]) * t);
    const g = Math.round(top[1] + (bot[1] - top[1]) * t);
    const b = Math.round(top[2] + (bot[2] - top[2]) * t);
    let p = (y * CW + ax) * 3;
    for (let x = ax; x < bx; x++) {
      canvas[p] = r; canvas[p + 1] = g; canvas[p + 2] = b;
      p += 3;
    }
  }
}

// -------------------------------------------------------------- polygons ----
// A path is a closed polygon in 1024-space coordinates (floats allowed).
// A shape is [outer, ...holes]; fillShape paints it with the even-odd rule.
// Shapes are painted one at a time and overwrite, so overlapping shapes of
// the same color union cleanly while holes stay holes.
type Pt = [number, number];
type Path = Pt[];
type Shape = Path[];

function fillShape(paths: Shape, rgb: RGB): void {
  // Collect edges in supersampled pixel space.
  const edges: Array<[number, number, number, number]> = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const a = path[i];
      const b = path[(i + 1) % n];
      const x0 = a[0] * SS, y0 = a[1] * SS;
      const x1 = b[0] * SS, y1 = b[1] * SS;
      if (y0 === y1) continue; // horizontal edges never cross a scanline center
      edges.push([x0, y0, x1, y1]);
      if (y0 < minY) minY = y0;
      if (y0 > maxY) maxY = y0;
      if (y1 < minY) minY = y1;
      if (y1 > maxY) maxY = y1;
    }
  }
  if (edges.length === 0) return;
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(CH - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let e = 0; e < edges.length; e++) {
      const [x0, y0, x1, y1] = edges[e];
      if ((y0 <= yc && yc < y1) || (y1 <= yc && yc < y0)) {
        xs.push(x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(CW, Math.floor(xs[k + 1] - 0.5) + 1);
      let p = (y * CW + xa) * 3;
      for (let x = xa; x < xb; x++) {
        canvas[p] = rgb[0]; canvas[p + 1] = rgb[1]; canvas[p + 2] = rgb[2];
        p += 3;
      }
    }
  }
}

function polyShape(pts: Path, rgb: RGB): void {
  fillShape([pts], rgb);
}

// Ellipse outline (closed polygon) in 1024-space coords.
function ellipsePath(cx: number, cy: number, rx: number, ry: number, n = 48): Path {
  const pts: Path = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function circleFill(cx: number, cy: number, r: number, rgb: RGB): void {
  fillShape([ellipsePath(cx, cy, r, r, 40)], rgb);
}

function ellipseFill(cx: number, cy: number, rx: number, ry: number, rgb: RGB): void {
  fillShape([ellipsePath(cx, cy, rx, ry, 48)], rgb);
}

// Ring: outer ellipse minus inner ellipse (even-odd, one shape).
function ringFill(cx: number, cy: number, rx: number, ry: number, t: number, rgb: RGB): void {
  fillShape([ellipsePath(cx, cy, rx, ry, 48), ellipsePath(cx, cy, rx - t, ry - t, 40)], rgb);
}

// Thick straight segment as a quad (1024-space coords).
function segQuad(x0: number, y0: number, x1: number, y1: number, w: number): Path {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
}

function lineDraw(x0: number, y0: number, x1: number, y1: number, w: number, rgb: RGB): void {
  fillShape([segQuad(x0, y0, x1, y1, w)], rgb);
}

// Arc polyline points (degrees, y-down screen space: angle grows clockwise
// visually because y points down; callers use the convention they need).
function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): Path {
  const pts: Path = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

// Downsample the 4x buffer to 1024x1024 with a box filter.
function downsample(): Buffer {
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        let p = ((y * SS + sy) * CW + x * SS) * 3;
        for (let sx = 0; sx < SS; sx++) {
          r += canvas[p]; g += canvas[p + 1]; b += canvas[p + 2];
          p += 3;
        }
      }
      const q = (y * W + x) * 3;
      out[q] = Math.round(r / (SS * SS));
      out[q + 1] = Math.round(g / (SS * SS));
      out[q + 2] = Math.round(b / (SS * SS));
    }
  }
  return out;
}

// ------------------------------------------------------------------ PNG ------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ============================================================ TYPEFACES =====
// Two original faces, both defined as outline geometry on a 100-unit em
// (cap height 70, baseline 0, y grows UP in glyph space; the text engine
// flips to screen space). Curves are finely segmented arcs so rounds are
// genuinely round. A glyph is a list of shapes; a shape is [outer, ...holes]
// filled even-odd; shapes union by overwrite, so strokes may overlap freely
// while counters stay open.

interface Glyph { adv: number; shapes: Shape[]; }
type Face = Record<string, Glyph>;

// --- glyph-space geometry helpers (y-up) ---
function gArc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): Path {
  const pts: Path = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
function gEllipse(cx: number, cy: number, rx: number, ry: number, n = 44): Path {
  return gArc(cx, cy, rx, ry, 0, 360, n);
}
function gRect(x0: number, y0: number, x1: number, y1: number): Path {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
function gDiag(x0: number, y0: number, x1: number, y1: number, w: number): Path {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
}
// Thick arc band: outer arc a0->a1, inner arc back. Constant thickness t.
function gBand(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, t: number, n = 30): Path {
  return [...gArc(cx, cy, rx, ry, a0, a1, n), ...gArc(cx, cy, rx - t, ry - t, a1, a0, n)];
}
// Contrast band: inner ellipse offset so the stroke is thick on one side
// and thin on the other (the Didone trick).
function gBandC(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number,
  tx: number, ty: number, ox: number, oy: number, n = 30): Path {
  return [...gArc(cx, cy, rx, ry, a0, a1, n),
    ...gArc(cx + ox, cy + oy, rx - tx, ry - ty, a1, a0, n)];
}
// Smooth stroke along a spine: quads between points + discs at joints.
function gStroke(spine: Path, w: number): Shape[] {
  const shapes: Shape[] = [];
  for (let i = 0; i + 1 < spine.length; i++) {
    shapes.push([gDiag(spine[i][0], spine[i][1], spine[i + 1][0], spine[i + 1][1], w)]);
  }
  for (const [x, y] of spine) shapes.push([gEllipse(x, y, w / 2, w / 2, 18)]);
  return shapes;
}
const G = (adv: number, shapes: Shape[]): Glyph => ({ adv, shapes });
const S1 = (p: Path): Shape => [p];

// ------------------------------------------------------- sans grotesque ----
// Clean news sans, parameterized by stem width s so one construction yields
// regular, medium and bold weights with identical proportions.
function buildSans(s: number): Face {
  const f: Face = {};
  const mid = s * 0.85;
  f[" "] = G(28, []);
  f["A"] = G(72, [[[[0, 0], [36, 72], [72, 0], [59, 0], [52, 26], [20, 26], [13, 0]],
    [[36, 44], [23, 34], [49, 34]]]]);
  f["B"] = G(68, [S1(gRect(0, 0, s, 70)),
    S1(gBand(s, 52.5, 68 - s, 17.5, 90, -90, s)),
    S1(gBand(s, 17.5, 68 - s, 17.5, 90, -90, s))]);
  f["C"] = G(70, [S1(gBand(36, 35, 34, 35, 55, 305, s))]);
  f["D"] = G(70, [S1(gRect(0, 0, s, 70)), S1(gBand(s, 35, 70 - s, 35, 90, -90, s))]);
  f["E"] = G(62, [S1(gRect(0, 0, s, 70)), S1(gRect(0, 70 - s, 62, 70)),
    S1(gRect(0, 35 - mid / 2, 50, 35 + mid / 2)), S1(gRect(0, 0, 62, s))]);
  f["F"] = G(58, [S1(gRect(0, 0, s, 70)), S1(gRect(0, 70 - s, 58, 70)),
    S1(gRect(0, 35 - mid / 2, 48, 35 + mid / 2))]);
  f["G"] = G(72, [S1(gBand(36, 35, 34, 35, 55, 305, s)),
    S1(gRect(38, 26, 70, 26 + s)), S1(gRect(70 - s, 12, 70, 26 + s))]);
  f["H"] = G(72, [S1(gRect(0, 0, s, 70)), S1(gRect(72 - s, 0, 72, 70)),
    S1(gRect(0, 35 - mid / 2, 72, 35 + mid / 2))]);
  f["I"] = G(26, [S1(gRect(5, 0, 5 + s + 2, 70))]);
  f["J"] = G(56, [S1(gRect(56 - s, 16, 56, 70)),
    S1(gBand(30, 16, 26, 16, 0, -180, s))]);
  f["K"] = G(68, [S1(gRect(0, 0, s, 70)),
    S1(gDiag(s + 2, 36, 68, 70, s)), S1(gDiag(s + 6, 32, 68, 0, s))]);
  f["L"] = G(58, [S1(gRect(0, 0, s, 70)), S1(gRect(0, 0, 58, s))]);
  f["M"] = G(84, [S1(gRect(0, 0, s, 70)), S1(gRect(84 - s, 0, 84, 70)),
    S1(gDiag(s, 70, 42, 16, mid)), S1(gDiag(84 - s, 70, 42, 16, mid))]);
  f["N"] = G(72, [S1(gRect(0, 0, s, 70)), S1(gRect(72 - s, 0, 72, 70)),
    S1(gDiag(3, 68, 69, 2, mid))]);
  f["O"] = G(72, [[[gEllipse(36, 35, 35, 36)][0], gEllipse(36, 35, 35 - s, 36 - s)]]);
  f["P"] = G(64, [S1(gRect(0, 0, s, 70)), S1(gBand(s, 52, 64 - s, 18, 90, -90, s))]);
  f["Q"] = G(72, [[[gEllipse(36, 35, 35, 36)][0], gEllipse(36, 35, 35 - s, 36 - s)],
    S1(gDiag(44, 16, 68, -6, mid))]);
  f["R"] = G(68, [S1(gRect(0, 0, s, 70)), S1(gBand(s, 52, 64 - s, 18, 90, -90, s)),
    S1(gDiag(s + 8, 34, 68, 0, s))]);
  // S spine: two arcs flowing through the middle, constant stroke.
  {
    const spine: Path = [];
    for (const a of [30, 60, 90, 120, 150, 180, 210, 240, 270]) {
      const r = (a * Math.PI) / 180;
      spine.push([32 + 18 * Math.cos(r), 50 + 18 * Math.sin(r)]);
    }
    for (const a of [90, 60, 30, 0, -30, -60, -90, -120, -150]) {
      const r = (a * Math.PI) / 180;
      spine.push([32 + 18 * Math.cos(r), 20 + 18 * Math.sin(r)]);
    }
    f["S"] = G(64, gStroke(spine, s));
  }
  f["T"] = G(62, [S1(gRect(0, 70 - s, 62, 70)), S1(gRect(31 - s / 2, 0, 31 + s / 2, 70 - s))]);
  f["U"] = G(70, [S1(gRect(0, 14, s, 70)), S1(gRect(70 - s, 14, 70, 70)),
    S1(gBand(35, 16, 35, 16, 180, 360, s))]);
  f["V"] = G(70, [S1(gDiag(0, 70, 35, -2, s)), S1(gDiag(70, 70, 35, -2, s))]);
  f["W"] = G(92, [S1(gDiag(0, 70, 23, -2, s)), S1(gDiag(23, -2, 46, 40, s)),
    S1(gDiag(46, 40, 69, -2, s)), S1(gDiag(69, -2, 92, 70, s))]);
  f["X"] = G(68, [S1(gDiag(0, 70, 68, 0, s)), S1(gDiag(68, 70, 0, 0, s))]);
  f["Y"] = G(66, [S1(gDiag(0, 70, 33, 32, s)), S1(gDiag(66, 70, 33, 32, s)),
    S1(gRect(33 - s / 2, 0, 33 + s / 2, 36))]);
  f["Z"] = G(62, [S1(gRect(0, 70 - s, 62, 70)), S1(gDiag(58, 68, 4, 2, mid)), S1(gRect(0, 0, 62, s))]);
  // Digits (tabular, adv 58).
  f["0"] = G(58, [[[gEllipse(29, 35, 28, 36)][0], gEllipse(29, 35, 28 - s, 36 - s)]]);
  f["1"] = G(58, [S1(gDiag(10, 52, 26, 70, mid)), S1(gRect(24, 0, 24 + s, 70)), S1(gRect(14, 0, 44, s))]);
  f["2"] = G(58, [S1(gBand(29, 50, 26, 20, 10, 195, s)),
    S1(gDiag(8, 46, 52, 6, s)), S1(gRect(2, 0, 56, s))]);
  f["3"] = G(60, [S1(gBand(30, 52, 26, 18, 140, -70, s)),
    S1(gBand(30, 18, 28, 18, 90, -160, s))]);
  f["4"] = G(56, [S1(gDiag(44, 70, 8, 18, mid)), S1(gRect(4, 16, 52, 16 + s)), S1(gRect(40, 0, 40 + s, 70))]);
  f["5"] = G(58, [S1(gRect(4, 70 - s, 54, 70)), S1(gRect(4, 36, 4 + s, 70)),
    S1(gRect(4, 36 - mid, 32, 36)), S1(gBand(28, 18, 26, 18, 90, -160, s))]);
  f["6"] = G(58, [[[gEllipse(29, 20, 27, 21)][0], gEllipse(29, 20, 27 - s, 21 - s)],
    S1(gBand(29, 46, 24, 22, 45, 215, s))]);
  f["7"] = G(58, [S1(gRect(2, 70 - s, 56, 70)), S1(gDiag(52, 68, 24, 0, s))]);
  f["8"] = G(58, [[[gEllipse(29, 51, 25, 19)][0], gEllipse(29, 51, 25 - s, 19 - s)],
    [[gEllipse(29, 19, 28, 20)][0], gEllipse(29, 19, 28 - s, 20 - s)]]);
  f["9"] = G(58, [[[gEllipse(29, 50, 27, 21)][0], gEllipse(29, 50, 27 - s, 21 - s)],
    S1(gRect(56 - s, 16, 56, 56)), S1(gBand(29, 18, 27, 18, 0, -180, s))]);
  // Punctuation.
  f["."] = G(30, [S1(gEllipse(15, 6, 6.5, 6.5, 18))]);
  f[","] = G(30, [S1(gEllipse(15, 6, 6.5, 6.5, 18)), S1(gDiag(19, 8, 9, -12, 7))]);
  f[":"] = G(32, [S1(gEllipse(16, 52, 6.5, 6.5, 18)), S1(gEllipse(16, 14, 6.5, 6.5, 18))]);
  f[";"] = G(32, [S1(gEllipse(16, 52, 6.5, 6.5, 18)), S1(gEllipse(16, 8, 6.5, 6.5, 18)),
    S1(gDiag(20, 10, 10, -12, 7))]);
  f["'"] = G(26, [S1(gDiag(16, 70, 10, 52, 9))]);
  f["’"] = f["'"];
  f["-"] = G(38, [S1(gRect(4, 28, 34, 28 + mid))]);
  f["–"] = G(48, [S1(gRect(2, 28, 46, 28 + mid))]);
  f["—"] = G(64, [S1(gRect(0, 28, 64, 28 + mid))]);
  f["%"] = G(64, [[[gEllipse(16, 54, 11, 12)][0], gEllipse(16, 54, 5, 6)],
    [[gEllipse(48, 16, 11, 12)][0], gEllipse(48, 16, 5, 6)],
    S1(gDiag(14, 6, 52, 66, mid))]);
  f["$"] = G(58, (() => {
    const spine: Path = [];
    for (const a of [30, 60, 90, 120, 150, 180, 210, 240, 270]) {
      const r = (a * Math.PI) / 180;
      spine.push([29 + 16 * Math.cos(r), 50 + 16 * Math.sin(r)]);
    }
    for (const a of [90, 60, 30, 0, -30, -60, -90, -120, -150]) {
      const r = (a * Math.PI) / 180;
      spine.push([29 + 16 * Math.cos(r), 20 + 16 * Math.sin(r)]);
    }
    return [...gStroke(spine, s * 0.9), S1(gRect(29 - s * 0.4, -8, 29 + s * 0.4, 78))];
  })());
  f["+"] = G(58, [S1(gRect(24, 10, 34, 60)), S1(gRect(9, 25, 49, 35))]);
  f["/"] = G(58, [S1(gDiag(12, -2, 46, 72, mid))]);
  f["("] = G(34, [S1(gBand(34, 35, 22, 38, 130, 230, mid))]);
  f[")"] = G(34, [S1(gBand(2, 35, 22, 38, -50, 50, mid))]);
  f["!"] = G(30, [S1(gRect(12, 22, 12 + s, 70)), S1(gEllipse(16, 6, 6.5, 6.5, 18))]);
  f["?"] = G(56, [S1(gBand(28, 52, 24, 18, 10, 200, mid)),
    S1(gDiag(8, 46, 26, 30, mid)), S1(gRect(24, 22, 24 + s, 32)),
    S1(gEllipse(28, 6, 6.5, 6.5, 18))]);
  f['"'] = G(40, [S1(gDiag(10, 70, 14, 54, 8)), S1(gDiag(26, 70, 30, 54, 8))]);
  f["•"] = G(32, [S1(gEllipse(16, 32, 8, 8, 20))]);
  f["·"] = G(26, [S1(gEllipse(13, 32, 5, 5, 16))]);
  return f;
}

// ------------------------------------------------- serif display face ------
// A Didone-style nameplate face: strong thick/thin contrast, bracketed
// slab serifs, sharp apexes, high-contrast rounds (thick sides, thin
// crowns). Used for the masthead, the giant date, the subhead and the
// ALSO header. Only the glyphs those strings need are defined.
function buildSerif(): Face {
  const f: Face = {};
  const T = 15; // thick stem
  const t = 5;  // thin stroke
  f[" "] = G(30, []);
  // Bracketed serif slab centered at cx for a stem of width w, sitting on
  // baseline y and rising `up` units (dir +1) or hanging down (dir -1).
  function slab(cx: number, w: number, y: number, dir: 1 | -1): Path {
    const h = 6, ext = 5;
    const y0 = y, y1 = y + dir * 2.5, y2 = y + dir * 4.5, y3 = y + dir * h;
    return [
      [cx - w / 2 - ext, y0], [cx - w / 2 - ext, y1], [cx - w / 2 - 1.5, y2],
      [cx - w / 2, y3], [cx + w / 2, y3], [cx + w / 2 + 1.5, y2],
      [cx + w / 2 + ext, y1], [cx + w / 2 + ext, y0],
    ];
  }
  // Vertical stem with top and bottom bracketed serifs.
  function stem(x: number, w: number, y0: number, y1: number): Shape[] {
    return [S1(gRect(x, y0, x + w, y1)),
      S1(slab(x + w / 2, w, y1, -1)), S1(slab(x + w / 2, w, y0, 1))];
  }
  // High-contrast ring: thick sides (ts), thin top/bottom (tt).
  function oring(cx: number, cy: number, rx: number, ry: number, ts: number, tt: number): Shape {
    return [gEllipse(cx, cy, rx, ry), gEllipse(cx, cy, rx - ts, ry - tt)];
  }
  f["A"] = G(72, [S1(gDiag(2, 0, 36, 72, T)), S1(gDiag(70, 0, 36, 72, t)),
    S1(gRect(20, 24, 52, 29)), S1(gRect(-4, 0, 11, 4.5)), S1(gRect(61, 0, 76, 4.5))]);
  f["B"] = G(68, [...stem(2, T, 0, 70),
    S1(gBandC(17, 52, 47, 18, 90, -90, 13, 5, 3, 0)),
    S1(gBandC(17, 18, 49, 18, 90, -90, 13, 5, 3, 0))]);
  f["D"] = G(70, [...stem(2, T, 0, 70),
    S1(gBandC(17, 35, 51, 36, 90, -90, 13, 5, 3, 0))]);
  f["E"] = G(62, [...stem(2, T, 0, 70), S1(gRect(2, 64, 58, 70)),
    S1(gRect(2, 32, 48, 37)), S1(gRect(2, 0, 58, 6))]);
  f["F"] = G(58, [...stem(2, T, 0, 70), S1(gRect(2, 64, 56, 70)), S1(gRect(2, 32, 46, 37))]);
  f["H"] = G(72, [...stem(2, T, 0, 70), ...stem(55, T, 0, 70), S1(gRect(2, 32, 70, 37))]);
  f["I"] = G(34, [S1(gRect(9, 0, 24, 70)), S1(slab(16.5, 15, 70, -1)), S1(slab(16.5, 15, 0, 1))]);
  f["L"] = G(60, [...stem(2, T, 0, 70), S1(gRect(2, 0, 56, 6)), S1(gRect(52, 0, 56, 11))]);
  f["M"] = G(86, [...stem(2, T, 0, 70), ...stem(69, T, 0, 70),
    S1(gDiag(15, 68, 42, 6, t)), S1(gDiag(71, 68, 44, 6, t))]);
  f["N"] = G(72, [...stem(2, T, 0, 70), ...stem(55, T, 0, 70), S1(gDiag(15, 68, 57, 2, t))]);
  f["O"] = G(72, [oring(36, 35, 35, 36, 14, 5)]);
  f["P"] = G(64, [...stem(2, T, 0, 70), S1(gBandC(17, 52, 45, 18, 90, -90, 13, 5, 3, 0))]);
  f["R"] = G(68, [...stem(2, T, 0, 70), S1(gBandC(17, 52, 47, 18, 90, -90, 13, 5, 3, 0)),
    S1(gDiag(24, 36, 64, 0, 9)), S1(gRect(58, 0, 70, 4.5))]);
  f["S"] = G(64, [S1(gBandC(32, 52, 30, 18, 30, 270, 11, 5, 2, -2)),
    S1(gBandC(32, 18, 30, 18, 90, -150, 11, 5, -2, 2))]);
  f["T"] = G(64, [S1(gRect(0, 63, 64, 70)),
    S1([[0, 64], [9, 64], [7, 59], [2, 59]]), S1([[64, 64], [55, 64], [57, 59], [62, 59]]),
    ...stem(24.5, T, 0, 64)]);
  f["U"] = G(72, [S1(gRect(2, 20, 17, 70)), S1(slab(9.5, T, 70, -1)),
    S1(gRect(55, 20, 70, 70)), S1(slab(62.5, T, 70, -1)),
    S1(gBandC(36, 22, 34, 22, 180, 360, 13, 5, 0, 2))]);
  f["V"] = G(72, [S1(gDiag(2, 70, 36, -2, T)), S1(gDiag(70, 70, 36, -2, t))]);
  f["W"] = G(88, [S1(gDiag(0, 70, 22, 0, 13)), S1(gDiag(22, 0, 44, 56, t)),
    S1(gDiag(44, 56, 66, 0, t)), S1(gDiag(66, 0, 88, 70, 13)),
    S1(gRect(15, 0, 29, 4)), S1(gRect(59, 0, 73, 4))]);
  f["Y"] = G(72, [S1(gDiag(2, 70, 36, 32, 13)), S1(gDiag(70, 70, 36, 32, t)),
    ...stem(28.5, T, 0, 34)]);
  f["0"] = G(58, [oring(29, 35, 28, 36, 13, 5)]);
  f["1"] = G(58, [S1(gDiag(10, 56, 26, 70, 7)), ...stem(24, 14, 0, 70), S1(gRect(14, 0, 46, 5))]);
  f["2"] = G(58, [S1(gBandC(29, 50, 27, 20, 20, 185, 12, 5, -3, -2)),
    S1(gDiag(7, 47, 50, 4, 8)), S1(gRect(2, 0, 56, 6)), S1(gRect(52, 0, 56, 11))]);
  f["3"] = G(60, [S1(gBandC(26, 52, 30, 18, 140, -70, 12, 5, 3, 0)),
    S1(gBandC(26, 18, 32, 18, 90, -160, 12, 5, 3, 0))]);
  f["4"] = G(58, [S1(gDiag(46, 70, 8, 20, t)), S1(gRect(4, 18, 54, 23)),
    S1(gRect(38, 0, 52, 70)), S1(slab(45, 14, 0, 1))]);
  f["5"] = G(58, [S1(gRect(4, 64, 54, 70)), S1(gRect(4, 36, 17, 66)),
    S1(gRect(4, 32, 32, 36)), S1(gBandC(28, 18, 26, 18, 90, -160, 12, 5, 2, 0))]);
  f["6"] = G(58, [oring(29, 20, 27, 21, 12, 5),
    S1(gBandC(29, 46, 24, 22, 45, 215, 6, 6, 0, 0))]);
  f["7"] = G(58, [S1(gRect(2, 64, 56, 70)),
    S1([[2, 65], [11, 65], [9, 60], [4, 60]]), S1(gDiag(50, 66, 26, 0, t))]);
  f["8"] = G(58, [oring(29, 51, 25, 19, 11, 5), oring(29, 19, 28, 20, 12, 5)]);
  f["9"] = G(58, [oring(29, 50, 27, 21, 12, 5), S1(gRect(43, 14, 56, 54)),
    S1(gBandC(29, 18, 27, 18, 0, -180, 6, 5, 0, 2))]);
  f["."] = G(30, [S1(gEllipse(15, 6, 6.5, 6.5, 18))]);
  f[","] = G(30, [S1(gEllipse(15, 6, 6.5, 6.5, 18)), S1(gDiag(19, 8, 9, -12, 7))]);
  f[":"] = G(32, [S1(gEllipse(16, 52, 6.5, 6.5, 18)), S1(gEllipse(16, 14, 6.5, 6.5, 18))]);
  f["-"] = G(38, [S1(gRect(4, 28, 34, 33))]);
  f["•"] = G(32, [S1(gEllipse(16, 32, 8, 8, 20))]);
  return f;
}

// ------------------------------------------------------------ text engine ---
const KERN: Record<string, number> = {
  "AV": -7, "VA": -7, "AW": -6, "WA": -6, "AY": -5, "YA": -5,
  "TA": -6, "TO": -4, "TW": -5, "TY": -5, "LT": -4, "LY": -4,
  "T,": -5, "Y,": -5, "A,": -4, "V,": -5, "W,": -5, "F,": -4, "P,": -4,
  "T.": -5, "Y.": -5, "V.": -5, "W.": -5, "R,": -3, "O,": -3,
  "17": -2, "7,": -3, "1,": -2, "L ": -2, "A ": -1,
};

function glyphAdvance(face: Face, ch: string): number {
  const g = face[ch];
  return g ? g.adv : 30;
}

function textWidth(str: string, face: Face, size: number, tracking = 0): number {
  let w = 0;
  for (let i = 0; i < str.length; i++) {
    w += glyphAdvance(face, str[i]);
    if (i + 1 < str.length) {
      w += tracking;
      const k = KERN[str[i] + str[i + 1]];
      if (k) w += k;
    }
  }
  return (w * size) / 100;
}

// Draw one line. (x, baselineY) is the baseline start in 1024-space coords.
// align: "left" | "center" | "right" relative to x.
function drawText(str: string, x: number, baselineY: number, face: Face, size: number,
  rgb: RGB, tracking = 0, align: "left" | "center" | "right" = "left"): void {
  const w = textWidth(str, face, size, tracking);
  let pen = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  const k = size / 100;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const g = face[ch];
    const adv = g ? g.adv : 30;
    if (g) {
      for (const shape of g.shapes) {
        const mapped: Shape = shape.map((path) =>
          path.map(([gx, gy]): Pt => [pen + gx * k, baselineY - gy * k]));
        fillShape(mapped, rgb);
      }
    }
    pen += adv * k;
    if (i + 1 < str.length) {
      pen += tracking * k;
      const kern = KERN[ch + str[i + 1]];
      if (kern) pen += kern * k;
    }
  }
}

// Fit one line into maxWidth by shrinking size from `size` downward.
function fitText(str: string, x: number, baselineY: number, face: Face, size: number,
  maxWidth: number, rgb: RGB, tracking = 0,
  align: "left" | "center" | "right" = "left"): number {
  let s = size;
  while (s > 4 && textWidth(str, face, s, tracking) > maxWidth) s -= 0.5;
  drawText(str, x, baselineY, face, s, rgb, tracking, align);
  return s;
}

// ============================================================== PALETTE =====
const NAVY = C(10, 30, 60);
const NAVY_DK = C(7, 23, 49);
const NAVY_PANEL = C(14, 40, 78);
const NAVY_LINE = C(28, 58, 100);
const GOLD = C(217, 164, 65);
const GOLD_BRIGHT = C(232, 184, 75);
const GOLD_PALE = C(240, 208, 137);
const CREAM = C(245, 237, 216);
const PAPER = C(247, 241, 226);
const PAPER_DK = C(233, 224, 196);
const INK = C(26, 36, 50);
const SLATE = C(61, 74, 90);
const RED = C(192, 57, 43);
const WHITE = C(250, 248, 242);

// ================================================================== MAP =====
// Stylized continents as [lon, lat] outlines, projected into the map panel.
const MAP_X0 = 12, MAP_X1 = 1012, MAP_Y0 = 162, MAP_Y1 = 270;
function project(lon: number, lat: number): Pt {
  return [MAP_X0 + ((lon + 180) / 360) * (MAP_X1 - MAP_X0),
    MAP_Y0 + ((75 - lat) / 130) * (MAP_Y1 - MAP_Y0)];
}
const CONTINENTS: Array<Array<[number, number]>> = [
  // North America
  [[-168, 66], [-158, 71], [-140, 70], [-128, 70], [-115, 73], [-95, 72], [-85, 70], [-80, 73],
   [-75, 72], [-65, 62], [-55, 52], [-60, 46], [-65, 44], [-70, 42], [-74, 40], [-76, 35],
   [-80, 32], [-81, 26], [-84, 30], [-88, 29], [-94, 29], [-97, 26], [-97, 22], [-94, 18],
   [-90, 16], [-86, 13], [-82, 9], [-79, 9], [-83, 15], [-90, 14], [-95, 16], [-100, 18],
   [-105, 20], [-110, 23], [-114, 28], [-120, 34], [-124, 40], [-124, 48], [-130, 54],
   [-135, 58], [-150, 61], [-162, 58]],
  // Greenland
  [[-58, 64], [-45, 60], [-40, 65], [-30, 68], [-22, 70], [-30, 76], [-50, 78], [-60, 74]],
  // South America
  [[-79, 9], [-72, 11], [-64, 10], [-58, 8], [-52, 5], [-50, 0], [-44, -3], [-35, -8],
   [-40, -20], [-48, -27], [-55, -33], [-62, -39], [-65, -45], [-70, -50], [-74, -53],
   [-72, -42], [-72, -30], [-70, -20], [-77, -12], [-80, -6], [-81, 0]],
  // Africa
  [[-17, 15], [-10, 30], [0, 35], [10, 37], [20, 32], [32, 31], [35, 28], [38, 22],
   [43, 12], [48, 11], [51, 12], [44, 2], [40, -8], [38, -18], [35, -24], [30, -30],
   [20, -35], [17, -32], [14, -22], [12, -12], [9, -2], [9, 4], [-8, 5], [-13, 8]],
  // Madagascar
  [[44, -16], [47, -20], [50, -25], [47, -25], [44, -20]],
  // Eurasia
  [[-10, 36], [-9, 43], [-2, 48], [0, 51], [5, 53], [8, 55], [10, 58], [13, 56], [18, 56],
   [21, 55], [24, 58], [28, 60], [30, 62], [35, 65], [40, 67], [50, 69], [60, 70], [70, 72],
   [80, 73], [90, 75], [100, 77], [110, 76], [120, 73], [130, 72], [140, 72], [150, 70],
   [158, 66], [162, 62], [158, 58], [155, 52], [150, 45], [142, 42], [140, 38], [135, 35],
   [130, 33], [126, 38], [122, 38], [120, 32], [122, 28], [118, 25], [114, 22], [109, 20],
   [105, 10], [103, 2], [100, 6], [98, 10], [94, 17], [91, 22], [88, 22], [85, 19], [80, 15],
   [77, 8], [75, 12], [72, 20], [68, 23], [66, 25], [61, 25], [57, 27], [54, 27], [52, 26],
   [50, 29], [48, 30], [44, 29], [40, 31], [36, 36], [30, 36], [27, 37], [23, 36], [19, 40],
   [15, 40], [12, 42], [8, 38], [3, 37], [-2, 36]],
  // United Kingdom
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53]],
  // Japan
  [[130, 31], [133, 34], [137, 35], [140, 36], [142, 40], [144, 44], [141, 45], [139, 39],
   [135, 34], [131, 33]],
  // Indonesia
  [[95, 5], [100, 0], [105, -5], [110, -7], [115, -8], [120, -10], [125, -9], [131, -3],
   [136, -2], [141, -4], [138, -8], [131, -8], [125, -10], [118, -10], [112, -8], [106, -6],
   [101, 0]],
  // Australia
  [[113, -22], [114, -30], [118, -35], [124, -33], [129, -32], [132, -32], [135, -35],
   [138, -35], [140, -38], [145, -38], [147, -39], [150, -37], [153, -32], [153, -27],
   [150, -23], [146, -19], [142, -11], [137, -12], [135, -15], [132, -12], [130, -12],
   [126, -14], [122, -17], [117, -20]],
  // New Zealand
  [[167, -45], [170, -43], [174, -41], [178, -38], [176, -40], [172, -43], [168, -46]],
];

// City dots: [name, lon, lat, dot nudge, label anchor x, label baseline y, align]
interface City { name: string; lon: number; lat: number; dx: number; dy: number;
  lx: number; ly: number; align: "left" | "center" | "right"; }
const CITIES: City[] = [
  { name: "WASHINGTON", lon: -77, lat: 39, dx: 0, dy: 0, lx: 286, ly: 186, align: "right" },
  { name: "KYIV", lon: 30.5, lat: 50.4, dx: -9, dy: -2, lx: 578, ly: 176, align: "right" },
  { name: "KERCH", lon: 36.7, lat: 45.3, dx: -8, dy: 3, lx: 600, ly: 208, align: "left" },
  { name: "HORMUZ", lon: 56.5, lat: 27, dx: 0, dy: 0, lx: 678, ly: 194, align: "left" },
  { name: "ADEN", lon: 45, lat: 12.8, dx: 0, dy: 0, lx: 637, ly: 232, align: "center" },
  { name: "KIGALI", lon: 30, lat: -1.9, dx: 0, dy: 0, lx: 584, ly: 242, align: "right" },
  { name: "SHENZHEN", lon: 114, lat: 22.5, dx: 0, dy: 0, lx: 818, ly: 194, align: "right" },
  { name: "MANILA", lon: 121, lat: 14.6, dx: 0, dy: 0, lx: 856, ly: 228, align: "left" },
  { name: "TOKYO", lon: 139.7, lat: 35.7, dx: 0, dy: 0, lx: 909, ly: 199, align: "left" },
  { name: "ANDHRA", lon: 80, lat: 16, dx: 0, dy: 0, lx: 734, ly: 228, align: "center" },
];

// ======================================================== lead illustrations =
// Each draws inside (x, y, w, h). Large central subjects, no element
// overlapping another's key feature.
function flame(cx: number, cy: number, s: number): void {
  // Leaning flame silhouette: pointed tip, wavy sides, flat base.
  // Three nested layers (red / orange / yellow) share the outline.
  const outline: Path = [
    [-14, 2], [-13, -6], [-10, -13], [-6, -19], [-1, -27], [3, -31],
    [5, -24], [4, -17], [8, -11], [12, -6], [14, 0], [8, 3], [-8, 3],
  ];
  const layer = (scale: number, dx: number, dy: number, rgb: RGB): void => {
    polyShape(outline.map(([px, py]): Pt => [cx + dx + px * scale * s, cy + dy + py * scale * s]), rgb);
  };
  layer(1.0, 0, 0, C(198, 52, 30));
  layer(0.66, -1 * s, 2 * s, C(232, 110, 30));
  layer(0.38, -1 * s, 4 * s, C(244, 190, 60));
}

function drawBridge(x: number, y: number, w: number, h: number): void {
  rectGradient(x, y, x + w, y + h, C(242, 217, 140), C(232, 199, 120));
  // Sun, far right and clear of the tower.
  circleFill(x + w - 26, y + 15, 11, C(250, 240, 200));
  circleFill(x + w - 26, y + 15, 8, C(252, 246, 220));
  const waterY = y + h * 0.66;
  rectFill(x, waterY, x + w, y + h, C(74, 127, 165));
  for (let i = 0; i < 9; i++) {
    lineDraw(x + 8 + i * 34, waterY + 8 + (i % 3) * 5, x + 26 + i * 34, waterY + 8 + (i % 3) * 5, 1.5, C(140, 180, 205));
  }
  // Bridge: left deck + broken section dipping into the strait.
  const deckY = y + h * 0.5;
  const towerX = x + w * 0.3;
  rectFill(x, deckY, x + w * 0.52, deckY + 5, C(90, 70, 55));
  lineDraw(x + w * 0.52, deckY + 2, x + w * 0.68, waterY - 2, 5, C(90, 70, 55)); // fallen span
  rectFill(x + w * 0.72, deckY, x + w, deckY + 5, C(90, 70, 55));
  // Tower (left of the fire, clear of the sun): twin posts + X brace.
  rectFill(towerX - 5, y + 10, towerX - 1, deckY, C(70, 55, 42));
  rectFill(towerX + 1, y + 10, towerX + 5, deckY, C(70, 55, 42));
  rectFill(towerX - 10, y + 14, towerX + 10, y + 18, C(70, 55, 42));
  lineDraw(towerX - 4, y + 20, towerX + 4, deckY - 4, 1.6, C(70, 55, 42));
  lineDraw(towerX + 4, y + 20, towerX - 4, deckY - 4, 1.6, C(70, 55, 42));
  lineDraw(towerX, y + 12, x + 6, deckY, 1.5, C(110, 90, 70));
  lineDraw(towerX, y + 12, x + w * 0.5, deckY, 1.5, C(110, 90, 70));
  // Fire at the break (sized to stay inside the panel).
  flame(x + w * 0.58, deckY - 6, 0.7);
  // Small boat, far left.
  polyShape([[x + 14, waterY + 8], [x + 40, waterY + 8], [x + 34, waterY + 16], [x + 20, waterY + 16]], C(160, 50, 40));
  rectFill(x + 24, waterY + 2, x + 32, waterY + 8, C(240, 235, 220));
}

function drawTanker(x: number, y: number, w: number, h: number): void {
  rectGradient(x, y, x + w, y + h, C(220, 232, 236), C(190, 208, 216));
  const waterY = y + h * 0.62;
  rectFill(x, waterY, x + w, y + h, C(62, 110, 142));
  for (let i = 0; i < 8; i++) {
    lineDraw(x + 10 + i * 38, waterY + 7 + (i % 2) * 6, x + 28 + i * 38, waterY + 7 + (i % 2) * 6, 1.5, C(130, 175, 200));
  }
  // Distant ship silhouette, far left.
  rectFill(x + 8, waterY - 8, x + 44, waterY - 2, C(90, 105, 115));
  rectFill(x + 28, waterY - 14, x + 36, waterY - 8, C(90, 105, 115));
  // Tanker hull: long dark-red trapezoid, deck structures right.
  const hullY = waterY - 12;
  polyShape([[x + w * 0.12, hullY], [x + w * 0.88, hullY], [x + w * 0.82, waterY + 8],
    [x + w * 0.18, waterY + 8]], C(148, 42, 34));
  rectFill(x + w * 0.12, hullY - 3, x + w * 0.88, hullY, C(120, 34, 28));
  rectFill(x + w * 0.74, hullY - 18, x + w * 0.86, hullY - 3, C(238, 236, 228));
  rectFill(x + w * 0.78, hullY - 24, x + w * 0.83, hullY - 18, C(40, 40, 44));
  // Fire amidships (sized to stay inside the panel).
  flame(x + w * 0.45, hullY - 4, 0.6);
  // Mines in the water, clear of the hull.
  for (const [mx, my] of [[0.2, 0.86], [0.62, 0.9]] as const) {
    const px = x + w * mx, py = y + h * my;
    circleFill(px, py, 4, C(30, 30, 32));
    for (let a = 0; a < 8; a++) {
      const r = (a / 8) * Math.PI * 2;
      lineDraw(px, py, px + 7 * Math.cos(r), py + 7 * Math.sin(r), 1.2, C(30, 30, 32));
    }
  }
}

function drawShenzhen(x: number, y: number, w: number, h: number): void {
  rectGradient(x, y, x + w, y + h, C(107, 74, 138), C(232, 130, 63));
  // Sun sits in the open sky above the low mid-block, clear of all towers.
  circleFill(x + w * 0.40, y + 13, 10, C(248, 214, 150));
  // Skyline silhouettes with lit windows.
  const base = y + h;
  const towers: Array<[number, number, number]> = [
    [0.02, 0.52, 0.16], [0.19, 0.68, 0.13], [0.33, 0.42, 0.15], [0.49, 0.74, 0.14],
    [0.64, 0.55, 0.15], [0.80, 0.64, 0.18],
  ];
  for (const [fx, fh, fw] of towers) {
    const tx = x + w * fx, tw = w * fw, ty = base - h * fh;
    rectFill(tx, ty, tx + tw, base, C(38, 30, 58));
    for (let wy = ty + 6; wy < base - 6; wy += 9) {
      for (let wx = tx + 5; wx < tx + tw - 4; wx += 9) {
        if (((wx * 7 + wy * 13) % 5) < 2) rectFill(wx, wy, wx + 3, wy + 3.5, C(240, 200, 110));
      }
    }
  }
  // Three flags on the tallest tower (center), poles clear of the sun.
  const poleX = x + w * 0.53, poleTop = base - h * 0.74 - 14;
  const flagCols: Array<[RGB, RGB, RGB]> = [
    [C(200, 60, 60), C(250, 245, 235), C(60, 80, 160)],
    [C(200, 40, 40), C(240, 200, 60), C(200, 40, 40)],
    [C(245, 245, 240), C(60, 100, 200), C(200, 50, 50)],
  ];
  for (let i = 0; i < 3; i++) {
    const px = poleX + i * 14;
    lineDraw(px, poleTop, px, poleTop + 16, 1.2, C(240, 240, 235));
    for (let s = 0; s < 3; s++) {
      rectFill(px + 1, poleTop + s * 3, px + 11, poleTop + s * 3 + 3, flagCols[i][s]);
    }
  }
}

function drawJets(x: number, y: number, w: number, h: number): void {
  rectGradient(x, y, x + w, y + h, C(127, 178, 224), C(200, 226, 242));
  // Clouds.
  for (const [cx, cy, s] of [[0.2, 0.2, 1], [0.55, 0.12, 0.8], [0.82, 0.3, 0.9]] as const) {
    const px = x + w * cx, py = y + h * cy;
    ellipseFill(px, py, 20 * s, 7 * s, C(250, 251, 252));
    ellipseFill(px - 12 * s, py + 3 * s, 12 * s, 5 * s, C(250, 251, 252));
    ellipseFill(px + 13 * s, py + 3 * s, 12 * s, 5 * s, C(250, 251, 252));
  }
  const seaY = y + h * 0.88;
  rectFill(x, seaY, x + w, y + h, C(62, 110, 142));
  // Island with palm, bottom left.
  ellipseFill(x + w * 0.14, seaY + 2, 34, 7, C(120, 110, 70));
  lineDraw(x + w * 0.14, seaY, x + w * 0.14 + 4, seaY - 20, 2.5, C(110, 80, 50));
  for (let a = 0; a < 5; a++) {
    const r = Math.PI * (0.15 + a * 0.18);
    lineDraw(x + w * 0.14 + 4, seaY - 20, x + w * 0.14 + 4 + 15 * Math.cos(r), seaY - 20 - 8 * Math.sin(r), 2, C(60, 130, 70));
  }
  // Jet silhouette: thick fuselage + swept wings + tail, flying right.
  const jet = (jx: number, jy: number, s: number): void => {
    polyShape([[jx - 28 * s, jy], [jx + 22 * s, jy - 4.5 * s], [jx + 32 * s, jy],
      [jx + 22 * s, jy + 4.5 * s], [jx - 28 * s, jy + 3 * s]], C(52, 58, 66));
    polyShape([[jx - 2 * s, jy], [jx + 8 * s, jy - 17 * s], [jx + 15 * s, jy - 17 * s],
      [jx + 11 * s, jy]], C(52, 58, 66));
    polyShape([[jx - 22 * s, jy], [jx - 15 * s, jy - 11 * s], [jx - 9 * s, jy - 11 * s],
      [jx - 13 * s, jy]], C(52, 58, 66));
  };
  jet(x + w * 0.32, y + h * 0.42, 1.15);
  jet(x + w * 0.68, y + h * 0.62, 1.0);
  // Contrails, dashed, behind the lead jet.
  for (let i = 0; i < 5; i++) {
    lineDraw(x + w * 0.32 - 34 - i * 12, y + h * 0.42 + 1, x + w * 0.32 - 26 - i * 12, y + h * 0.42 + 1, 1.5, C(245, 248, 250));
  }
}

function drawPentagon(x: number, y: number, w: number, h: number): void {
  rectFill(x, y, x + w, y + h, C(239, 230, 204));
  for (let gx = x + 14; gx < x + w; gx += 14) lineDraw(gx, y, gx, y + h, 0.7, C(222, 212, 182));
  for (let gy = y + 14; gy < y + h; gy += 14) lineDraw(x, gy, x + w, gy, 0.7, C(222, 212, 182));
  // Big navy pentagon, left.
  const cx = x + w * 0.26, cy = y + h * 0.52, r = h * 0.38;
  const pent: Path = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    pent.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  polyShape(pent, C(46, 64, 96));
  const inner: Path = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    inner.push([cx + r * 0.62 * Math.cos(a), cy + r * 0.62 * Math.sin(a)]);
  }
  polyShape(inner, C(66, 86, 120));
  // Gold coin, top right — clear of the bars and the arrow.
  const coinX = x + w - 20, coinY = y + 14;
  circleFill(coinX, coinY, 10, C(212, 164, 60));
  circleFill(coinX, coinY, 7.5, C(232, 190, 90));
  // Descending bars, right side, below the coin.
  const barX0 = x + w * 0.52, barW = w * 0.09, gap = w * 0.035;
  const barBase = y + h - 8;
  const heights = [0.52, 0.42, 0.32, 0.22];
  for (let i = 0; i < 4; i++) {
    const bx = barX0 + i * (barW + gap);
    rectFill(bx, barBase - h * heights[i], bx + barW, barBase, C(178, 52, 40));
  }
  // Trend arrow: floats ABOVE the bar tops with a clear gap, ends left of the coin.
  const ax0 = barX0 - 6, ay0 = barBase - h * 0.62;
  const ax1 = barX0 + 3 * (barW + gap) + barW - 4, ay1 = barBase - h * 0.34;
  lineDraw(ax0, ay0, ax1, ay1, 2.5, C(140, 40, 30));
  polyShape([[ax1, ay1], [ax1 - 9, ay1 - 2], [ax1 - 5, ay1 + 7]], C(140, 40, 30));
}

function drawRwanda(x: number, y: number, w: number, h: number): void {
  rectGradient(x, y, x + w, y + h, C(227, 201, 143), C(214, 182, 120));
  circleFill(x + w - 24, y + 14, 10, C(248, 236, 200));
  // Africa, simplified but recognizable, right of center.
  const ax = x + w * 0.58, ay = y + h * 0.5;
  const africa: Path = [
    [ax - 30, ay - 26], [ax - 8, ay - 30], [ax + 16, ay - 26], [ax + 30, ay - 18],
    [ax + 34, ay - 4], [ax + 26, ay + 8], [ax + 18, ay + 22], [ax + 6, ay + 30],
    [ax - 8, ay + 26], [ax - 18, ay + 12], [ax - 26, ay - 2], [ax - 34, ay - 12],
  ];
  polyShape(africa, C(185, 138, 74));
  // Dotted flight path from the top-left plane down to the pin.
  const px0 = x + w * 0.16, py0 = y + h * 0.14;
  const px1 = ax + 12, py1 = ay - 6;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const bx = (1 - t) * (1 - t) * px0 + 2 * (1 - t) * t * ((px0 + px1) / 2) + t * t * px1;
    const by = (1 - t) * (1 - t) * py0 + 2 * (1 - t) * t * (Math.min(py0, py1) - 14) + t * t * py1;
    circleFill(bx, by, 2, C(110, 80, 45));
  }
  // Small plane at the path start.
  polyShape([[px0 - 11, py0], [px0 + 11, py0 - 2.5], [px0 + 14, py0], [px0 + 11, py0 + 2.5],
    [px0 - 11, py0 + 2.5]], C(70, 70, 74));
  polyShape([[px0, py0], [px0 + 4, py0 - 7.5], [px0 + 8, py0 - 7.5], [px0 + 5, py0]], C(70, 70, 74));
  // Map pin on Rwanda (east-center of the continent).
  const pinX = ax + 12, pinY = ay - 6;
  circleFill(pinX, pinY - 5, 6, C(198, 52, 38));
  polyShape([[pinX - 5, pinY - 2], [pinX + 5, pinY - 2], [pinX, pinY + 8]], C(198, 52, 38));
  circleFill(pinX, pinY - 5, 2.5, C(250, 245, 235));
  // Acacia tree, far left.
  const tx = x + w * 0.12, ty = y + h - 8;
  lineDraw(tx, ty, tx + 3, ty - 22, 3, C(110, 80, 50));
  ellipseFill(tx + 4, ty - 26, 20, 6, C(90, 130, 70));
  ellipseFill(tx + 4, ty - 30, 13, 4.5, C(100, 140, 76));
}

// ================================================================= LAYOUT ===
const sansReg = buildSans(13);
const sansMed = buildSans(15);
const sansBold = buildSans(17);
const serif = buildSerif();

function diamond(cx: number, cy: number, r: number, rgb: RGB): void {
  polyShape([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], rgb);
}

function drawFrame(): void {
  fillCanvas(NAVY_DK);
  rectFill(4, 4, 1020, 7, GOLD);
  rectFill(4, 1017, 1020, 1020, GOLD);
  rectFill(4, 4, 7, 1020, GOLD);
  rectFill(1017, 4, 1020, 1020, GOLD);
  rectFill(10, 10, 1014, 11, GOLD);
  rectFill(10, 1013, 1014, 1014, GOLD);
  rectFill(10, 10, 11, 1014, GOLD);
  rectFill(1013, 10, 1014, 1014, GOLD);
}

function drawMasthead(): void {
  const str = "THE WORLD IN ONE DAY";
  const size = 32, tracking = 10;
  const w = textWidth(str, serif, size, tracking);
  const x0 = 512 - w / 2, x1 = 512 + w / 2;
  // Flanking rules with diamonds.
  rectFill(40, 38, x0 - 20, 39.5, GOLD);
  rectFill(x1 + 20, 38, 984, 39.5, GOLD);
  diamond(x0 - 11, 38.75, 4, GOLD);
  diamond(x1 + 11, 38.75, 4, GOLD);
  drawText(str, 512, 50, serif, size, GOLD_PALE, tracking, "center");
}

function drawDate(): void {
  // Three segments: white TUESDAY, gold 17, white NOVEMBER 2026.
  const segs: Array<[string, RGB]> = [
    ["TUESDAY ", WHITE],
    ["17", GOLD_BRIGHT],
    [" NOVEMBER 2026", WHITE],
  ];
  const tracking = 2;
  let size = 96;
  const total = (s: number): number => segs.reduce((a, [t]) => a + textWidth(t, serif, s, tracking), 0);
  while (size > 40 && total(size) > 988) size -= 0.5;
  let pen = 512 - total(size) / 2;
  const baseline = 58 + size * 0.7;
  for (const [t, rgb] of segs) {
    drawText(t, pen, baseline, serif, size, rgb, tracking, "left");
    pen += textWidth(t, serif, size, tracking);
  }
  // Double gold rule + subhead.
  rectFill(12, 132, 1012, 134, GOLD);
  rectFill(12, 136, 1012, 137, GOLD);
  drawText("34 STORIES THAT DEFINED THE DAY", 512, 156, serif, 20, GOLD, 12, "center");
}

function drawMap(): void {
  rectFill(MAP_X0, MAP_Y0, MAP_X1, MAP_Y1, C(13, 36, 70));
  for (let gx = MAP_X0; gx <= MAP_X1; gx += 62.5) lineDraw(gx, MAP_Y0, gx, MAP_Y1, 0.7, NAVY_LINE);
  for (let gy = MAP_Y0; gy <= MAP_Y1; gy += 27) lineDraw(MAP_X0, gy, MAP_X1, gy, 0.7, NAVY_LINE);
  const land = C(201, 162, 75);
  for (const cont of CONTINENTS) {
    polyShape(cont.map(([lo, la]) => project(lo, la)), land);
  }
  // City labels: navy chips + gold leader lines, then dots on top.
  const labelSize = 11.5;
  const dots: Array<[number, number]> = [];
  for (const city of CITIES) {
    const [dx, dy] = project(city.lon, city.lat);
    const dotX = dx + city.dx, dotY = dy + city.dy;
    dots.push([dotX, dotY]);
    const tw = textWidth(city.name, sansBold, labelSize, 1);
    let chipX0: number;
    if (city.align === "right") chipX0 = city.lx - tw - 4;
    else if (city.align === "center") chipX0 = city.lx - tw / 2 - 4;
    else chipX0 = city.lx - 4;
    const chipY0 = city.ly - labelSize * 0.7 - 3;
    const chipX1 = chipX0 + tw + 8, chipY1 = city.ly + 3;
    rectFill(chipX0, chipY0, chipX1, chipY1, NAVY_DK);
    // Leader from chip edge toward the dot.
    const ccx = (chipX0 + chipX1) / 2, ccy = (chipY0 + chipY1) / 2;
    const ddx = dotX - ccx, ddy = dotY - ccy;
    const hw = (chipX1 - chipX0) / 2, hh = (chipY1 - chipY0) / 2;
    const tt = Math.min(Math.abs(ddx) > 0.01 ? hw / Math.abs(ddx) : 99,
      Math.abs(ddy) > 0.01 ? hh / Math.abs(ddy) : 99);
    const sx = ccx + ddx * Math.min(tt, 1), sy = ccy + ddy * Math.min(tt, 1);
    lineDraw(sx, sy, dotX, dotY, 1, GOLD);
    drawText(city.name, city.lx, city.ly, sansBold, labelSize, CREAM, 1, city.align);
  }
  for (const [dotX, dotY] of dots) {
    circleFill(dotX, dotY, 5, WHITE);
    circleFill(dotX, dotY, 3.2, RED);
  }
  // Panel title chip.
  const title = "WHERE IT HAPPENED";
  const tw = textWidth(title, sansBold, 11, 2);
  rectFill(18, 168, 18 + tw + 12, 185, GOLD);
  drawText(title, 24, 180, sansBold, 11, NAVY_DK, 2, "left");
  // Panel border.
  rectFill(MAP_X0, MAP_Y0, MAP_X1, MAP_Y0 + 1.5, GOLD);
  rectFill(MAP_X0, MAP_Y1 - 1.5, MAP_X1, MAP_Y1, GOLD);
  rectFill(MAP_X0, MAP_Y0, MAP_X0 + 1.5, MAP_Y1, GOLD);
  rectFill(MAP_X1 - 1.5, MAP_Y0, MAP_X1, MAP_Y1, GOLD);
}

interface Lead {
  cat: string; color: RGB; art: (x: number, y: number, w: number, h: number) => void;
  head: string[]; deck: string[];
}
const LEADS: Lead[] = [
  { cat: "EUROPE - WAR", color: C(192, 69, 47), art: drawBridge,
    head: ["CRIMEA BRIDGE", "HIT AGAIN"],
    deck: ["DRONES AND MISSILES DROP THE", "KERCH ROAD ARCH INTO THE STRAIT."] },
  { cat: "GULF - SHIPPING", color: C(46, 125, 107), art: drawTanker,
    head: ["TANKERS HIT BY MINES", "NEAR HORMUZ"],
    deck: ["A FOURTH TANKER CATCHES FIRE AS", "IRAN REPORTS MINE STRIKES."] },
  { cat: "DIPLOMACY - SHENZHEN", color: C(123, 75, 166), art: drawShenzhen,
    head: ["TRUMP LANDS IN ASIA", "FOR APEC"],
    deck: ["MANILA FIRST, THEN SHENZHEN FOR", "THE FIRST XI-TRUMP-PUTIN TALKS."] },
  { cat: "ASIA - SECURITY", color: C(46, 107, 168), art: drawJets,
    head: ["JAPAN SCRAMBLES JETS"],
    deck: ["TWO SUSPECTED RUSSIAN AIRCRAFT", "ENTER AIRSPACE NEAR OKINOSHIMA."] },
  { cat: "UNITED STATES - DEFENCE", color: C(138, 109, 43), art: drawPentagon,
    head: ["PENTAGON FAILS", "ITS AUDIT"],
    deck: ["NINTH STRAIGHT YEAR: BOOKS", "COVERING $4.8 TRILLION UNVERIFIED."] },
  { cat: "EUROPE - MIGRATION", color: C(62, 142, 77), art: drawRwanda,
    head: ["FIVE EU STATES PLAN", "RWANDA HUB"],
    deck: ["GERMANY, DENMARK, AUSTRIA,", "GREECE, NETHERLANDS BACK A HUB."] },
];

function drawLeads(): void {
  const colW = 328, gap = 8, rowH = 152;
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 12 + col * (colW + gap);
    const y = 276 + row * (rowH + 6);
    const lead = LEADS[i];
    rectFill(x, y, x + colW, y + rowH, PAPER);
    rectFill(x, y, x + colW, y + 22, lead.color);
    drawText(lead.cat, x + 10, y + 15.5, sansBold, 12.5, WHITE, 3, "left");
    lead.art(x, y + 22, colW, 58);
    const headSize = 20.5;
    const n = lead.head.length;
    for (let li = 0; li < n; li++) {
      fitText(lead.head[li], x + 10, y + 97 + li * 23, sansBold, headSize, colW - 20, INK, 0.5, "left");
    }
    for (let li = 0; li < lead.deck.length; li++) {
      drawText(lead.deck[li], x + 10, y + 136 + li * 13, sansReg, 11, SLATE, 0.5, "left");
    }
  }
}

interface GridItem { cat: string; lines: string[]; }
const GRID: GridItem[] = [
  { cat: "HEALTH", lines: ["U.S. LOSES MEASLES-FREE", "STATUS: 5,412 CASES, 26 YEARS"] },
  { cat: "MARKETS", lines: ["NVIDIA BEATS, GUIDES TO $130BN", "IN FIRST REPORT WITHOUT HUANG"] },
  { cat: "MARKETS", lines: ["WALL STREET FALLS: S&P -1.0%,", "DOW -1.6%, VIX AT 25.5"] },
  { cat: "SPACE", lines: ["VULCAN GROUNDED: BOOSTER", "FAULT, 40 SATELLITES LOST"] },
  { cat: "TECH", lines: ["U.S. MOVES TO CLOSE AI CHIP", "LOOPHOLE ON DATA CENTERS"] },
  { cat: "TECH", lines: ["JPMORGAN BLAMES SOFTWARE BUG", "FOR MONDAY BANKING OUTAGE"] },
  { cat: "ENERGY", lines: ["OIL RISES ON HORMUZ TENSION:", "BRENT $93.14, WTI $86.01"] },
  { cat: "WEATHER", lines: ["CYCLONE AKVAN NEARS ANDHRA", "COAST; LANDFALL DUE NOV 20"] },
  { cat: "SPORT", lines: ["MOROCCO REACHES FIFA TOP FIVE,", "FIRST AFRICAN SIDE SINCE 1994"] },
  { cat: "SPORT", lines: ["JAY SHAH RE-ELECTED AS ICC", "CHAIRMAN FOR A SECOND TERM"] },
  { cat: "ASIA", lines: ["SEOUL SCRAMBLES JETS TOO;", "TAIWAN RESPONDS TO RUSSIAN JETS"] },
  { cat: "U.S.", lines: ["WHITE HOUSE CURBS TESTIMONY:", "AGENCIES NEED PRIOR APPROVAL"] },
];

function drawGrid(): void {
  const y0 = 592, colW = 328, gap = 8, rowH = 45;
  rectFill(12, y0, 1012, y0 + 4 * rowH, PAPER);
  for (let i = 0; i < 12; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 12 + col * (colW + gap);
    const y = y0 + row * rowH;
    const item = GRID[i];
    // Number badge.
    circleFill(x + 17, y + 22, 12, RED);
    drawText(String(i + 1), x + 17, y + 27, sansBold, 13, WHITE, 0, "center");
    drawText(item.cat, x + 36, y + 13, sansBold, 9.5, RED, 2, "left");
    for (let li = 0; li < item.lines.length; li++) {
      fitText(item.lines[li], x + 36, y + 27 + li * 13, sansMed, 12.5, colW - 44, INK, 0, "left");
    }
    if (col > 0) rectFill(x - gap / 2 - 0.5, y + 5, x - gap / 2 + 0.5, y + rowH - 5, PAPER_DK);
    if (row > 0) rectFill(x + 5, y - 0.5, x + colW - 5, y + 0.5, PAPER_DK);
  }
  rectFill(12, y0, 1012, y0 + 1.5, GOLD);
  rectFill(12, y0 + 4 * rowH - 1.5, 1012, y0 + 4 * rowH, GOLD);
}

const ALSO_LEFT = [
  "DISNEY BEATS: REVENUE $25.9BN, DIVIDEND RAISED",
  "FED'S MUSELEM: MORE HIKES MAY BE NEEDED",
  "NSA NETWORK DOWN; NO SIGN OF CYBERATTACK",
  "APPLE SERVICES HIT BY OUTAGE ON TUESDAY",
  "GAZA FLOODS HIT SHELTERS; TENTS HELD AT BORDER",
  "CYBERCRIME DAMAGES PUT AT $10.5T A YEAR",
  "RICE AGREES 5-YEAR ARSENAL DEAL",
  "PATIDAR SMASHES 135 OFF 48 BALLS",
];
const ALSO_RIGHT = [
  "U.S. RETAIL SALES RISE 0.2% IN OCTOBER",
  "ANTHROPIC IPO PRICES WEDNESDAY, NEAR $1.5T",
  "DRONES OVER BAHRAIN BASE INTERCEPTED",
  "HOUTHIS ADVANCE ON ADEN; FORCES PULL BACK",
  "BUS CRASH IN UTTARAKHAND KILLS 8",
  "DHONI RETIRES FROM IPL AS A PLAYER",
  "SHAMI TO RAJASTHAN; CURRAN TO LUCKNOW",
  "INDIA WINS SAFF TITLE HAT-TRICK",
];

function drawAlso(): void {
  const y0 = 778, y1 = 940;
  rectFill(12, y0, 1012, y1, NAVY_PANEL);
  rectFill(12, y0, 1012, y0 + 1.5, GOLD);
  rectFill(12, y1 - 1.5, 1012, y1, GOLD);
  rectFill(12, y0, 13.5, y1, GOLD);
  rectFill(1010.5, y0, 1012, y1, GOLD);
  const header = "ALSO ON TUESDAY 17 NOVEMBER";
  const hw = textWidth(header, serif, 21, 6);
  drawText(header, 512, 802, serif, 21, GOLD_BRIGHT, 6, "center");
  rectFill(40, 794, 512 - hw / 2 - 16, 795.5, GOLD);
  rectFill(512 + hw / 2 + 16, 794, 984, 795.5, GOLD);
  diamond(512 - hw / 2 - 9, 794.75, 3.5, GOLD);
  diamond(512 + hw / 2 + 9, 794.75, 3.5, GOLD);
  // Large, bright, high-contrast type: the section the user asked to see.
  const size = 15.5;
  const cols: Array<[number, string[]]> = [[30, ALSO_LEFT], [522, ALSO_RIGHT]];
  for (const [cx, items] of cols) {
    for (let i = 0; i < items.length; i++) {
      const baseline = 820 + i * 16.5;
      diamond(cx + 3, baseline - 5, 4, GOLD_BRIGHT);
      fitText(items[i], cx + 16, baseline, sansMed, size, 462, WHITE, 0, "left");
    }
  }
}

function drawFooter(): void {
  drawText("SOURCES: REUTERS, AP, BBC, AL JAZEERA, JAPAN DEFENSE MINISTRY, PAHO, ULA, IMD, NDTV",
    512, 960, sansReg, 11, GOLD_PALE, 1, "center");
  drawText("EVERY STORY ABOVE HAPPENED OR WAS FIRST REPORTED ON TUESDAY 17 NOVEMBER 2026.",
    512, 983, sansBold, 13.5, GOLD_BRIGHT, 1, "center");
}

// =================================================================== MAIN ===
function main(): void {
  drawFrame();
  drawMasthead();
  drawDate();
  drawMap();
  drawLeads();
  drawGrid();
  drawAlso();
  drawFooter();
  const rgb = downsample();
  const png = encodePNG(rgb);
  fs.mkdirSync("/output", { recursive: true });
  fs.writeFileSync("/output/entry.png", png);
}

main();
