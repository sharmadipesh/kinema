import { describe, expect, it } from 'vitest';
import { estimateLabelWidth, layoutLabels, type LabelCandidate } from './layout.ts';

const candidate = (id: string, position: number, label: string, priority = 1): LabelCandidate => ({
  id,
  position,
  label,
  priority,
});

describe('layoutLabels', () => {
  it('places well-separated labels', () => {
    const placed = layoutLabels([candidate('a', 0, 'Zoom'), candidate('b', 0.9, 'Cut')], 360);
    expect(placed).toHaveLength(2);
  });

  it('drops a colliding label rather than overlapping two', () => {
    const placed = layoutLabels([candidate('a', 0.5, 'Whip Pan'), candidate('b', 0.51, 'Hard Cut')], 320);
    expect(placed).toHaveLength(1);
  });

  it('keeps the higher-priority label when two collide', () => {
    const placed = layoutLabels(
      [candidate('low', 0.5, 'Zoom', 0.2), candidate('high', 0.51, 'Cut', 9)],
      320,
    );
    expect(placed.map((entry) => entry.id)).toEqual(['high']);
  });

  it('keeps every label inside the track at both ends', () => {
    const placed = layoutLabels([candidate('a', 0, 'Zoom In'), candidate('b', 1, 'Whip Pan')], 320);
    for (const label of placed) {
      expect(label.left).toBeGreaterThanOrEqual(0);
      expect(label.left + label.width).toBeLessThanOrEqual(320);
    }
  });

  it('returns results in time order regardless of priority order', () => {
    const placed = layoutLabels(
      [candidate('c', 0.8, 'C', 1), candidate('a', 0.1, 'A', 9), candidate('b', 0.45, 'B', 5)],
      400,
    );
    expect(placed.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('degrades to nothing rather than crashing on a zero-width track', () => {
    // The first render happens before ResizeObserver has measured anything.
    expect(layoutLabels([candidate('a', 0.5, 'Cut')], 0)).toEqual([]);
  });

  it('shows fewer labels in a narrow panel than a wide one', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      candidate(`e${index}`, index / 11, 'Whip Pan', 12 - index),
    );
    expect(layoutLabels(many, 320).length).toBeLessThan(layoutLabels(many, 900).length);
  });
});

describe('estimateLabelWidth', () => {
  it('clamps to a usable range', () => {
    expect(estimateLabelWidth('')).toBe(26);
    expect(estimateLabelWidth('a'.repeat(80))).toBe(84);
  });
});
