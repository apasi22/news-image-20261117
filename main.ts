// THE WORLD IN ONE DAY — Tuesday 17 November 2026.
// Fresh code-drawn newspaper poster. Own PNG encoder, own two-face
// vector font system (serif display + grotesque sans), 4x supersampled.
// Stdlib only, no network, deterministic.
//
// Digit discipline (the #1 job): "2" is a CURVED top bowl + diagonal +
// flat base, never three straight strokes. Every digit was verified on a
// large test sheet before the full image was built.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------- PNG out

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- canvas
// Logical coordinates are 1024x1024; everything is drawn at SSx and box
// downsampled, which is the antialiasing.

const LW = 1024;
const LH = 1024;
const SS = 4;
const SW = LW * SS;
const SH = LH * SS;

class Canvas {
  constructor() {
    this.buf = Buffer.alloc(SW * SH * 3);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= SW || y >= SH) return;
    const i = (y * SW + x) * 3;
    this.buf[i] = c[0];
    this.buf[i + 1] = c[1];
    this.buf[i + 2] = c[2];
  }
  rect(x0, y0, x1, y1, c) {
    const ax = Math.max(0, Math.round(x0 * SS));
    const bx = Math.min(SW, Math.round(x1 * SS));
    const ay = Math.max(0, Math.round(y0 * SS));
    const by = Math.min(SH, Math.round(y1 * SS));
    for (let y = ay; y < by; y++) {
      let i = (y * SW + ax) * 3;
      for (let x = ax; x < bx; x++) {
        this.buf[i] = c[0];
        this.buf[i + 1] = c[1];
        this.buf[i + 2] = c[2];
        i += 3;
      }
    }
  }
  // Filled disc stamp, with cached offset masks per integer radius.
  stamp(cx, cy, r, c) {
    const ri = Math.max(1, Math.round(r));
    let offs = Canvas._discs.get(ri);
    if (!offs) {
      const list = [];
      for (let dy = -ri; dy <= ri; dy++)
        for (let dx = -ri; dx <= ri; dx++)
          if (dx * dx + dy * dy <= ri * ri + ri * 0.5) list.push(dx, dy);
      offs = Int32Array.from(list);
      Canvas._discs.set(ri, offs);
    }
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    for (let k = 0; k < offs.length; k += 2) {
      const x = x0 + offs[k];
      const y = y0 + offs[k + 1];
      if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
      const i = (y * SW + x) * 3;
      this.buf[i] = c[0];
      this.buf[i + 1] = c[1];
      this.buf[i + 2] = c[2];
    }
  }
  disc(x, y, r, c) {
    this.stamp(x * SS, y * SS, r * SS, c);
  }
  ring(x, y, rOuter, rInner, c) {
    const cx = x * SS;
    const cy = y * SS;
    const ro = rOuter * SS;
    const ri = rInner * SS;
    const x0 = Math.max(0, Math.floor(cx - ro));
    const x1 = Math.min(SW - 1, Math.ceil(cx + ro));
    const y0 = Math.max(0, Math.floor(cy - ro));
    const y1 = Math.min(SH - 1, Math.ceil(cy + ro));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d2 = (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy);
        if (d2 <= ro * ro && d2 >= ri * ri) {
          const i = (yy * SW + xx) * 3;
          this.buf[i] = c[0];
          this.buf[i + 1] = c[1];
          this.buf[i + 2] = c[2];
        }
      }
    }
  }
  ellipse(x, y, rx, ry, c) {
    const cx = x * SS;
    const cy = y * SS;
    const ax = rx * SS;
    const ay = ry * SS;
    const x0 = Math.max(0, Math.floor(cx - ax));
    const x1 = Math.min(SW - 1, Math.ceil(cx + ax));
    const y0 = Math.max(0, Math.floor(cy - ay));
    const y1 = Math.min(SH - 1, Math.ceil(cy + ay));
    for (let yy = y0; yy <= y1; yy++) {
      const t = (yy - cy) / ay;
      if (t < -1 || t > 1) continue;
      const half = ax * Math.sqrt(1 - t * t);
      const xa = Math.max(x0, Math.ceil(cx - half));
      const xb = Math.min(x1, Math.floor(cx + half));
      for (let xx = xa; xx <= xb; xx++) {
        const i = (yy * SW + xx) * 3;
        this.buf[i] = c[0];
        this.buf[i + 1] = c[1];
        this.buf[i + 2] = c[2];
      }
    }
  }
  // Filled polygon, scanline even-odd. pts: [[x,y],...] logical coords.
  poly(pts, c) {
    const sp = pts.map((p) => [p[0] * SS, p[1] * SS]);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of sp) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(SH - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < sp.length; i++) {
        const a = sp[i];
        const b = sp[(i + 1) % sp.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]));
        const xb = Math.min(SW - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) {
          const i = (y * SW + x) * 3;
          this.buf[i] = c[0];
          this.buf[i + 1] = c[1];
          this.buf[i + 2] = c[2];
        }
      }
    }
  }
  // Thick segment with round caps, drawn as disc stamps.
  seg(x1, y1, x2, y2, w, c) {
    const ax = x1 * SS;
    const ay = y1 * SS;
    const bx = x2 * SS;
    const by = y2 * SS;
    const len = Math.hypot(bx - ax, by - ay);
    const r = (w * SS) / 2;
    const step = Math.max(1, r * 0.55);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.stamp(ax + (bx - ax) * t, ay + (by - ay) * t, r, c);
    }
  }
  // Thick polyline through points (round joins).
  polyline(pts, w, c) {
    for (let i = 0; i + 1 < pts.length; i++)
      this.seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c);
  }
  cubic(p0, p1, p2, p3, w, c) {
    const len =
      Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
      Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
      Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const n = Math.max(10, Math.ceil(len / 1.5));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    this.polyline(pts, w, c);
  }
  quad(p0, p1, p2, w, c) {
    this.cubic(
      p0,
      [p0[0] + (2 / 3) * (p1[0] - p0[0]), p0[1] + (2 / 3) * (p1[1] - p0[1])],
      [p2[0] + (2 / 3) * (p1[0] - p2[0]), p2[1] + (2 / 3) * (p1[1] - p2[1])],
      p2,
      w,
      c
    );
  }
  // Thick ellipse arc. Angles in degrees, 0 = east, increasing clockwise
  // (y grows downward). Sweep is always taken in the increasing direction.
  earc(cx, cy, rx, ry, a0, a1, w, c) {
    let sweep = a1 - a0;
    while (sweep <= 0) sweep += 360;
    const n = Math.max(24, Math.ceil((sweep / 360) * 120));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (sweep * i) / n) * Math.PI) / 180;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    this.polyline(pts, w, c);
  }
  downsample() {
    const out = Buffer.alloc(LW * LH * 3);
    for (let y = 0; y < LH; y++) {
      for (let x = 0; x < LW; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < SS; dy++) {
          let i = ((y * SS + dy) * SW + x * SS) * 3;
          for (let dx = 0; dx < SS; dx++) {
            r += this.buf[i];
            g += this.buf[i + 1];
            b += this.buf[i + 2];
            i += 3;
          }
        }
        const o = (y * LW + x) * 3;
        const d = SS * SS;
        out[o] = Math.round(r / d);
        out[o + 1] = Math.round(g / d);
        out[o + 2] = Math.round(b / d);
      }
    }
    return out;
  }
}
Canvas._discs = new Map();

// Chaikin corner cutting for smooth continent outlines.
function smoothPoly(pts, rounds) {
  let cur = pts;
  for (let r = 0; r < rounds; r++) {
    const next = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
}

// ------------------------------------------------------------------ font
// Glyphs live on a 0..100 cap-height grid (y down, baseline y=100).
// Stroke forms: ["l",x1,y1,x2,y2,w] line; ["q",x1,y1,cx,cy,x2,y2,w]
// quadratic; ["c",x1,y1,c1x,c1y,c2x,c2y,x2,y2,w] cubic;
// ["p",x0,y0, ...cubic groups of 6..., w] cubic chain;
// ["e",cx,cy,rx,ry,a0,a1,w] ellipse arc; ["d",x,y,r] filled dot.
// w: 0 = hairline, 1 = stem, 2 = stem with no serif slabs.
// Sans uses one uniform width for all strokes; serif uses thick stems,
// thin hairlines, plus slab serifs on near-vertical stems.

const G = {
  "0": [60, [["e", 30, 50, 22, 45, 0, 360, 0]]],
  // "1": flag + stem + base bar. Never a bare "I".
  "1": [60, [["l", 13, 30, 30, 8, 0], ["l", 30, 8, 30, 96, 2], ["l", 14, 96, 48, 96, 0]]],
  // "2": CURVED top bowl (cubic), then diagonal, then flat base.
  // The bowl is what separates it from Sigma — it must stay curved.
  "2": [60, [
    ["c", 8, 52, 8, 0, 56, 0, 54, 38, 0],
    ["l", 54, 38, 8, 92, 1],
    ["l", 8, 92, 55, 92, 0],
  ]],
  "3": [60, [["p", 13, 10, 30, -2, 52, 6, 51, 26, 50, 42, 40, 49, 29, 50, 42, 51, 55, 58, 55, 73, 55, 92, 33, 100, 13, 87, 0]]],
  "4": [60, [["l", 44, 6, 8, 64, 1], ["l", 2, 64, 56, 64, 0], ["l", 40, 6, 40, 96, 2]]],
  // "5": flat top + straight stem + curved bowl. Never an "S".
  "5": [60, [
    ["l", 6, 8, 52, 8, 0],
    ["l", 8, 8, 8, 50, 1],
    ["p", 8, 50, 38, 48, 54, 56, 54, 72, 54, 90, 34, 99, 15, 89, 0],
  ]],
  "6": [60, [
    ["c", 50, 6, 32, 14, 18, 32, 16, 54, 0],
    ["e", 31, 72, 23, 24, 0, 360, 0],
  ]],
  "7": [60, [["l", 6, 8, 56, 8, 0], ["q", 54, 8, 44, 52, 22, 96, 1]]],
  "8": [60, [["e", 30, 27, 20, 23, 0, 360, 0], ["e", 30, 71, 23, 25, 0, 360, 0]]],
  "9": [60, [
    ["e", 30, 29, 23, 24, 0, 360, 0],
    ["c", 52, 30, 55, 56, 48, 84, 28, 95, 0],
  ]],
  "A": [62, [["l", 8, 96, 31, 6, 1], ["l", 54, 96, 31, 6, 1], ["l", 19, 64, 43, 64, 0]]],
  "B": [60, [
    ["l", 10, 6, 10, 96, 1],
    ["p", 10, 8, 36, 3, 52, 9, 52, 24, 52, 38, 40, 46, 28, 48, 0],
    ["p", 28, 48, 44, 48, 56, 56, 56, 70, 56, 88, 40, 96, 10, 96, 0],
  ]],
  "C": [58, [["e", 31, 51, 25, 45, 42, 318, 0]]],
  "D": [62, [
    ["l", 10, 6, 10, 96, 1],
    ["p", 10, 6, 44, 5, 58, 24, 58, 51, 58, 78, 44, 96, 10, 96, 0],
  ]],
  "E": [54, [["l", 10, 6, 10, 96, 1], ["l", 10, 6, 52, 6, 0], ["l", 10, 50, 44, 50, 0], ["l", 10, 96, 52, 96, 0]]],
  "F": [52, [["l", 10, 6, 10, 96, 1], ["l", 10, 6, 50, 6, 0], ["l", 10, 50, 42, 50, 0]]],
  "G": [60, [
    ["e", 31, 51, 25, 45, 52, 308, 0],
    ["l", 58, 52, 36, 52, 0],
    ["l", 58, 52, 58, 74, 1],
  ]],
  "H": [62, [["l", 10, 6, 10, 96, 1], ["l", 54, 6, 54, 96, 1], ["l", 10, 51, 54, 51, 0]]],
  "I": [34, [["l", 17, 6, 17, 96, 1], ["l", 6, 6, 28, 6, 0], ["l", 6, 96, 28, 96, 0]]],
  "J": [46, [["l", 6, 6, 42, 6, 0], ["p", 32, 6, 32, 40, 32, 60, 32, 76, 32, 95, 22, 99, 10, 92, 1]]],
  "K": [60, [["l", 10, 6, 10, 96, 1], ["l", 52, 6, 14, 52, 1], ["l", 24, 42, 54, 96, 1]]],
  "L": [52, [["l", 10, 6, 10, 96, 1], ["l", 10, 96, 50, 96, 0]]],
  "M": [78, [["l", 8, 96, 8, 6, 1], ["l", 8, 6, 39, 60, 1], ["l", 70, 6, 39, 60, 1], ["l", 70, 6, 70, 96, 1]]],
  "N": [64, [["l", 8, 6, 8, 96, 1], ["l", 8, 6, 56, 96, 1], ["l", 56, 6, 56, 96, 1]]],
  "O": [64, [["e", 32, 51, 26, 45, 0, 360, 0]]],
  "P": [58, [
    ["l", 10, 6, 10, 96, 1],
    ["p", 10, 6, 38, 3, 54, 11, 54, 26, 54, 42, 38, 50, 10, 50, 0],
  ]],
  "Q": [64, [["e", 32, 51, 26, 45, 0, 360, 0], ["l", 44, 78, 61, 99, 1]]],
  "R": [60, [
    ["l", 10, 6, 10, 96, 1],
    ["p", 10, 6, 38, 3, 54, 11, 54, 26, 54, 42, 38, 50, 12, 50, 0],
    ["l", 30, 50, 56, 96, 1],
  ]],
  "S": [56, [["p", 45, 13, 36, 3, 16, 3, 12, 17, 8, 31, 22, 39, 30, 43, 39, 48, 49, 53, 49, 68, 49, 86, 32, 98, 13, 89, 0]]],
  "T": [56, [["l", 4, 6, 52, 6, 0], ["l", 28, 6, 28, 96, 1]]],
  "U": [62, [["p", 10, 6, 10, 30, 10, 50, 10, 68, 10, 90, 20, 97, 31, 97, 42, 97, 52, 90, 52, 68, 52, 50, 52, 30, 52, 6, 1]]],
  "V": [60, [["l", 6, 6, 30, 96, 1], ["l", 54, 6, 30, 96, 1]]],
  "W": [80, [["p", 4, 6, 9, 36, 15, 66, 20, 96, 27, 75, 33, 55, 40, 34, 47, 55, 53, 75, 60, 96, 65, 66, 71, 36, 76, 6, 1]]],
  "X": [60, [["l", 8, 6, 52, 96, 1], ["l", 52, 6, 8, 96, 1]]],
  "Y": [58, [["l", 6, 6, 29, 50, 1], ["l", 52, 6, 29, 50, 1], ["l", 29, 50, 29, 96, 1]]],
  "Z": [56, [["l", 6, 6, 50, 6, 0], ["l", 50, 6, 6, 96, 1], ["l", 6, 96, 50, 96, 0]]],
  " ": [30, []],
  ".": [30, [["d", 15, 90, 7]]],
  ",": [30, [["d", 15, 88, 7], ["c", 19, 92, 18, 102, 14, 108, 8, 111, 0]]],
  ":": [30, [["d", 15, 30, 7], ["d", 15, 74, 7]]],
  ";": [30, [["d", 15, 30, 7], ["d", 15, 72, 7], ["c", 19, 76, 18, 86, 14, 92, 8, 95, 0]]],
  "$": [56, [
    ["p", 44, 16, 36, 7, 18, 6, 14, 18, 10, 30, 22, 38, 29, 42, 37, 47, 46, 52, 46, 66, 46, 82, 31, 93, 14, 86, 0],
    ["l", 29, -2, 29, 102, 1],
  ]],
  "%": [64, [["e", 15, 25, 11, 12, 0, 360, 0], ["e", 49, 75, 11, 12, 0, 360, 0], ["l", 54, 6, 10, 94, 1]]],
  "-": [52, [["l", 6, 52, 46, 52, 0]]],
  "—": [64, [["l", 2, 52, 62, 52, 0]]],
  "–": [56, [["l", 4, 52, 52, 52, 0]]],
  "'": [26, [["q", 18, 4, 14, 16, 11, 28, 1]]],
  "/": [52, [["l", 44, 2, 10, 98, 1]]],
  "(": [34, [["e", 38, 51, 24, 46, 108, 252, 0]]],
  ")": [34, [["e", -4, 51, 24, 46, 288, 72, 0]]],
  "+": [56, [["l", 8, 50, 48, 50, 0], ["l", 28, 30, 28, 70, 1]]],
  "!": [32, [["l", 16, 6, 16, 64, 1], ["d", 16, 88, 7]]],
  "?": [52, [
    ["p", 12, 24, 10, 8, 26, 2, 34, 6, 44, 10, 46, 22, 38, 30, 32, 36, 28, 40, 28, 54, 0],
    ["d", 28, 86, 7],
  ]],
  '"': [36, [["l", 10, 4, 6, 24, 1], ["l", 26, 4, 22, 24, 1]]],
  "=": [52, [["l", 6, 36, 46, 36, 0], ["l", 6, 64, 46, 64, 0]]],
};

const FACES = {
  sans: { stem: 13, hair: 13, serif: false },
  serif: { stem: 15.5, hair: 7, serif: true },
};

function glyphOf(ch) {
  if (ch === "’" || ch === "‘" || ch === "`") return G["'"];
  if (ch === "“" || ch === "”") return G['"'];
  const up = ch.toUpperCase();
  return G[up] || G[" "];
}

function drawGlyph(cv, ch, x, yTop, size, face, color, weight) {
  const g = glyphOf(ch);
  const s = size / 100;
  const stemW = face.stem * s * weight;
  const hairW = face.hair * s * weight;
  const P = (ux, uy) => [x + ux * s, yTop + uy * s];
  for (const st of g[1]) {
    const kind = st[0];
    const wflag = st[st.length - 1];
    const w = wflag === 0 ? hairW : stemW;
    if (kind === "l") {
      const a = P(st[1], st[2]);
      const b = P(st[3], st[4]);
      cv.seg(a[0], a[1], b[0], b[1], w, color);
    } else if (kind === "q") {
      cv.quad(P(st[1], st[2]), P(st[3], st[4]), P(st[5], st[6]), w, color);
    } else if (kind === "c") {
      cv.cubic(P(st[1], st[2]), P(st[3], st[4]), P(st[5], st[6]), P(st[7], st[8]), w, color);
    } else if (kind === "p") {
      let prev = P(st[1], st[2]);
      for (let i = 3; i + 5 < st.length; i += 6) {
        const c1 = P(st[i], st[i + 1]);
        const c2 = P(st[i + 2], st[i + 3]);
        const end = P(st[i + 4], st[i + 5]);
        cv.cubic(prev, c1, c2, end, w, color);
        prev = end;
      }
    } else if (kind === "e") {
      const c = P(st[1], st[2]);
      cv.earc(c[0], c[1], st[3] * s, st[4] * s, st[5], st[6], w, color);
    } else if (kind === "d") {
      const c = P(st[1], st[2]);
      cv.disc(c[0], c[1], st[3] * s, color);
    }
  }
  // Slab serifs: near-vertical stems only, at cap line / baseline ends.
  if (face.serif) {
    const sw = stemW * 2.0;
    const sh = Math.max(0.7, stemW * 0.42);
    for (const st of g[1]) {
      if (st[0] !== "l" || st[5] !== 1) continue;
      const dx = Math.abs(st[3] - st[1]);
      const dy = Math.abs(st[4] - st[2]);
      if (dx > 0.2 * dy || dy < 20) continue;
      for (const [ux, uy] of [[st[1], st[2]], [st[3], st[4]]]) {
        if (uy > 10 && uy < 90) continue;
        const c = P(ux, uy);
        cv.rect(c[0] - sw / 2, c[1] - sh / 2, c[0] + sw / 2, c[1] + sh / 2, color);
      }
    }
  }
  return g[0] * s;
}

function measure(text, size, faceName, tracking) {
  const s = size / 100;
  let w = 0;
  for (const ch of text) w += glyphOf(ch)[0] * s + (tracking || 0);
  if (text.length) w -= tracking || 0;
  return w;
}

function drawText(cv, text, x, yTop, size, faceName, color, opts) {
  const o = opts || {};
  const face = FACES[faceName];
  const tracking = o.tracking || 0;
  const weight = o.weight || 1;
  let cx = x;
  if (o.align === "center") cx = x - measure(text, size, faceName, tracking) / 2;
  else if (o.align === "right") cx = x - measure(text, size, faceName, tracking);
  for (const ch of text) {
    const adv = drawGlyph(cv, ch, cx, yTop, size, face, color, weight);
    cx += adv + tracking;
  }
  return cx - x;
}

// Fit text to a max width by shrinking the size; returns the size used.
function drawTextFit(cv, text, x, yTop, size, maxW, faceName, color, opts) {
  const o = opts || {};
  let s = size;
  while (s > 8 && measure(text, s, faceName, o.tracking || 0) > maxW) s -= 0.5;
  drawText(cv, text, x, yTop, s, faceName, color, o);
  return s;
}

// ---------------------------------------------------------------- palette

const NAVY = [9, 30, 68];
const NAVY2 = [14, 40, 86];
const NAVY3 = [5, 19, 45];
const GOLD = [216, 164, 65];
const GOLD_LT = [233, 190, 92];
const GOLD_DK = [166, 124, 46];
const CREAM = [247, 240, 220];
const PAPER = [251, 246, 233];
const INK = [16, 30, 58];
const INK_SOFT = [52, 62, 84];
const WHITE = [255, 255, 255];
const RED = [183, 51, 42];
const RED_DK = [150, 38, 30];
const TEAL = [31, 122, 109];
const PURPLE = [122, 78, 158];
const GREEN = [62, 142, 77];
const BLUE = [46, 111, 168];
const TAN = [201, 163, 92];
const SKY = [168, 205, 232];
const SEA = [58, 122, 168];

// ---------------------------------------------------------------- helpers

function diamond(cv, x, y, r, c) {
  cv.poly([[x, y - r], [x + r, y], [x, y + r], [x - r, y]], c);
}

function hRule(cv, x0, x1, y, w, c) {
  cv.rect(x0, y - w / 2, x1, y + w / 2, c);
}

function flame(cv, x, y, s, c1, c2) {
  const f = (pts, c) => cv.poly(pts.map((p) => [x + p[0] * s, y + p[1] * s]), c);
  f([[0, 10], [10, 2], [6, -8], [12, -16], [4, -30], [0, -40], [-4, -28], [-10, -18], [-6, -8], [-10, 2]], c1);
  f([[0, 8], [5, 2], [3, -6], [6, -12], [1, -22], [-3, -14], [-6, -6], [-5, 2]], c2);
}

function cloud(cv, x, y, s, c) {
  cv.ellipse(x, y, 20 * s, 8 * s, c);
  cv.ellipse(x - 13 * s, y + 2 * s, 12 * s, 6 * s, c);
  cv.ellipse(x + 13 * s, y + 2 * s, 12 * s, 6 * s, c);
  cv.ellipse(x, y - 5 * s, 11 * s, 7 * s, c);
}

function jet(cv, x, y, s, c) {
  cv.poly(
    [
      [x + 34 * s, y],
      [x + 6 * s, y - 5 * s],
      [x - 8 * s, y - 16 * s],
      [x - 14 * s, y - 16 * s],
      [x - 12 * s, y - 4 * s],
      [x - 30 * s, y - 8 * s],
      [x - 34 * s, y - 4 * s],
      [x - 30 * s, y],
      [x - 34 * s, y + 4 * s],
      [x - 30 * s, y + 8 * s],
      [x - 12 * s, y + 4 * s],
      [x - 14 * s, y + 16 * s],
      [x - 8 * s, y + 16 * s],
      [x + 6 * s, y + 5 * s],
    ],
    c
  );
}

function pin(cv, x, y, s, c) {
  cv.disc(x, y - 6 * s, 9 * s, c);
  cv.poly([[x - 8 * s, y - 2 * s], [x + 8 * s, y - 2 * s], [x, y + 12 * s]], c);
  cv.disc(x, y - 6 * s, 3.5 * s, WHITE);
}

function vGradient(cv, x0, y0, x1, y1, top, bottom, bands) {
  const n = bands || 10;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const c = [
      Math.round(top[0] + (bottom[0] - top[0]) * ((t0 + t1) / 2)),
      Math.round(top[1] + (bottom[1] - top[1]) * ((t0 + t1) / 2)),
      Math.round(top[2] + (bottom[2] - top[2]) * ((t0 + t1) / 2)),
    ];
    cv.rect(x0, y0 + (y1 - y0) * t0, x1, y0 + (y1 - y0) * t1, c);
  }
}

// ------------------------------------------------------- lead illustrations
// Each draws inside (x, y, w, h).

function illBridge(cv, x, y, w, h) {
  vGradient(cv, x, y, x + w, y + h, [238, 214, 150], [240, 226, 180], 8);
  cv.disc(x + w - 26, y + 16, 11, [246, 232, 190]);
  const deckY = y + h * 0.60;
  const gapL = x + w * 0.42;
  const gapR = x + w * 0.60;
  cv.rect(x, deckY, gapL, deckY + 4, [70, 62, 52]);
  cv.rect(gapR, deckY, x + w, deckY + 4, [70, 62, 52]);
  // Broken arch stubs + fallen middle section, tilted into the water.
  cv.seg(x + 8, deckY + 3, x + w * 0.3, deckY + 16, 3, [90, 80, 66]);
  cv.seg(x + w - 8, deckY + 3, x + w * 0.72, deckY + 16, 3, [90, 80, 66]);
  cv.poly(
    [
      [gapL + 2, deckY + 2],
      [gapR - 2, deckY + 10],
      [gapR - 8, deckY + 16],
      [gapL - 2, deckY + 8],
    ],
    [70, 62, 52]
  );
  cv.rect(x + w * 0.14, deckY + 4, x + w * 0.14 + 4, y + h, [90, 80, 66]);
  cv.rect(x + w * 0.80, deckY + 4, x + w * 0.80 + 4, y + h, [90, 80, 66]);
  // Pylons + cables.
  cv.rect(x + w * 0.24, deckY - 26, x + w * 0.24 + 3, deckY, [70, 62, 52]);
  cv.rect(x + w * 0.72, deckY - 26, x + w * 0.72 + 3, deckY, [70, 62, 52]);
  cv.seg(x + w * 0.24, deckY - 26, x + 10, deckY, 1.2, [110, 100, 84]);
  cv.seg(x + w * 0.24, deckY - 26, gapL, deckY, 1.2, [110, 100, 84]);
  cv.seg(x + w * 0.72, deckY - 26, gapR, deckY, 1.2, [110, 100, 84]);
  cv.seg(x + w * 0.72, deckY - 26, x + w - 10, deckY, 1.2, [110, 100, 84]);
  flame(cv, (gapL + gapR) / 2, deckY - 2, 0.5, [226, 84, 43], [245, 166, 35]);
  cv.rect(x, y + h * 0.78, x + w, y + h, SEA);
  cv.seg(x + 12, y + h * 0.86, x + 44, y + h * 0.86, 1.5, [210, 232, 244]);
  cv.seg(x + w * 0.6, y + h * 0.9, x + w * 0.82, y + h * 0.9, 1.5, [210, 232, 244]);
  cv.poly([[x + 18, y + h * 0.78], [x + 40, y + h * 0.78], [x + 35, y + h * 0.86], [x + 23, y + h * 0.86]], RED_DK);
  cv.rect(x + 26, y + h * 0.72, x + 32, y + h * 0.78, [240, 240, 240]);
}

function illTanker(cv, x, y, w, h) {
  vGradient(cv, x, y, x + w, y + h * 0.62, [196, 220, 236], [222, 234, 242], 6);
  cv.rect(x, y + h * 0.62, x + w, y + h, SEA);
  cv.rect(x + 6, y + h * 0.30, x + 46, y + h * 0.42, [120, 130, 140]);
  cv.seg(x + 10, y + h * 0.30, x + 10, y + h * 0.18, 2, [120, 130, 140]);
  // Hull.
  cv.poly(
    [
      [x + w * 0.18, y + h * 0.42],
      [x + w * 0.94, y + h * 0.42],
      [x + w * 0.86, y + h * 0.74],
      [x + w * 0.24, y + h * 0.74],
    ],
    [166, 58, 46]
  );
  cv.rect(x + w * 0.18, y + h * 0.42, x + w * 0.94, y + h * 0.48, [120, 40, 32]);
  cv.rect(x + w * 0.72, y + h * 0.26, x + w * 0.86, y + h * 0.42, [240, 240, 238]);
  cv.rect(x + w * 0.76, y + h * 0.18, x + w * 0.82, y + h * 0.26, [150, 60, 50]);
  flame(cv, x + w * 0.5, y + h * 0.42, 0.45, [226, 84, 43], [245, 166, 35]);
  cv.disc(x + w * 0.44, y + h * 0.18, 6, [150, 150, 150]);
  cv.disc(x + w * 0.38, y + h * 0.13, 4.5, [170, 170, 170]);
  // Naval mine, spiked, in the water.
  const mx = x + w * 0.13;
  const my = y + h * 0.82;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    cv.seg(mx, my, mx + Math.cos(a) * 9, my + Math.sin(a) * 9, 2, [30, 30, 34]);
  }
  cv.disc(mx, my, 6, [30, 30, 34]);
  cv.disc(mx - 2, my - 2, 1.6, [120, 120, 125]);
  cv.seg(x + w * 0.3, y + h * 0.86, x + w * 0.6, y + h * 0.86, 1.5, [210, 232, 244]);
  cv.seg(x + w * 0.68, y + h * 0.9, x + w * 0.9, y + h * 0.9, 1.5, [210, 232, 244]);
}

function illSkyline(cv, x, y, w, h) {
  vGradient(cv, x, y, x + w, y + h, [122, 78, 158], [226, 140, 82], 8);
  cv.disc(x + w * 0.62, y + h * 0.34, 11, [248, 220, 160]);
  const base = y + h;
  const k = h / 54; // scale heights to the band so nothing pokes into the bar
  const b = (bx, bw, bh, win) => {
    const bh2 = bh * k;
    cv.rect(bx, base - bh2, bx + bw, base, [28, 24, 52]);
    if (win) {
      for (let wy = base - bh2 + 7; wy < base - 5; wy += 8)
        for (let wx = bx + 5; wx < bx + bw - 4; wx += 8)
          cv.rect(wx, wy, wx + 3, wy + 3, [244, 200, 110]);
    }
  };
  b(x + 4, 34, 34, true);
  b(x + 42, 26, 52, true);
  b(x + 72, 40, 30, true);
  b(x + 116, 30, 54, true);
  b(x + 150, 36, 40, true);
  b(x + 190, 30, 50, true);
  b(x + 224, 38, 34, true);
  b(x + 266, 30, 46, true);
  b(x + 300, 22, 30, false);
  // Flag poles on two towers, kept inside the band.
  const f1 = 54 * k;
  cv.seg(x + 128, base - f1, x + 128, base - f1 - 8, 1.5, [230, 230, 230]);
  cv.rect(x + 128, base - f1 - 8, x + 140, base - f1 - 3, RED);
  const f2 = 50 * k;
  cv.seg(x + 204, base - f2, x + 204, base - f2 - 8, 1.5, [230, 230, 230]);
  cv.rect(x + 204, base - f2 - 8, x + 216, base - f2 - 3, [240, 240, 240]);
  cv.rect(x + 204, base - f2 - 5, x + 216, base - f2 - 3, BLUE);
}

function illJets(cv, x, y, w, h) {
  vGradient(cv, x, y, x + w, y + h, [126, 180, 222], [196, 224, 240], 8);
  cloud(cv, x + 52, y + 14, 0.8, WHITE);
  cloud(cv, x + w - 60, y + 20, 0.7, WHITE);
  cloud(cv, x + w * 0.5, y + h - 12, 0.6, [240, 246, 250]);
  cv.seg(x + 30, y + h * 0.52, x + 120, y + h * 0.44, 1.5, [255, 255, 255]);
  cv.seg(x + 60, y + h * 0.68, x + 150, y + h * 0.60, 1.5, [255, 255, 255]);
  jet(cv, x + 150, y + h * 0.42, 0.85, [30, 44, 70]);
  jet(cv, x + 185, y + h * 0.60, 0.7, [48, 62, 88]);
  // Island with a palm, bottom-left.
  cv.ellipse(x + 34, y + h - 2, 34, 9, [96, 150, 92]);
  cv.seg(x + 30, y + h - 6, x + 34, y + h - 26, 2.5, [110, 82, 52]);
  for (const [dx, dy] of [[-14, -6], [-8, -11], [0, -13], [8, -11], [14, -6]]) {
    cv.quad([x + 34, y + h - 26], [x + 34 + dx * 0.6, y + h - 26 + dy], [x + 34 + dx, y + h - 26 + dy + 7], 2, [52, 122, 66]);
  }
}

function illPentagon(cv, x, y, w, h) {
  cv.rect(x, y, x + w, y + h, [240, 230, 200]);
  cv.disc(x + w - 24, y + 14, 10, [246, 220, 150]);
  const cx = x + w * 0.3;
  const cy = y + h * 0.55;
  const r = 26;
  const pts = [];
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  cv.poly(pts, [32, 52, 92]);
  const pts2 = [];
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    pts2.push([cx + r * 0.55 * Math.cos(a), cy + r * 0.55 * Math.sin(a)]);
  }
  cv.poly(pts2, [240, 230, 200]);
  // Falling bars.
  const bars = [34, 27, 20, 13];
  bars.forEach((bh, i) => {
    const bx = x + w * 0.56 + i * 26;
    cv.rect(bx, y + h - 10 - bh, bx + 18, y + h - 10, RED);
  });
  cv.seg(x + w * 0.56, y + h - 16 - 34, x + w * 0.56 + 3 * 26 + 18, y + h - 16 - 13, 1.5, [90, 90, 90]);
  cv.disc(x + w * 0.56 + 3 * 26 + 18, y + h - 16 - 13, 2.5, [90, 90, 90]);
}

function illHub(cv, x, y, w, h) {
  vGradient(cv, x, y, x + w, y + h, [232, 214, 168], [214, 192, 138], 6);
  cv.disc(x + w - 26, y + 14, 10, [248, 236, 200]);
  // Stylised landmass.
  const land = smoothPoly(
    [
      [x + w * 0.30, y + h * 0.10],
      [x + w * 0.62, y + h * 0.06],
      [x + w * 0.86, y + h * 0.24],
      [x + w * 0.92, y + h * 0.55],
      [x + w * 0.78, y + h * 0.86],
      [x + w * 0.52, y + h * 0.97],
      [x + w * 0.30, y + h * 0.80],
      [x + w * 0.18, y + h * 0.48],
    ],
    2
  );
  cv.poly(land, [196, 158, 96]);
  // Dotted route in.
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const px = x + w * 0.08 + (x + w * 0.58 - (x + w * 0.08)) * t;
    const py = y + h * 0.82 - Math.sin(t * Math.PI) * h * 0.34 - t * h * 0.3;
    cv.disc(px, py, 1.8, RED_DK);
  }
  pin(cv, x + w * 0.60, y + h * 0.50, 1.0, RED);
  // Tree, left.
  cv.rect(x + w * 0.13, y + h * 0.62, x + w * 0.13 + 4, y + h * 0.86, [110, 82, 52]);
  cv.disc(x + w * 0.15, y + h * 0.54, 13, [62, 138, 72]);
  cv.disc(x + w * 0.09, y + h * 0.60, 8, [62, 138, 72]);
  cv.disc(x + w * 0.21, y + h * 0.60, 8, [62, 138, 72]);
}

// -------------------------------------------------------------------- map

// Rough world outlines in [lon, lat]; smoothed at draw time.
const CONTINENTS = [
  // North America
  [[-168, 66], [-150, 70], [-135, 69], [-125, 72], [-110, 68], [-95, 70], [-85, 66], [-80, 62], [-70, 58], [-60, 52], [-65, 45], [-75, 38], [-80, 32], [-90, 30], [-97, 26], [-94, 19], [-87, 15], [-83, 9], [-90, 14], [-97, 16], [-105, 20], [-110, 24], [-117, 33], [-124, 40], [-124, 48], [-132, 56], [-150, 61], [-162, 58]],
  // South America
  [[-80, 9], [-72, 11], [-62, 9], [-52, 5], [-44, -3], [-35, -8], [-40, -18], [-48, -26], [-58, -35], [-65, -42], [-70, -50], [-73, -42], [-72, -32], [-70, -20], [-77, -12], [-81, -5], [-80, 2]],
  // Africa
  [[-17, 15], [-10, 30], [0, 36], [10, 37], [20, 32], [32, 31], [35, 28], [43, 12], [51, 11], [48, 2], [40, -8], [36, -18], [32, -26], [20, -35], [15, -28], [12, -18], [9, -2], [9, 4], [-8, 5], [-13, 8]],
  // Eurasia
  [[-10, 37], [-2, 44], [-5, 48], [0, 51], [8, 54], [13, 56], [18, 56], [21, 60], [25, 65], [30, 70], [45, 68], [60, 69], [75, 73], [90, 75], [105, 77], [120, 73], [135, 72], [150, 70], [158, 62], [162, 60], [158, 52], [142, 50], [140, 40], [135, 35], [128, 33], [122, 30], [120, 23], [110, 20], [105, 9], [100, 6], [97, 12], [94, 17], [90, 22], [86, 20], [80, 15], [77, 8], [73, 16], [68, 23], [62, 25], [58, 24], [54, 26], [52, 28], [48, 30], [44, 29], [40, 31], [36, 36], [30, 36], [26, 38], [22, 37], [18, 40], [12, 44], [8, 44], [3, 43], [-2, 37]],
  // Australia
  [[113, -22], [122, -17], [132, -12], [142, -11], [147, -19], [153, -27], [150, -37], [140, -38], [130, -32], [117, -35], [113, -26]],
  // Britain
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [0, 53], [1, 51]],
  // Japan
  [[130, 31], [133, 34], [137, 35], [140, 37], [142, 42], [144, 44], [141, 40], [138, 35], [134, 33], [131, 32]],
  // Borneo / Sumatra / Java hints
  [[109, 1], [114, 4], [118, 1], [117, -3], [112, -3], [109, -1]],
  [[95, 5], [100, 0], [104, -4], [106, -6], [102, -2], [97, 2]],
  [[105, -6], [112, -7], [114, -8], [108, -8], [105, -7]],
];

function drawMap(cv, x0, y0, x1, y1) {
  cv.rect(x0, y0, x1, y1, NAVY2);
  const W = x1 - x0;
  const H = y1 - y0;
  const proj = (lon, lat) => [x0 + ((lon + 180) / 360) * W, y0 + ((72 - lat) / 108) * H];
  // Graticule.
  for (let lon = -150; lon <= 150; lon += 30) {
    const [gx] = proj(lon, 0);
    cv.rect(gx, y0, gx + 0.7, y1, [26, 58, 104]);
  }
  for (let lat = -30; lat <= 60; lat += 30) {
    const [, gy] = proj(0, lat);
    cv.rect(x0, gy, x1, gy + 0.7, [26, 58, 104]);
  }
  for (const cont of CONTINENTS) {
    const pts = smoothPoly(cont.map(([lo, la]) => proj(lo, la)), 2);
    cv.poly(pts, TAN);
  }
  // Dots + chips. Chip offsets are hand-placed: no two chips overlap.
  const spots = [
    ["WASHINGTON", -77, 39, -4, -24, "right"],
    ["KYIV", 30, 50, -8, -26, "center"],
    ["KERCH", 36, 45, 24, 18, "left"],
    ["HORMUZ", 56, 26, -6, -26, "center"],
    ["SHENZHEN", 114, 22, -10, -26, "center"],
    ["TOKYO", 139, 36, 10, -8, "left"],
    ["MANILA", 121, 15, 10, 10, "left"],
    ["ANDHRA", 80, 16, -8, 14, "center"],
    ["ADEN", 45, 13, -14, 12, "center"],
    ["KIGALI", 30, -2, -52, 6, "right"],
  ];
  const labelSize = 11.5;
  for (const [name, lon, lat, dx, dy, anchor] of spots) {
    const [px, py] = proj(lon, lat);
    const tw = measure(name, labelSize, "sans", 0.5) + 12;
    const th = 17;
    let cx;
    if (anchor === "right") cx = px + dx - tw;
    else if (anchor === "left") cx = px + dx;
    else cx = px + dx - tw / 2;
    const cy = py + dy;
    // Leader line from dot to chip edge.
    const ex = Math.max(cx, Math.min(px, cx + tw));
    const ey = Math.max(cy, Math.min(py, cy + th));
    cv.seg(px, py, ex, ey, 1, GOLD_LT);
    cv.rect(cx, cy, cx + tw, cy + th, NAVY3);
    cv.rect(cx, cy, cx + tw, cy + 1, GOLD_DK);
    cv.rect(cx, cy + th - 1, cx + tw, cy + th, GOLD_DK);
    cv.rect(cx, cy, cx + 1, cy + th, GOLD_DK);
    cv.rect(cx + tw - 1, cy, cx + tw, cy + th, GOLD_DK);
    drawText(cv, name, cx + 6, cy + 3.5, labelSize, "sans", WHITE, { tracking: 0.5, weight: 1.15 });
    cv.disc(px, py, 4.6, WHITE);
    cv.disc(px, py, 3.2, RED);
  }
}

// ------------------------------------------------------------------ layout

const LEADS = [
  { cat: "EUROPE - WAR", color: RED, ill: illBridge,
    head: ["CRIMEA BRIDGE", "HIT AGAIN"],
    deck: ["DRONES AND MISSILES DROP THE", "KERCH ROAD ARCH INTO THE STRAIT."] },
  { cat: "GULF - SHIPPING", color: TEAL, ill: illTanker,
    head: ["TANKERS HIT BY MINES", "NEAR HORMUZ"],
    deck: ["A FOURTH TANKER CATCHES FIRE AS", "IRAN REPORTS MINE STRIKES."] },
  { cat: "DIPLOMACY - SHENZHEN", color: PURPLE, ill: illSkyline,
    head: ["TRUMP LANDS IN ASIA", "FOR APEC"],
    deck: ["MANILA FIRST, THEN SHENZHEN FOR", "THE FIRST XI-TRUMP-PUTIN TALKS."] },
  { cat: "ASIA - SECURITY", color: BLUE, ill: illJets,
    head: ["JAPAN SCRAMBLES JETS"],
    deck: ["TWO SUSPECTED RUSSIAN AIRCRAFT", "ENTER AIRSPACE NEAR OKINOSHIMA."] },
  { cat: "UNITED STATES - DEFENCE", color: GOLD_DK, ill: illPentagon,
    head: ["PENTAGON FAILS", "ITS AUDIT"],
    deck: ["NINTH STRAIGHT YEAR: BOOKS", "COVERING $4.8 TRILLION UNVERIFIED."] },
  { cat: "EUROPE - MIGRATION", color: GREEN, ill: illHub,
    head: ["FIVE EU STATES PLAN", "RWANDA HUB"],
    deck: ["GERMANY, DENMARK, AUSTRIA,", "GREECE, NETHERLANDS BACK A HUB."] },
];

const GRID = [
  ["HEALTH", ["U.S. LOSES MEASLES-FREE", "STATUS: 5,412 CASES, 26 YEARS"]],
  ["MARKETS", ["NVIDIA BEATS, GUIDES TO $130BN", "IN FIRST REPORT WITHOUT HUANG"]],
  ["MARKETS", ["WALL STREET FALLS: S&P -1.0%,", "DOW -1.6%, VIX AT 25.5"]],
  ["SPACE", ["VULCAN GROUNDED: BOOSTER", "FAULT, 40 SATELLITES LOST"]],
  ["TECH", ["U.S. MOVES TO CLOSE AI CHIP", "LOOPHOLE ON DATA CENTERS"]],
  ["TECH", ["JPMORGAN BLAMES SOFTWARE BUG", "FOR MONDAY BANKING OUTAGE"]],
  ["ENERGY", ["OIL RISES ON HORMUZ TENSION:", "BRENT $93.14, WTI $86.01"]],
  ["WEATHER", ["CYCLONE AKVAN NEARS ANDHRA", "COAST; LANDFALL DUE NOV 20"]],
  ["SPORT", ["MOROCCO REACHES FIFA TOP FIVE,", "FIRST AFRICAN SIDE SINCE 1994"]],
  ["SPORT", ["JAY SHAH RE-ELECTED AS ICC", "CHAIRMAN FOR A SECOND TERM"]],
  ["ASIA", ["SEOUL SCRAMBLES JETS TOO;", "TAIWAN RESPONDS TO RUSSIAN JETS"]],
  ["U.S.", ["WHITE HOUSE CURBS TESTIMONY:", "AGENCIES NEED PRIOR APPROVAL"]],
];

const ALSO_LEFT = [
  "DISNEY BEATS: REVENUE $25.9BN, DIVIDEND RAISED",
  "FED'S MUSALEM: MORE HIKES MAY BE NEEDED",
  "NSA NETWORK DOWN; NO SIGN OF CYBERATTACK",
  "APPLE SERVICES HIT BY OUTAGE ON TUESDAY",
  "GAZA FLOODS HIT SHELTERS; TENTS HELD AT BORDER",
  "CYBERCRIME DAMAGES PUT AT $10.5T A YEAR",
  "RICE AGREES 5-YEAR ARSENAL DEAL",
  "PATIDAR SMASHES 135 OFF 48 BALLS",
];
const ALSO_RIGHT = [
  "U.S. RETAIL SALES +0.5% EX-AUTOS AND GAS",
  "ANTHROPIC IPO PRICES WEDNESDAY, NEAR $1.5T",
  "IRANIAN DRONES OVER BAHRAIN INTERCEPTED",
  "HOUTHIS ADVANCE ON ADEN; FORCES PULL BACK",
  "BUS CRASH IN UTTARAKHAND KILLS 8",
  "DHONI RETIRES FROM IPL AS A PLAYER",
  "SHAMI TO RAJASTHAN; CURRAN TO LUCKNOW",
  "INDIA BEAT PAKISTAN 2-1 FOR SAFF HAT-TRICK",
];

function buildFull() {
  const cv = new Canvas();
  cv.rect(0, 0, LW, LH, NAVY);

  // Gold double frame.
  cv.rect(5, 5, 1019, 7, GOLD);
  cv.rect(5, 1017, 1019, 1019, GOLD);
  cv.rect(5, 5, 7, 1019, GOLD);
  cv.rect(1017, 5, 1019, 1019, GOLD);
  cv.rect(11, 11, 1013, 12, GOLD_DK);
  cv.rect(11, 1012, 1013, 1013, GOLD_DK);
  cv.rect(11, 11, 12, 1013, GOLD_DK);
  cv.rect(1012, 11, 1013, 1013, GOLD_DK);

  // Masthead.
  const mast = "THE WORLD IN ONE DAY";
  const mastSize = 29;
  const mastW = measure(mast, mastSize, "serif", 7);
  const mastX0 = 512 - mastW / 2;
  hRule(cv, 34, mastX0 - 26, 36, 1.4, GOLD);
  hRule(cv, mastX0 + mastW + 26, 990, 36, 1.4, GOLD);
  diamond(cv, mastX0 - 16, 36, 4, GOLD);
  diamond(cv, mastX0 + mastW + 16, 36, 4, GOLD);
  drawText(cv, mast, mastX0, 20, mastSize, "serif", GOLD_LT, { tracking: 7 });

  // GIANT date. "17" in gold, the rest white. Must read "2026" perfectly.
  const dateParts = [["TUESDAY ", WHITE], ["17", GOLD_LT], [" NOVEMBER 2026", WHITE]];
  let dateSize = 70;
  const dateW = (s) =>
    dateParts.reduce((a, [t]) => a + measure(t, s, "serif", 1), 0) - 1;
  while (dateSize > 40 && dateW(dateSize) > 982) dateSize -= 1;
  let dx = 512 - dateW(dateSize) / 2;
  for (const [t, col] of dateParts) {
    const w = drawText(cv, t, dx, 54, dateSize, "serif", col, { tracking: 1 });
    dx += w + 1;
  }
  hRule(cv, 30, 994, 133, 1.6, GOLD);
  hRule(cv, 30, 994, 137, 0.8, GOLD_DK);
  diamond(cv, 512, 135, 4, GOLD);

  // Subhead.
  drawText(cv, "34 STORIES THAT DEFINED THE DAY", 512, 143, 20, "serif", GOLD, {
    align: "center",
    tracking: 5.5,
  });

  // Map.
  drawMap(cv, 16, 164, 1008, 270);
  const mapTitle = "WHERE IT HAPPENED";
  const mtW = measure(mapTitle, 11, "sans", 1) + 14;
  cv.rect(16, 164, 16 + mtW, 183, GOLD);
  drawText(cv, mapTitle, 23, 167.5, 11, "sans", NAVY3, { tracking: 1, weight: 1.3 });
  cv.rect(16, 270, 1008, 271, GOLD_DK);

  // Lead cards.
  const colX = [16, 349, 683];
  const colW = 325;
  const rowY = [278, 428];
  const rowH = 144;
  LEADS.forEach((lead, i) => {
    const x = colX[i % 3];
    const y = rowY[Math.floor(i / 3)];
    cv.rect(x, y, x + colW, y + rowH, CREAM);
    cv.rect(x, y, x + colW, y + 19, lead.color);
    drawText(cv, lead.cat, x + 10, y + 4, 11.5, "sans", WHITE, { tracking: 1.5, weight: 1.2 });
    lead.ill(cv, x, y + 19, colW, 44);
    const headTop = y + 67;
    if (lead.head.length === 1) {
      drawTextFit(cv, lead.head[0], x + 12, headTop + 11, 19.5, colW - 24, "sans", INK, { weight: 1.4 });
    } else {
      drawTextFit(cv, lead.head[0], x + 12, headTop, 19.5, colW - 24, "sans", INK, { weight: 1.4 });
      drawTextFit(cv, lead.head[1], x + 12, headTop + 23, 19.5, colW - 24, "sans", INK, { weight: 1.4 });
    }
    drawText(cv, lead.deck[0], x + 12, headTop + 46, 12.5, "sans", INK_SOFT, { weight: 1.0 });
    drawText(cv, lead.deck[1], x + 12, headTop + 60, 12.5, "sans", INK_SOFT, { weight: 1.0 });
  });

  // Numbered grid.
  const gridY = 578;
  const gridH = 190;
  const cellH = gridH / 4;
  cv.rect(16, gridY, 1008, gridY + gridH, PAPER);
  cv.rect(16, gridY, 1008, gridY + 1, GOLD_DK);
  cv.rect(16, gridY + gridH - 1, 1008, gridY + gridH, GOLD_DK);
  for (let r = 1; r < 4; r++)
    cv.rect(16, gridY + r * cellH, 1008, gridY + r * cellH + 1, [214, 202, 178]);
  for (let c = 1; c < 3; c++)
    cv.rect(colX[c] - 4, gridY, colX[c] - 3, gridY + gridH, [214, 202, 178]);
  GRID.forEach(([cat, lines], i) => {
    const x = colX[i % 3];
    const y = gridY + Math.floor(i / 3) * cellH;
    cv.disc(x + 22, y + cellH / 2, 12.5, RED);
    const num = String(i + 1);
    const nw = measure(num, 13.5, "sans", 0);
    drawText(cv, num, x + 22 - nw / 2, y + cellH / 2 - 6.75, 13.5, "sans", WHITE, { weight: 1.4 });
    drawText(cv, cat, x + 42, y + 5, 9, "sans", RED, { tracking: 1.2, weight: 1.25 });
    drawTextFit(cv, lines[0], x + 42, y + 17, 13, colW - 50, "sans", INK, { weight: 1.25 });
    drawTextFit(cv, lines[1], x + 42, y + 32, 13, colW - 50, "sans", INK, { weight: 1.25 });
  });

  // ALSO panel.
  const alsoY = 776;
  const alsoH = 176;
  cv.rect(16, alsoY, 1008, alsoY + alsoH, NAVY2);
  cv.rect(16, alsoY, 1008, alsoY + 2, GOLD);
  const alsoHead = "ALSO ON TUESDAY 17 NOVEMBER";
  const ahW = measure(alsoHead, 19, "serif", 3);
  drawText(cv, alsoHead, 512, alsoY + 8, 19, "serif", GOLD_LT, { align: "center", tracking: 3 });
  diamond(cv, 512 - ahW / 2 - 16, alsoY + 18, 4.5, GOLD);
  diamond(cv, 512 + ahW / 2 + 16, alsoY + 18, 4.5, GOLD);
  hRule(cv, 30, 994, alsoY + 36, 1, GOLD_DK);
  const rowH2 = 16.5;
  const topY = alsoY + 42;
  ALSO_LEFT.forEach((t, i) => {
    const ry = topY + i * rowH2;
    diamond(cv, 34, ry + 7, 4, GOLD);
    drawText(cv, t, 46, ry, 14.5, "sans", WHITE, { weight: 1.05 });
  });
  ALSO_RIGHT.forEach((t, i) => {
    const ry = topY + i * rowH2;
    diamond(cv, 526, ry + 7, 4, GOLD);
    drawText(cv, t, 538, ry, 14.5, "sans", WHITE, { weight: 1.05 });
  });

  // Footer.
  drawText(
    cv,
    "SOURCES: REUTERS, AP, BBC, AL JAZEERA, JAPAN DEFENSE MINISTRY, PAHO, ULA, IMD, NDTV",
    512, 958, 10.5, "sans", [178, 164, 128], { align: "center", tracking: 1 }
  );
  drawText(
    cv,
    "EVERY STORY ABOVE HAPPENED OR WAS FIRST REPORTED ON TUESDAY 17 NOVEMBER 2026.",
    512, 974, 13.5, "serif", GOLD, { align: "center", tracking: 0.5 }
  );

  return encodePNG(LW, LH, cv.downsample());
}

// ------------------------------------------------------- digit test sheet
// Mandatory gate: every digit must read correctly at a glance in BOTH
// faces before the full image is trusted.

function buildTest() {
  const cv = new Canvas();
  cv.rect(0, 0, LW, LH, NAVY);
  drawText(cv, "DIGIT TEST", 512, 26, 30, "serif", GOLD_LT, { align: "center", tracking: 6 });
  drawText(cv, "SERIF DISPLAY", 60, 84, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "0123456789", 60, 108, 110, "serif", WHITE, {});
  drawText(cv, "SANS", 60, 244, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "0123456789", 60, 268, 110, "sans", WHITE, {});
  drawText(cv, "SERIF DATE", 60, 404, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "TUESDAY 17 NOVEMBER 2026", 60, 428, 54, "serif", WHITE, {});
  drawText(cv, "SANS NUMBERS", 60, 508, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "26 YEARS  5,412  $130BN  $25.9BN", 60, 532, 40, "sans", WHITE, {});
  drawText(cv, "135 OFF 48  $10.5T  0.5%  40  NOV 20", 60, 586, 40, "sans", WHITE, {});
  drawText(cv, "SANS ALPHABET", 60, 654, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 60, 678, 40, "sans", WHITE, {});
  drawText(cv, "SERIF ALPHABET", 60, 736, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 60, 760, 40, "serif", WHITE, {});
  drawText(cv, "MUSALEM CHECK", 60, 824, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "FED'S MUSALEM", 60, 848, 44, "sans", WHITE, {});
  drawText(cv, "PUNCTUATION", 560, 824, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "$ % . , : ; - ' / ( ) + ! ?", 560, 848, 40, "sans", WHITE, {});
  drawText(cv, "SMALL 14PX", 60, 920, 16, "sans", GOLD, { tracking: 3 });
  drawText(cv, "0123456789  2026  5,412  $25.9BN", 60, 944, 14, "sans", WHITE, { weight: 1.35 });
  drawText(cv, "0123456789  2026", 560, 944, 14, "serif", WHITE, {});
  return encodePNG(LW, LH, cv.downsample());
}

// -------------------------------------------------------------------- main

const outDir = process.env.OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
const png = process.env.DIGIT_TEST ? buildTest() : buildFull();
writeFileSync(join(outDir, "entry.png"), png);
console.log("wrote", join(outDir, "entry.png"), png.length, "bytes");
