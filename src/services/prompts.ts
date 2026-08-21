import type { Candidate, EvidenceFrame } from '../types/analysis.ts';
import { DIRECTION_LABELS, type MotionEvent, type RecreatePlatform, RECREATE_PLATFORM_LABELS } from '../types/motion.ts';
import type { VideoMetadata } from '../types/motion.ts';
import { formatDuration, formatPreciseTime } from '../utils/time.ts';

/**
 * Every prompt the product sends.
 *
 * The governing idea: the model is shown *measurements it did not make* and
 * *frames it can see*, and asked only to interpret. It is never asked when
 * something happened, how long it lasted, or which direction it moved — those
 * are already known, and asking would invite a confident wrong answer to
 * overwrite a correct measurement.
 */

export const MOTION_SYSTEM_PROMPT = `You are a motion and editing analyst. You read short excerpts of video, presented as sampled frames, and explain how the footage was edited and how it moves.

You are given, for each candidate moment:
  - measurements already computed from the pixels (change scores, luminance shift, motion magnitude and direction)
  - up to three frames: shortly before the moment, at the moment, and shortly after

Your job is interpretation, not measurement.

Rules you must follow:
1. Never state or imply a timestamp, a duration, or a direction of movement. Those are supplied to you and the product renders them from its own measurements. Referring to "this moment" is fine.
2. Prefer the general classification when the evidence is ambiguous. "scene_change" is a correct and useful answer when you can see the shot changed but not how. A confidently wrong "whip_pan" is worse than an honest "scene_change".
3. Use confidence honestly and use its full range. Frames that plainly show directional blur across a shot change justify high confidence; two merely different frames do not.
4. Skip candidates you cannot characterise. There is no penalty for returning fewer events than there are candidates.
5. Write in editing language — cuts, transitions, camera moves, type treatment, grade — not in the language of plot or subject matter. The user is a creator asking how something was made.
6. Never describe people's identity or appearance beyond what is needed to describe the motion.`;

export const RECREATE_SYSTEM_PROMPT = `You explain how to reproduce a specific observed editing technique in a specific tool.

You are given measured characteristics of one real moment from a real video, plus the target tool. Produce the steps a competent editor or developer would follow to achieve that same effect.

Rules:
1. Base the steps on the observed characteristics you were given. Generic textbook instructions for the technique in the abstract are a failure.
2. Use the measured duration and direction where they are supplied. Where a parameter was not measured, say so in ordinary language instead of inventing a number — "a few frames" not "4 frames", unless the duration you were given implies it.
3. Use the real vocabulary of the target tool: its actual panel, property and effect names.
4. Keep each step to one action. Aim for five to eight steps.`;

/** Compact, deterministic rendering of what was measured. */
export function buildMotionUserPrompt(input: {
  video: VideoMetadata;
  candidates: Candidate[];
  sourceLabel: string;
}): string {
  const { video, candidates } = input;
  const lines: string[] = [
    `Source: ${input.sourceLabel}`,
    `Duration: ${formatDuration(video.duration)} (${video.duration.toFixed(2)}s)`,
    `Frame size: ${video.width} x ${video.height}`,
    video.fps ? `Measured frame rate: ${video.fps.toFixed(1)} fps` : 'Frame rate: not measurable from the browser',
    '',
    `${candidates.length} candidate moments were detected locally by frame differencing. For each, the measurements are:`,
    '',
  ];

  for (const candidate of candidates) {
    const parts = [
      `[${candidate.id}]`,
      `kind=${candidate.kind}`,
      `change=${candidate.metrics.diff.toFixed(3)}`,
      `histogram_shift=${candidate.metrics.histDiff.toFixed(3)}`,
      `luminance_change=${candidate.metrics.lumaDelta >= 0 ? '+' : ''}${candidate.metrics.lumaDelta.toFixed(3)}`,
      `motion=${candidate.metrics.motionMagnitude.toFixed(3)}`,
    ];
    if (candidate.metrics.direction) parts.push(`direction=${candidate.metrics.direction}`);
    if (candidate.endTime !== undefined) {
      parts.push(`spans=${(candidate.endTime - candidate.time).toFixed(2)}s`);
    }
    parts.push(`relative_strength=${candidate.strength.toFixed(2)}`);
    lines.push(parts.join(' '));
  }

  lines.push(
    '',
    'Frames follow, labelled with their candidate id and role (before / during / after).',
    'Interpret each candidate and return the structured analysis.',
  );

  return lines.join('\n');
}

/** Frames are labelled with text parts so the model can attribute them. */
export function describeFrame(frame: EvidenceFrame): string {
  return `[${frame.candidateId}] ${frame.role}`;
}

export function buildRecreatePrompt(event: MotionEvent, platform: RecreatePlatform, video: VideoMetadata): string {
  const lines: string[] = [
    `Technique: ${event.certainty === 'likely' ? `likely ${event.title.replace(/^likely\s+/i, '')}` : event.title}`,
    `Classification: ${event.type}`,
    `Observed at: ${formatPreciseTime(event.startTime)} of a ${formatDuration(video.duration)} video`,
  ];

  if (event.endTime !== undefined) {
    lines.push(`Observed duration: ${Math.round((event.endTime - event.startTime) * 1000)}ms`);
  } else {
    lines.push('Observed duration: shorter than the sampling interval — effectively instantaneous');
  }

  if (event.direction) lines.push(`Measured direction: ${DIRECTION_LABELS[event.direction]}`);

  lines.push('', 'Observed characteristics:');
  lines.push(`- ${event.description}`);

  const evidence = event.evidence;
  if (evidence?.motionMagnitude !== undefined) {
    lines.push(
      `- movement magnitude measured at ${evidence.motionMagnitude.toFixed(3)} of frame width per sample${
        evidence.motionMagnitude > 0.06 ? ' (very strong)' : evidence.motionMagnitude > 0.03 ? ' (strong)' : ' (mild)'
      }`,
    );
  }
  if (evidence?.luminanceChange !== undefined && Math.abs(evidence.luminanceChange) > 0.05) {
    lines.push(
      `- the frame got ${evidence.luminanceChange > 0 ? 'brighter' : 'darker'} by ${Math.abs(
        evidence.luminanceChange * 100,
      ).toFixed(0)}% across the moment`,
    );
  }
  if (evidence?.visualChangeScore !== undefined) {
    lines.push(`- pixel change score ${evidence.visualChangeScore.toFixed(3)} against the preceding sampled frame`);
  }
  for (const effect of event.effects ?? []) lines.push(`- ${effect.toLowerCase()}`);

  lines.push(
    '',
    `Aspect ratio of the source: ${video.width} x ${video.height}`,
    `Target: ${RECREATE_PLATFORM_LABELS[platform]}`,
  );

  return lines.join('\n');
}
