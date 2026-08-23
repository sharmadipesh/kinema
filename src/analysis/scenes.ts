import type { Candidate, FrameMetrics } from '../types/analysis.ts';
import type { MotionDirection, Scene } from '../types/motion.ts';
import { ANALYSIS_FRAME } from './config.ts';
import { describeDirection } from './metrics.ts';

/**
 * Scene segmentation.
 *
 * Shots are the unit editing is actually made of, and until now the product had
 * no model of them at all — which is why "pacing" was derived from event counts
 * rather than from shot length, and why nothing could say "eleven shots,
 * average 1.6 seconds". Everything in `rhythm.ts` depends on this existing.
 *
 * Boundaries come from the candidates that represent discontinuities. Camera
 * runs and colour shifts happen *within* a shot and are deliberately not
 * treated as boundaries — a push-in does not end the shot it is pushing in on.
 */

const MIN_SCENE_SEC = 0.12;

export function segmentScenes(
  candidates: Candidate[],
  metrics: FrameMetrics[],
  duration: number,
): Scene[] {
  const boundaries = candidates
    .filter((candidate) => candidate.kind === 'boundary' || candidate.kind === 'gradual')
    .map((candidate) => candidate.peakTime ?? candidate.time)
    .filter((time) => time > MIN_SCENE_SEC && time < duration - MIN_SCENE_SEC)
    .sort((a, b) => a - b);

  const cuts = [0, ...dedupe(boundaries), duration];
  const scenes: Scene[] = [];

  for (let index = 0; index < cuts.length - 1; index += 1) {
    const start = cuts[index] ?? 0;
    const end = cuts[index + 1] ?? duration;
    if (end - start < MIN_SCENE_SEC) continue;

    const inside = metrics.filter((metric) => metric.time >= start && metric.time < end);
    scenes.push({
      id: `s${scenes.length + 1}`,
      index: scenes.length + 1,
      startTime: Number(start.toFixed(3)),
      endTime: Number(end.toFixed(3)),
      duration: Number((end - start).toFixed(3)),
      ...describeMotion(inside),
      ...(index > 0 ? { entryCandidateId: candidateAt(candidates, start) } : {}),
      ...(index < cuts.length - 2 ? { exitCandidateId: candidateAt(candidates, end) } : {}),
    });
  }

  return scenes;
}

/**
 * What the measurements say about how this shot behaves.
 *
 * Only ever motion and tone — never a description of subject matter. The model
 * supplies that later where it is useful, and a scene record full of invented
 * semantics would be a liability the moment anyone relied on it.
 */
function describeMotion(metrics: FrameMetrics[]): Pick<Scene, 'motionLevel' | 'meanLuma' | 'dominantDirection' | 'sampleCount'> {
  if (metrics.length === 0) {
    return { motionLevel: 0, meanLuma: 0, sampleCount: 0 };
  }

  const motion = metrics.reduce((sum, metric) => sum + metric.motionMagnitude, 0) / metrics.length;
  const luma = metrics.reduce((sum, metric) => sum + metric.meanLuma, 0) / metrics.length;

  // Summed vectors rather than a vote: a shot that pans right then back left
  // has no dominant direction, and summing is what makes it cancel out.
  const dx = metrics.reduce((sum, metric) => sum + metric.motionX, 0) / metrics.length;
  const dy = metrics.reduce((sum, metric) => sum + metric.motionY, 0) / metrics.length;
  const divergence = metrics.reduce((sum, metric) => sum + metric.divergence, 0) / metrics.length;

  const direction = describeDirection(
    { dx, dy, magnitude: Math.hypot(dx, dy) / ANALYSIS_FRAME.width, divergence, saturated: false },
    ANALYSIS_FRAME.width,
  );

  return {
    motionLevel: Number(motion.toFixed(4)),
    meanLuma: Number(luma.toFixed(4)),
    ...(direction ? { dominantDirection: direction as MotionDirection } : {}),
    sampleCount: metrics.length,
  };
}

function candidateAt(candidates: Candidate[], time: number): string | undefined {
  const match = candidates.find((candidate) => Math.abs((candidate.peakTime ?? candidate.time) - time) < 0.02);
  return match?.id;
}

function dedupe(times: number[]): number[] {
  const out: number[] = [];
  for (const time of times) {
    const last = out[out.length - 1];
    if (last === undefined || time - last >= MIN_SCENE_SEC) out.push(time);
  }
  return out;
}
