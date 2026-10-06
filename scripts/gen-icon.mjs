/**
 * Juzt icon generator — no dependencies, no network.
 *
 *   node scripts/gen-icon.mjs
 *
 * Writes `build/icon.png` (512²) and `build/icon.ico` (16…256, PNG payloads),
 * both built from the same drawing routine so they can never drift apart.
 *
 * The mark is geometric and minimal: a rounded dark tile, a white "J" stroke and
 * a blue→violet accent dot — the same shapes used by the in-app logo.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/* ------------------------------------------------------------------ *
 * Tiny software rasteriser (RGBA, supersampled)
 * ------------------------------------------------------------------ */

const SS = 3; // supersampling factor

/** A supersampled buffer: `size` is the final size, the buffer is N = size*SS. */
function makeCanvas(size) {
  const n = size * SS;
  return { size, n, pixels: new Float32Array(n * n * 4) };
}

/** Source-over composite of an RGBA colour with coverage `a` (0..1). */
function blend(canvas, x, y, [r, g, b], a) {
  if (a <= 0) return;
  const i = (y * canvas.n + x) * 4;
  const p = canvas.pixels;
  const dstA = p[i + 3];
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  p[i] = (r * a + p[i] * dstA * (1 - a)) / outA;
  p[i + 1] = (g * a + p[i + 1] * dstA * (1 - a)) / outA;
  p[i + 2] = (b * a + p[i + 2] * dstA * (1 - a)) / outA;
  p[i + 3] = outA;
}

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Signed distance to a rounded rectangle, in normalised 0..1 units. */
function sdRoundRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Signed distance to a capsule (thick segment). */
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/** Minimum distance to an arc of a circle (angles in turns, 0 = +x, clockwise). */
function sdArc(px, py, cx, cy, radius, from, to) {
  const angle = Math.atan2(py - cy, px - cx);
  let t = angle / (Math.PI * 2);
  while (t < 0) t += 1;
  const inside = from <= to ? t >= from && t <= to : t >= from || t <= to;
  if (inside) return Math.abs(Math.hypot(px - cx, py - cy) - radius);
  const a0 = from * Math.PI * 2;
  const a1 = to * Math.PI * 2;
  const d0 = Math.hypot(px - (cx + Math.cos(a0) * radius), py - (cy + Math.sin(a0) * radius));
  const d1 = Math.hypot(px - (cx + Math.cos(a1) * radius), py - (cy + Math.sin(a1) * radius));
  return Math.min(d0, d1);
}

/**
 * Draw the Juzt mark into a unit square (0..1 coordinates) by sampling with
 * `covers()`. Everything scales linearly, so 16px and 512px stay identical.
 */
function drawMark(canvas) {
  const N = canvas.n;
  const tile = hex('#0B0E14');
  const ink = hex('#EDF3FF');
  const accentA = hex('#4AA3FF');
  const accentB = hex('#8B6BFF');

  const feather = 1 / N;

  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const u = (x + 0.5) / N;
      const v = (y + 0.5) / N;

      // Rounded tile background (with a soft vertical gradient so it reads as
      // "premium dark" instead of flat black).
      const tileD = sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.235);
      const tileCoverage = Math.min(1, Math.max(0, 0.5 - tileD / feather));
      if (tileCoverage > 0) {
        const shade = mix(tile, hex('#161C2B'), Math.min(1, v * 1.05));
        blend(canvas, x, y, shade, tileCoverage);
      }

      // A thin gradient ring hugging the tile edge — the brand accent.
      const ringD = Math.abs(sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.235)) - 0.008;
      const ringCoverage = Math.min(1, Math.max(0, 0.5 - ringD / feather));
      if (ringCoverage > 0) {
        blend(canvas, x, y, mix(accentA, accentB, Math.min(1, Math.max(0, (u + v) / 2))), ringCoverage * 0.5);
      }

      // The "J": a stem plus a hook, both drawn as round-capped strokes.
      const stroke = 0.088;
      const stemD = sdSegment(u, v, 0.612, 0.272, 0.612, 0.548) - stroke / 2;
      const hookD = sdArc(u, v, 0.478, 0.548, 0.134, 0, 0.5) - stroke / 2;
      const jD = Math.min(stemD, hookD);
      const jCoverage = Math.min(1, Math.max(0, 0.5 - jD / feather));
      if (jCoverage > 0) blend(canvas, x, y, ink, jCoverage);

      // Accent dot to the upper right of the stem.
      const dotD = Math.hypot(u - 0.742, v - 0.276) - 0.052;
      const dotCoverage = Math.min(1, Math.max(0, 0.5 - dotD / feather));
      if (dotCoverage > 0) blend(canvas, x, y, mix(accentA, accentB, 0.65), dotCoverage);
    }
  }

  // Downsample SS×SS → 1 (box filter).
  const out = Buffer.alloc(canvas.size * canvas.size * 4);
  const p = canvas.pixels;
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * N + (x * SS + sx)) * 4;
          const alpha = p[i + 3];
          r += p[i];
          g += p[i + 1];
          b += p[i + 2];
          a += alpha;
        }
      }
      const n = SS * SS;
      const o = (y * canvas.size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * PNG encoder (RGBA, 8-bit, one IDAT)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * ICO container (PNG entries, valid for Windows Vista+)
 * ------------------------------------------------------------------ */

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach((entry, i) => {
    const at = i * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0;
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32BE(0, at + 8);
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const entries = ICO_SIZES.map((size) => ({ size, png: encodePng(drawMark(makeCanvas(size)), size) }));
const big = encodePng(drawMark(makeCanvas(512)), 512);

mkdirSync(resolve(root, 'build'), { recursive: true });
writeFileSync(resolve(root, 'build/icon.png'), big);
writeFileSync(resolve(root, 'build/icon.ico'), encodeIco(entries));
// electron-builder also picks these up when packaging Linux targets.
writeFileSync(resolve(root, 'build/icons/512x512.png'), big, { flag: 'w' });

console.log(`icon.png  512×512  ${big.length} bytes`);
console.log(`icon.ico  ${ICO_SIZES.join(', ')}  ${encodeIco(entries).length} bytes`);
