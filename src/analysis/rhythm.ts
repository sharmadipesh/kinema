import type { Candidate } from '../types/analysis.ts';
import type { EditRhythm, MotionDirection, MotionProfile, Scene } from '../types/motion.ts';
import { DIRECTION_LABELS } from '../types/motion.ts';
import { formatClock } from '../utils/time.ts';

/**
 * Edit rhythm and motion profile.
 *
 * Everything here is arithmetic over the scene list and the measured
 * candidates. Nothing is asked of the model, because a model asked for "average
 * shot length" will produce a plausible number with no relationship to the
 * video — and a statistic is exactly the kind of claim that reads as measured
 * whether or not it is.
 */

export function deriveEditRhythm(scenes: Scene[], duration: number): EditRhythm | undefined {
  // Two shots is not a rhythm. Reporting an "average shot length" from one cut
  // would be arithmetically true and editorially meaningless.
  if (scenes.length < 3) return undefined;

  const lengths = scenes.map((scene) => scene.duration).sort((a, b) => a - b);
  const shortest = lengths[0] ?? 0;
  const longest = lengths[lengths.length - 1] ?? 0;
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const middle = lengths.length >> 1;
  const medianLength =
    lengths.length % 2 === 0 ? ((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2 : (lengths[middle] ?? 0);

  const cutsPerMinute = (scenes.length - 1) / (Math.max(duration, 1) / 60);
  const density: EditRhythm['density'] =
    cutsPerMinute > 45 ? 'very high' : cutsPerMinute > 24 ? 'high' : cutsPerMinute > 10 ? 'moderate' : 'low';

  return {
    shotCount: scenes.length,
    averageShot: round(average),
    medianShot: round(medianLength),
    shortestShot: round(shortest),
    longestShot: round(longest),
    cutsPerMinute: round(cutsPerMinute),
    density,
    ...(findFastestRun(scenes) ?? {}),
  };
}

/**
 * The densest stretch of cutting in the video.
 *
 * A sliding window over shot lengths rather than a global average, because the
 * interesting thing about pacing is usually where it *changes* — "the edit gets
 * aggressive between 8 and 12 seconds" is a useful observation in a way that a
 * single mean never is.
 */
function findFastestRun(scenes: Scene[]): Pick<EditRhythm, 'fastestSectionStart' | 'fastestSectionEnd'> | null {
  const window = Math.min(4, Math.max(3, Math.floor(scenes.length / 3)));
  if (scenes.length < window + 1) return null;

  let best = { start: 0, end: 0, mean: Number.POSITIVE_INFINITY };
  for (let index = 0; index + window <= scenes.length; index += 1) {
    const slice = scenes.slice(index, index + window);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (!first || !last) continue;
    const meanLength = slice.reduce((sum, scene) => sum + scene.duration, 0) / slice.length;
    if (meanLength < best.mean) best = { start: first.startTime, end: last.endTime, mean: meanLength };
  }

  if (!Number.isFinite(best.mean)) return null;
  return { fastestSectionStart: round(best.start), fastestSectionEnd: round(best.end) };
}

export function deriveMotionProfile(candidates: Candidate[], scenes: Scene[]): MotionProfile {
  const directed = candidates
    .map((candidate) => candidate.metrics.direction)
    .filter((direction): direction is MotionDirection => Boolean(direction));

  const tally = new Map<MotionDirection, number>();
  for (const direction of directed) tally.set(direction, (tally.get(direction) ?? 0) + 1);

  const dominant = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const translations = directed.filter((direction) => direction !== 'inward' && direction !== 'outward');
  const zooms = directed.filter((direction) => direction === 'inward' || direction === 'outward');

  const movingScenes = scenes.filter((scene) => scene.motionLevel > 0.012).length;
  const cameraShare = scenes.length > 0 ? movingScenes / scenes.length : 0;

  const blurEvents = candidates.filter((candidate) => candidate.metrics.edgeDelta < -0.02).length;
  const saturated = candidates.filter((candidate) => candidate.metrics.motionSaturated).length;

  return {
    ...(dominant ? { dominantDirection: dominant[0], dominantDirectionCount: dominant[1] } : {}),
    cameraMotionShare: round(cameraShare),
    translationEvents: translations.length,
    zoomEvents: zooms.length,
    blurEvents,
    rapidMotionEvents: saturated,
  };
}

/**
 * A sentence a person can read, built only from the numbers above.
 *
 * Returns null rather than padding: a two-shot clip has nothing interesting to
 * say about its rhythm, and saying it anyway is how a product starts sounding
 * like it is guessing.
 */
export function describeRhythm(rhythm: EditRhythm | undefined, profile: MotionProfile): string | null {
  if (!rhythm) return null;
  const parts: string[] = [];

  parts.push(
    `${rhythm.shotCount} shots, averaging ${rhythm.averageShot.toFixed(2)}s (shortest ${rhythm.shortestShot.toFixed(
      2,
    )}s, longest ${rhythm.longestShot.toFixed(2)}s).`,
  );

  if (rhythm.fastestSectionStart !== undefined && rhythm.fastestSectionEnd !== undefined) {
    parts.push(
      `The cutting is densest between ${formatClock(rhythm.fastestSectionStart)} and ${formatClock(
        rhythm.fastestSectionEnd,
      )}.`,
    );
  }

  if (profile.dominantDirection && (profile.dominantDirectionCount ?? 0) >= 2) {
    parts.push(
      `Movement runs ${DIRECTION_LABELS[profile.dominantDirection].toLowerCase()} across ${
        profile.dominantDirectionCount
      } measured moments.`,
    );
  }

  return parts.join(' ');
}

const round = (value: number): number => Number(value.toFixed(3));
