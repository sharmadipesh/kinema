import type { Candidate, EvidenceFrame } from '../types/analysis.ts';
import {
  CONTINUITY_LABELS,
  DIRECTION_LABELS,
  type ContinuityKind,
  type EditRhythm,
  type MotionEvent,
  type MotionProfile,
  type RecreatePlatform,
  RECREATE_PLATFORM_LABELS,
  type Scene,
  type VideoMetadata,
} from '../types/motion.ts';
import { formatDuration, formatPreciseTime } from '../utils/time.ts';

/**
 * Every prompt the product sends.
 *
 * The governing idea: the model is shown *measurements it did not make* and
 * *frames it can see*, and asked only to interpret. It is never asked when
 * something happened or how long it lasted — those are already known, and
 * asking would invite a confident wrong answer to overwrite a correct
 * measurement.
 *
 * A NOTE ON RULE 1, which was previously wrong in an instructive way. The old
 * instruction read "never state or imply a timestamp, a duration, or a
 * direction of movement". The intent was to protect measurement integrity. The
 * effect was to forbid the model from writing "the frame shifts rapidly toward
 * the right" — the exact sentence the product exists to produce — and every
 * description came back generic as a direct result. The rule now bans
 * *inventing* quantities while explicitly requiring qualitative description of
 * the movement, which is what the model can actually see.
 */

const NEVER_INVENT = `You are given measurements taken from the pixels: durations, directions, velocities and change scores. Use them. Never invent a competing number, never state a timestamp, and never contradict a supplied measurement — but DO describe, in words, the movement and change you can see between the frames. "The frame shifts hard to the right and detail smears" is exactly the kind of sentence wanted. "Between 4.12 and 4.34 seconds" is not, because the product supplies that itself.`;

export const GLOBAL_SYSTEM_PROMPT = `You are a senior video editor performing a forensic breakdown of an edit.

You are shown a handful of frames spread evenly across a video, plus real shot statistics measured from it. Your job is to characterise how the video is CONSTRUCTED — its cutting rhythm, its transition habits, its camera language, its type treatment — not what it is about.

${NEVER_INVENT}

Write for a creator asking "how was this made?". Never describe plot, subject identity, or what people look like beyond what is needed to describe movement. If the frames do not support a claim, leave that field null rather than filling it.`;

export const EVENTS_SYSTEM_PROMPT = `You are a senior motion designer and video editor inspecting an edit frame by frame.

For each event you are given a short CHRONOLOGICAL sequence of frames sampled around one moment, the shots either side of it, and measurements already computed from the pixels.

Your job is interpretation of CHANGE BETWEEN FRAMES. A description of what is in each frame is a failed answer. What moved, in which way, how the movement developed, where it peaked, and what the incoming shot does with it — that is the answer.

${NEVER_INVENT}

WORK IN THIS ORDER, and do not skip ahead:
  1. Observed visual change — what is different between consecutive frames
  2. Temporal progression — how that change develops across the sequence
  3. Scene-boundary behaviour — whether the shot identity changes, and where
  4. Motion direction
  5. Motion continuity — what the incoming shot does with the movement
  6. Effects visible in the frames
  7. Only then, the likely editing technique
  8. Confidence, and any rival reading that would also fit

Fill \`observations\` before \`interpretation\`. A classification reached first and evidenced afterwards is how a wrong answer becomes a confident one.

Rules:
1. Every field in \`observations\` is checked against measurements taken from the pixels. A claim that is not supported lowers the confidence of the whole event. Answer null rather than guessing — an unanswered field costs nothing.
2. Prefer the general classification when the evidence is ambiguous. "scene_change" is a correct and useful answer when you can see the shot changed but not how.
3. Use confidence across its full range. Frames plainly showing directional smear across a shot change justify high confidence; two merely different frames do not.
4. If a second reading would fit the same observations, put it in \`alternatives\`. This does not weaken your answer — it is how the product avoids sounding certain when it should not.
5. Skip any event you cannot characterise. There is no penalty for returning fewer events than you were given.
6. An optical zoom, a digital scale and a physical camera push are indistinguishable in frames. When you cannot tell, say so in the ambiguity field rather than picking one.
7. Never guess at text you cannot read.
8. Write in editing language — cuts, transitions, camera moves, type treatment, grade — not the language of plot or subject.`;

export const RECONCILE_SYSTEM_PROMPT = `You are a supervising editor reviewing a completed shot-by-shot breakdown.

You are given the full event list, the measured shot statistics, and the global context — but no images. Your job is the judgement that only the whole picture allows: which classifications the wider context corrects, and how to describe the edit as a whole.

${NEVER_INVENT}

Only correct an event when the surrounding context genuinely changes the reading — for instance, a "scene change" that is one of six identically constructed direction-matched transitions is a match cut. An empty corrections list is the expected answer for a clean analysis.`;

export const RECREATE_SYSTEM_PROMPT = `You explain how to reproduce one specific observed editing technique in one specific tool.

You are given measured characteristics of a real moment from a real video, plus the target tool. Produce the steps a competent editor or developer would follow to achieve that same effect.

Rules:
1. Base the steps on the observed characteristics. Generic textbook instructions for the technique in the abstract are a failure.
2. Use the measured duration and direction where supplied. Where a parameter was not measured, say so in ordinary language rather than inventing a number.
3. Use the real vocabulary of the target tool: its actual panel, property and effect names.
4. Keep each step to one action. Aim for six to eight steps.`;

// -- Pass 1 ------------------------------------------------------------------

export function buildGlobalPrompt(input: {
  video: VideoMetadata;
  scenes: Scene[];
  rhythm?: EditRhythm;
  profile: MotionProfile;
  sourceLabel: string;
  frameTimes: number[];
}): string {
  const lines = [
    `Source: ${input.sourceLabel}`,
    `Duration: ${formatDuration(input.video.duration)} · ${input.video.width}x${input.video.height}`,
    input.video.fps ? `Measured frame rate: ${input.video.fps.toFixed(1)} fps` : 'Frame rate: not measurable from the browser',
    '',
  ];

  if (input.rhythm) {
    lines.push(
      'Measured shot statistics:',
      `  shots: ${input.rhythm.shotCount}`,
      `  average shot: ${input.rhythm.averageShot.toFixed(2)}s (median ${input.rhythm.medianShot.toFixed(2)}s)`,
      `  shortest: ${input.rhythm.shortestShot.toFixed(2)}s · longest: ${input.rhythm.longestShot.toFixed(2)}s`,
      `  cuts per minute: ${input.rhythm.cutsPerMinute.toFixed(1)} (${input.rhythm.density})`,
      '',
    );
  } else {
    lines.push('Measured shot statistics: too few shot boundaries to compute reliably.', '');
  }

  lines.push(
    'Measured motion:',
    `  shots containing movement: ${(input.profile.cameraMotionShare * 100).toFixed(0)}%`,
    input.profile.dominantDirection
      ? `  dominant direction: ${DIRECTION_LABELS[input.profile.dominantDirection]} (${input.profile.dominantDirectionCount} moments)`
      : '  dominant direction: none measured',
    `  zoom-like moments: ${input.profile.zoomEvents} · translation moments: ${input.profile.translationEvents}`,
    `  moments showing detail smear: ${input.profile.blurEvents}`,
    '',
    `${input.frameTimes.length} frames follow, evenly spread across the video in chronological order.`,
  );

  return lines.join('\n');
}

// -- Pass 2 ------------------------------------------------------------------

export interface PromptEvent {
  id: string;
  candidate: Candidate;
  frames: EvidenceFrame[];
  /** The shot running into this moment. */
  previousScene?: Scene;
  /** The shot running out of it. */
  nextScene?: Scene;
  /** Continuity as measured from the two shots, for the model to check against. */
  measuredContinuity?: ContinuityKind;
}

/**
 * The measurements for one event, written for a reader rather than a parser.
 *
 * Ordered so the most decision-relevant facts come first: what kind of change,
 * how strong, which way, and — the part that was previously missing entirely —
 * where the movement peaked relative to the change, and whether it survived it.
 */
export function describeCandidate(entry: PromptEvent, index: number): string {
  const { candidate } = entry;
  const metrics = candidate.metrics;
  const lines = [`EVENT ${entry.id}  (${index + 1})`];

  const span =
    candidate.endTime !== undefined ? `${Math.round((candidate.endTime - candidate.time) * 1000)}ms` : 'under one sample interval';
  lines.push(`  measured span: ${span}`);
  lines.push(`  local reading: ${candidate.kind}`);
  lines.push(`  change score: ${metrics.diff.toFixed(3)} pixel · ${metrics.histDiff.toFixed(3)} tonal · ${metrics.chromaDist.toFixed(3)} colour`);

  if (Math.abs(metrics.lumaDelta) > 0.02) {
    lines.push(`  brightness: ${metrics.lumaDelta > 0 ? 'rises' : 'falls'} by ${Math.abs(metrics.lumaDelta * 100).toFixed(0)}%`);
  }
  if (metrics.direction) {
    lines.push(`  measured direction: ${DIRECTION_LABELS[metrics.direction]}`);
  }
  if (metrics.motionMagnitude > 0.005) {
    lines.push(
      `  movement: ${(metrics.motionMagnitude * 100).toFixed(1)}% of frame width per sample${
        metrics.motionSaturated ? ' (at or beyond what the estimator can measure — genuinely fast)' : ''
      }`,
    );
  }
  if (metrics.peakVelocityTime !== undefined && candidate.peakTime !== undefined) {
    const offset = metrics.peakVelocityTime - candidate.peakTime;
    lines.push(
      `  peak movement lands ${Math.abs(offset) < 0.02 ? 'at the change itself' : offset < 0 ? `${Math.round(-offset * 1000)}ms before the change` : `${Math.round(offset * 1000)}ms after the change`}`,
    );
  }
  if (metrics.motionContinues !== undefined) {
    lines.push(`  movement after the change: ${metrics.motionContinues ? 'continues at a similar rate' : 'stops or reverses'}`);
  }
  if (metrics.edgeDelta < -0.02) {
    lines.push(`  fine detail drops by ${Math.abs(metrics.edgeDelta * 100).toFixed(0)}% — consistent with smear`);
  }
  /**
   * The shots either side.
   *
   * Without this the model judges a transition from the transition alone, which
   * is precisely the information a whip pan does not contain — the technique
   * lives in the relationship between the two shots, and half of that
   * relationship is outside the frames supplied.
   */
  if (entry.previousScene) {
    lines.push(
      `  previous shot: ${entry.previousScene.duration.toFixed(2)}s, ${describeShotMotion(entry.previousScene)}`,
    );
  }
  if (entry.nextScene) {
    lines.push(`  next shot: ${entry.nextScene.duration.toFixed(2)}s, ${describeShotMotion(entry.nextScene)}`);
  }
  if (entry.measuredContinuity) {
    lines.push(`  measured continuity: ${CONTINUITY_LABELS[entry.measuredContinuity].toLowerCase()}`);
  }

  lines.push(`  frames supplied: ${entry.frames.length}, chronological`);
  return lines.join('\n');
}

export function buildEventsPrompt(entries: PromptEvent[], globalSummary: string | null): string {
  const lines: string[] = [];

  if (globalSummary) {
    lines.push('Context for the whole video (established in an earlier pass):', globalSummary, '');
  }

  lines.push(
    `${entries.length} events follow. For each, the measurements and surrounding shots come first, then its frames.`,
    'The frames for one event are SEQUENTIAL SAMPLES FROM THE SAME MOMENT, in chronological order. Analyse the',
    'differences between consecutive frames rather than describing each image independently.',
    '',
  );

  for (const [index, entry] of entries.entries()) lines.push(describeCandidate(entry, index), '');

  return lines.join('\n');
}

function describeShotMotion(scene: Scene): string {
  if (scene.motionLevel < 0.012) return 'static';
  const direction = scene.dominantDirection ? DIRECTION_LABELS[scene.dominantDirection].toLowerCase() : 'no dominant direction';
  return `movement ${(scene.motionLevel * 100).toFixed(1)}% of frame width per sample, ${direction}`;
}

/** Frame labels. Without these the images are an undifferentiated soup. */
export function describeFrame(frame: EvidenceFrame, relativeMs: number): string {
  const offset = relativeMs === 0 ? 'at the change' : relativeMs < 0 ? `${-relativeMs}ms before` : `${relativeMs}ms after`;
  return `[${frame.candidateId}] frame ${frame.order + 1} · ${frame.role} · ${offset}`;
}

// -- Pass 3 ------------------------------------------------------------------

export function buildReconcilePrompt(input: {
  video: VideoMetadata;
  events: MotionEvent[];
  scenes: Scene[];
  rhythm?: EditRhythm;
  profile: MotionProfile;
  globalSummary: string | null;
}): string {
  const lines: string[] = [
    `Duration ${formatDuration(input.video.duration)} · ${input.scenes.length} shots · ${input.events.length} events.`,
    '',
  ];

  if (input.globalSummary) lines.push('First-pass context:', input.globalSummary, '');

  if (input.rhythm) {
    lines.push(
      `Shots: ${input.rhythm.shotCount}, average ${input.rhythm.averageShot.toFixed(2)}s, shortest ${input.rhythm.shortestShot.toFixed(2)}s, longest ${input.rhythm.longestShot.toFixed(2)}s, ${input.rhythm.cutsPerMinute.toFixed(1)} cuts/min (${input.rhythm.density}).`,
    );
    if (input.rhythm.fastestSectionStart !== undefined) {
      lines.push(
        `Densest cutting: ${formatPreciseTime(input.rhythm.fastestSectionStart)} to ${formatPreciseTime(input.rhythm.fastestSectionEnd ?? 0)}.`,
      );
    }
  }

  lines.push(
    `Movement: ${(input.profile.cameraMotionShare * 100).toFixed(0)}% of shots move; ${input.profile.zoomEvents} zoom-like, ${input.profile.translationEvents} translations, ${input.profile.blurEvents} showing smear.`,
    '',
    'Events, in order:',
  );

  for (const event of input.events) {
    const parts = [
      `  ${event.id}`,
      `${formatPreciseTime(event.startTime)}`,
      event.type,
      `"${event.title}"`,
      `conf ${event.confidence.toFixed(2)}`,
    ];
    if (event.direction) parts.push(DIRECTION_LABELS[event.direction]);
    lines.push(parts.join(' · '));
  }

  return lines.join('\n');
}

// -- Recreate ----------------------------------------------------------------

export function buildRecreatePrompt(event: MotionEvent, platform: RecreatePlatform, video: VideoMetadata): string {
  const lines: string[] = [
    `Technique: ${event.title}`,
    `Classification: ${event.type} (${event.certainty})`,
    `Observed at ${formatPreciseTime(event.startTime)} of a ${formatDuration(video.duration)} video`,
  ];

  if (event.endTime !== undefined) {
    lines.push(`Total observed span: ${Math.round((event.endTime - event.startTime) * 1000)}ms`);
    if (event.peakTime !== undefined) {
      lines.push(
        `  outgoing phase: ~${Math.round((event.peakTime - event.startTime) * 1000)}ms`,
        `  incoming phase: ~${Math.round((event.endTime - event.peakTime) * 1000)}ms`,
      );
    }
  } else {
    lines.push('Total observed span: shorter than the sampling interval — effectively instantaneous');
  }

  if (event.direction) lines.push(`Measured direction: ${DIRECTION_LABELS[event.direction]}`);

  const evidence = event.evidence;
  lines.push('', 'Observed characteristics:');
  lines.push(`- ${event.description}`);

  if (event.observation?.build) lines.push(`- build: ${event.observation.build}`);
  if (event.observation?.peak) lines.push(`- peak: ${event.observation.peak}`);
  if (event.observation?.after) lines.push(`- after: ${event.observation.after}`);
  if (event.transition?.outgoingBehavior) lines.push(`- outgoing shot: ${event.transition.outgoingBehavior}`);
  if (event.transition?.incomingBehavior) lines.push(`- incoming shot: ${event.transition.incomingBehavior}`);

  if (evidence?.motionMagnitude !== undefined) {
    lines.push(
      `- movement magnitude ${(evidence.motionMagnitude * 100).toFixed(1)}% of frame width per sample${
        evidence.motionMagnitude > 0.06 ? ' (very strong)' : evidence.motionMagnitude > 0.03 ? ' (strong)' : ' (mild)'
      }`,
    );
  }
  if (evidence?.motionContinues) lines.push('- movement continues into the incoming shot at a similar rate');
  if (evidence?.luminanceChange !== undefined && Math.abs(evidence.luminanceChange) > 0.05) {
    lines.push(
      `- the frame got ${evidence.luminanceChange > 0 ? 'brighter' : 'darker'} by ${Math.abs(evidence.luminanceChange * 100).toFixed(0)}% across the moment`,
    );
  }
  if (evidence?.detailLoss !== undefined && evidence.detailLoss > 0.02) {
    lines.push(`- fine detail drops by ${(evidence.detailLoss * 100).toFixed(0)}%, consistent with directional smear`);
  }
  for (const effect of event.effects ?? []) lines.push(`- ${effect.toLowerCase()}`);

  lines.push('', `Source aspect: ${video.width}x${video.height}`, `Target: ${RECREATE_PLATFORM_LABELS[platform]}`);
  return lines.join('\n');
}
