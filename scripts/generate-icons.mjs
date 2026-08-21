import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Generates the extension's PNG icons from geometry, so the repository carries
 * no binary assets and the mark stays crisp at every required size.
 *
 * The mark: a graphite squircle carrying three vertical bars of unequal height
 * — a motion trace, and the same rhythm as the timeline the product is built
 * around. Rendered with 3x3 supersampling.
 */

const SIZES = [16, 32, 48, 128];
const OUT_DIR = new URL('../public/icons/', import.meta.url);

const INK = [17, 17, 19];
const MARK = [255, 255, 255];
const SAMPLES = 3;

/** Squircle: |x|^n + |y|^n <= 1 */
const inSquircle = (x, y, radius, n = 4.6) =>
  Math.abs(x / radius) ** n + Math.abs(y / radius) ** n <= 1;

/** Three rounded bars: the outer pair short, the centre tall. */
function inMark(x, y, unit) {
  const bars = [
    { cx: -2.05 * unit, half: 1.55 * unit },
    { cx: 0, half: 2.7 * unit },
    { cx: 2.05 * unit, half: 2.05 * unit },
  ];
  const halfWidth = 0.62 * unit;
  const cap = halfWidth;

  for (const bar of bars) {
    const dx = Math.abs(x - bar.cx);
    const dy = Math.abs(y);
    if (dx > halfWidth) continue;
    if (dy <= bar.half - cap) return true;
    // Rounded cap.
    const capDy = dy - (bar.half - cap);
    if (capDy <= cap && dx * dx + capDy * capDy <= cap * cap) return true;
  }
  return false;
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const plateRadius = center * 0.98;
  // The mark grows proportionally at small sizes so 16px stays legible.
  const unit = center * (size <= 16 ? 0.25 : size <= 32 ? 0.235 : 0.22);
  const step = 1 / SAMPLES;
  const total = SAMPLES * SAMPLES;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plateHits = 0;
      let markHits = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) * step - center;
          const py = y + (sy + 0.5) * step - center;
          if (inSquircle(px, py, plateRadius)) plateHits += 1;
          if (inMark(px, py, unit)) markHits += 1;
        }
      }

      const plate = plateHits / total;
      const mark = Math.min(markHits / total, plate);
      const offset = (y * size + x) * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const blended = plate > 0 ? INK[channel] * (1 - mark / plate) + MARK[channel] * (mark / plate) : 0;
        pixels[offset + channel] = Math.round(blended);
      }
      pixels[offset + 3] = Math.round(plate * 255);
    }
  }

  return pixels;
}

// -- Minimal PNG encoder -----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // 10-12 default to 0: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(fileURLToPath(OUT_DIR), { recursive: true });
for (const size of SIZES) {
  writeFileSync(fileURLToPath(new URL(`icon-${size}.png`, OUT_DIR)), encodePng(size, renderIcon(size)));
}
console.log(`  icons generated        ·  ${SIZES.join(', ')}px`);
