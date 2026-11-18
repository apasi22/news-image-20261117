// THE WORLD IN ONE DAY — Tuesday 17 November 2026.
// A code-drawn newspaper poster: every pixel is computed here.
// Own PNG encoder, own vector letterforms, own map and illustrations.
// Stdlib only, no network, deterministic.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- canvas
const W = 1024, H = 1024, SS = 2; // render at 2x, downsample for antialiasing
const SW = W * SS, SH = H * SS;
const buf = new Uint8Array(SW * SH * 3);

let clipX0 = 0, clipY0 = 0, clipX1 = SW, clipY1 = SH;
function setClip(x0, y0, x1, y1) { // final-pixel coords
  clipX0 = Math.max(0, Math.floor(x0 * SS)); clipY0 = Math.max(0, Math.floor(y0 * SS));
  clipX1 = Math.min(SW, Math.ceil(x1 * SS)); clipY1 = Math.min(SH, Math.ceil(y1 * SS));
}
function clearClip() { clipX0 = 0; clipY0 = 0; clipX1 = SW; clipY1 = SH; }

function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function mix(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}

function fillRect(x, y, w, h, c) { // final coords
  const x0 = Math.max(clipX0, Math.floor(x * SS)), x1 = Math.min(clipX1, Math.ceil((x + w) * SS));
  const y0 = Math.max(clipY0, Math.floor(y * SS)), y1 = Math.min(clipY1, Math.ceil((y + h) * SS));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * SW + x0) * 3;
    for (let xx = x0; xx < x1; xx++) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; i += 3; }
  }
}

function vgrad(x, y, w, h, top, bottom) {
  const y0 = Math.max(clipY0, Math.floor(y * SS)), y1 = Math.min(clipY1, Math.ceil((y + h) * SS));
  const x0 = Math.max(clipX0, Math.floor(x * SS)), x1 = Math.min(clipX1, Math.ceil((x + w) * SS));
  for (let yy = y0; yy < y1; yy++) {
    const t = h <= 0 ? 0 : (yy / SS - y) / h;
    const c = mix(top, bottom, Math.max(0, Math.min(1, t)));
    let i = (yy * SW + x0) * 3;
    for (let xx = x0; xx < x1; xx++) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; i += 3; }
  }
}

function hline(x, y, w, c, th) { fillRect(x, y - th / 2, w, th, c); }
function vline(x, y, h, c, th) { fillRect(x - th / 2, y, th, h, c); }

// Filled circle, final coords (cx, cy, radius).
function circle(cx, cy, r, c) {
  const x0 = Math.max(clipX0, Math.floor((cx - r) * SS)), x1 = Math.min(clipX1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(clipY0, Math.floor((cy - r) * SS)), y1 = Math.min(clipY1, Math.ceil((cy + r) * SS));
  const ccx = cx * SS, ccy = cy * SS, rr = r * SS;
  for (let yy = y0; yy < y1; yy++) {
    const dy = yy + 0.5 - ccy;
    const dx = Math.sqrt(Math.max(0, rr * rr - dy * dy));
    const xa = Math.max(x0, Math.ceil(ccx - dx)), xb = Math.min(x1, Math.floor(ccx + dx));
    let i = (yy * SW + xa) * 3;
    for (let xx = xa; xx < xb; xx++) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; i += 3; }
  }
}

// Filled ellipse, final coords.
function ellipse(cx, cy, rx, ry, c) {
  const x0 = Math.max(clipX0, Math.floor((cx - rx) * SS)), x1 = Math.min(clipX1, Math.ceil((cx + rx) * SS));
  const y0 = Math.max(clipY0, Math.floor((cy - ry) * SS)), y1 = Math.min(clipY1, Math.ceil((cy + ry) * SS));
  const ccx = cx * SS, ccy = cy * SS, arx = rx * SS, ary = ry * SS;
  for (let yy = y0; yy < y1; yy++) {
    const t = (yy + 0.5 - ccy) / ary;
    const dx = arx * Math.sqrt(Math.max(0, 1 - t * t));
    const xa = Math.max(x0, Math.ceil(ccx - dx)), xb = Math.min(x1, Math.floor(ccx + dx));
    let i = (yy * SW + xa) * 3;
    for (let xx = xa; xx < xb; xx++) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; i += 3; }
  }
}

// Polygon fill, signed nonzero winding. polys: [{pts:[[x,y]...], s:+1|-1}]
// Coordinates in FINAL pixels; holes use s:-1, overlapping solids stay solid.
function fillPolys(polys, c) {
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const poly of polys) {
    const pts = poly.pts, s = poly.s || 1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const y1 = a[1] * SS, y2 = b[1] * SS;
      if (y1 === y2) continue;
      edges.push({ x1: a[0] * SS, y1, x2: b[0] * SS, y2, s: y2 > y1 ? s : -s });
      if (y1 < minY) minY = y1; if (y2 < minY) minY = y2;
      if (y1 > maxY) maxY = y1; if (y2 > maxY) maxY = y2;
    }
  }
  if (!edges.length) return;
  const y0 = Math.max(clipY0, Math.floor(minY)), y1 = Math.min(clipY1, Math.ceil(maxY));
  const xs = [];
  for (let yy = y0; yy < y1; yy++) {
    const yc = yy + 0.5;
    xs.length = 0;
    for (const e of edges) {
      if ((e.y1 <= yc && e.y2 > yc) || (e.y2 <= yc && e.y1 > yc)) {
        xs.push([e.x1 + (yc - e.y1) * (e.x2 - e.x1) / (e.y2 - e.y1), e.s]);
      }
    }
    if (!xs.length) continue;
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let i = 0; i < xs.length; i++) {
      const xStart = xs[i][0];
      wind += xs[i][1];
      const xEnd = i + 1 < xs.length ? xs[i + 1][0] : xStart;
      if (wind !== 0 && xEnd > xStart) {
        const xa = Math.max(clipX0, Math.ceil(xStart)), xb = Math.min(clipX1, Math.floor(xEnd));
        let k = (yy * SW + xa) * 3;
        for (let xx = xa; xx < xb; xx++) { buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; k += 3; }
      }
    }
  }
}
function fillPoly(pts, c) { fillPolys([{ pts, s: 1 }], c); }

// Thick polyline with round joins/caps. pts in final coords.
function strokePath(pts, w, c, closed) {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = -dy / len * w / 2, ny = dx / len * w / 2;
    fillPoly([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], c);
  }
  for (const p of pts) circle(p[0], p[1], w / 2, c);
}
function line(x1, y1, x2, y2, w, c) { strokePath([[x1, y1], [x2, y2]], w, c, false); }

// Dashed line, final coords.
function dashedLine(x1, y1, x2, y2, w, c, dash, gap) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  let d = 0;
  while (d < len) {
    const e = Math.min(len, d + dash);
    line(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e, w, c);
    d = e + gap;
  }
}

// Quadratic bezier sampled polyline.
function quad(p0, p1, p2, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
              u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}

// ---------------------------------------------------------------- PNG out
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function writePng(file) {
  // Downsample 2x2 box average -> final RGB.
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const rowStart = y * (1 + W * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < W; x++) {
      const sx = x * SS, sy = y * SS;
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const i = ((sy + dy) * SW + sx + dx) * 3;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      }
      const o = rowStart + 1 + x * 3;
      raw[o] = Math.round(r / 4); raw[o + 1] = Math.round(g / 4); raw[o + 2] = Math.round(b / 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  return png.length;
}

// ---------------------------------------------------------------- letterforms
// Vector capitals on a 12x16 grid: filled polygons (with signed holes) and
// thick strokes with round joins. Thick verticals, thinner horizontals,
// flared feet on stemmed letters: a sturdy editorial face that stays smooth
// when scaled, unlike a bitmap font.
// Shape: {p:[[x,y]...], h:1} polygon (h = hole) or {l:[[x,y]...], w, c:1} stroke.
const G = {
  A: { a: 12, sh: [{ p: [[6, 0], [12, 16], [9.1, 16], [7.7, 11.6], [4.3, 11.6], [2.9, 16], [0, 16]] }, { p: [[6, 4.4], [8.2, 9.6], [3.8, 9.6]], h: 1 }] },
  B: { a: 12, sh: [{ p: [[0, 0], [7.5, 0], [11, 2.6], [11, 6.2], [9.6, 8], [11, 9.8], [11, 13.4], [7.5, 16], [0, 16]] }, { p: [[3, 2.8], [7, 2.8], [8.2, 4.2], [8.2, 5.6], [7, 6.8], [3, 6.8]], h: 1 }, { p: [[3, 9.2], [7.2, 9.2], [8.4, 10.6], [8.4, 12.2], [7.2, 13.4], [3, 13.4]], h: 1 }] },
  C: { a: 12, sh: [{ l: [[10.5, 3.5], [8, 1.5], [4.5, 1.5], [2, 4], [1.5, 8], [2, 12], [4.5, 14.5], [8, 14.5], [10.5, 12.5]], w: 3 }] },
  D: { a: 12, sh: [{ p: [[0, 0], [7, 0], [11, 3], [12, 8], [11, 13], [7, 16], [0, 16]] }, { p: [[3.2, 3], [6.6, 3], [8.6, 5.4], [8.6, 10.6], [6.6, 13], [3.2, 13]], h: 1 }] },
  E: { a: 11, sh: [{ p: [[0, 0], [11, 0], [11, 2.8], [3.2, 2.8], [3.2, 6.6], [9.5, 6.6], [9.5, 9.4], [3.2, 9.4], [3.2, 13.2], [11, 13.2], [11, 16], [0, 16]] }] },
  F: { a: 11, sh: [{ p: [[0, 0], [11, 0], [11, 2.8], [3.2, 2.8], [3.2, 6.6], [9.5, 6.6], [9.5, 9.4], [3.2, 9.4], [3.2, 16], [0, 16]] }] },
  G: { a: 12, sh: [{ l: [[10.5, 3.5], [8, 1.5], [4.5, 1.5], [2, 4], [1.5, 8], [2, 12], [4.5, 14.5], [8, 14.5], [10.5, 12.5], [10.5, 8.5]], w: 3 }, { p: [[6.5, 8], [10.8, 8], [10.8, 10.6], [6.5, 10.6]] }] },
  H: { a: 12, sh: [{ p: [[0, 0], [3.2, 0], [3.2, 6.6], [8.8, 6.6], [8.8, 0], [12, 0], [12, 16], [8.8, 16], [8.8, 9.4], [3.2, 9.4], [3.2, 16], [0, 16]] }] },
  I: { a: 8, sh: [{ p: [[0.5, 0], [7.5, 0], [7.5, 2.6], [5.1, 2.6], [5.1, 13.4], [7.5, 13.4], [7.5, 16], [0.5, 16], [0.5, 13.4], [2.9, 13.4], [2.9, 2.6], [0.5, 2.6]] }] },
  J: { a: 10, sh: [{ l: [[7, 1], [7, 10.5], [5.8, 13], [3.5, 13.2], [1.8, 11.4]], w: 2.9 }, { p: [[2.5, 0], [9.5, 0], [9.5, 2.6], [2.5, 2.6]] }] },
  K: { a: 12, sh: [{ p: [[0, 0], [3.2, 0], [3.2, 6.8], [6.4, 3.2], [9.8, 0], [12, 0], [12, 1.8], [8.2, 6.4], [12, 14.2], [12, 16], [9.6, 16], [6.2, 10.4], [3.2, 13.6], [3.2, 16], [0, 16]] }] },
  L: { a: 11, sh: [{ p: [[0, 0], [3.2, 0], [3.2, 13.2], [11, 13.2], [11, 16], [0, 16]] }] },
  M: { a: 13, sh: [{ p: [[0, 16], [0, 0], [3.4, 0], [6.5, 6.5], [9.6, 0], [13, 0], [13, 16], [9.8, 16], [9.8, 6.8], [6.5, 12], [3.2, 6.8], [3.2, 16]] }] },
  N: { a: 12, sh: [{ p: [[0, 16], [0, 0], [3, 0], [9, 10.5], [9, 0], [12, 0], [12, 16], [9, 16], [3, 5.5], [3, 16]] }] },
  O: { a: 12, sh: [{ l: [[6, 1], [8.5, 2], [10.5, 4.5], [11, 8], [10.5, 11.5], [8.5, 14], [6, 15], [3.5, 14], [1.5, 11.5], [1, 8], [1.5, 4.5], [3.5, 2]], w: 3, c: 1 }] },
  P: { a: 11, sh: [{ p: [[0, 0], [7.5, 0], [11, 2.6], [11, 6.8], [7.5, 9.6], [3.2, 9.6], [3.2, 16], [0, 16]] }, { p: [[3.2, 2.8], [7, 2.8], [8.2, 4.2], [8.2, 5.6], [7, 6.8], [3.2, 6.8]], h: 1 }] },
  Q: { a: 12, sh: [{ l: [[6, 1], [8.5, 2], [10.5, 4.5], [11, 8], [10.5, 11.5], [8.5, 14], [6, 15], [3.5, 14], [1.5, 11.5], [1, 8], [1.5, 4.5], [3.5, 2]], w: 3, c: 1 }, { p: [[7.5, 11], [11.8, 15.8], [11.8, 17.6], [9.6, 17.6], [6.4, 13]] }] },
  R: { a: 12, sh: [{ p: [[0, 0], [7.5, 0], [11, 2.6], [11, 6.8], [9.4, 8.6], [12, 16], [9, 16], [6.6, 10], [3.2, 10], [3.2, 16], [0, 16]] }, { p: [[3.2, 2.8], [7, 2.8], [8.2, 4.2], [8.2, 5.6], [7, 6.8], [3.2, 6.8]], h: 1 }] },
  S: { a: 12, sh: [{ l: [[9.5, 3], [7, 1.8], [4, 2.4], [2.4, 4.6], [3, 7], [5.5, 8.2], [8, 9.2], [9.6, 11.2], [9, 13.6], [6.5, 14.8], [3.8, 14.2], [2.2, 12.4]], w: 2.9 }] },
  T: { a: 12, sh: [{ p: [[0, 0], [12, 0], [12, 2.8], [0, 2.8]] }, { p: [[4.6, 2.8], [7.4, 2.8], [7.4, 13.6], [8.8, 13.6], [8.8, 16], [3.2, 16], [3.2, 13.6], [4.6, 13.6]] }] },
  U: { a: 12, sh: [{ l: [[1.8, 0.5], [1.8, 11], [3.5, 14], [6, 15], [8.5, 14], [10.2, 11], [10.2, 0.5]], w: 3 }] },
  V: { a: 12, sh: [{ p: [[0, 0], [3.2, 0], [6, 11.5], [8.8, 0], [12, 0], [7.6, 16], [4.4, 16]] }] },
  W: { a: 13, sh: [{ p: [[0, 0], [3, 0], [4.8, 9], [6.5, 3.5], [8.2, 9], [9.8, 0], [13, 0], [10.6, 16], [7.4, 16], [6.5, 12], [5.6, 16], [2.4, 16]] }] },
  X: { a: 12, sh: [{ p: [[0, 0], [3.4, 0], [6, 5.5], [8.6, 0], [12, 0], [7.6, 8], [12, 16], [8.6, 16], [6, 10.5], [3.4, 16], [0, 16], [4.4, 8]] }] },
  Y: { a: 12, sh: [{ p: [[0, 0], [3.2, 0], [6, 6], [8.8, 0], [12, 0], [7.6, 9.5], [7.6, 16], [4.4, 16], [4.4, 9.5]] }] },
  Z: { a: 12, sh: [{ p: [[0, 0], [12, 0], [12, 2.8], [4.6, 13.2], [12, 13.2], [12, 16], [0, 16], [0, 13.2], [7.4, 2.8], [0, 2.8]] }] },
  "0": { a: 11, sh: [{ l: [[5.5, 1], [8, 2], [9.8, 4.5], [10.3, 8], [9.8, 11.5], [8, 14], [5.5, 15], [3, 14], [1.2, 11.5], [0.7, 8], [1.2, 4.5], [3, 2]], w: 2.8, c: 1 }] },
  "1": { a: 9, sh: [{ p: [[4.5, 1.2], [7.3, 0], [7.3, 16], [4.5, 16]] }, { p: [[4.5, 1.2], [7.3, 0], [7.3, 2.6], [5.4, 4.6], [3.2, 5.6], [2.4, 3.4]] }, { p: [[2.5, 13.4], [8.5, 13.4], [8.5, 16], [2.5, 16]] }] },
  "2": { a: 11, sh: [{ l: [[3, 4], [4.5, 2], [7, 1.8], [9, 3.2], [9.5, 5.5], [8, 7.5], [3, 13], [2.5, 14.5]], w: 2.8 }, { p: [[2, 13.4], [10.5, 13.4], [10.5, 16], [2, 16]] }] },
  "3": { a: 11, sh: [{ l: [[3.5, 2.8], [5.5, 1.6], [8, 2.2], [9.6, 4.2], [9, 6.6], [7, 7.8], [9, 9.2], [9.6, 11.8], [8, 14.2], [5.5, 15.4], [3.5, 14.2]], w: 2.8 }] },
  "4": { a: 11, sh: [{ p: [[1.5, 10], [6.5, 0], [9, 0], [9, 10], [11, 10], [11, 12.8], [9, 12.8], [9, 16], [6.2, 16], [6.2, 12.8], [1.5, 12.8]] }, { p: [[4, 9.8], [6.2, 6.6], [6.2, 9.8]], h: 1 }] },
  "5": { a: 11, sh: [{ l: [[9.5, 2], [3, 2], [3, 7], [7, 7.5], [9.3, 9.5], [9.3, 12], [7, 14.5], [4, 14.5], [2.8, 13]], w: 2.8 }] },
  "6": { a: 11, sh: [{ l: [[9, 2], [6, 1.5], [3.5, 3.5], [2.5, 7], [3, 11], [5, 14], [8, 14.5], [9.5, 12], [9.5, 9.5], [8, 7.5], [5.5, 7], [3.5, 8]], w: 2.8 }] },
  "7": { a: 11, sh: [{ p: [[1.5, 0], [10.5, 0], [10.5, 2.8], [7.8, 2.8], [5.6, 16], [2.8, 16], [5, 2.8], [1.5, 2.8]] }] },
  "8": { a: 11, sh: [{ l: [[5.5, 1.5], [7.5, 2.5], [8.5, 4.5], [7.5, 7], [5.5, 7.8], [3.5, 7], [2.5, 4.5], [3.5, 2.5]], w: 2.6, c: 1 }, { l: [[5.5, 8.2], [8, 9], [9.3, 11], [8.5, 14], [5.5, 15.5], [2.5, 14], [1.7, 11], [3, 9]], w: 2.6, c: 1 }] },
  "9": { a: 11, sh: [{ l: [[3, 14], [6, 14.5], [8.5, 12.5], [9.5, 9], [9, 5], [7, 2], [4, 1.5], [2.5, 4], [2.5, 6.5], [4, 8.5], [6.5, 9], [8.5, 8]], w: 2.8 }] },
  " ": { a: 6, sh: [] },
  ".": { a: 6, sh: [{ p: [[1.5, 13], [4.5, 13], [4.5, 16], [1.5, 16]] }] },
  ",": { a: 6, sh: [{ p: [[1.5, 13], [4.5, 13], [4.5, 15], [3.2, 18], [1.2, 18], [2.5, 15]] }] },
  ":": { a: 6, sh: [{ p: [[1.5, 3.5], [4.5, 3.5], [4.5, 6.5], [1.5, 6.5]] }, { p: [[1.5, 10], [4.5, 10], [4.5, 13], [1.5, 13]] }] },
  ";": { a: 6, sh: [{ p: [[1.5, 3.5], [4.5, 3.5], [4.5, 6.5], [1.5, 6.5]] }, { p: [[1.5, 10], [4.5, 10], [4.5, 12], [3.2, 15], [1.2, 15], [2.5, 12]] }] },
  $: { a: 11, sh: [{ l: [[8.5, 3], [6, 2], [3.8, 3.2], [3.2, 5.2], [4.5, 6.8], [7.5, 7.6], [8.8, 9.4], [8, 12], [5.5, 13], [3.5, 12]], w: 2.1 }, { p: [[5, 0], [6.6, 0], [6.6, 16], [5, 16]] }] },
  "%": { a: 12, sh: [{ l: [[3, 1.5], [4.6, 2.4], [5.2, 4], [4.6, 5.6], [3, 6.5], [1.4, 5.6], [0.8, 4], [1.4, 2.4]], w: 1.9, c: 1 }, { l: [[9, 9.5], [10.6, 10.4], [11.2, 12], [10.6, 13.6], [9, 14.5], [7.4, 13.6], [6.8, 12], [7.4, 10.4]], w: 1.9, c: 1 }, { p: [[9.5, 0.5], [11.2, 2], [3.2, 15.5], [1.5, 14]] }] },
  "-": { a: 8, sh: [{ p: [[1, 7], [7, 7], [7, 9.5], [1, 9.5]] }] },
  "'": { a: 4, sh: [{ p: [[1.5, 0], [3.5, 0], [2.8, 4], [1, 4.5]] }] },
  "/": { a: 8, sh: [{ p: [[5.5, 0], [7.5, 0], [2.5, 16], [0.5, 16]] }] },
  "(": { a: 7, sh: [{ l: [[5.5, 1], [3.5, 3], [2.8, 8], [3.5, 13], [5.5, 15]], w: 2.4 }] },
  ")": { a: 7, sh: [{ l: [[1.5, 1], [3.5, 3], [4.2, 8], [3.5, 13], [1.5, 15]], w: 2.4 }] },
  "+": { a: 10, sh: [{ p: [[4.2, 3], [5.8, 3], [5.8, 7], [9, 7], [9, 9], [5.8, 9], [5.8, 13], [4.2, 13], [4.2, 9], [1, 9], [1, 7], [4.2, 7]] }] },
  "!": { a: 6, sh: [{ p: [[2, 0], [4, 0], [3.7, 10], [2.3, 10]] }, { p: [[2, 12.5], [4, 12.5], [4, 15.5], [2, 15.5]] }] },
  "=": { a: 9, sh: [{ p: [[1, 4.5], [8, 4.5], [8, 6.8], [1, 6.8]] }, { p: [[1, 9.5], [8, 9.5], [8, 11.8], [1, 11.8]] }] },
};

function glyph(ch) { return G[ch] || G[" "]; }

function textWidth(str, size, tracking) {
  const s = size / 16;
  let w = 0;
  for (const ch of str) w += glyph(ch).a * s + (tracking || 0);
  return w - (tracking || 0);
}

function drawGlyph(ch, x, y, size, c) {
  const g = glyph(ch);
  const s = size / 16;
  const polys = [];
  for (const sh of g.sh) {
    if (sh.p) {
      polys.push({ pts: sh.p.map(([gx, gy]) => [x + gx * s, y + gy * s]), s: sh.h ? -1 : 1 });
    } else {
      strokePath(sh.l.map(([gx, gy]) => [x + gx * s, y + gy * s]), sh.w * s, c, !!sh.c);
    }
  }
  if (polys.length) fillPolys(polys, c);
}

// Draw text; x,y = top-left of cap box. opts: align ('l','c','r'), tracking (px/char).
function drawText(str, x, y, size, c, opts) {
  const o = opts || {};
  const tr = o.tracking || 0;
  let xx = x;
  if (o.align === "c") xx = x - textWidth(str, size, tr) / 2;
  if (o.align === "r") xx = x - textWidth(str, size, tr);
  const s = size / 16;
  for (const ch of str) {
    drawGlyph(ch, xx, y, size, c);
    xx += glyph(ch).a * s + tr;
  }
  return xx;
}

// Text with a soft offset shadow for legibility over busy art.
function drawTextShadow(str, x, y, size, c, shadow, opts) {
  const o = opts || {};
  drawText(str, x + size * 0.06, y + size * 0.07, size, shadow, o);
  drawText(str, x, y, size, c, o);
}

// Greedy word wrap. Returns array of lines.
function wrapText(str, size, maxW, tracking) {
  const words = str.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, size, tracking || 0) <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Fit one line to a max width by shrinking size.
function fitSize(str, size, maxW, tracking) {
  let s = size;
  while (s > 6 && textWidth(str, s, tracking || 0) > maxW) s -= 0.5;
  return s;
}

// ---------------------------------------------------------------- palette
const NAVY = rgb("#0a1730"), NAVY2 = rgb("#0e2242"), NAVY3 = rgb("#081226");
const GOLD = rgb("#d9b45b"), GOLDLT = rgb("#f0d48a"), GOLDDK = rgb("#a8873a");
const CREAM = rgb("#f6efdd"), CREAM2 = rgb("#ece2c8"), INK = rgb("#1a2433");
const SLATE = rgb("#4a5568"), FAINT = rgb("#8fa3c4");
const RED = rgb("#b23a2e"), TEAL = rgb("#1e7a6d"), BLUE = rgb("#2b6cb0");
const PURPLE = rgb("#7d4a9e"), BROWN = rgb("#6b4f2e"), GREEN = rgb("#3d8b4f");
const WHITE = rgb("#ffffff");

function diamond(cx, cy, r, c) {
  fillPoly([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], c);
}

// Layered flame: base at (cx, cy), height ~ s.
function flame(cx, cy, s) {
  const shape = (k, dy) => [[-0.95, 0], [-1, -0.35], [-0.6, -0.6], [-0.7, -1.05], [-0.3, -0.8], [-0.05, -1.55], [0.2, -0.95], [0.55, -1.25], [0.5, -0.7], [0.95, -0.4], [0.9, 0]]
    .map(([x, y]) => [cx + x * s * k, cy + y * s * k + dy]);
  fillPoly(shape(1, 0), rgb("#d9480f"));
  fillPoly(shape(0.72, s * 0.06), rgb("#f07316"));
  fillPoly(shape(0.48, s * 0.1), rgb("#f5a623"));
  fillPoly(shape(0.26, s * 0.14), rgb("#ffe08a"));
}
function smoke(x, y, s) {
  circle(x - s * 0.5, y - s * 0.2, s * 0.42, rgb("#8b939c"));
  circle(x, y - s * 0.7, s * 0.55, rgb("#a7aeb6"));
  circle(x + s * 0.55, y - s * 1.2, s * 0.45, rgb("#c2c7cc"));
  circle(x + s * 0.1, y - s * 1.7, s * 0.38, rgb("#d4d8dc"));
}
function cloud(x, y, s, c) {
  ellipse(x, y, s * 1.1, s * 0.42, c);
  ellipse(x - s * 0.7, y + s * 0.1, s * 0.6, s * 0.3, c);
  ellipse(x + s * 0.7, y + s * 0.08, s * 0.65, s * 0.32, c);
  circle(x - s * 0.25, y - s * 0.22, s * 0.42, c);
  circle(x + s * 0.35, y - s * 0.18, s * 0.36, c);
}

// Jet silhouette pointing right, centered at (cx, cy), length ~ s.
function jet(cx, cy, s, c) {
  const P = (pts) => pts.map(([x, y]) => [cx + x * s, cy + y * s]);
  fillPoly(P([[1.7, 0], [0.4, -0.16], [-0.5, -0.14], [-1.4, 0.05], [-1.5, 0.18], [-0.4, 0.2], [0.4, 0.16]]), c);
  fillPoly(P([[-0.1, -0.12], [-1.1, -0.78], [-1.38, -0.74], [-0.62, -0.04]]), c);
  fillPoly(P([[-0.2, 0.14], [-0.9, 0.6], [-1.12, 0.55], [-0.55, 0.1]]), c);
  fillPoly(P([[-1.0, -0.05], [-1.5, -0.52], [-1.68, -0.44], [-1.28, 0.08]]), c);
  circle(cx + 0.95 * s, cy - 0.05 * s, 0.09 * s, rgb("#9fb6c8"));
}

// Airliner silhouette pointing right, small.
function airliner(cx, cy, s, c) {
  const P = (pts) => pts.map(([x, y]) => [cx + x * s, cy + y * s]);
  fillPoly(P([[1.8, 0], [1.2, -0.16], [-0.8, -0.16], [-1.6, -0.02], [-1.8, 0.1], [-0.8, 0.18], [1.2, 0.18]]), c);
  fillPoly(P([[0.1, -0.12], [-0.7, -0.62], [-0.95, -0.58], [-0.35, -0.08]]), c);
  fillPoly(P([[-0.1, 0.14], [-0.6, 0.5], [-0.8, 0.46], [-0.4, 0.12]]), c);
  fillPoly(P([[-1.3, -0.1], [-1.7, -0.5], [-1.88, -0.44], [-1.55, -0.02]]), c);
}

// ---------------------------------------------------------------- world map
// Coastlines as [lon, lat] point lists (own approximations, equirectangular).
const LAND = [
  [[-168, 66], [-165, 60], [-158, 58], [-152, 60], [-140, 60], [-135, 57], [-130, 54], [-125, 49], [-124, 42], [-120, 34], [-114, 30], [-110, 24], [-105, 20], [-97, 16], [-92, 15], [-86, 13], [-83, 9], [-80, 8], [-77, 7], [-80, 9], [-83, 15], [-88, 16], [-87, 21], [-90, 21], [-97, 26], [-94, 29], [-89, 30], [-84, 30], [-81, 26], [-80, 32], [-76, 35], [-74, 40], [-70, 42], [-68, 44], [-65, 45], [-60, 46], [-55, 47], [-60, 52], [-65, 55], [-68, 58], [-72, 62], [-78, 62], [-85, 66], [-92, 66], [-95, 69], [-110, 68], [-125, 70], [-140, 70], [-155, 71]],
  [[-58, 64], [-52, 60], [-43, 60], [-40, 64], [-32, 68], [-22, 70], [-20, 76], [-30, 80], [-45, 82], [-60, 80], [-70, 77], [-62, 72]],
  [[-77, 7], [-72, 11], [-64, 10], [-60, 8], [-52, 5], [-50, 0], [-44, -3], [-35, -8], [-38, -15], [-40, -22], [-48, -27], [-53, -33], [-58, -38], [-62, -41], [-65, -45], [-68, -50], [-69, -52], [-73, -53], [-73, -44], [-72, -36], [-70, -23], [-70, -18], [-77, -12], [-81, -6], [-80, -1]],
  [[-17, 15], [-10, 28], [-5, 35], [0, 36], [10, 37], [20, 32], [30, 31], [34, 28], [35, 24], [37, 22], [40, 15], [43, 12], [48, 11], [51, 10], [46, 5], [41, -2], [40, -8], [39, -15], [36, -20], [33, -26], [28, -33], [20, -35], [17, -32], [14, -25], [12, -18], [13, -10], [9, -1], [9, 4], [-8, 4], [-13, 8]],
  [[44, -16], [47, -15], [50, -17], [48, -22], [45, -25], [43, -21]],
  [[-10, 36], [-9, 43], [-2, 48], [0, 51], [5, 53], [8, 55], [10, 58], [13, 56], [18, 56], [21, 55], [24, 58], [28, 60], [30, 62], [35, 65], [40, 67], [45, 68], [55, 69], [65, 69], [70, 72], [80, 73], [90, 75], [100, 77], [110, 74], [120, 73], [130, 72], [140, 72], [150, 70], [158, 66], [162, 64], [170, 66], [178, 65], [178, 62], [170, 60], [162, 58], [158, 52], [156, 50], [150, 46], [142, 45], [140, 40], [135, 35], [130, 33], [126, 38], [122, 38], [120, 32], [118, 25], [114, 22], [108, 18], [105, 10], [103, 7], [100, 6], [98, 10], [94, 17], [91, 22], [88, 22], [86, 20], [80, 16], [77, 8], [74, 12], [72, 20], [68, 23], [66, 25], [62, 25], [58, 24], [54, 26], [52, 28], [50, 30], [48, 30], [44, 29], [40, 32], [36, 36], [33, 36], [30, 36], [26, 38], [23, 36], [19, 40], [16, 38], [12, 44], [8, 44], [3, 43], [-2, 37], [-6, 36]],
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51]],
  [[130, 31], [133, 34], [137, 35], [140, 36], [141, 40], [143, 43], [141, 45], [139, 38], [136, 34], [132, 33]],
  [[95, 5], [98, 2], [101, -1], [104, -3], [106, -6], [103, -5], [100, -1], [96, 2]],
  [[105, -6], [110, -7], [114, -8], [118, -9], [114, -9], [108, -8], [105, -7]],
  [[109, 1], [113, 3], [117, 6], [119, 2], [117, -2], [113, -3], [110, -1]],
  [[131, -1], [136, -2], [141, -3], [146, -6], [141, -8], [136, -8], [132, -6]],
  [[113, -22], [114, -30], [118, -35], [124, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -23], [146, -19], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [117, -20]],
  [[167, -46], [172, -43], [175, -38], [178, -38], [174, -41], [170, -44]],
];
const AFRICA = LAND[3];

function drawMap(x, y, w, h) {
  vgrad(x, y, w, h, rgb("#0e2547"), rgb("#0a1a33"));
  const mx = x + 8, my = y + 6, mw = w - 16, mh = h - 12;
  const proj = (lon, lat) => [mx + (lon + 170) / 360 * mw, my + (78 - lat) / 136 * mh];
  // Graticule.
  const gridC = rgb("#1d3a63");
  for (let lon = -150; lon <= 180; lon += 30) {
    const [gx] = proj(lon, 0);
    vline(gx, my, mh, gridC, 0.7);
  }
  for (let lat = 60; lat >= -45; lat -= 30) {
    const [, gy] = proj(0, lat);
    hline(mx, gy, mw, gridC, 0.7);
  }
  // Continents: gold land with a darker edge.
  for (const poly of LAND) {
    const pts = poly.map(([lo, la]) => proj(lo, la));
    fillPoly(pts, rgb("#c2a15c"));
    strokePath(pts, 1, rgb("#8a6f35"), true);
  }
  // Story dots + labels.
  const dots = [
    ["WASHINGTON", -77, 39, -7, -4, "r"], ["KYIV", 30, 50, -5, -11, "r"],
    ["KERCH", 36, 45, -7, 3, "r"], ["HORMUZ", 56, 26, 7, -6, "l"],
    ["ADEN", 45, 13, 7, 11, "l"], ["KIGALI", 30, -2, -7, 13, "r"],
    ["SHENZHEN", 114, 22, 0, -13, "c"], ["MANILA", 121, 15, 8, 1, "l"],
    ["TOKYO", 140, 36, 7, -4, "l"], ["ANDHRA", 80, 16, 0, 13, "c"],
  ];
  for (const [name, lo, la, dx, dy, al] of dots) {
    const [px, py] = proj(lo, la);
    circle(px, py, 4.2, WHITE);
    circle(px, py, 2.7, RED);
    drawTextShadow(name, px + dx, py + dy, 10, WHITE, NAVY3, { align: al === "c" ? "c" : al === "r" ? "r" : "l", tracking: 0.5 });
  }
  // Tag.
  fillRect(x + 8, y + 6, 118, 17, GOLD);
  drawText("WHERE IT HAPPENED", x + 14, y + 10, 9.5, NAVY, { tracking: 0.5 });
}

// ---------------------------------------------------------------- scenes
// Each draws inside (x, y, w, h); clip is set by the caller.
function sceneBridge(x, y, w, h) {
  vgrad(x, y, w, h, rgb("#f7c873"), rgb("#f2e3c2"));
  circle(x + w * 0.9, y + h * 0.2, 13, rgb("#fff3cf"));
  // Sea.
  fillRect(x, y + h * 0.62, w, h * 0.38, rgb("#3f6d8e"));
  for (let i = 0; i < 7; i++) {
    const wy = y + h * 0.68 + i * 5;
    dashedLine(x + 8 + (i % 2) * 14, wy, x + w - 10, wy, 1.2, rgb("#7fa3bd"), 10, 8);
  }
  const deckY = y + h * 0.58;
  const gapL = x + w * 0.44, gapR = x + w * 0.58;
  // Towers + cables.
  const tower = (tx) => {
    fillRect(tx - 3, deckY - 34, 6, 34 + h * 0.1, rgb("#5a4632"));
    fillRect(tx - 6, deckY - 34, 12, 4, rgb("#5a4632"));
  };
  tower(x + w * 0.22); tower(x + w * 0.78);
  strokePath(quad([x + w * 0.22, deckY - 32], [x + w * 0.33, deckY - 8], [gapL, deckY - 2], 10), 1.4, rgb("#5a4632"), false);
  strokePath(quad([x + w * 0.78, deckY - 32], [x + w * 0.67, deckY - 8], [gapR, deckY - 2], 10), 1.4, rgb("#5a4632"), false);
  // Deck segments + broken ends.
  fillRect(x, deckY - 4, gapL - x, 5, rgb("#6b543a"));
  fillRect(gapR, deckY - 4, x + w - gapR, 5, rgb("#6b543a"));
  fillPoly([[gapL, deckY - 4], [gapL + 7, deckY - 1], [gapL + 3, deckY + 2], [gapL - 2, deckY + 1]], rgb("#6b543a"));
  fillPoly([[gapR, deckY - 4], [gapR - 7, deckY - 1], [gapR - 3, deckY + 2], [gapR + 2, deckY + 1]], rgb("#6b543a"));
  // Fallen span in the water, tilted.
  fillPoly([[gapL + 2, deckY + 14], [gapR - 4, deckY + 22], [gapR - 8, deckY + 27], [gapL - 2, deckY + 19]], rgb("#54432f"));
  // Fire + smoke at the break.
  flame((gapL + gapR) / 2, deckY - 2, 26);
  smoke((gapL + gapR) / 2 + 8, deckY - 26, 9);
  // Small boat.
  const bx = x + w * 0.16, by = y + h * 0.82;
  fillPoly([[bx - 16, by], [bx + 16, by], [bx + 11, by + 7], [bx - 11, by + 7]], rgb("#7e2f26"));
  fillRect(bx - 5, by - 7, 10, 7, rgb("#e8e0cc"));
}

function sceneTanker(x, y, w, h) {
  vgrad(x, y, w, h, rgb("#bfd9e8"), rgb("#f0dfba"));
  circle(x + w * 0.82, y + h * 0.2, 11, rgb("#fff6da"));
  fillRect(x, y + h * 0.6, w, h * 0.4, rgb("#2e5f7e"));
  for (let i = 0; i < 5; i++) {
    const wy = y + h * 0.66 + i * 6;
    dashedLine(x + 6 + (i % 2) * 18, wy, x + w - 8, wy, 1.2, rgb("#6f9ab5"), 12, 9);
  }
  // Distant warship silhouette.
  const wx = x + w * 0.1, wy = y + h * 0.56;
  fillPoly([[wx - 30, wy], [wx + 30, wy], [wx + 24, wy + 6], [wx - 24, wy + 6]], rgb("#5b6b7a"));
  fillRect(wx - 8, wy - 9, 14, 9, rgb("#5b6b7a"));
  line(wx + 2, wy - 9, wx + 2, wy - 16, 1.5, rgb("#5b6b7a"));
  // Tanker hull.
  const hy = y + h * 0.6;
  fillPoly([[x + 26, hy - 4], [x + w - 30, hy - 4], [x + w - 12, hy + 16], [x + 40, hy + 16], [x + 26, hy + 8]], rgb("#7e2f26"));
  fillRect(x + 26, hy - 7, w - 56, 4, rgb("#5e211c"));
  // Superstructure + funnel.
  fillRect(x + w - 78, hy - 26, 30, 20, rgb("#e8e0cc"));
  for (let i = 0; i < 3; i++) fillRect(x + w - 72 + i * 9, hy - 21, 5, 5, rgb("#3a4a5a"));
  fillRect(x + w - 48, hy - 30, 12, 24, rgb("#2e2a26"));
  smoke(x + w - 42, hy - 32, 8);
  // Deck fire, layered.
  flame(x + w * 0.42, hy - 6, 30);
  smoke(x + w * 0.42 + 10, hy - 34, 8);
  // Naval mine in the foreground water.
  const mxp = x + w * 0.82, myp = y + h * 0.86;
  for (let a = 0; a < 8; a++) {
    const t = a / 8 * Math.PI * 2;
    line(mxp, myp, mxp + Math.cos(t) * 11, myp + Math.sin(t) * 11, 1.6, rgb("#1c222c"));
  }
  circle(mxp, myp, 7, rgb("#1c222c"));
  circle(mxp - 2, myp - 2, 2, rgb("#4a5568"));
  ellipse(mxp, myp + 9, 14, 2.5, rgb("#7fa3bd"));
}

function sceneShenzhen(x, y, w, h) {
  vgrad(x, y, w, h, rgb("#6b3a6e"), rgb("#e8804a"));
  circle(x + w * 0.3, y + h * 0.34, 12, rgb("#ffd98a"));
  // Skyline silhouettes with lit windows.
  const towers = [[0, 0.52, 0.13], [0.12, 0.38, 0.1], [0.23, 0.6, 0.12], [0.36, 0.3, 0.09], [0.46, 0.48, 0.13], [0.6, 0.36, 0.1], [0.71, 0.55, 0.12], [0.84, 0.42, 0.16]];
  for (const [fx, top, fw] of towers) {
    const bx = x + fx * w, bw = fw * w, by = y + top * h, bh = h - top * h;
    fillRect(bx, by, bw, bh, rgb("#2a1e3a"));
    for (let wy = by + 6; wy < y + h - 6; wy += 9)
      for (let wx = bx + 5; wx < bx + bw - 5; wx += 9)
        if ((Math.floor(wx) + Math.floor(wy)) % 3 === 0) fillRect(wx, wy, 3, 4, rgb("#f0d48a"));
  }
  fillRect(x, y + h - 8, w, 8, rgb("#1c1426"));
  // Birds.
  for (const [bx, by] of [[0.2, 0.16], [0.28, 0.1], [0.55, 0.12]]) {
    const px = x + bx * w, py = y + by * h;
    strokePath([[px - 5, py], [px, py - 3], [px + 5, py]], 1.3, rgb("#2a1e3a"), false);
  }
  // Three flags on poles.
  const flag = (fx, kind) => {
    const px = x + fx * w, py = y + h * 0.52;
    line(px, py, px, py - 34, 1.6, rgb("#e8e0cc"));
    const fw = 22, fh = 13, fx0 = px + 1, fy0 = py - 34;
    if (kind === 0) { // US: stripes + canton
      fillRect(fx0, fy0, fw, fh, rgb("#f2ede0"));
      for (let i = 0; i < 4; i++) fillRect(fx0, fy0 + i * 3.4, fw, 1.7, rgb("#b23a2e"));
      fillRect(fx0, fy0, 9, 7, rgb("#2b4a7a"));
    } else if (kind === 1) { // China: red + stars
      fillRect(fx0, fy0, fw, fh, rgb("#c0392b"));
      diamond(fx0 + 5, fy0 + 4, 2.4, rgb("#f0d48a"));
      circle(fx0 + 11, fy0 + 3, 1.1, rgb("#f0d48a"));
      circle(fx0 + 13, fy0 + 6, 1.1, rgb("#f0d48a"));
    } else { // Russia: white / blue / red
      fillRect(fx0, fy0, fw, fh / 3, rgb("#f2ede0"));
      fillRect(fx0, fy0 + fh / 3, fw, fh / 3, rgb("#2b6cb0"));
      fillRect(fx0, fy0 + 2 * fh / 3, fw, fh / 3, rgb("#c0392b"));
    }
  };
  flag(0.62, 0); flag(0.74, 1); flag(0.86, 2);
}

function sceneJets(x, y, w, h) {
  vgrad(x, y, w, h, rgb("#8fc3e8"), rgb("#e8f2f8"));
  cloud(x + w * 0.2, y + h * 0.24, 16, rgb("#ffffff"));
  cloud(x + w * 0.62, y + h * 0.16, 12, rgb("#f4f8fb"));
  cloud(x + w * 0.85, y + h * 0.42, 14, rgb("#eef4f8"));
  // Contrails: dashed curves trailing the jets.
  const trail = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (i % 2 === 0) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1.6, rgb("#ffffff"));
    }
  };
  trail(quad([x + w * 0.08, y + h * 0.34], [x + w * 0.24, y + h * 0.42], [x + w * 0.4, y + h * 0.3], 14));
  trail(quad([x + w * 0.3, y + h * 0.62], [x + w * 0.48, y + h * 0.7], [x + w * 0.64, y + h * 0.58], 14));
  jet(x + w * 0.44, y + h * 0.3, 15, rgb("#2b3442"));
  jet(x + w * 0.68, y + h * 0.58, 18, rgb("#232c38"));
  // Sea + island below.
  fillRect(x, y + h * 0.8, w, h * 0.2, rgb("#4a7fa5"));
  fillPoly([[x + w * 0.12, y + h * 0.8], [x + w * 0.3, y + h * 0.8], [x + w * 0.26, y + h * 0.72], [x + w * 0.17, y + h * 0.7]], rgb("#4a7a4e"));
  line(x + w * 0.21, y + h * 0.72, x + w * 0.21, y + h * 0.62, 1.4, rgb("#5a4632"));
  ellipse(x + w * 0.21, y + h * 0.6, 7, 2.5, rgb("#3d6b3f"));
}

function scenePentagon(x, y, w, h) {
  fillRect(x, y, w, h, rgb("#e9e2cf"));
  const gc = rgb("#ddd2b6");
  for (let gx = x + 12; gx < x + w; gx += 14) vline(gx, y, h, gc, 0.6);
  for (let gy = y + 12; gy < y + h; gy += 14) hline(x, gy, w, gc, 0.6);
  // Pentagon building.
  const cx = x + w * 0.34, cy = y + h * 0.52, R = 34;
  const ring = (r, rot) => {
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const a = rot + i / 5 * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };
  fillPoly(ring(R, -Math.PI / 2), rgb("#46536a"));
  fillPoly(ring(R * 0.55, -Math.PI / 2), rgb("#e9e2cf"));
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i / 5 * Math.PI * 2;
    line(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55, cx + Math.cos(a) * R, cy + Math.sin(a) * R, 1.2, rgb("#5b6a84"));
  }
  // Falling bar chart.
  const bx = x + w * 0.62, by = y + h * 0.78, bw = 13;
  const heights = [44, 34, 24, 13];
  for (let i = 0; i < 4; i++) {
    fillRect(bx + i * (bw + 7), by - heights[i], bw, heights[i], rgb("#b23a2e"));
  }
  line(bx - 6, by + 2, bx + 4 * bw + 28, by + 2, 1.6, rgb("#46536a"));
  strokePath([[bx - 2, by - 50], [bx + 30, by - 34], [bx + 62, by - 18]], 2, rgb("#8a2a20"), false);
  // Gold coin.
  circle(x + w * 0.88, y + h * 0.24, 13, GOLDDK);
  circle(x + w * 0.88, y + h * 0.24, 10.5, GOLD);
  drawText("$", x + w * 0.88, y + h * 0.24 - 7, 14, rgb("#7a5c14"), { align: "c" });
}

function sceneRwanda(x, y, w, h) {
  vgrad(x, y, w, h, rgb("#f6d9a0"), rgb("#e8b06a"));
  circle(x + w * 0.82, y + h * 0.2, 11, rgb("#fff3cf"));
  fillRect(x, y + h * 0.78, w, h * 0.22, rgb("#c99a5b"));
  // Acacia tree, left, clear of the map.
  const tx = x + w * 0.14, ty = y + h * 0.78;
  strokePath([[tx, ty], [tx + 2, ty - 18], [tx - 3, ty - 30]], 3, rgb("#5a4632"), false);
  strokePath([[tx + 2, ty - 18], [tx + 9, ty - 28]], 2, rgb("#5a4632"), false);
  ellipse(tx - 2, ty - 32, 20, 5, rgb("#4a6b35"));
  ellipse(tx - 2, ty - 36, 13, 4, rgb("#557a3d"));
  // Africa shape with TRUE aspect (equal px per degree) so it reads as Africa.
  const aBoxX = x + w * 0.42, aBoxY = y + h * 0.02, aBoxW = w * 0.54, aBoxH = h * 0.74;
  const sc = Math.min(aBoxW / 70, aBoxH / 70);
  const aW = 70 * sc, aH = 70 * sc;
  const aX0 = aBoxX + (aBoxW - aW) / 2, aY0 = aBoxY + (aBoxH - aH) / 2;
  const projA = (lon, lat) => [aX0 + (lon + 18) * sc, aY0 + (35 - lat) * sc];
  const apts = AFRICA.map(([lo, la]) => projA(lo, la));
  fillPoly(apts, rgb("#d8b878"));
  strokePath(apts, 1.2, rgb("#7a5230"), true);
  // Dashed flight arc from upper left down to the Rwanda pin.
  const [pinX, pinY] = projA(30, -2);
  const arc = quad([x + w * 0.28, y + h * 0.14], [x + w * 0.44, y + h * 0.02], [pinX - 12, pinY - 8], 16);
  for (let i = 0; i < arc.length - 1; i++) {
    if (i % 2 === 0) line(arc[i][0], arc[i][1], arc[i + 1][0], arc[i + 1][1], 1.5, rgb("#8a2a20"));
  }
  // Plane riding the arc, clear of the pin and the tree.
  airliner(x + w * 0.38, y + h * 0.1, 9, rgb("#2b3442"));
  // Pin at Kigali.
  circle(pinX, pinY - 6, 6, RED);
  fillPoly([[pinX - 5, pinY - 3], [pinX + 5, pinY - 3], [pinX, pinY + 6]], RED);
  circle(pinX, pinY - 6, 2.4, WHITE);
}

// ---------------------------------------------------------------- page
const LEADS = [
  { cat: "EUROPE - WAR", color: RED, head: "CRIMEA BRIDGE HIT AGAIN", deck: "DRONES AND MISSILES DROP THE KERCH ROAD ARCH INTO THE STRAIT.", scene: sceneBridge },
  { cat: "GULF - SHIPPING", color: TEAL, head: "TANKERS HIT BY MINES NEAR HORMUZ", deck: "A FOURTH TANKER CATCHES FIRE AS IRAN REPORTS MINE STRIKES.", scene: sceneTanker },
  { cat: "DIPLOMACY - SHENZHEN", color: PURPLE, head: "TRUMP LANDS IN ASIA FOR APEC", deck: "MANILA FIRST, THEN SHENZHEN FOR THE FIRST XI-TRUMP-PUTIN TALKS.", scene: sceneShenzhen },
  { cat: "ASIA - SECURITY", color: BLUE, head: "JAPAN SCRAMBLES JETS", deck: "TWO SUSPECTED RUSSIAN AIRCRAFT ENTER AIRSPACE NEAR OKINOSHIMA.", scene: sceneJets },
  { cat: "UNITED STATES - DEFENCE", color: BROWN, head: "PENTAGON FAILS ITS AUDIT", deck: "NINTH STRAIGHT YEAR: BOOKS COVERING $4.8 TRILLION UNVERIFIED.", scene: scenePentagon },
  { cat: "EUROPE - MIGRATION", color: GREEN, head: "FIVE EU STATES PLAN RWANDA HUB", deck: "GERMANY, DENMARK, AUSTRIA, GREECE, NETHERLANDS BACK A HUB.", scene: sceneRwanda },
];
const GRID = [
  ["HEALTH", RED, "U.S. LOSES MEASLES-FREE STATUS AFTER 26 YEARS; 5,412 CASES"],
  ["MARKETS", BROWN, "NVIDIA BEATS, GUIDES TO $130BN IN FIRST REPORT WITHOUT HUANG"],
  ["MARKETS", BROWN, "WALL STREET FALLS; S&P -1.0%, DOW -1.6%, VIX AT 25.5"],
  ["SPACE", BLUE, "VULCAN GROUNDED: BOOSTER UNDERPERFORMED, 40 SATELLITES LOST"],
  ["TECH", TEAL, "U.S. MOVES TO CLOSE AI CHIP LOOPHOLE ON DATA CENTERS"],
  ["TECH", TEAL, "JPMORGAN BLAMES SOFTWARE BUG FOR MONDAY BANKING OUTAGE"],
  ["ENERGY", RED, "OIL RISES ON HORMUZ TENSION: BRENT $93.14, WTI $86.01"],
  ["WEATHER", BLUE, "CYCLONE AKVAN NEARS ANDHRA COAST; LANDFALL DUE NOV 20"],
  ["SPORT", GREEN, "MOROCCO REACHES FIFA TOP FIVE, FIRST AFRICAN SIDE SINCE 1994"],
  ["SPORT", GREEN, "JAY SHAH RE-ELECTED AS ICC CHAIRMAN FOR A SECOND TERM"],
  ["ASIA", PURPLE, "SEOUL SCRAMBLES JETS TOO; TAIWAN RESPONDS TO RUSSIAN FLIGHTS"],
  ["U.S.", RED, "WHITE HOUSE CURBS TESTIMONY; AGENCIES NEED PRIOR APPROVAL"],
];
const ALSO_L = [
  "DISNEY BEATS; REVENUE $25.9BN, DIVIDEND RAISED",
  "FED'S MUSALEM: MORE HIKES MAY BE NEEDED",
  "NSA CLASSIFIED NETWORK DOWN; NO SIGN OF CYBERATTACK",
  "APPLE SERVICES HIT BY OUTAGE ON TUESDAY",
  "GAZA FLOODS DAMAGE SHELTERS; TENTS HELD AT BORDER",
  "CYBERCRIME DAMAGES PUT AT $10.5T A YEAR",
  "RICE AGREES 5-YEAR ARSENAL DEAL",
  "PATIDAR SMASHES 135 OFF 48 BALLS",
];
const ALSO_R = [
  "U.S. RETAIL SALES RISE 0.2% IN OCTOBER",
  "ANTHROPIC IPO PRICES WEDNESDAY, NEAR $1.5T",
  "DRONES OVER BAHRAIN BASE INTERCEPTED",
  "HOUTHI ADVANCE; IRAQI ARMY PULLS BACK",
  "BUS CRASH IN UTTARAKHAND KILLS 8",
  "DHONI RETIRES FROM IPL AS A PLAYER",
  "SHAMI TO RAJASTHAN; CURRAN TO LUCKNOW",
  "INDIA WINS SAFF TITLE HAT-TRICK",
];

function drawLeadPanel(px, py, pw, ph, lead, idx) {
  fillRect(px, py, pw, ph, CREAM);
  // Gold hairline border.
  fillRect(px, py, pw, 1.5, GOLD); fillRect(px, py + ph - 1.5, pw, 1.5, GOLD);
  fillRect(px, py, 1.5, ph, GOLD); fillRect(px + pw - 1.5, py, 1.5, ph, GOLD);
  // Category bar.
  fillRect(px + 1.5, py + 1.5, pw - 3, 22, lead.color);
  drawText(lead.cat, px + 10, py + 7, 12, WHITE, { tracking: 1 });
  // Illustration.
  const ay = py + 23.5, ah = 86;
  setClip(px + 1.5, ay, px + pw - 1.5, ay + ah);
  lead.scene(px + 1.5, ay, pw - 3, ah);
  clearClip();
  // Headline, up to 2 lines.
  const lines = wrapText(lead.head, 21, pw - 20, 0.5).slice(0, 2);
  let hy = ay + ah + 6;
  for (const ln of lines) { drawText(ln, px + 10, hy, 21, INK, { tracking: 0.5 }); hy += 23; }
  // Deck, up to 2 lines.
  const dlines = wrapText(lead.deck, 11.5, pw - 20, 0).slice(0, 2);
  let dy = ay + ah + 52;
  for (const ln of dlines) { drawText(ln, px + 10, dy, 11.5, SLATE, {}); dy += 13; }
}

function main() {
  vgrad(0, 0, W, H, rgb("#0c1a36"), NAVY3);
  // Double gold frame.
  fillRect(6, 6, W - 12, 2, GOLD); fillRect(6, H - 8, W - 12, 2, GOLD);
  fillRect(6, 6, 2, H - 12, GOLD); fillRect(W - 8, 6, 2, H - 12, GOLD);
  fillRect(13, 13, W - 26, 1, GOLDDK); fillRect(13, H - 14, W - 26, 1, GOLDDK);
  fillRect(13, 13, 1, H - 26, GOLDDK); fillRect(W - 14, 13, 1, H - 26, GOLDDK);

  // Masthead.
  const mh = "THE WORLD IN ONE DAY";
  const mhw = textWidth(mh, 25, 6);
  drawText(mh, 512, 22, 25, GOLDLT, { align: "c", tracking: 6 });
  hline(40, 35, 512 - mhw / 2 - 70, GOLDDK, 1.2);
  hline(512 + mhw / 2 + 30, 35, 512 - mhw / 2 - 70, GOLDDK, 1.2);
  diamond(512 - mhw / 2 - 16, 35, 4, GOLD);
  diamond(512 + mhw / 2 + 16, 35, 4, GOLD);

  // Giant date, mixed colors, fitted.
  const segs = [["TUESDAY ", WHITE], ["17", GOLDLT], [" NOVEMBER 2026", WHITE]];
  let ds = 62;
  const dateW = (s) => segs.reduce((t, [txt]) => t + textWidth(txt, s, 2), 0);
  while (ds > 20 && dateW(ds) > 968) ds -= 1;
  let dx = 512 - dateW(ds) / 2;
  for (const [txt, col] of segs) {
    drawText(txt, dx + 2, 50 + 2, ds, NAVY3, { tracking: 2 });
    drawText(txt, dx, 50, ds, col, { tracking: 2 });
    dx += textWidth(txt, ds, 2);
  }
  // Rules under the date.
  hline(34, 120, 956, GOLD, 2);
  hline(34, 124, 956, GOLDDK, 0.8);

  drawText("34 STORIES THAT DEFINED THE DAY", 512, 130, 14, GOLD, { align: "c", tracking: 4 });

  // World map panel.
  const mapY = 150, mapH = 126;
  fillRect(16, mapY, 992, mapH, NAVY2);
  setClip(16, mapY, 1008, mapY + mapH);
  drawMap(16, mapY, 992, mapH);
  clearClip();
  fillRect(16, mapY, 992, 1.5, GOLD); fillRect(16, mapY + mapH - 1.5, 992, 1.5, GOLD);
  fillRect(16, mapY, 1.5, mapH, GOLD); fillRect(1006.5, mapY, 1.5, mapH, GOLD);

  // Lead stories: 2 rows x 3.
  const colX = [16, 350, 684], colW = 322, rowY = [284, 484], rowH = 192;
  for (let i = 0; i < 6; i++) {
    drawLeadPanel(colX[i % 3], rowY[Math.floor(i / 3)], colW, rowH, LEADS[i], i);
  }

  // Numbered grid: 4 rows x 3.
  const gridY = 684, gridH = 160;
  fillRect(16, gridY, 992, gridH, CREAM);
  fillRect(16, gridY, 992, 1.5, GOLD); fillRect(16, gridY + gridH - 1.5, 992, 1.5, GOLD);
  fillRect(16, gridY, 1.5, gridH, GOLD); fillRect(1006.5, gridY, 1.5, gridH, GOLD);
  const rowH2 = gridH / 4;
  for (let i = 0; i < 12; i++) {
    const gx = colX[i % 3], gy = gridY + Math.floor(i / 3) * rowH2;
    if (i % 3 > 0) vline(gx - 6, gy + 5, rowH2 - 10, rgb("#d8cdb2"), 1);
    if (i >= 3) hline(gx + 4, gy - 0.5, colW - 8, rgb("#d8cdb2"), 1);
    const [cat, col, txt] = GRID[i];
    circle(gx + 15, gy + rowH2 / 2, 11, RED);
    drawText(String(i + 1), gx + 15, gy + rowH2 / 2 - 7, 14, WHITE, { align: "c" });
    drawText(cat, gx + 32, gy + 4, 9.5, col, { tracking: 1 });
    const gl = wrapText(txt, 11, colW - 42, 0).slice(0, 2);
    let ly = gy + 16;
    for (const ln of gl) { drawText(ln, gx + 32, ly, 11, INK, {}); ly += 12.5; }
  }

  // ALSO panel.
  const alsoY = 852, alsoH = 108;
  fillRect(16, alsoY, 992, alsoH, NAVY2);
  fillRect(16, alsoY, 992, 1.5, GOLD); fillRect(16, alsoY + alsoH - 1.5, 992, 1.5, GOLD);
  fillRect(16, alsoY, 1.5, alsoH, GOLD); fillRect(1006.5, alsoY, 1.5, alsoH, GOLD);
  drawText("ALSO ON TUESDAY 17 NOVEMBER", 512, alsoY + 7, 13, GOLD, { align: "c", tracking: 3 });
  hline(300, alsoY + 25, 424, GOLDDK, 0.8);
  const alsoRow = (items, ax) => {
    for (let i = 0; i < items.length; i++) {
      const iy = alsoY + 32 + i * 9.4;
      fillRect(ax, iy + 3, 4, 4, GOLD);
      drawText(items[i], ax + 10, iy, 9, rgb("#dbe4f0"), {});
    }
  };
  alsoRow(ALSO_L, 30);
  alsoRow(ALSO_R, 516);
  vline(506, alsoY + 32, 70, rgb("#24406a"), 1);

  // Footer.
  drawText("SOURCES: REUTERS, AP, BBC, AL JAZEERA, JAPAN DEFENSE MINISTRY, PAHO, ULA, IMD, NDTV", 512, 968, 10.5, FAINT, { align: "c", tracking: 0.5 });
  drawText("EVERY STORY ABOVE HAPPENED OR WAS FIRST REPORTED ON TUESDAY 17 NOVEMBER 2026.", 512, 986, 12.5, GOLDLT, { align: "c", tracking: 0.5 });

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const file = path.join(outDir, "entry.png");
  const n = writePng(file);
  console.log(JSON.stringify({ file, bytes: n, width: W, height: H }));
}

main();
