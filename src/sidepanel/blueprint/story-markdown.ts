import type { MotionAnalysis, ProductionBlueprint, StoryStage } from '../../types/motion.ts';
import { formatClock } from '../../utils/time.ts';

/**
 * The board as text an editor can paste into a brief.
 *
 * Pure and separately tested because the evidence contract has to survive the
 * export: measured structure (times, shot counts, energy) and interpreted
 * direction (purpose, mood, camera) are grouped under headings that say which
 * is which, and the suggestion-only sections say so in the document rather than
 * only in the UI they came from. A pasted board that drops the distinction is
 * worse than no export, because it travels.
 */

const MEASURED_NOTE = 'Times, shot counts and energy are measured from the video.';
const INTERPRETED_NOTE = 'Direction below is read from sampled frames, not metadata.';

export function stageToMarkdown(stage: StoryStage): string {
  const lines: string[] = [
    `### ${String(stage.index).padStart(2, '0')} · ${stage.name}`,
    '',
    `- **Time**: ${formatClock(stage.startTime)} – ${formatClock(stage.endTime)}`,
    `- **Shots**: ${stage.shotCount}${stage.averageShot > 0 ? ` (avg ${stage.averageShot.toFixed(2)}s)` : ''}`,
    `- **Energy**: ${Math.round(stage.energy * 100)}%`,
  ];

  const interpreted: Array<[string, string | undefined]> = [
    ['Purpose', stage.purpose],
    ['Mood', stage.mood],
    ['Composition', stage.composition],
    ['Camera', stage.camera],
    ['Movement', stage.movement],
    ['Lighting', stage.lighting],
    ['Colour', stage.color],
    ['Typography', stage.typography],
  ];
  const present = interpreted.filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (present.length > 0) {
    lines.push('', `_${INTERPRETED_NOTE}_`, '');
    for (const [label, value] of present) lines.push(`- **${label}**: ${value}`);
  }

  if (stage.shotSuggestion) {
    lines.push('', `**Frame concept** — ${stage.shotSuggestion}`);
  }
  if (stage.keywords?.length) {
    lines.push('', `**Reference search**: ${stage.keywords.join(' · ')}`);
  }

  return lines.join('\n');
}

export function boardToMarkdown(analysis: MotionAnalysis, title: string): string {
  const blueprint: ProductionBlueprint | undefined = analysis.blueprint;
  const stages = blueprint?.storyStages ?? [];

  const lines: string[] = [
    `# Story board — ${title}`,
    '',
    `Duration ${formatClock(analysis.video.duration)} · ${stages.length} stage${stages.length === 1 ? '' : 's'} · ${analysis.scenes.length} shots`,
    '',
    `_${MEASURED_NOTE}_`,
  ];

  if (analysis.localOnly) {
    lines.push('', '> Interpretation was unavailable for this analysis. Structure is measured; there is no technique reading.');
  }

  for (const stage of stages) lines.push('', stageToMarkdown(stage));

  /**
   * Read defensively rather than trusting the shape.
   *
   * The live validator guarantees these arrays, but this function also runs
   * over history entries written by older builds, and export is the wrong place
   * to throw: the user has already lost whatever produced the gap, and losing
   * the copy as well would be the second failure in a row.
   */
  const keywords = blueprint?.moodboardKeywords ?? [];
  if (keywords.length > 0) {
    lines.push('', '## Reference searches', '', ...keywords.map((word) => `- ${word}`));
  }

  // Carried into the export deliberately. A board pasted into a brief with
  // silent holes reads as complete; one that names its holes can be finished.
  const gaps = blueprint?.unavailable ?? [];
  if (gaps.length > 0) {
    lines.push('', '## Not produced', '');
    for (const entry of gaps) lines.push(`- **${entry.section}** — ${entry.reason}`);
  }

  return `${lines.join('\n')}\n`;
}
