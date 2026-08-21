/**
 * Deciding which timeline labels can actually be drawn.
 *
 * A thirty-second edit with twelve events has markers four pixels apart in a
 * 320px panel. Drawing every label produces an unreadable smear, and dropping
 * labels arbitrarily hides the ones that matter — so this places them greedily
 * in priority order and reports honestly which ones did not fit. The markers
 * themselves are always drawn; only the text is rationed.
 *
 * Pure and unit-tested, because "does the label fit" is exactly the kind of
 * geometry that quietly breaks at one panel width and nobody notices.
 */

export interface LabelCandidate {
  id: string;
  /** 0–1 along the track. */
  position: number;
  label: string;
  /** Higher wins when two labels collide. */
  priority: number;
}

export interface PlacedLabel extends LabelCandidate {
  /** Left edge in pixels, already clamped inside the track. */
  left: number;
  width: number;
}

const CHAR_WIDTH = 5.3;
const PADDING = 6;
const MIN_WIDTH = 26;
const MAX_WIDTH = 84;
const GAP = 5;

export function estimateLabelWidth(label: string): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, label.length * CHAR_WIDTH + PADDING));
}

export function layoutLabels(candidates: LabelCandidate[], trackWidth: number): PlacedLabel[] {
  if (trackWidth <= 0) return [];

  const placed: PlacedLabel[] = [];

  for (const candidate of [...candidates].sort((a, b) => b.priority - a.priority)) {
    const width = estimateLabelWidth(candidate.label);
    const centre = candidate.position * trackWidth;
    const left = Math.max(0, Math.min(trackWidth - width, centre - width / 2));

    const collides = placed.some((entry) => left < entry.left + entry.width + GAP && entry.left < left + width + GAP);
    if (collides) continue;

    placed.push({ ...candidate, left, width });
  }

  return placed.sort((a, b) => a.position - b.position);
}
