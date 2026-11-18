// The World in One Day — Tuesday 17 November 2026.
// A program-drawn newspaper poster: dark-navy/gold premium look, giant date,
// six illustrated lead stories, a world map, a numbered story grid and an
// "also on this day" list. Every story happened or was first reported on
// 17 November 2026. Stdlib only, deterministic, no network.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const NAVY_DEEP: RGB = [7, 18, 36];
const NAVY: RGB = [11, 29, 56];
const NAVY_PANEL: RGB = [18, 41, 77];
const NAVY_LIGHT: RGB = [27, 58, 102];
const NAVY_EDGE: RGB = [38, 74, 124];
const GOLD: RGB = [212, 169, 55];
const GOLD_LIGHT: RGB = [240, 212, 122];
const GOLD_DARK: RGB = [154, 123, 36];
const CREAM: RGB = [245, 237, 216];
const PAPER: RGB = [251, 246, 233];
const PAPER_DARK: RGB = [232, 222, 190];
const INK: RGB = [26, 26, 26];
const INK_SOFT: RGB = [58, 52, 44];
const WHITE: RGB = [255, 255, 255];
const RED: RGB = [192, 57, 43];
const RED_DARK: RGB = [150, 40, 30];
const TEAL: RGB = [46, 125, 123];
const BLUE: RGB = [46, 95, 138];
const PURPLE: RGB = [122, 62, 158];
const GREEN: RGB = [46, 125, 72];
const ORANGE: RGB = [214, 106, 40];
const SEA: RGB = [22, 54, 94];
const SEA_DARK: RGB = [14, 40, 72];
const LAND: RGB = [122, 139, 92];
const LAND_DARK: RGB = [96, 112, 70];
const SKY_DAWN_TOP: RGB = [240, 178, 110];
const SKY_DAWN_BOT: RGB = [250, 226, 170];

// ---------------------------------------------------------------- canvas
const buf = Buffer.alloc(W * H * 3);

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
      i += 3;
    }
  }
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
  rect(x, y, w, t, c);
  rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c);
  rect(x + w - t, y, t, h, c);
}

function vgrad(x: number, y: number, w: number, h: number, top: RGB, bot: RGB): void {
  for (let j = 0; j < h; j++) {
    const t = h <= 1 ? 0 : j / (h - 1);
    const c: RGB = [
      Math.round(top[0] + (bot[0] - top[0]) * t),
      Math.round(top[1] + (bot[1] - top[1]) * t),
      Math.round(top[2] + (bot[2] - top[2]) * t),
    ];
    rect(x, y + j, w, 1, c);
  }
}

function hline(x0: number, x1: number, y: number, c: RGB, t = 1): void {
  for (let k = 0; k < t; k++) rect(Math.min(x0, x1), y + k, Math.abs(x1 - x0), 1, c);
}

function vline(x: number, y0: number, y1: number, c: RGB, t = 1): void {
  for (let k = 0; k < t; k++) rect(x + k, Math.min(y0, y1), 1, Math.abs(y1 - y0), c);
}

// Bresenham line, thickness 1.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    px(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function dashedLine(x0: number, y0: number, x1: number, y1: number, c: RGB, dash = 5, gap = 4): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.floor(len));
  let on = true, count = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (on) px(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c);
    count++;
    if (on && count >= dash) { on = false; count = 0; }
    else if (!on && count >= gap) { on = true; count = 0; }
  }
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -w; x <= w; x++) px(cx + x, cy + y, c);
  }
}

function ring(cx: number, cy: number, r: number, c: RGB, t = 2): void {
  for (let a = 0; a < 360; a++) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      px(Math.round(cx + Math.cos(rad) * (r - k)), Math.round(cy + Math.sin(rad) * (r - k)), c);
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = -ry; y <= ry; y++) {
    const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    for (let x = -w; x <= w; x++) px(cx + x, cy + y, c);
  }
}

// Scanline polygon fill.
function poly(points: Array<[number, number]>, c: RGB): void {
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.ceil(minY); y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.ceil(xs[k]), b = Math.floor(xs[k + 1]);
      for (let x = a; x <= b; x++) px(x, y, c);
    }
  }
}

function polyOutline(points: Array<[number, number]>, c: RGB): void {
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    line(x0, y0, x1, y1, c);
  }
}

// ---------------------------------------------------------------- font
// Own bitmap font, designed for this entry: 8x12 cells, one-pixel strokes,
// uppercase A-Z, digits, and punctuation. Glyphs are rows of "#" / ".".
const GLYPHS: Record<string, string[]> = {
  A: ["...##...", "..#..#..", ".#....#.", ".#....#.", "#......#", "#......#", "########", "#......#", "#......#", "#......#", "#......#", "........"],
  B: ["#######.", "#......#", "#......#", "#......#", "#######.", "#......#", "#......#", "#......#", "#......#", "#......#", "#######.", "........"],
  C: ["..######", ".#......", "#.......", "#.......", "#.......", "#.......", "#.......", "#.......", "#.......", ".#......", "..######", "........"],
  D: ["######..", "#.....#.", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", "#.....#.", "######..", "........"],
  E: ["########", "#.......", "#.......", "#.......", "######..", "#.......", "#.......", "#.......", "#.......", "#.......", "########", "........"],
  F: ["########", "#.......", "#.......", "#.......", "######..", "#.......", "#.......", "#.......", "#.......", "#.......", "#.......", "........"],
  G: ["..######", ".#......", "#.......", "#.......", "#.......", "#...####", "#......#", "#......#", "#......#", ".#.....#", "..#####.", "........"],
  H: ["#......#", "#......#", "#......#", "#......#", "#......#", "########", "#......#", "#......#", "#......#", "#......#", "#......#", "........"],
  I: ["..####..", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "..####..", "........"],
  J: [".......#", ".......#", ".......#", ".......#", ".......#", ".......#", ".......#", "#......#", "#......#", ".#....#.", "..####..", "........"],
  K: ["#.....#.", "#....#..", "#...#...", "#..#....", "#.##....", "##......", "#.##....", "#..#....", "#...#...", "#....#..", "#.....#.", "........"],
  L: ["#.......", "#.......", "#.......", "#.......", "#.......", "#.......", "#.......", "#.......", "#.......", "#.......", "########", "........"],
  M: ["#......#", "##....##", "##....##", "#.#..#.#", "#.#..#.#", "#..##..#", "#..##..#", "#......#", "#......#", "#......#", "#......#", "........"],
  N: ["#......#", "##.....#", "##.....#", "#.#....#", "#.#....#", "#..#...#", "#...#..#", "#....#.#", "#....#.#", "#.....##", "#......#", "........"],
  O: ["..####..", ".#....#.", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", ".#....#.", "..####..", "........"],
  P: ["#######.", "#......#", "#......#", "#......#", "#......#", "#######.", "#.......", "#.......", "#.......", "#.......", "#.......", "........"],
  Q: ["..####..", ".#....#.", "#......#", "#......#", "#......#", "#......#", "#......#", "#..#...#", "#...#..#", ".#....#.", "..####.#", ".......#"],
  R: ["#######.", "#......#", "#......#", "#......#", "#......#", "#######.", "#.##....", "#..#....", "#...#...", "#....#..", "#.....#.", "........"],
  S: [".######.", "#......#", "#.......", "#.......", ".#####..", "......#.", ".......#", ".......#", ".......#", "#......#", ".######.", "........"],
  T: ["########", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "........"],
  U: ["#......#", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", ".#....#.", "..####..", "........"],
  V: ["#......#", "#......#", "#......#", "#......#", "#......#", "#......#", ".#....#.", ".#....#.", "..#..#..", "..#..#..", "...##...", "........"],
  W: ["#......#", "#......#", "#......#", "#......#", "#......#", "#..##..#", "#..##..#", "#.#..#.#", "#.#..#.#", "##....##", "#......#", "........"],
  X: ["#......#", ".#....#.", "..#..#..", "...##...", "...##...", "...##...", "...##...", "...##...", "..#..#..", ".#....#.", "#......#", "........"],
  Y: ["#......#", "#......#", ".#....#.", "..#..#..", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "........"],
  Z: ["########", ".......#", "......#.", ".....#..", "....#...", "...#....", "..#.....", ".#......", "#.......", "#.......", "########", "........"],
  "0": ["..####..", ".#....#.", "#......#", "#....#.#", "#...#..#", "#..#...#", "#.#....#", "##.....#", "#......#", ".#....#.", "..####..", "........"],
  "1": ["...##...", "..###...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "..####..", "........"],
  "2": [".######.", "#......#", ".......#", ".......#", "......#.", ".....#..", "...##...", "..#.....", ".#......", "#.......", "########", "........"],
  "3": [".######.", "#......#", ".......#", ".......#", "..#####.", ".......#", ".......#", ".......#", "#......#", "#......#", ".######.", "........"],
  "4": ["#......#", "#......#", "#......#", "#......#", "#......#", "########", ".......#", ".......#", ".......#", ".......#", ".......#", "........"],
  "5": ["########", "#.......", "#.......", "#.......", "#######.", ".......#", ".......#", ".......#", "#......#", "#......#", ".######.", "........"],
  "6": ["..####..", ".#......", "#.......", "#.......", "######..", "#......#", "#......#", "#......#", "#......#", ".#....#.", "..####..", "........"],
  "7": ["########", ".......#", ".......#", "......#.", ".....#..", "....#...", "....#...", "...#....", "...#....", "...#....", "...#....", "........"],
  "8": [".######.", "#......#", "#......#", "#......#", ".######.", "#......#", "#......#", "#......#", "#......#", "#......#", ".######.", "........"],
  "9": ["..####..", ".#....#.", "#......#", "#......#", "#......#", ".#######", ".......#", ".......#", "......#.", ".....#..", "..###...", "........"],
  ".": ["........", "........", "........", "........", "........", "........", "........", "........", "........", "..##....", "..##....", "........"],
  ",": ["........", "........", "........", "........", "........", "........", "........", "........", "........", "..##....", "..##....", ".#......"],
  ":": ["........", "........", "........", "..##....", "..##....", "........", "........", "..##....", "..##....", "........", "........", "........"],
  ";": ["........", "........", "........", "..##....", "..##....", "........", "........", "..##....", "..##....", "..##....", ".#......", ".#......"],
  "'": ["...##...", "...##...", "...#....", "..#.....", "........", "........", "........", "........", "........", "........", "........", "........"],
  "-": ["........", "........", "........", "........", "........", ".######.", "........", "........", "........", "........", "........", "........"],
  "/": [".......#", "......#.", "......#.", ".....#..", "....#...", "...#....", "...#....", "..#.....", ".#......", ".#......", "#.......", "........"],
  "(": ["....###.", "...#....", "..#.....", ".#......", "#.......", "#.......", "#.......", "#.......", ".#......", "..#.....", "...#....", "....###."],
  ")": [".###....", "....#...", ".....#..", "......#.", ".......#", ".......#", ".......#", ".......#", "......#.", ".....#..", "....#...", ".###...."],
  "%": ["##....#.", "#.#...#.", "#.#..#..", "##..#...", "...#....", "..#.....", "..#.....", ".#...##.", "#...#.#.", "#...#.#.", "....##..", "........"],
  "$": ["...##...", ".######.", "#..##..#", "#..#....", ".###....", "...###..", "....#..#", "#..##..#", ".######.", "...##...", "...##...", "........"],
  "&": ["..###...", ".#...#..", "#.....#.", "#.....#.", ".#...#..", "..#.#...", ".#.#.#..", "#...#.#.", "#....#.#", ".#...#.#", "..##..##", "........"],
  "+": ["........", "........", "........", "........", "...##...", "...##...", ".######.", ".######.", "...##...", "...##...", "........", "........"],
  " ": ["........", "........", "........", "........", "........", "........", "........", "........", "........", "........", "........", "........"],
};

function textWidth(s: string, sx: number, tracking = 1): number {
  if (s.length === 0) return 0;
  return s.length * (8 * sx + tracking) - tracking;
}

// Draw text at (x, y) top-left. sx/sy scale the 8x12 cells.
function drawText(x: number, y: number, s: string, c: RGB, sx = 1, sy = 1, tracking = 1): void {
  let cx = x;
  for (const ch of s) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let r = 0; r < 12; r++) {
      const row = g[r];
      for (let col = 0; col < 8; col++) {
        if (row[col] === "#") rect(cx + col * sx, y + r * sy, sx, sy, c);
      }
    }
    cx += 8 * sx + tracking;
  }
}

function drawTextCentered(cx: number, y: number, s: string, c: RGB, sx = 1, sy = 1, tracking = 1): void {
  drawText(cx - Math.floor(textWidth(s, sx, tracking) / 2), y, s, c, sx, sy, tracking);
}

// Word-wrap into lines of at most maxW px at the given scale.
function wrap(s: string, maxW: number, sx: number, tracking = 1): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, sx, tracking) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawBlock(x: number, y: number, s: string, c: RGB, maxW: number, sx: number, sy: number, lineH: number, tracking = 1, maxLines = 99): number {
  const lines = wrap(s, maxW, sx, tracking).slice(0, maxLines);
  lines.forEach((ln, i) => drawText(x, y + i * lineH, ln, c, sx, sy, tracking));
  return lines.length;
}

// ---------------------------------------------------------------- helpers
function drawLabel(x: number, y: number, s: string, c: RGB): void {
  drawText(x + 1, y + 1, s, NAVY_DEEP, 1, 1, 1);
  drawText(x, y, s, c, 1, 1, 1);
}

function explosion(cx: number, cy: number, r: number): void {
  circle(cx, cy, r, [230, 90, 30]);
  circle(cx - r * 0.3, cy - r * 0.2, r * 0.7, [245, 160, 40]);
  circle(cx + r * 0.2, cy + r * 0.1, r * 0.55, [250, 210, 90]);
  circle(cx, cy - r * 0.1, r * 0.35, [255, 240, 180]);
  // smoke puffs above
  circle(cx - r * 0.7, cy - r * 1.1, r * 0.45, [90, 88, 84]);
  circle(cx + r * 0.1, cy - r * 1.35, r * 0.55, [70, 68, 64]);
  circle(cx + r * 0.8, cy - r * 1.05, r * 0.4, [105, 102, 96]);
}

function jetShape(cx: number, cy: number, s: number, c: RGB, flip: boolean): void {
  const d = flip ? -1 : 1;
  poly([
    [cx + 26 * s * d, cy],
    [cx + 6 * s * d, cy - 4 * s],
    [cx - 8 * s * d, cy - 14 * s],
    [cx - 12 * s * d, cy - 14 * s],
    [cx - 10 * s * d, cy - 3 * s],
    [cx - 22 * s * d, cy - 8 * s],
    [cx - 26 * s * d, cy - 6 * s],
    [cx - 24 * s * d, cy],
    [cx - 26 * s * d, cy + 6 * s],
    [cx - 22 * s * d, cy + 8 * s],
    [cx - 10 * s * d, cy + 3 * s],
    [cx - 12 * s * d, cy + 14 * s],
    [cx - 8 * s * d, cy + 14 * s],
    [cx + 6 * s * d, cy + 4 * s],
  ], c);
}

function flag(x: number, y: number, w: number, h: number, kind: "us" | "cn" | "ru"): void {
  if (kind === "us") {
    rect(x, y, w, h, WHITE);
    for (let i = 0; i < 7; i += 2) rect(x, y + Math.floor((i * h) / 7), w, Math.max(1, Math.floor(h / 7)), RED);
    rect(x, y, Math.floor(w * 0.42), Math.floor(h * 0.55), NAVY_LIGHT);
    for (let r = 0; r < 3; r++) for (let cI = 0; cI < 4; cI++) px(x + 3 + cI * 5, y + 3 + r * 4, WHITE);
  } else if (kind === "cn") {
    rect(x, y, w, h, RED_DARK);
    circle(x + Math.floor(w * 0.25), y + Math.floor(h * 0.35), 4, GOLD_LIGHT);
    px(x + Math.floor(w * 0.55), y + Math.floor(h * 0.2), GOLD_LIGHT);
    px(x + Math.floor(w * 0.65), y + Math.floor(h * 0.4), GOLD_LIGHT);
    px(x + Math.floor(w * 0.6), y + Math.floor(h * 0.6), GOLD_LIGHT);
  } else {
    rect(x, y, w, Math.floor(h / 3), WHITE);
    rect(x, y + Math.floor(h / 3), w, Math.floor(h / 3), BLUE);
    rect(x, y + Math.floor((2 * h) / 3), w, h - Math.floor((2 * h) / 3), RED);
  }
  frame(x, y, w, h, INK_SOFT, 1);
}

function flagPole(x: number, y: number, h: number, kind: "us" | "cn" | "ru"): void {
  vline(x, y, y + h, INK_SOFT, 2);
  flag(x + 2, y + 2, 30, 20, kind);
}

// ---------------------------------------------------------------- world map
function drawMap(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, SEA, SEA_DARK);
  // graticule
  for (let i = 1; i < 8; i++) {
    const gx = x + Math.floor((i * w) / 8);
    for (let yy = y; yy < y + h; yy += 4) px(gx, yy, NAVY_EDGE);
  }
  for (let i = 1; i < 4; i++) {
    const gy = y + Math.floor((i * h) / 4);
    for (let xx = x; xx < x + w; xx += 4) px(xx, gy, NAVY_EDGE);
  }
  const P = (pts: Array<[number, number]>): Array<[number, number]> =>
    pts.map(([pxx, pyy]) => [x + Math.floor((pxx / 996) * w), y + Math.floor((pyy / 136) * h)]);
  // North America
  poly(P([[26, 16], [100, 8], [180, 10], [235, 24], [246, 38], [222, 50], [190, 54], [172, 72], [148, 84], [124, 68], [92, 62], [52, 48], [26, 34], [18, 24]]), LAND);
  // Greenland
  poly(P([[266, 8], [296, 6], [304, 18], [282, 26], [264, 18]]), LAND_DARK);
  // South America
  poly(P([[250, 80], [292, 74], [322, 86], [312, 112], [290, 132], [268, 114], [252, 94]]), LAND);
  // Europe
  poly(P([[452, 20], [498, 12], [534, 22], [528, 38], [502, 50], [472, 46], [454, 34]]), LAND);
  // UK
  poly(P([[440, 24], [452, 22], [454, 34], [444, 38]]), LAND_DARK);
  // Africa
  poly(P([[466, 58], [520, 54], [560, 62], [576, 80], [562, 104], [536, 120], [506, 112], [486, 92], [468, 74]]), LAND);
  // Asia
  poly(P([[544, 20], [650, 10], [760, 8], [852, 20], [874, 34], [852, 48], [800, 56], [750, 70], [700, 74], [645, 62], [585, 50], [552, 36]]), LAND);
  // India
  poly(P([[658, 60], [692, 58], [700, 74], [686, 92], [666, 78]]), LAND_DARK);
  // SE Asia
  poly(P([[768, 82], [800, 80], [812, 90], [788, 96], [770, 90]]), LAND_DARK);
  // Indonesia
  poly(P([[820, 88], [852, 86], [858, 96], [830, 100]]), LAND_DARK);
  // Japan
  poly(P([[860, 28], [874, 34], [878, 48], [868, 56], [858, 44]]), LAND_DARK);
  // Australia
  poly(P([[830, 90], [892, 86], [924, 96], [912, 114], [862, 120], [832, 108]]), LAND);
  // sea shimmer
  for (let i = 0; i < 26; i++) {
    const sx = x + 20 + ((i * 37) % (w - 40));
    const sy = y + 12 + ((i * 23) % (h - 24));
    hline(sx, sx + 14, sy, NAVY_LIGHT, 1);
  }
  // location dots: [lon, lat, label, dx, dy]
  const locs: Array<[number, number, string, number, number]> = [
    [-77, 39, "WASHINGTON", -28, 12],
    [30.5, 50.4, "KYIV", -38, -14],
    [36.6, 45.3, "KERCH", 8, 10],
    [56.5, 26.5, "HORMUZ", 8, -14],
    [45, 12.8, "ADEN", 8, 12],
    [30, -1.9, "KIGALI", -52, 10],
    [114, 22.5, "SHENZHEN", -32, -14],
    [121, 14.6, "MANILA", 8, 8],
    [139.7, 35.7, "TOKYO", 8, -6],
    [80, 15.5, "ANDHRA", -24, 14],
  ];
  for (const [lon, lat, label, dx, dy] of locs) {
    const dx0 = x + Math.floor(((lon + 170) / 360) * w);
    const dy0 = y + Math.floor(((75 - lat) / 130) * h);
    ring(dx0, dy0, 6, GOLD_LIGHT, 1);
    circle(dx0, dy0, 3, RED);
    px(dx0, dy0, WHITE);
    drawLabel(dx0 + dx, dy0 + dy, label, GOLD_LIGHT);
  }
}

// ---------------------------------------------------------------- scenes
function drawBridge(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, SKY_DAWN_TOP, SKY_DAWN_BOT);
  circle(x + Math.floor(w * 0.82), y + Math.floor(h * 0.3), 12, [255, 240, 190]);
  const seaY = y + Math.floor(h * 0.62);
  vgrad(x, seaY, w, h - Math.floor(h * 0.62), [52, 110, 160], [30, 78, 128]);
  for (let i = 0; i < 8; i++) {
    const wy = seaY + 6 + i * 5;
    hline(x + ((i * 29) % 40), x + w - ((i * 17) % 30), wy, [120, 170, 210], 1);
  }
  const deckY = y + Math.floor(h * 0.52);
  // towers
  rect(x + Math.floor(w * 0.18), deckY - 34, 6, 34 + (seaY - deckY), [52, 52, 58]);
  rect(x + Math.floor(w * 0.62), deckY - 34, 6, 34 + (seaY - deckY), [52, 52, 58]);
  // cables
  line(x + Math.floor(w * 0.18) + 3, deckY - 34, x + Math.floor(w * 0.42), deckY, [70, 70, 76]);
  line(x + Math.floor(w * 0.62) + 3, deckY - 34, x + Math.floor(w * 0.42), deckY, [70, 70, 76]);
  line(x + Math.floor(w * 0.18) + 3, deckY - 34, x + 4, deckY, [70, 70, 76]);
  // deck: left standing span, gap, right standing span
  const gapX0 = x + Math.floor(w * 0.42), gapX1 = x + Math.floor(w * 0.58);
  rect(x, deckY, gapX0 - x, 5, [40, 40, 46]);
  rect(gapX1, deckY, x + w - gapX1, 5, [40, 40, 46]);
  // fallen span in the water, tilted
  poly([[gapX0 + 2, seaY + 4], [gapX1 - 2, seaY + 12], [gapX1 - 6, seaY + 17], [gapX0 - 2, seaY + 9]], [48, 48, 54]);
  // arch remnant
  poly([[gapX0, deckY], [gapX0 + 14, deckY - 16], [gapX0 + 18, deckY - 14], [gapX0 + 6, deckY]], [60, 60, 66]);
  // explosion at the gap
  explosion(x + Math.floor(w * 0.5), deckY - 12, 13);
  circle(x + Math.floor(w * 0.5) - 16, deckY - 30, 6, [80, 78, 74]);
  circle(x + Math.floor(w * 0.5) + 14, deckY - 34, 7, [66, 64, 60]);
  // small ship
  rect(x + Math.floor(w * 0.72), seaY + 8, 34, 6, [30, 30, 36]);
  rect(x + Math.floor(w * 0.72) + 20, seaY + 2, 8, 6, [30, 30, 36]);
}

function drawTanker(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [168, 200, 228], [240, 214, 170]);
  circle(x + Math.floor(w * 0.16), y + Math.floor(h * 0.28), 11, [255, 244, 200]);
  const seaY = y + Math.floor(h * 0.6);
  vgrad(x, seaY, w, h - Math.floor(h * 0.6), [44, 96, 148], [26, 66, 112]);
  for (let i = 0; i < 7; i++) {
    const wy = seaY + 5 + i * 5;
    hline(x + ((i * 31) % 50), x + w - ((i * 19) % 40), wy, [110, 160, 205], 1);
  }
  // distant tanker
  rect(x + Math.floor(w * 0.62), seaY - 4, 60, 8, [90, 96, 104]);
  rect(x + Math.floor(w * 0.62) + 44, seaY - 12, 10, 8, [90, 96, 104]);
  // main tanker
  const hx = x + Math.floor(w * 0.08), hw = Math.floor(w * 0.52);
  poly([[hx, seaY + 2], [hx + hw, seaY + 2], [hx + hw - 10, seaY + 16], [hx + 8, seaY + 16]], [140, 40, 34]);
  rect(hx + 8, seaY - 10, hw - 24, 12, [120, 34, 30]);
  rect(hx + hw - 34, seaY - 22, 22, 12, [220, 222, 224]);
  rect(hx + hw - 34, seaY - 28, 4, 6, [60, 60, 64]);
  // deck pipes
  for (let i = 0; i < 4; i++) rect(hx + 16 + i * 22, seaY - 14, 14, 4, [90, 26, 24]);
  // fire plume amidships
  explosion(hx + Math.floor(hw * 0.45), seaY - 16, 11);
  // naval mine in the foreground water
  const mx = x + Math.floor(w * 0.78), my = seaY + 14;
  circle(mx, my, 7, [20, 20, 24]);
  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4;
    line(mx, my, Math.round(mx + Math.cos(rad) * 11), Math.round(my + Math.sin(rad) * 11), [20, 20, 24]);
    px(Math.round(mx + Math.cos(rad) * 11), Math.round(my + Math.sin(rad) * 11), [20, 20, 24]);
  }
  circle(mx, my, 3, [50, 50, 56]);
}

function drawSkyline(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [64, 52, 110], [236, 140, 92]);
  circle(x + Math.floor(w * 0.5), y + Math.floor(h * 0.52), 14, [255, 222, 160]);
  const base = y + h;
  const towers: Array<[number, number, number]> = [
    [0.02, 0.52, 0.1], [0.13, 0.68, 0.09], [0.23, 0.44, 0.11], [0.35, 0.78, 0.1],
    [0.46, 0.6, 0.09], [0.56, 0.88, 0.1], [0.67, 0.5, 0.1], [0.78, 0.66, 0.09], [0.88, 0.46, 0.1],
  ];
  for (const [fx, fh, fw] of towers) {
    const tx = x + Math.floor(fx * w), tw = Math.floor(fw * w), th = Math.floor(fh * h);
    rect(tx, base - th, tw, th, [38, 34, 58]);
    for (let wy = base - th + 6; wy < base - 6; wy += 9) {
      for (let wx = tx + 4; wx < tx + tw - 4; wx += 8) {
        if ((wx * 7 + wy * 13) % 5 < 2) rect(wx, wy, 3, 4, GOLD_LIGHT);
      }
    }
  }
  // tapered supertall
  poly([
    [x + Math.floor(w * 0.58), base],
    [x + Math.floor(w * 0.6), y + Math.floor(h * 0.06)],
    [x + Math.floor(w * 0.63), y + Math.floor(h * 0.06)],
    [x + Math.floor(w * 0.66), base],
  ], [30, 27, 48]);
  // flags in front
  flagPole(x + Math.floor(w * 0.08), y + h - 34, 32, "us");
  flagPole(x + Math.floor(w * 0.4), y + h - 34, 32, "cn");
  flagPole(x + Math.floor(w * 0.72), y + h - 34, 32, "ru");
}

function drawJets(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [140, 190, 230], [220, 236, 248]);
  circle(x + Math.floor(w * 0.8), y + Math.floor(h * 0.3), 13, [255, 250, 220]);
  ellipse(x + Math.floor(w * 0.25), y + Math.floor(h * 0.3), 30, 7, WHITE);
  ellipse(x + Math.floor(w * 0.55), y + Math.floor(h * 0.18), 24, 6, WHITE);
  const seaY = y + Math.floor(h * 0.72);
  vgrad(x, seaY, w, h - Math.floor(h * 0.72), [70, 130, 180], [44, 100, 150]);
  // contrails
  dashedLine(x + 8, y + Math.floor(h * 0.42), x + Math.floor(w * 0.4), y + Math.floor(h * 0.34), WHITE, 6, 4);
  dashedLine(x + Math.floor(w * 0.55), y + Math.floor(h * 0.55), x + Math.floor(w * 0.86), y + Math.floor(h * 0.48), WHITE, 6, 4);
  jetShape(x + Math.floor(w * 0.42), y + Math.floor(h * 0.34), 1, [30, 42, 60], false);
  jetShape(x + Math.floor(w * 0.88), y + Math.floor(h * 0.48), 1, [52, 62, 78], false);
  // island
  poly([[x + Math.floor(w * 0.1), seaY + 12], [x + Math.floor(w * 0.2), seaY - 2], [x + Math.floor(w * 0.3), seaY + 12]], LAND_DARK);
}

function drawPentagonScene(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [214, 222, 232], [188, 198, 212]);
  const cx = x + Math.floor(w * 0.3), cy = y + Math.floor(h * 0.52), r = Math.floor(h * 0.36);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]);
  }
  poly(pts, [120, 128, 140]);
  polyOutline(pts, [70, 76, 86]);
  const inner = pts.map(([pxx, pyy]) => [Math.round(cx + (pxx - cx) * 0.55), Math.round(cy + (pyy - cy) * 0.55)] as [number, number]);
  poly(inner, [150, 158, 170]);
  // falling bars
  const bx = x + Math.floor(w * 0.58), bw = 16, gap = 8;
  const heights = [0.62, 0.48, 0.36, 0.24];
  for (let i = 0; i < 4; i++) {
    const bh = Math.floor(h * heights[i]);
    rect(bx + i * (bw + gap), y + h - 12 - bh, bw, bh, RED);
    rect(bx + i * (bw + gap), y + h - 12 - bh, bw, 3, RED_DARK);
  }
  hline(bx - 6, bx + 4 * (bw + gap), y + h - 12, INK_SOFT, 2);
  // gold coin
  circle(x + Math.floor(w * 0.88), y + Math.floor(h * 0.26), 11, GOLD);
  ring(x + Math.floor(w * 0.88), y + Math.floor(h * 0.26), 11, GOLD_DARK, 2);
  drawText(x + Math.floor(w * 0.88) - 4, y + Math.floor(h * 0.26) - 6, "$", GOLD_DARK, 1, 1, 1);
}

function drawRwandaScene(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [246, 222, 170], [232, 196, 138]);
  circle(x + Math.floor(w * 0.82), y + Math.floor(h * 0.26), 12, [255, 240, 190]);
  // stylised Africa shape
  poly([
    [x + Math.floor(w * 0.3), y + Math.floor(h * 0.14)],
    [x + Math.floor(w * 0.52), y + Math.floor(h * 0.1)],
    [x + Math.floor(w * 0.62), y + Math.floor(h * 0.3)],
    [x + Math.floor(w * 0.56), y + Math.floor(h * 0.58)],
    [x + Math.floor(w * 0.44), y + Math.floor(h * 0.86)],
    [x + Math.floor(w * 0.34), y + Math.floor(h * 0.72)],
    [x + Math.floor(w * 0.26), y + Math.floor(h * 0.44)],
  ], [196, 158, 96]);
  // Rwanda pin
  const pinX = x + Math.floor(w * 0.47), pinY = y + Math.floor(h * 0.48);
  circle(pinX, pinY, 7, RED);
  circle(pinX, pinY, 3, WHITE);
  // dotted route from Europe
  dashedLine(x + Math.floor(w * 0.12), y + Math.floor(h * 0.2), pinX, pinY, INK_SOFT, 4, 4);
  // plane silhouette
  jetShape(x + Math.floor(w * 0.2), y + Math.floor(h * 0.3), 1, [40, 40, 48], false);
  // buildings / facility blocks
  rect(x + Math.floor(w * 0.66), y + h - 26, 26, 26, [120, 118, 110]);
  rect(x + Math.floor(w * 0.66) + 30, y + h - 18, 20, 18, [140, 138, 130]);
  rect(x + Math.floor(w * 0.66) + 54, y + h - 30, 22, 30, [110, 108, 100]);
  // acacia tree
  rect(x + Math.floor(w * 0.1), y + h - 30, 4, 30, [90, 66, 44]);
  ellipse(x + Math.floor(w * 0.12), y + h - 34, 22, 6, [96, 124, 66]);
}

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

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    buf.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- layout
const COL_X = [16, 350, 684];
const COL_W = [322, 322, 324];

interface Lead {
  tag: string;
  tagColor: RGB;
  headline: string;
  deck: string;
  scene: (x: number, y: number, w: number, h: number) => void;
}

function leadPanel(x: number, y: number, w: number, h: number, lead: Lead, big: boolean): void {
  rect(x, y, w, h, PAPER);
  frame(x, y, w, h, GOLD_DARK, 1);
  const barH = big ? 22 : 20;
  rect(x + 1, y + 1, w - 2, barH, lead.tagColor);
  drawText(x + 8, y + 5, lead.tag, WHITE, 1, 1, 2);
  const illoY = y + barH + 6;
  const illoH = big ? 80 : 44;
  lead.scene(x + 6, illoY, w - 12, illoH);
  frame(x + 6, illoY, w - 12, illoH, INK_SOFT, 1);
  const headY = illoY + illoH + 5;
  const headLH = big ? 26 : 23;
  drawBlock(x + 8, headY, lead.headline, INK, w - 16, 2, 2, headLH, 1, 2);
  const deckY = headY + 2 * headLH + 2;
  drawBlock(x + 8, deckY, lead.deck, INK_SOFT, w - 16, 1, 1, big ? 13 : 12, 1, 2);
}

const LEADS_ROW1: Lead[] = [
  {
    tag: "EUROPE - WAR", tagColor: RED,
    headline: "CRIMEA BRIDGE HIT AGAIN",
    deck: "DRONES AND MISSILES DROP THE KERCH ROAD ARCH INTO THE STRAIT.",
    scene: drawBridge,
  },
  {
    tag: "GULF - SHIPPING", tagColor: TEAL,
    headline: "TANKERS HIT BY MINES NEAR HORMUZ",
    deck: "A FOURTH TANKER CATCHES FIRE AS IRAN REPORTS MINE STRIKES.",
    scene: drawTanker,
  },
  {
    tag: "DIPLOMACY - SHENZHEN", tagColor: PURPLE,
    headline: "TRUMP LANDS IN ASIA FOR APEC",
    deck: "MANILA FIRST, THEN SHENZHEN FOR THE FIRST XI-TRUMP-PUTIN TALKS.",
    scene: drawSkyline,
  },
];

const LEADS_ROW2: Lead[] = [
  {
    tag: "ASIA - SECURITY", tagColor: BLUE,
    headline: "JAPAN SCRAMBLES JETS",
    deck: "TWO SUSPECTED RUSSIAN AIRCRAFT ENTER AIRSPACE NEAR OKINOSHIMA.",
    scene: drawJets,
  },
  {
    tag: "UNITED STATES - DEFENCE", tagColor: INK_SOFT,
    headline: "PENTAGON FAILS ITS AUDIT",
    deck: "NINTH STRAIGHT YEAR: BOOKS COVERING $4.8 TRILLION UNVERIFIED.",
    scene: drawPentagonScene,
  },
  {
    tag: "EUROPE - MIGRATION", tagColor: GREEN,
    headline: "FIVE EU STATES PLAN RWANDA HUB",
    deck: "GERMANY, DENMARK, AUSTRIA, GREECE, NETHERLANDS BACK A HUB.",
    scene: drawRwandaScene,
  },
];

const GRID: Array<{ cat: string; color: RGB; head: string }> = [
  { cat: "HEALTH", color: RED, head: "U.S. LOSES MEASLES-FREE STATUS AFTER 26 YEARS; 5,412 CASES" },
  { cat: "MARKETS", color: BLUE, head: "NVIDIA BEATS, GUIDES TO $130BN; HUANG OPEN TO RETURN" },
  { cat: "MARKETS", color: BLUE, head: "WALL STREET FALLS; S&P -1.0%, DOW -1.6%, VIX AT 25.5" },
  { cat: "SPACE", color: PURPLE, head: "VULCAN GROUNDED: BOOSTER UNDERPERFORMED, 40 SATELLITES LOST" },
  { cat: "TECH", color: TEAL, head: "U.S. MOVES TO CLOSE AI CHIP LOOPHOLE ON DATA CENTERS" },
  { cat: "TECH", color: TEAL, head: "JPMORGAN BLAMES SOFTWARE BUG FOR MONDAY BANKING OUTAGE" },
  { cat: "ENERGY", color: ORANGE, head: "OIL RISES ON HORMUZ TENSION: BRENT $93.14, WTI $86.01" },
  { cat: "WEATHER", color: BLUE, head: "CYCLONE AKVAN NEARS ANDHRA COAST; LANDFALL DUE NOV 20" },
  { cat: "SPORT", color: GREEN, head: "MOROCCO REACHES FIFA TOP FIVE, FIRST AFRICAN SIDE SINCE 1994" },
  { cat: "SPORT", color: GREEN, head: "JAY SHAH RE-ELECTED AS ICC CHAIRMAN FOR A SECOND TERM" },
  { cat: "ASIA", color: PURPLE, head: "SEOUL SCRAMBLES JETS TOO; TAIWAN RESPONDS TO RUSSIAN FLIGHTS" },
  { cat: "U.S.", color: RED_DARK, head: "WHITE HOUSE CURBS TESTIMONY: AGENCIES NEED PRIOR APPROVAL" },
];

const ALSO: string[] = [
  "DISNEY BEATS: REVENUE UP 16% TO $26BN",
  "U.S. RETAIL SALES RISE 0.2% IN OCTOBER",
  "FED'S MUSALEM: MORE HIKES MAY BE NEEDED",
  "ANTHROPIC IPO PRICES WEDNESDAY, NEAR $1.5T",
  "SINGAPORE SEEKS TRUSTED AI CHIP ACCESS",
  "DRONE ALERT AT IRAQ GAS FIELD",
  "IRAN DRONES TARGET BAHRAIN BASE, INTERCEPTED",
  "HOUTHIS ADVANCE; YEMEN ARMY PULLS BACK",
  "GAZA FLOODS DAMAGE SHELTERS; TENTS HELD AT BORDER",
  "BUS CRASH IN UTTARAKHAND KILLS 8",
  "CYBERCRIME DAMAGES PUT AT $10.5T A YEAR",
  "DHONI RETIRES FROM IPL AS A PLAYER",
  "RICE AGREES 5-YEAR ARSENAL DEAL",
  "SHAMI TO RAJASTHAN; CURRAN TO LUCKNOW",
  "PATIDAR SMASHES 135 OFF 48 BALLS",
  "INDIA WINS SAFF TITLE HAT-TRICK",
];

function compose(): void {
  vgrad(0, 0, W, H, NAVY_DEEP, NAVY);
  frame(4, 4, W - 8, H - 8, GOLD, 2);
  frame(9, 9, W - 18, H - 18, GOLD_DARK, 1);

  // ---- header: masthead + giant date
  drawTextCentered(512, 22, "THE WORLD IN ONE DAY", GOLD_LIGHT, 2, 2, 6);
  hline(64, 262, 32, GOLD, 1);
  hline(762, 960, 32, GOLD, 1);
  const dateStr = "TUESDAY 17 NOVEMBER 2026";
  const dateX = 512 - Math.floor(textWidth(dateStr, 4, 2) / 2);
  drawText(dateX, 52, dateStr, WHITE, 4, 6, 2);
  // gold "17" overdrawn on the white date
  drawText(dateX + 8 * (8 * 4 + 2), 52, "17", GOLD, 4, 6, 2);
  drawTextCentered(512, 132, "34 STORIES THAT DEFINED THE DAY", GOLD, 1, 1, 3);
  hline(16, 1008, 148, GOLD, 2);

  // ---- world map
  drawMap(16, 156, 992, 136);
  frame(16, 156, 992, 136, GOLD_DARK, 1);
  rect(24, 162, 178, 20, NAVY_DEEP);
  frame(24, 162, 178, 20, GOLD, 1);
  drawText(32, 166, "WHERE IT HAPPENED", GOLD_LIGHT, 1, 1, 1);

  // ---- lead stories, two rows
  for (let i = 0; i < 3; i++) leadPanel(COL_X[i], 300, COL_W[i], 196, LEADS_ROW1[i], true);
  for (let i = 0; i < 3; i++) leadPanel(COL_X[i], 504, COL_W[i], 152, LEADS_ROW2[i], false);

  // ---- numbered story grid
  rect(16, 664, 992, 172, PAPER);
  frame(16, 664, 992, 172, GOLD_DARK, 1);
  const cellW = 992 / 3, cellH = 172 / 4;
  GRID.forEach((g, i) => {
    const cx = 16 + Math.floor((i % 3) * cellW);
    const cy = 664 + Math.floor(Math.floor(i / 3) * cellH);
    if (i % 3 > 0) vline(cx, cy + 6, cy + Math.floor(cellH) - 6, PAPER_DARK, 1);
    if (i >= 3) hline(cx + 6, cx + Math.floor(cellW) - 6, cy, PAPER_DARK, 1);
    circle(cx + 16, cy + 20, 10, RED);
    const num = String(i + 1);
    drawText(cx + 16 - Math.floor(textWidth(num, 1, 1) / 2), cy + 14, num, WHITE, 1, 1, 1);
    drawText(cx + 32, cy + 5, g.cat, g.color, 1, 1, 2);
    drawBlock(cx + 32, cy + 19, g.head, INK, Math.floor(cellW) - 40, 1, 1, 13, 1, 2);
  });

  // ---- also list
  rect(16, 844, 992, 126, NAVY_PANEL);
  frame(16, 844, 992, 126, GOLD, 1);
  drawTextCentered(512, 852, "ALSO ON TUESDAY 17 NOVEMBER", GOLD_LIGHT, 1, 1, 3);
  hline(200, 380, 858, GOLD_DARK, 1);
  hline(644, 824, 858, GOLD_DARK, 1);
  ALSO.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const ix = 16 + (col === 0 ? 16 : 510);
    const iy = 870 + row * 12;
    rect(ix, iy + 3, 5, 5, GOLD);
    drawText(ix + 11, iy, s, CREAM, 1, 1, 1);
  });

  // ---- footer
  drawTextCentered(512, 980, "SOURCES: REUTERS, AP, BBC, AL JAZEERA, JAPAN DEFENSE MINISTRY, CDC AND PAHO, ULA, IMD, NDTV", GOLD_LIGHT, 1, 1, 1);
  drawTextCentered(512, 996, "EVERY STORY ABOVE HAPPENED OR WAS FIRST REPORTED ON TUESDAY 17 NOVEMBER 2026.", GOLD, 1, 1, 1);
}

function main(): void {
  compose();
  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

main();
