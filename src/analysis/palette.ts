import type { PaletteSwatch } from '../types/motion.ts';

/**
 * Colours measured from the sampled frames, not asked for.
 *
 * A model handed a few thumbnails will happily produce hex codes, and they will
 * look plausible and be wrong — it is reading downscaled JPEGs and reporting
 * from memory of what "warm editorial" looks like. These come from counting
 * actual pixels, which makes them the one part of a moodboard that can be
 * trusted against the footage.
 *
 * Accumulated as a coarse 6x6x6 RGB histogram during sampling: fine enough to
 * separate a warm skin tone from an amber practical, coarse enough that a
 * gradient does not fragment into thirty near-identical swatches.
 */

const BINS = 6;
const TOTAL_BINS = BINS * BINS * BINS;

export type PaletteAccumulator = Uint32Array;

export function createAccumulator(): PaletteAccumulator {
  return new Uint32Array(TOTAL_BINS);
}

export function accumulate(into: PaletteAccumulator, rgba: Uint8Array | Uint8ClampedArray, pixels: number): void {
  for (let pixel = 0, index = 0; pixel < pixels; pixel += 1, index += 4) {
    const r = Math.min(BINS - 1, ((rgba[index] ?? 0) * BINS) >> 8);
    const g = Math.min(BINS - 1, ((rgba[index + 1] ?? 0) * BINS) >> 8);
    const b = Math.min(BINS - 1, ((rgba[index + 2] ?? 0) * BINS) >> 8);
    const bin = (r * BINS + g) * BINS + b;
    into[bin] = (into[bin] ?? 0) + 1;
  }
}

/** Bin centre → hex. The centre, not the edge, so swatches sit mid-range. */
function binToHex(bin: number): string {
  const b = bin % BINS;
  const g = Math.floor(bin / BINS) % BINS;
  const r = Math.floor(bin / (BINS * BINS));
  const channel = (value: number): string =>
    Math.round(((value + 0.5) / BINS) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function saturationOf(bin: number): number {
  const b = bin % BINS;
  const g = Math.floor(bin / BINS) % BINS;
  const r = Math.floor(bin / (BINS * BINS));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * The handful of colours that actually define the image.
 *
 * Roles are assigned by weight and saturation rather than named by a model:
 * the two most common bins carry the picture, a saturated minority colour is
 * doing accent work, and a desaturated one is the neutral the rest sits on.
 */
export function extractPalette(accumulator: PaletteAccumulator, maxSwatches = 6): PaletteSwatch[] {
  let total = 0;
  for (const count of accumulator) total += count;
  if (total === 0) return [];

  const ranked = [...accumulator]
    .map((count, bin) => ({ bin, count }))
    .filter((entry) => entry.count / total > 0.01)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxSwatches);

  return ranked.map((entry, index) => {
    const saturation = saturationOf(entry.bin);
    const role: PaletteSwatch['role'] =
      index === 0 ? 'primary' : index === 1 ? 'secondary' : saturation > 0.45 ? 'accent' : 'neutral';
    return { hex: binToHex(entry.bin), weight: Number((entry.count / total).toFixed(4)), role };
  });
}
