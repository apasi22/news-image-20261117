// news-image-20261117 — "Sum up 17 November's world news in one image"
// A deterministic program that draws a newspaper front page for
// TUESDAY 17 NOVEMBER 2026 in pure code (Node 22 stdlib only) and
// writes it to /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png).
// Everything is drawn from scratch: a tiny PNG encoder (node:zlib +
// CRC32), a hand-defined 5x7 bitmap font, and vector-style panels.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- PNG out --
// CRC32 (IEEE 802.3) table, built once at load.
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Raw scanlines: one filter byte (0 = none) + 3 bytes per pixel.
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- framebuffer --
export type RGB = [number, number, number];

export class Canvas {
  readonly w: number;
  readonly h: number;
  readonly buf: Buffer;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 3);
  }
  px(x: number, y: number, c: RGB): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const o = (iy * this.w + ix) * 3;
    this.buf[o] = c[0];
    this.buf[o + 1] = c[1];
    this.buf[o + 2] = c[2];
  }
  fill(c: RGB): void {
    for (let i = 0; i < this.w * this.h; i++) {
      this.buf[i * 3] = c[0];
      this.buf[i * 3 + 1] = c[1];
      this.buf[i * 3 + 2] = c[2];
    }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const o = (yy * this.w + xx) * 3;
        this.buf[o] = c[0];
        this.buf[o + 1] = c[1];
        this.buf[o + 2] = c[2];
      }
    }
  }
  // 1px outline rectangle (border only).
  frame(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
    this.rect(x, y, w, t, c);
    this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c);
    this.rect(x + w - t, y, t, h, c);
  }
  // Bresenham line.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(ax, ay, c);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }
  // Thick line: draw the line several times with small offsets.
  thickLine(x0: number, y0: number, x1: number, y1: number, c: RGB, t: number): void {
    const r = Math.floor(t / 2);
    for (let ox = -r; ox <= r; ox++) {
      for (let oy = -r; oy <= r; oy++) {
        this.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, c);
      }
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB): void {
    const rr = Math.round(r);
    for (let dy = -rr; dy <= rr; dy++) {
      const dx = Math.floor(Math.sqrt(rr * rr - dy * dy));
      for (let x = -dx; x <= dx; x++) this.px(cx + x, cy + dy, c);
    }
  }
  ring(cx: number, cy: number, r: number, c: RGB, t: number): void {
    const rr = Math.round(r);
    for (let a = 0; a < 360; a++) {
      const rad = (a * Math.PI) / 180;
      for (let k = 0; k < t; k++) {
        this.px(cx + (rr - k) * Math.cos(rad), cy + (rr - k) * Math.sin(rad), c);
      }
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let dy = -Math.round(ry); dy <= Math.round(ry); dy++) {
      const f = 1 - (dy * dy) / (ry * ry);
      if (f < 0) continue;
      const dx = Math.floor(rx * Math.sqrt(f));
      for (let x = -dx; x <= dx; x++) this.px(cx + x, cy + dy, c);
    }
  }
  // Filled triangle.
  tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      const edges: Array<[number, number, number, number]> = [
        [x0, y0, x1, y1],
        [x1, y1, x2, y2],
        [x2, y2, x0, y0],
      ];
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      if (xs.length >= 2) {
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        for (let x = Math.floor(lo); x <= Math.ceil(hi); x++) this.px(x, y, c);
      }
    }
  }
  // Filled convex polygon (points in order).
  poly(pts: Array<[number, number]>, c: RGB): void {
    const minY = Math.min(...pts.map((p) => p[1]));
    const maxY = Math.max(...pts.map((p) => p[1]));
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      if (xs.length >= 2) {
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        for (let x = Math.floor(lo); x <= Math.ceil(hi); x++) this.px(x, y, c);
      }
    }
  }
  // Dashed horizontal or diagonal line helper (used for flight paths).
  dashed(x0: number, y0: number, x1: number, y1: number, c: RGB, dash: number, gap: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.floor(len));
    let on = true;
    let run = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (on) this.px(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c);
      run++;
      if (on && run >= dash) {
        on = false;
        run = 0;
      } else if (!on && run >= gap) {
        on = true;
        run = 0;
      }
    }
  }
}

// ------------------------------------------------------------------ font --
// Hand-defined 5x7 bitmap font. Each glyph is 7 rows of 5 bits (numbers
// 0-31, bit 4 = leftmost pixel). Only capitals are defined; text is
// upper-cased before drawing. Rows are top to bottom.
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ";": [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '"': [0x0a, 0x0a, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 0x0e, 0, 0, 0],
  "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  "%": [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  "#": [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
  "@": [0x0e, 0x11, 0x17, 0x15, 0x16, 0x10, 0x0e],
  "*": [0, 0x04, 0x15, 0x0e, 0x15, 0x04, 0],
  "+": [0, 0x04, 0x04, 0x0e, 0x04, 0x04, 0],
  "=": [0, 0, 0x1f, 0, 0x1f, 0, 0],
  "\u00b7": [0, 0, 0, 0x0c, 0x0c, 0, 0], // middot
  "\u2013": [0, 0, 0, 0x1f, 0, 0, 0], // en dash
};

const FONT_W = 5;
const FONT_H = 7;

// Width of one glyph cell at a given scale (glyph + 1px gap).
function cellW(scale: number): number {
  return (FONT_W + 1) * scale;
}

function textWidth(s: string, scale: number): number {
  return s.length * cellW(scale) - scale; // no trailing gap
}

function drawGlyph(cv: Canvas, ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let r = 0; r < FONT_H; r++) {
    const row = g[r];
    for (let col = 0; col < FONT_W; col++) {
      if (row & (1 << (FONT_W - 1 - col))) {
        cv.rect(x + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

// Draw text, upper-cased. Returns the width drawn.
function drawText(cv: Canvas, s: string, x: number, y: number, scale: number, c: RGB): number {
  const up = s.toUpperCase();
  let cx = x;
  for (const ch of up) {
    drawGlyph(cv, ch, cx, y, scale, c);
    cx += cellW(scale);
  }
  return cx - x - scale;
}

// Draw text with fake bold (a second pass offset by 1px right).
function drawTextBold(cv: Canvas, s: string, x: number, y: number, scale: number, c: RGB): number {
  drawText(cv, s, x, y, scale, c);
  if (scale >= 2) drawText(cv, s, x + 1, y, scale, c);
  return textWidth(s.toUpperCase(), scale) + (scale >= 2 ? 1 : 0);
}

function drawTextCentered(cv: Canvas, s: string, cx: number, y: number, scale: number, c: RGB): number {
  const w = textWidth(s.toUpperCase(), scale);
  return drawText(cv, s, Math.round(cx - w / 2), y, scale, c);
}

// Greedy word wrap: returns lines that fit maxW at the given scale.
function wrapText(s: string, scale: number, maxW: number): string[] {
  const words = s.toUpperCase().split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW) {
      cur = trial;
    } else {
      if (cur !== "") lines.push(cur);
      // A single word too wide: hard-split it.
      let rest = w;
      while (textWidth(rest, scale) > maxW) {
        let n = 1;
        while (n < rest.length && textWidth(rest.slice(0, n + 1), scale) <= maxW) n++;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      cur = rest;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------- palette --
const PAPER: RGB = [246, 241, 231];
const INK: RGB = [26, 26, 26];
const WHITE: RGB = [255, 255, 255];
const SKY: RGB = [214, 232, 244];
const GOLD: RGB = [255, 210, 74];

// ----------------------------------------------------------- illustrations --
// Each illustration draws inside a rectangle (x, y, w, h) with simple,
// recognizable vector shapes. All coordinates are relative to the rect.

function illoBridge(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const sky: RGB = [232, 190, 140];
  const sea: RGB = [46, 92, 128];
  const deck: RGB = [90, 90, 96];
  const tower: RGB = [60, 60, 68];
  cv.rect(x, y, w, h, sky);
  // sun
  cv.circle(x + w - 52, y + 26, 16, [255, 226, 140]);
  // sea
  cv.rect(x, y + h - 26, w, 26, sea);
  cv.thickLine(x + 8, y + h - 18, x + w - 8, y + h - 18, [255, 255, 255], 2);
  cv.thickLine(x + 40, y + h - 10, x + w - 40, y + h - 10, [180, 210, 230], 2);
  // towers
  const t1 = x + w * 0.22;
  const t2 = x + w * 0.78;
  cv.rect(t1 - 5, y + 12, 10, h - 38, tower);
  cv.rect(t2 - 5, y + 12, 10, h - 38, tower);
  cv.rect(t1 - 9, y + 8, 18, 8, tower);
  cv.rect(t2 - 9, y + 8, 18, 8, tower);
  // deck in two pieces with a gap in the middle (the strike)
  const deckY = y + h - 44;
  cv.rect(x + 6, deckY, w * 0.5 - 20, 8, deck);
  cv.rect(x + w * 0.5 + 14, deckY, w * 0.5 - 20, 8, deck);
  // cables
  cv.line(t1, y + 14, x + 6, deckY, [120, 120, 128]);
  cv.line(t1, y + 14, x + w * 0.5 - 20, deckY, [120, 120, 128]);
  cv.line(t2, y + 14, x + w * 0.5 + 14, deckY, [120, 120, 128]);
  cv.line(t2, y + 14, x + w - 6, deckY, [120, 120, 128]);
  // explosion star at the gap
  const ex = x + w * 0.5;
  const ey = deckY - 8;
  cv.circle(ex, ey, 14, [255, 170, 30]);
  cv.circle(ex, ey, 8, [255, 220, 90]);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    cv.line(ex, ey, ex + 16 * Math.cos(a), ey + 16 * Math.sin(a), [255, 120, 20]);
  }
  // smoke, kept inside the illustration frame
  cv.circle(ex - 22, ey - 10, 7, [120, 120, 120]);
  cv.circle(ex + 18, ey - 12, 8, [140, 140, 140]);
  cv.circle(ex - 4, ey - 14, 6, [160, 160, 160]);
}

function illoTanker(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const sky: RGB = [250, 200, 130];
  const sea: RGB = [24, 68, 110];
  cv.rect(x, y, w, h, sky);
  cv.circle(x + 44, y + 22, 15, [255, 240, 180]);
  // sea band; everything afloat sits on its top edge
  const water = y + h - 30;
  cv.rect(x, water, w, 30, sea);
  cv.thickLine(x + 10, y + h - 20, x + w - 10, y + h - 20, [120, 170, 210], 2);
  cv.thickLine(x + 60, y + h - 10, x + w - 60, y + h - 10, [90, 140, 190], 2);
  // carrier silhouette in the distance (lightened so it reads on the sky)
  cv.rect(x + w - 190, water - 8, 150, 10, [118, 128, 142]);
  cv.rect(x + w - 96, water - 26, 18, 20, [118, 128, 142]);
  cv.rect(x + w - 190, water - 4, 150, 6, [96, 106, 120]);
  // tanker hull (foreground) sitting in the water
  const hy = water;
  cv.poly(
    [
      [x + 14, hy],
      [x + 250, hy],
      [x + 268, hy + 14],
      [x + 30, hy + 14],
    ],
    [140, 40, 36],
  );
  cv.rect(x + 30, hy - 14, 60, 14, [180, 60, 46]);
  cv.rect(x + 100, hy - 10, 90, 10, [120, 34, 30]);
  // flame + smoke from the tanker, kept inside the illustration frame
  const fx = x + 120;
  const fy = hy - 12;
  cv.tri(fx - 10, fy, fx, fy - 22, fx + 10, fy, [255, 140, 20]);
  cv.tri(fx - 6, fy, fx, fy - 13, fx + 6, fy, [255, 210, 80]);
  cv.circle(fx - 26, fy - 8, 7, [110, 110, 110]);
  cv.circle(fx + 24, fy - 10, 8, [130, 130, 130]);
  cv.circle(fx - 2, fy - 14, 6, [150, 150, 150]);
}

function illoSummit(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const sky: RGB = [255, 224, 160];
  cv.rect(x, y, w, h, sky);
  cv.circle(x + w - 46, y + 24, 15, [255, 244, 190]);
  // Shenzhen skyline
  const base = y + h - 26;
  const towers: Array<[number, number, number]> = [
    [0.02, 0.1, 0.45],
    [0.14, 0.07, 0.58],
    [0.23, 0.12, 0.4],
    [0.37, 0.08, 0.55],
    [0.47, 0.11, 0.45],
    [0.6, 0.07, 0.6],
    [0.69, 0.1, 0.4],
    [0.81, 0.06, 0.55],
  ];
  for (const [fx, fw, fh] of towers) {
    cv.rect(x + w * fx, base - h * fh, w * fw, h * fh + 26, [96, 110, 140]);
  }
  cv.rect(x, base, w, 26, [70, 80, 100]);
  // three flags on poles above the skyline
  const flags: Array<{ c1: RGB; c2: RGB; c3: RGB }> = [
    { c1: [178, 34, 52], c2: [255, 255, 255], c3: [60, 60, 140] }, // USA
    { c1: [222, 41, 16], c2: [255, 222, 0], c3: [222, 41, 16] }, // China
    { c1: [255, 255, 255], c2: [0, 57, 166], c3: [213, 0, 50] }, // Russia
  ];
  for (let i = 0; i < 3; i++) {
    const px = x + w * (0.2 + i * 0.3);
    const py = y + 10;
    cv.rect(px, py, 3, 44, [40, 40, 40]);
    const f = flags[i];
    cv.rect(px + 3, py, 34, 8, f.c1);
    cv.rect(px + 3, py + 8, 34, 8, f.c2);
    cv.rect(px + 3, py + 16, 34, 8, f.c3);
    cv.circle(px + 12, py + 4, 3, [255, 222, 0]);
  }
}

function illoRwanda(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const land: RGB = [232, 222, 190];
  cv.rect(x, y, w, h, land);
  // simplified Africa silhouette (left) and Europe hint (top right)
  cv.poly(
    [
      [x + 30, y + 8],
      [x + 150, y + 8],
      [x + 170, y + 30],
      [x + 150, y + 60],
      [x + 120, y + 74],
      [x + 96, y + 66],
      [x + 70, y + 44],
      [x + 40, y + 30],
    ],
    [196, 160, 110],
  );
  cv.poly(
    [
      [x + w - 120, y + 6],
      [x + w - 30, y + 6],
      [x + w - 20, y + 18],
      [x + w - 60, y + 26],
      [x + w - 110, y + 20],
    ],
    [150, 170, 200],
  );
  // plane flying from Europe to Africa with dashed path
  cv.dashed(x + w - 90, y + 22, x + 120, y + 52, [60, 60, 60], 5, 4);
  const px = x + 150;
  const py = y + 46;
  cv.tri(px, py - 6, px + 34, py, px, py + 6, [40, 60, 90]);
  cv.tri(px + 8, py - 4, px + 16, py - 12, px + 20, py - 4, [40, 60, 90]);
  cv.tri(px + 8, py + 4, px + 16, py + 12, px + 20, py + 4, [40, 60, 90]);
  // map pin on the hub site
  const pinX = x + 108;
  const pinY = y + 62;
  cv.circle(pinX, pinY - 6, 9, [179, 38, 30]);
  cv.tri(pinX - 7, pinY, pinX + 7, pinY, pinX, pinY + 12, [179, 38, 30]);
  cv.circle(pinX, pinY - 6, 3, [255, 255, 255]);
  // facility: small buildings at bottom right
  cv.rect(x + w - 150, y + h - 34, 34, 26, [120, 120, 120]);
  cv.rect(x + w - 108, y + h - 44, 30, 36, [100, 100, 100]);
  cv.rect(x + w - 70, y + h - 28, 40, 20, [130, 130, 130]);
  cv.rect(x + w - 150, y + h - 8, 120, 2, [60, 60, 60]);
}

function illoPentagon(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const bg: RGB = [226, 232, 238];
  cv.rect(x, y, w, h, bg);
  // the Pentagon building: five-sided ring with a courtyard
  const cx = x + 118;
  const cy = y + h / 2 + 2;
  const R = 40;
  const outer: Array<[number, number]> = [];
  const inner: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    outer.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    inner.push([cx + (R - 12) * Math.cos(a), cy + (R - 12) * Math.sin(a)]);
  }
  cv.poly(outer, [120, 132, 148]);
  cv.poly(inner, bg);
  cv.poly(inner, [120, 132, 148]); // redraw ring edge cleanly
  cv.poly(
    inner.map(([px, py]) => [px, py] as [number, number]),
    bg,
  );
  // red downward chart on the right
  const bx = x + w - 150;
  const by = y + h - 18;
  cv.line(bx, by, x + w - 14, by, [60, 60, 60]);
  const bars = [52, 44, 34, 22];
  for (let i = 0; i < 4; i++) {
    cv.rect(bx + 12 + i * 32, by - bars[i], 20, bars[i], [179, 38, 30]);
  }
  cv.line(bx + 8, by - 56, bx + 8 + 3 * 32 + 20, by - 18, [179, 38, 30]);
  // dollar coin
  cv.circle(x + w - 52, y + 22, 15, [255, 210, 74]);
  cv.ring(x + w - 52, y + 22, 15, [180, 140, 20], 2);
  drawText(cv, "$", x + w - 58, y + 15, 2, [120, 90, 10]);
}

function illoJets(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const sky: RGB = [196, 224, 244];
  cv.rect(x, y, w, h, sky);
  cv.circle(x + w - 48, y + 20, 14, [255, 240, 170]);
  // clouds
  cv.ellipse(x + 70, y + 16, 34, 10, [255, 255, 255]);
  cv.ellipse(x + 240, y + 12, 28, 8, [255, 255, 255]);
  // sea at the bottom
  cv.rect(x, y + h - 22, w, 22, [70, 130, 180]);
  cv.thickLine(x + 20, y + h - 14, x + w - 20, y + h - 14, [190, 220, 240], 2);
  // two fighter jets with contrails
  const jets: Array<[number, number, number]> = [
    [0.18, 0.42, 1.0],
    [0.52, 0.58, 0.9],
  ];
  for (const [fx, fy, s] of jets) {
    const jx = x + w * fx;
    const jy = y + h * fy;
    cv.dashed(jx - 10, jy + 4, jx - 110 * s, jy + 14, [255, 255, 255], 6, 4);
    // delta wing + fuselage
    cv.tri(jx, jy - 6 * s, jx + 44 * s, jy, jx, jy + 6 * s, [50, 60, 74]);
    cv.tri(jx + 6 * s, jy - 4 * s, jx + 20 * s, jy - 16 * s, jx + 22 * s, jy - 4 * s, [50, 60, 74]);
    cv.tri(jx + 6 * s, jy + 4 * s, jx + 20 * s, jy + 16 * s, jx + 22 * s, jy + 4 * s, [50, 60, 74]);
    cv.circle(jx + 34 * s, jy, 3, [200, 60, 50]);
  }
  // small red disc (rising sun hint) on the right
  cv.circle(x + w - 96, y + h - 40, 8, [200, 60, 50]);
}

// ------------------------------------------------------------------ layout --
interface Story {
  kicker: string;
  kickerBg: RGB;
  headline: string;
  sub: string;
  draw: (cv: Canvas, x: number, y: number, w: number, h: number) => void;
}

const STORIES: Story[] = [
  {
    kicker: "EUROPE \u00b7 WAR",
    kickerBg: [179, 38, 30],
    headline: "UKRAINE HITS CRIMEA BRIDGE AGAIN",
    sub: "Second strike on the Kerch crossing in a day; Moscow hits two bridges over the Dnipro.",
    draw: illoBridge,
  },
  {
    kicker: "GULF \u00b7 SHIPPING",
    kickerBg: [11, 79, 108],
    headline: "TANKERS HIT BY MINES NEAR HORMUZ",
    sub: "Two tankers struck and ablaze south of the strait; a third U.S. carrier reaches the region.",
    draw: illoTanker,
  },
  {
    kicker: "DIPLOMACY \u00b7 SHENZHEN",
    kickerBg: [123, 31, 162],
    headline: "TRUMP FLIES TO ASIA FOR APEC",
    sub: "Beijing confirms a first Xi-Trump-Putin summit on Thursday, on nuclear risks and Ukraine.",
    draw: illoSummit,
  },
  {
    kicker: "EUROPE \u00b7 MIGRATION",
    kickerBg: [46, 125, 50],
    headline: "FIVE EU STATES PLAN RWANDA HUB",
    sub: "Germany, Denmark, Austria, Greece and the Netherlands back a joint return facility.",
    draw: illoRwanda,
  },
  {
    kicker: "UNITED STATES \u00b7 DEFENCE",
    kickerBg: [55, 71, 79],
    headline: "PENTAGON FAILS ITS AUDIT",
    sub: "Ninth straight year: auditors cannot verify books covering $4.8 trillion in assets.",
    draw: illoPentagon,
  },
  {
    kicker: "ASIA \u00b7 SECURITY",
    kickerBg: [21, 101, 192],
    headline: "JAPAN SCRAMBLES FIGHTER JETS",
    sub: "Russian aircraft enter Japanese airspace; Tokyo lodges a stern protest with Moscow.",
    draw: illoJets,
  },
];

function drawPanel(cv: Canvas, s: Story, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, WHITE);
  cv.frame(x, y, w, h, INK, 2);
  // kicker strip
  cv.rect(x + 2, y + 2, w - 4, 28, s.kickerBg);
  drawText(cv, s.kicker, x + 12, y + 9, 2, WHITE);
  const tx = x + 12;
  const tw = w - 24;
  // headline (scale 3, bold)
  const headLines = wrapText(s.headline, 3, tw);
  let cy = y + 40;
  for (const ln of headLines) {
    drawTextBold(cv, ln, tx, cy, 3, INK);
    cy += 3 * 7 + 5;
  }
  // subline (scale 2)
  cy += 2;
  const subLines = wrapText(s.sub, 2, tw);
  for (const ln of subLines) {
    drawText(cv, ln, tx, cy, 2, [64, 64, 64]);
    cy += 2 * 7 + 4;
  }
  // illustration fills the rest of the panel
  const iy = cy + 6;
  const ih = y + h - 8 - iy;
  if (ih >= 40) {
    s.draw(cv, x + 10, iy, w - 20, ih);
    cv.frame(x + 10, iy, w - 20, ih, [150, 150, 150], 1);
  }
}

function drawPage(): Buffer {
  const W = 1024;
  const H = 1024;
  const cv = new Canvas(W, H);
  cv.fill(PAPER);
  // double frame
  cv.frame(10, 10, W - 20, H - 20, INK, 3);
  cv.frame(18, 18, W - 36, H - 36, [120, 120, 120], 1);
  // masthead
  drawTextCentered(cv, "THE WORLD IN ONE DAY", W / 2, 34, 2, INK);
  drawTextCentered(cv, "TUESDAY 17 NOVEMBER 2026", W / 2, 60, 6, INK);
  cv.thickLine(32, 116, W - 32, 116, INK, 3);
  drawTextCentered(cv, "SIX STORIES THAT DEFINED THE DAY", W / 2, 126, 2, [90, 90, 90]);
  // panels: 2 columns x 3 rows
  const gx = 32;
  const gy = 152;
  const gap = 16;
  const pw = Math.floor((W - 2 * gx - gap) / 2);
  const ph = 238;
  for (let i = 0; i < STORIES.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    drawPanel(cv, STORIES[i], gx + col * (pw + gap), gy + row * (ph + 14), pw, ph);
  }
  // footer
  const fy = gy + 3 * ph + 2 * 14 + 12;
  cv.thickLine(32, fy, W - 32, fy, INK, 2);
  const also =
    "ALSO: TECH OUTAGES HIT THE NSA, APPLE AND JPMORGAN \u00b7 U.S. MEASLES CASES HIGHEST SINCE 1991";
  const alsoLines = wrapText(also, 2, W - 64);
  let ly = fy + 10;
  for (const ln of alsoLines) {
    drawText(cv, ln, 32, ly, 2, INK);
    ly += 2 * 7 + 5;
  }
  ly += 2;
  drawText(
    cv,
    "EVERY STORY ABOVE HAPPENED OR WAS FIRST REPORTED ON 17 NOVEMBER 2026.",
    32,
    ly,
    2,
    [120, 30, 30],
  );
  return encodePng(W, H, cv.buf);
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const png = drawPage();
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  console.log(`wrote ${png.length} bytes to ${path.join(outDir, "entry.png")}`);
}

main();
