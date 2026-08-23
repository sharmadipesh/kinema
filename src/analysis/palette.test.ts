import { describe, expect, it } from 'vitest';
import { accumulate, createAccumulator, extractPalette } from './palette.ts';

/** Builds an RGBA buffer of one repeated colour. */
function solid(r: number, g: number, b: number, pixels: number): Uint8Array {
  const rgba = new Uint8Array(pixels * 4);
  for (let index = 0; index < pixels; index += 1) {
    rgba[index * 4] = r;
    rgba[index * 4 + 1] = g;
    rgba[index * 4 + 2] = b;
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}

describe('extractPalette', () => {
  it('returns nothing for an empty accumulator rather than inventing swatches', () => {
    expect(extractPalette(createAccumulator())).toEqual([]);
  });

  it('finds the dominant colour of a solid frame', () => {
    const accumulator = createAccumulator();
    accumulate(accumulator, solid(20, 20, 22, 100), 100);
    const palette = extractPalette(accumulator);
    expect(palette).toHaveLength(1);
    expect(palette[0]?.role).toBe('primary');
    expect(palette[0]?.weight).toBeCloseTo(1, 2);
  });

  it('ranks colours by how much of the frame they occupy', () => {
    const accumulator = createAccumulator();
    accumulate(accumulator, solid(10, 10, 10, 800), 800);
    accumulate(accumulator, solid(230, 180, 90, 200), 200);
    const palette = extractPalette(accumulator);
    expect(palette[0]?.weight).toBeGreaterThan(palette[1]!.weight);
    expect(palette[0]?.role).toBe('primary');
    expect(palette[1]?.role).toBe('secondary');
  });

  it('marks a saturated minority colour as an accent', () => {
    const accumulator = createAccumulator();
    accumulate(accumulator, solid(15, 15, 15, 600), 600);
    accumulate(accumulator, solid(120, 120, 120, 300), 300);
    accumulate(accumulator, solid(250, 140, 20, 100), 100);
    const palette = extractPalette(accumulator);
    expect(palette.find((swatch) => swatch.role === 'accent')?.hex).toBeDefined();
  });

  it('drops colours too rare to define anything', () => {
    const accumulator = createAccumulator();
    accumulate(accumulator, solid(10, 10, 10, 1000), 1000);
    accumulate(accumulator, solid(255, 0, 0, 2), 2);
    expect(extractPalette(accumulator)).toHaveLength(1);
  });

  it('emits well-formed hex', () => {
    const accumulator = createAccumulator();
    accumulate(accumulator, solid(200, 100, 50, 100), 100);
    expect(extractPalette(accumulator)[0]?.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
