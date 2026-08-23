import type { EvidenceFrame } from '../../types/analysis.ts';
import { EXTENSION_VERSION } from '../../config.ts';
import type { MotionAnalysis, StoryStage } from '../../types/motion.ts';
import {
  applyStageEdit,
  editedFields,
  FOOTAGE_STATE_LABELS,
  RECREATION_MODE_LABELS,
  type ProjectRecord,
} from '../../types/project.ts';
import { csvRow } from '../../utils/download.ts';
import { formatClock } from '../../utils/time.ts';
import { boardToMarkdown } from './story-markdown.ts';
import { resolveStageFrame } from './story-frames.ts';

/**
 * The handoff pack.
 *
 * One rule governs all of it: **an export must not be more confident than the
 * panel it came from.** A board pasted into a brief travels further than the UI
 * that produced it, and a document that quietly drops "no frame captured" or
 * "lighting was not produced" will be read as complete by someone who never saw
 * the caveat. So every format below carries the same three things — the
 * measured/interpreted split, the unavailable sections, and a mark on anything
 * the user changed by hand.
 *
 * Deliberately not here: EDL, FCPXML and Premiere XML. Those need frame rate,
 * timebase and drop-frame handled correctly, and this product frequently cannot
 * measure frame rate at all. An interchange file with a guessed timebase is
 * worse than no interchange file, because an NLE will accept it.
 */

export interface HandoffContext {
  analysis: MotionAnalysis;
  project: ProjectRecord;
  frames: EvidenceFrame[];
  title: string;
  /** Passed in rather than read from a clock, so exports are reproducible. */
  generatedAt: number;
}

/** Stages with the user's corrections applied, in board order. */
function resolvedStages(context: HandoffContext): StoryStage[] {
  const stages = context.analysis.blueprint?.storyStages ?? [];
  return stages.map((stage) => applyStageEdit(stage, context.project.stageEdits[stage.id]));
}

function header(context: HandoffContext): string[] {
  const { analysis, project } = context;
  return [
    `- **Source**: ${context.title}`,
    `- **Duration**: ${formatClock(analysis.video.duration)} (${analysis.video.width}×${analysis.video.height})`,
    `- **Analysis version**: ${analysis.version} · KINEMA ${EXTENSION_VERSION}`,
    `- **Generated**: ${new Date(context.generatedAt).toISOString()}`,
    ...(project.mode ? [`- **Recreation mode**: ${RECREATION_MODE_LABELS[project.mode]}`] : []),
    ...(analysis.localOnly ? ['- **Note**: interpretation was unavailable; structure is measured only.'] : []),
  ];
}

// -- Markdown brief ----------------------------------------------------------

export function briefMarkdown(context: HandoffContext): string {
  const { analysis, project } = context;
  const blueprint = analysis.blueprint;
  const lines: string[] = [`# Recreation brief — ${context.title}`, '', ...header(context), ''];

  const brief = project.brief;
  const briefRows = [
    ['Platform', brief.platform],
    ['Aspect ratio', brief.aspectRatio],
    ['Target duration', brief.targetDurationSec ? `${brief.targetDurationSec}s` : undefined],
    ['Fidelity', brief.fidelity],
    ['Production tier', brief.tier],
    ['Crew size', brief.crewSize !== undefined ? String(brief.crewSize) : undefined],
    ['Equipment', brief.equipment],
    ['Editor', brief.editor],
    ['Footage', brief.footage],
    ['Audio', brief.audio],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (briefRows.length > 0) {
    lines.push('## Your brief', '', '_Supplied by you, not measured._', '');
    for (const [label, value] of briefRows) lines.push(`- **${label}**: ${value}`);
    lines.push('');
  }

  lines.push('## Measured structure', '');
  lines.push(`- Events: ${analysis.events.filter((event) => event.role === 'primary').length}`);
  lines.push(`- Shots: ${analysis.scenes.length}`);
  lines.push(`- Story stages: ${blueprint?.storyStages.length ?? 0}`);
  lines.push(`- Cuts mapped: ${blueprint?.editorToolkit?.cutMap.length ?? 0}`);

  if (blueprint?.creativeDirection.length) {
    lines.push('', '## Creative direction', '', '_Interpreted from sampled frames._', '');
    for (const entry of blueprint.creativeDirection) lines.push(`- ${entry}`);
  }
  if (blueprint?.equipment.length) {
    lines.push('', '## Equipment', '');
    for (const gear of blueprint.equipment) lines.push(`- **${gear.name}** (${gear.priority}) — ${gear.why}`);
  }
  if (blueprint?.shotList.length) {
    lines.push('', '## Shot list', '');
    for (const shot of blueprint.shotList) {
      lines.push(`${shot.index}. **${shot.shot}** — ${shot.durationTarget} · ${shot.use}`);
    }
  }

  const gaps = blueprint?.unavailable ?? [];
  if (gaps.length > 0) {
    lines.push('', '## Not produced', '');
    for (const gap of gaps) lines.push(`- **${gap.section}** — ${gap.reason}`);
  }

  const edited = Object.keys(project.stageEdits).length;
  if (edited > 0) {
    lines.push('', `_${edited} stage${edited === 1 ? '' : 's'} carry manual edits, marked in the board export._`);
  }

  return `${lines.join('\n')}\n`;
}

// -- Board -------------------------------------------------------------------

/** The board, with edits applied and manual changes named. */
export function boardMarkdownWithEdits(context: HandoffContext): string {
  const stages = resolvedStages(context);
  const withEdits: MotionAnalysis = {
    ...context.analysis,
    ...(context.analysis.blueprint
      ? { blueprint: { ...context.analysis.blueprint, storyStages: stages } }
      : {}),
  };

  const base = boardToMarkdown(withEdits, context.title);
  const notes: string[] = [];
  for (const stage of stages) {
    const fields = editedFields(context.project.stageEdits[stage.id]);
    if (fields.length > 0) notes.push(`- **${stage.name}** — edited by hand: ${fields.join(', ')}`);
    const note = context.project.stageEdits[stage.id]?.note;
    if (note) notes.push(`  - Note: ${note}`);
  }

  if (notes.length === 0) return base;
  return `${base}\n## Manual edits\n\n${notes.join('\n')}\n`;
}

// -- Cut list ----------------------------------------------------------------

/**
 * Markers as CSV.
 *
 * Timecode is left as measured seconds to three decimals rather than converted
 * to SMPTE. Converting needs a frame rate, which this product measures only for
 * uploads and refuses to guess elsewhere — and a marker list carrying a
 * confidently wrong timecode is exactly the sort of precision the rest of the
 * product declines to invent.
 */
export function cutListCsv(context: HandoffContext): string {
  const cuts = context.analysis.blueprint?.editorToolkit?.cutMap ?? [];
  const stages = resolvedStages(context);

  const rows = [csvRow(['Seconds', 'Timecode', 'Type', 'Label', 'Stage'])];
  for (const cut of cuts) {
    const stage = stages.find((entry) => cut.time >= entry.startTime && cut.time < entry.endTime);
    rows.push(csvRow([cut.time.toFixed(3), formatClock(cut.time), cut.type, cut.label, stage?.name ?? '']));
  }
  return `${rows.join('\n')}\n`;
}

export function footageCsv(context: HandoffContext): string {
  const checklist = context.analysis.blueprint?.editorToolkit?.footageChecklist ?? [];
  const rows = [csvRow(['Item', 'Status'])];
  for (const entry of checklist) {
    rows.push(csvRow([entry, FOOTAGE_STATE_LABELS[context.project.footage[entry] ?? 'unset']]));
  }
  return `${rows.join('\n')}\n`;
}

// -- JSON --------------------------------------------------------------------

/**
 * The interchange format, and the only lossless one.
 *
 * Carries the analysis and the user layer side by side rather than merged, so a
 * reimport can still tell which was measured and which was typed. Frames are
 * referenced by id and not inlined — a board of base64 JPEGs would be megabytes
 * and the frame store already holds them.
 */
export function handoffJson(context: HandoffContext): string {
  return `${JSON.stringify(
    {
      kind: 'kinema.handoff',
      formatVersion: 1,
      generatedAt: new Date(context.generatedAt).toISOString(),
      app: { name: 'KINEMA', version: EXTENSION_VERSION },
      title: context.title,
      analysis: context.analysis,
      // Kept separate on purpose: merging them would lose the distinction
      // between what was measured and what a person asserted.
      project: context.project,
      frameIds: context.frames.map((frame) => frame.id),
    },
    null,
    2,
  )}\n`;
}

// -- Contact sheet -----------------------------------------------------------

/**
 * A printable contact sheet.
 *
 * Self-contained HTML with the frames inlined as data URLs, because the file is
 * meant to be emailed or printed and a sheet whose images 404 outside the
 * extension would be useless. Stages with no frame print the reason rather than
 * an empty box, for the same reason the panel does.
 */
export function contactSheetHtml(context: HandoffContext): string {
  const stages = resolvedStages(context);
  const cells = stages
    .map((stage) => {
      const resolved = resolveStageFrame(stage, context.frames);
      const picture =
        resolved.kind === 'exact' || resolved.kind === 'nearby'
          ? `<img src="${resolved.frame.dataUrl}" alt="${escapeHtml(stage.name)}">`
          : `<div class="missing">${resolved.kind === 'evicted' ? 'Frame no longer stored' : 'No frame captured'}</div>`;
      const approximate = resolved.kind === 'nearby' ? `<p class="warn">Nearest frame, ${resolved.offsetSec.toFixed(1)}s away</p>` : '';
      const edited = editedFields(context.project.stageEdits[stage.id]);

      return `<figure>
  ${picture}
  <figcaption>
    <strong>${String(stage.index).padStart(2, '0')} · ${escapeHtml(stage.name)}</strong>
    <span class="time">${formatClock(stage.startTime)} – ${formatClock(stage.endTime)}</span>
    ${stage.purpose ? `<p>${escapeHtml(stage.purpose)}</p>` : ''}
    ${approximate}
    ${edited.length > 0 ? `<p class="manual">Edited by hand: ${edited.join(', ')}</p>` : ''}
  </figcaption>
</figure>`;
    })
    .join('\n');

  const gaps = context.analysis.blueprint?.unavailable ?? [];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Contact sheet — ${escapeHtml(context.title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 13px/1.5 -apple-system, system-ui, sans-serif; margin: 24px; color: #16161a; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #6a6a72; font-size: 12px; margin: 0 0 20px; }
  .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
  figure { margin: 0; border: 1px solid #e2e2e6; border-radius: 6px; overflow: hidden; break-inside: avoid; }
  img { display: block; width: 100%; aspect-ratio: 16/9; object-fit: cover; background: #f2f2f4; }
  .missing { display: grid; place-items: center; aspect-ratio: 16/9; background: #f2f2f4; color: #85858c; font-size: 11px; }
  figcaption { padding: 8px 10px 10px; }
  .time { display: block; color: #6a6a72; font-variant-numeric: tabular-nums; font-size: 11px; margin-top: 2px; }
  figcaption p { margin: 6px 0 0; font-size: 12px; color: #3d3d44; }
  .warn { color: #8a6d1f; }
  .manual { color: #4a4a80; font-style: italic; }
  .gaps { margin-top: 24px; border-top: 1px solid #e2e2e6; padding-top: 12px; }
  .gaps li { color: #6a6a72; font-size: 12px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${escapeHtml(context.title)}</h1>
<p class="meta">${formatClock(context.analysis.video.duration)} · ${stages.length} stages · analysis ${escapeHtml(context.analysis.version)} · generated ${new Date(context.generatedAt).toISOString().slice(0, 10)}</p>
<div class="sheet">
${cells}
</div>
${gaps.length > 0 ? `<div class="gaps"><strong>Not produced</strong><ul>${gaps.map((gap) => `<li><b>${escapeHtml(gap.section)}</b> — ${escapeHtml(gap.reason)}</li>`).join('')}</ul></div>` : ''}
</body>
</html>
`;
}

/**
 * Escaped because every one of these strings is model-written or site-supplied.
 * A video title is untrusted text, and this file is opened in a browser.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
