import {
  DIRECTION_LABELS,
  type EditRhythm,
  type MotionAnalysis,
  type MotionProfile,
  type PaletteSwatch,
  type Scene,
  type StoryStage,
  type VideoMetadata,
} from '../types/motion.ts';
import { formatClock, formatDuration } from '../utils/time.ts';

/**
 * The production blueprint prompt.
 *
 * Written against one failure mode above all: equipment advice that could have
 * been produced without watching the video. "Camera, tripod, lights" is not
 * wrong, it is useless — it answers a question nobody asked and signals that
 * nothing was actually observed. So the instruction is not "recommend
 * equipment"; it is "derive the production requirements from these
 * measurements, then name what satisfies them, and say which observation
 * demanded each one".
 */

export const BLUEPRINT_SYSTEM_PROMPT = `You are a creative director, cinematographer and senior commercial editor writing a production blueprint from a reference video.

Someone is going to shoot and cut something in this visual language. Everything you write should be usable by them on set or in a timeline.

You are given real measurements: shot statistics, the movement profile, the story stages segmented from a measured energy curve, the colour palette counted from actual pixels, and the full event list. You are also given frames spread across the video.

HOW TO WORK:
1. Read the measurements and the frames, and infer the PRODUCTION REQUIREMENTS this style implies — how much the camera moves, whether subjects are tracked, how much light is available, whether shallow depth is in play, whether slow motion appears, how long shots run.
2. Only then name equipment that satisfies those requirements.
3. For every recommendation, say which observed characteristic of THIS reference demands it.

Rules:
- Generic equipment advice is a failure. "Camera, tripod, lights" could be written without watching anything. If you cannot tie a recommendation to an observation, leave it out and record the gap in \`unavailable\`.
- Recommend equipment CLASSES and CAPABILITIES, not products or brands.
- Never claim to know how the reference was shot. Frame rates, focal lengths, lighting setups and grades are all inferred from apparent characteristics — say so in the caveat fields.
- Never name real films, directors, brands or photographers as references. Describe the imagery instead.
- The shot statistics, cut map and pacing are already measured and rendered separately. Do not restate them; build on them.
- An empty section with a stated reason is worth more than a filled one with invented content.`;

export function buildBlueprintPrompt(input: {
  video: VideoMetadata;
  analysis: Pick<MotionAnalysis, 'overview' | 'events' | 'editingDNA'>;
  scenes: Scene[];
  rhythm?: EditRhythm;
  profile: MotionProfile;
  stages: StoryStage[];
  palette: PaletteSwatch[];
  globalSummary: string | null;
  sourceLabel: string;
  frameTimes: number[];
}): string {
  const lines: string[] = [
    `Source: ${input.sourceLabel}`,
    `Duration ${formatDuration(input.video.duration)} · ${input.video.width}x${input.video.height}${
      input.video.fps ? ` · ${input.video.fps.toFixed(1)} fps measured` : ''
    }`,
    '',
  ];

  if (input.globalSummary) lines.push('Editing context established earlier:', input.globalSummary, '');

  lines.push('MEASURED EDIT:');
  if (input.rhythm) {
    lines.push(
      `  ${input.rhythm.shotCount} shots · average ${input.rhythm.averageShot.toFixed(2)}s · shortest ${input.rhythm.shortestShot.toFixed(2)}s · longest ${input.rhythm.longestShot.toFixed(2)}s`,
      `  ${input.rhythm.cutsPerMinute.toFixed(1)} cuts per minute (${input.rhythm.density})`,
    );
  } else {
    lines.push('  too few shot boundaries to compute statistics');
  }
  lines.push(
    `  pacing ${input.analysis.overview.pacing} · ${input.analysis.overview.sceneChanges} cuts · ${input.analysis.overview.transitions} transitions · ${input.analysis.overview.textAnimations} type events · ${input.analysis.overview.cameraMovements} camera moves`,
    '',
  );

  lines.push('MEASURED MOVEMENT:');
  lines.push(
    `  ${Math.round(input.profile.cameraMotionShare * 100)}% of shots contain movement`,
    input.profile.dominantDirection
      ? `  dominant direction ${DIRECTION_LABELS[input.profile.dominantDirection]} across ${input.profile.dominantDirectionCount} moments`
      : '  no dominant direction measured',
    `  ${input.profile.translationEvents} translations · ${input.profile.zoomEvents} zoom-like · ${input.profile.blurEvents} showing detail smear · ${input.profile.rapidMotionEvents} beyond measurable speed`,
    '',
  );

  if (input.palette.length > 0) {
    lines.push(
      'MEASURED PALETTE (counted from sampled pixels — do not restate these values):',
      ...input.palette.map((swatch) => `  ${swatch.hex} · ${swatch.role} · ${(swatch.weight * 100).toFixed(0)}% of pixels`),
      '',
    );
  }

  lines.push('STORY STAGES (segmented from the measured energy curve — describe these, do not re-segment):');
  for (const stage of input.stages) {
    lines.push(
      `  [${stage.id}] ${stage.name} · ${formatClock(stage.startTime)}–${formatClock(stage.endTime)} · energy ${(stage.energy * 100).toFixed(0)}% · ${stage.shotCount} shots avg ${stage.averageShot.toFixed(2)}s${
        stage.dominantEventTypes.length ? ` · mostly ${stage.dominantEventTypes.join(', ')}` : ''
      }`,
    );
  }
  lines.push('');

  const primary = input.analysis.events.filter((event) => event.role === 'primary');
  lines.push(`EVENTS (${primary.length}):`);
  for (const event of primary.slice(0, 30)) {
    lines.push(
      `  ${formatClock(event.startTime)} ${event.type}${event.direction ? ` ${event.direction}` : ''} · ${event.certainty}`,
    );
  }

  lines.push(
    '',
    `${input.frameTimes.length} frames follow, spread across the video in chronological order.`,
    'Infer the production requirements from all of this, then write the blueprint.',
  );

  return lines.join('\n');
}
