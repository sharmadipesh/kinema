import type { EvidenceFrame } from '../types/analysis.ts';
import type { MotionAnalysis } from '../types/motion.ts';
import type { ProjectRecord, RecreationMode } from '../types/project.ts';
import { CONFIRMABLE_LABELS, type Confirmable } from '../types/project.ts';
import {
  holdsBack,
  type ReadinessAction,
  type ReadinessImportance,
  type ReadinessState,
  type RecreationReadiness,
  type RecreationReadinessItem,
  type ReadinessVerdict,
} from '../types/readiness.ts';
import { checkConsistency, type ConsistencyFinding } from './consistency.ts';
import { resolveStageFrame } from '../sidepanel/blueprint/story-frames.ts';

/**
 * Whether this analysis can actually be turned back into a video.
 *
 * The rule that shapes everything below: **importance depends on what the user
 * is doing.** A missing lighting plan is irrelevant to someone studying an edit
 * and required for someone shooting it; unanalysed audio is a footnote for a
 * picture study and a blocker for cutting to music. One fixed set of weights
 * has to be wrong for three of the four modes, so the weights are a function of
 * the mode and the mode is asked for rather than assumed.
 *
 * Two invariants hold regardless:
 *
 *  - An `optional` row never affects the verdict. Gear suggestions cannot make
 *    a board look broken, and cannot make a broken board look ready.
 *  - A single `blocked` critical row outranks any number of satisfied ones.
 *    The old counter reported `9/9` over an analysis with a declared gap, and
 *    burying the one thing that makes recreation impossible is the specific
 *    failure this replaces.
 */

export interface ReadinessInput {
  analysis: MotionAnalysis;
  frames: EvidenceFrame[];
  project: ProjectRecord;
  /** Whether a live video is bound and seekable. False for history entries. */
  canSeek: boolean;
}

/** How much each mode cares about each area. `null` means "not applicable". */
type WeightKey =
  | 'events' | 'shots' | 'story' | 'frames' | 'coverage' | 'creative' | 'camera'
  | 'lighting' | 'equipment' | 'shotList' | 'cuts' | 'transitions' | 'footage'
  | 'audio' | 'tier' | 'duration' | 'source';

/**
 * Exhaustive by key, so adding an area forces every mode to state its opinion.
 * A missing entry would silently drop the row rather than fail the build, which
 * is the quiet way a readiness engine stops checking something.
 */
type Weights = Record<WeightKey, ReadinessImportance | null>;

const MODE_WEIGHTS: Record<RecreationMode, Weights> = {
  study: {
    events: 'critical',
    shots: 'required',
    story: 'required',
    frames: 'recommended',
    coverage: 'required',
    creative: 'optional',
    camera: 'optional',
    lighting: 'optional',
    equipment: 'optional',
    shotList: 'optional',
    cuts: 'recommended',
    transitions: 'recommended',
    footage: null,
    audio: 'optional',
    tier: null,
    duration: null,
    source: 'recommended',
  },
  shoot: {
    events: 'critical',
    shots: 'required',
    story: 'critical',
    frames: 'required',
    coverage: 'recommended',
    creative: 'required',
    camera: 'required',
    lighting: 'required',
    equipment: 'required',
    shotList: 'required',
    cuts: 'recommended',
    transitions: 'recommended',
    footage: 'recommended',
    audio: 'recommended',
    tier: 'required',
    duration: 'optional',
    source: 'optional',
  },
  edit: {
    events: 'critical',
    shots: 'required',
    story: 'required',
    frames: 'recommended',
    coverage: 'recommended',
    creative: 'optional',
    camera: 'optional',
    lighting: 'optional',
    equipment: 'optional',
    shotList: 'optional',
    cuts: 'critical',
    transitions: 'required',
    footage: 'critical',
    audio: 'required',
    tier: null,
    duration: 'optional',
    source: 'recommended',
  },
  cutdown: {
    events: 'critical',
    shots: 'required',
    story: 'critical',
    frames: 'required',
    coverage: 'recommended',
    creative: 'optional',
    camera: null,
    lighting: null,
    equipment: null,
    shotList: 'optional',
    cuts: 'required',
    transitions: 'recommended',
    footage: 'required',
    audio: 'required',
    tier: null,
    duration: 'critical',
    source: 'recommended',
  },
};

export function deriveRecreationReadiness(input: ReadinessInput): RecreationReadiness {
  const mode = input.project.mode;

  // Without a mode there is no honest way to weigh anything, so the engine says
  // exactly that rather than picking one and quietly grading against it.
  if (!mode) return awaitingMode(input);

  const weights = MODE_WEIGHTS[mode];
  const items = [
    ...analysisItems(input, weights),
    ...storyItems(input, weights),
    ...productionItems(input, weights),
    ...footageItems(input, weights),
    ...editItems(input, weights),
    ...audioItems(input, weights, mode),
    ...deliveryItems(input, weights),
    ...confirmationItems(input, mode),
  ].filter((item): item is RecreationReadinessItem => item !== null);

  return { summary: summarise(items, mode), items };
}

// -- Phases ------------------------------------------------------------------

function analysisItems(input: ReadinessInput, weights: Weights): Array<RecreationReadinessItem | null> {
  const { analysis, frames } = input;
  const primaries = analysis.events.filter((event) => event.role === 'primary');
  const findings = checkConsistency({ analysis, frames });
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');

  return [
    item({
      id: 'analysis.events',
      phase: 'analysis',
      title: 'Motion analysis',
      importance: weights.events,
      state: primaries.length > 0 ? 'ready' : 'blocked',
      summary:
        primaries.length > 0
          ? `${primaries.length} measured events on the timeline.`
          : 'No events were detected, so there is nothing to rebuild from.',
      action: { label: 'Open timeline', kind: 'jump', target: 'overview#timeline' },
    }),
    item({
      id: 'analysis.shots',
      phase: 'analysis',
      title: 'Shot structure',
      importance: weights.shots,
      state: analysis.scenes.length > 1 ? 'ready' : 'warning',
      summary:
        analysis.scenes.length > 1
          ? `${analysis.scenes.length} shots segmented.`
          : 'No shot boundaries were found — this reads as one continuous take.',
      action: { label: 'Open shots', kind: 'jump', target: 'overview#shots' },
    }),
    // Consistency is the one row that can be blocked by something the user did
    // not do and cannot see anywhere else in the panel.
    errors.length > 0 || warnings.length > 0
      ? item({
          id: 'analysis.consistency',
          phase: 'analysis',
          title: 'Structural consistency',
          importance: 'critical',
          state: errors.length > 0 ? 'blocked' : 'warning',
          summary: errors.length > 0 ? errors[0]!.detail : warnings[0]!.detail,
          reason: findingsReason(findings),
          evidence: findings.map((finding) => finding.title),
          action: { label: 'Repair story board', kind: 'jump', target: 'story#stages' },
        })
      : item({
          id: 'analysis.consistency',
          phase: 'analysis',
          title: 'Structural consistency',
          importance: 'critical',
          state: 'ready',
          summary: 'Stages, timings, frames and cut markers all agree.',
        }),
    coverageItem(input, weights),
    input.canSeek
      ? item({
          id: 'analysis.source',
          phase: 'analysis',
          title: 'Live source',
          importance: weights.source,
          state: 'ready',
          summary: 'The analysed video is attached, so timestamps can be jumped to.',
        })
      : item({
          id: 'analysis.source',
          phase: 'analysis',
          title: 'Live source',
          importance: weights.source,
          state: 'warning',
          summary: 'No live video is attached, so timestamps cannot be scrubbed.',
          reason: 'The plan is complete and usable; only playback control is unavailable.',
          action: { label: 'Detect the video again', kind: 'detect-video' },
        }),
  ];
}

function coverageItem(input: ReadinessInput, weights: Weights): RecreationReadinessItem | null {
  const coverage = input.analysis.coverage;
  if (!coverage) return null;

  const unavailable = Object.entries(coverage).filter(([key, value]) => key !== 'notes' && value === 'unavailable');
  const partial = Object.entries(coverage).filter(([key, value]) => key !== 'notes' && value === 'partial');

  const state: ReadinessState = unavailable.length > 0 ? 'warning' : partial.length > 0 ? 'warning' : 'ready';
  return item({
    id: 'analysis.coverage',
    phase: 'analysis',
    title: 'Analysis coverage',
    importance: weights.coverage,
    state,
    summary:
      state === 'ready'
        ? 'Every area was analysed.'
        : `${unavailable.length + partial.length} area${unavailable.length + partial.length === 1 ? '' : 's'} were only partly covered.`,
    ...(coverage.notes.length > 0 ? { evidence: coverage.notes } : {}),
    action: { label: 'Read coverage', kind: 'jump', target: 'overview#coverage' },
  });
}

function storyItems(input: ReadinessInput, weights: Weights): Array<RecreationReadinessItem | null> {
  const stages = input.analysis.blueprint?.storyStages ?? [];

  if (stages.length === 0) {
    return [
      item({
        id: 'story.stages',
        phase: 'story',
        title: 'Story board',
        importance: weights.story,
        state: 'unavailable',
        summary: 'No story arc was segmented.',
        reason: 'The energy curve did not vary enough across shots to identify separate beats.',
      }),
    ];
  }

  // Frames are checked against the store, not against the stage claiming one.
  const missing = stages.filter((stage) => {
    const resolved = resolveStageFrame(stage, input.frames);
    return resolved.kind === 'none' || resolved.kind === 'evicted';
  });
  const approximate = stages.filter((stage) => resolveStageFrame(stage, input.frames).kind === 'nearby');

  return [
    item({
      id: 'story.stages',
      phase: 'story',
      title: 'Story board',
      importance: weights.story,
      state: 'ready',
      summary: `${stages.length} stages covering the full running time.`,
      action: { label: 'Open story board', kind: 'jump', target: 'story#stages' },
    }),
    item({
      id: 'story.frames',
      phase: 'story',
      title: 'Representative frames',
      importance: weights.frames,
      state: missing.length === 0 ? (approximate.length > 0 ? 'warning' : 'ready') : 'needs_input',
      summary:
        missing.length > 0
          ? `${missing.length} of ${stages.length} stages have no usable frame.`
          : approximate.length > 0
            ? `${approximate.length} stage${approximate.length === 1 ? '' : 's'} are showing a nearby frame rather than their own.`
            : `All ${stages.length} stages have their own captured frame.`,
      ...(missing.length > 0
        ? { reason: 'A visual board without frames cannot be used to brief a shoot or a stock search.' }
        : {}),
      ...(missing.length > 0 ? { evidence: missing.map((stage) => stage.name) } : {}),
      action:
        missing.length > 0
          ? { label: 'Choose frames', kind: 'select-frame', target: 'story#stages' }
          : { label: 'Open story board', kind: 'jump', target: 'story#stages' },
    }),
    approvalItem(input, stages.length),
  ];
}

function approvalItem(input: ReadinessInput, total: number): RecreationReadinessItem | null {
  const approved = Object.values(input.project.stageEdits).filter((edit) => edit.approved).length;
  if (approved >= total) {
    return item({
      id: 'story.approval',
      phase: 'story',
      title: 'Stage review',
      importance: 'recommended',
      state: 'ready',
      summary: `All ${total} stages reviewed and approved.`,
      automaticallyEvaluated: false,
    });
  }
  return item({
    id: 'story.approval',
    phase: 'story',
    title: 'Stage review',
    importance: 'recommended',
    // Recommended, never blocking: an unreviewed board is still a usable board.
    state: 'needs_input',
    summary: `${approved} of ${total} stages approved.`,
    automaticallyEvaluated: false,
    action: { label: 'Review stages', kind: 'confirm', target: 'story#stages' },
  });
}

function productionItems(input: ReadinessInput, weights: Weights): Array<RecreationReadinessItem | null> {
  const blueprint = input.analysis.blueprint;
  const gaps = blueprint?.unavailable ?? [];
  const gapFor = (section: string): string | undefined =>
    gaps.find((entry) => entry.section.toLowerCase().includes(section))?.reason;

  return [
    planItem('production.creative', 'Creative direction', weights.creative, (blueprint?.creativeDirection.length ?? 0) > 0, gapFor('creative'), 'create#direction'),
    planItem('production.shotList', 'Shot list', weights.shotList, (blueprint?.shotList.length ?? 0) > 0, gapFor('shot list'), 'create#shot-list'),
    /**
     * Camera is not "an object came back".
     *
     * The old check was `Boolean(blueprint.camera)`, which ticked for a plan
     * with no stated reason and no tiers — exactly the spec-sheet advice the
     * validator already refuses to render. Ready here means it is usable.
     */
    cameraItem(input, weights, gapFor('camera')),
    planItem('production.lighting', 'Lighting plan', weights.lighting, (blueprint?.lighting?.setup.length ?? 0) > 0, gapFor('light'), 'create#lighting'),
    planItem('production.equipment', 'Equipment', weights.equipment, (blueprint?.equipment.length ?? 0) > 0, gapFor('equipment'), 'create#equipment'),
    tierItem(input, weights),
  ];
}

function cameraItem(input: ReadinessInput, weights: Weights, gap: string | undefined): RecreationReadinessItem | null {
  const camera = input.analysis.blueprint?.camera;
  const usable = Boolean(camera && camera.capabilities.length > 0 && camera.why);
  const tiers = camera?.tiers?.length ?? 0;

  if (!usable) {
    return item({
      id: 'production.camera',
      phase: 'production',
      title: 'Camera plan',
      importance: weights.camera,
      state: gap ? 'unavailable' : 'unavailable',
      summary: 'No usable camera plan was produced.',
      reason: gap ?? 'A camera plan needs stated capabilities and a reason each one is required.',
      action: { label: 'Retry the plan', kind: 'retry', target: 'create' },
    });
  }

  return item({
    id: 'production.camera',
    phase: 'production',
    title: 'Camera plan',
    importance: weights.camera,
    state: tiers > 0 ? 'ready' : 'warning',
    summary:
      tiers > 0
        ? `${camera!.capabilities.length} capabilities across ${tiers} budget tier${tiers === 1 ? '' : 's'}.`
        : `${camera!.capabilities.length} capabilities, but no budget tiers to choose between.`,
    action: { label: 'Open camera plan', kind: 'jump', target: 'create#camera' },
  });
}

function tierItem(input: ReadinessInput, weights: Weights): RecreationReadinessItem | null {
  if (weights.tier === null) return null;
  const chosen = input.project.brief.tier;
  const tiers = input.analysis.blueprint?.camera?.tiers ?? [];
  if (tiers.length === 0) return null;

  return item({
    id: 'production.tier',
    phase: 'production',
    title: 'Production tier',
    importance: weights.tier,
    state: chosen ? 'ready' : 'needs_input',
    summary: chosen
      ? `Planning at the ${chosen} tier.`
      : `The plan offers ${tiers.length} tiers, but none is selected.`,
    automaticallyEvaluated: Boolean(chosen) === false ? false : false,
    action: { label: 'Choose a tier', kind: 'choose', target: 'brief#tier' },
  });
}

function footageItems(input: ReadinessInput, weights: Weights): Array<RecreationReadinessItem | null> {
  if (weights.footage === null) return [];
  const checklist = input.analysis.blueprint?.editorToolkit?.footageChecklist ?? [];

  if (checklist.length === 0) {
    return [
      item({
        id: 'footage.checklist',
        phase: 'footage',
        title: 'Footage requirements',
        importance: weights.footage,
        state: 'unavailable',
        summary: 'No footage checklist was produced.',
        reason: 'It is derived from the event list and shot structure, and neither yielded requirements.',
      }),
    ];
  }

  const states = checklist.map((entry) => input.project.footage[entry] ?? 'unset');
  const unset = states.filter((state) => state === 'unset').length;
  const needed = states.filter((state) => state === 'needs-capture').length;

  return [
    item({
      id: 'footage.checklist',
      phase: 'footage',
      title: 'Footage requirements',
      importance: weights.footage,
      state: unset > 0 ? 'needs_input' : needed > 0 ? 'warning' : 'ready',
      summary:
        unset > 0
          ? `${unset} of ${checklist.length} items have no status yet.`
          : needed > 0
            ? `${needed} item${needed === 1 ? '' : 's'} still need capturing.`
            : `All ${checklist.length} items are accounted for.`,
      automaticallyEvaluated: false,
      action: { label: 'Set footage status', kind: 'confirm', target: 'edit#footage' },
    }),
  ];
}

function editItems(input: ReadinessInput, weights: Weights): Array<RecreationReadinessItem | null> {
  const toolkit = input.analysis.blueprint?.editorToolkit;
  const cuts = toolkit?.cutMap.length ?? 0;
  const recipes = toolkit?.transitionRecipes.length ?? 0;
  const duration = input.analysis.video.duration;
  const inside = (toolkit?.cutMap ?? []).every((cut) => cut.time >= 0 && cut.time <= duration + 0.05);

  return [
    item({
      id: 'edit.cuts',
      phase: 'edit',
      title: 'Cut map',
      importance: weights.cuts,
      state: cuts > 0 && inside ? 'ready' : cuts > 0 ? 'blocked' : 'unavailable',
      summary:
        cuts === 0
          ? 'No cuts were mapped.'
          : inside
            ? `${cuts} measured cuts, all inside the source duration.`
            : `${cuts} cuts mapped, but some fall outside the video.`,
      action: { label: 'Open cut map', kind: 'jump', target: 'edit#cut-map' },
    }),
    item({
      id: 'edit.transitions',
      phase: 'edit',
      title: 'Transition instructions',
      importance: weights.transitions,
      state: recipes > 0 ? 'ready' : 'unavailable',
      summary:
        recipes > 0
          ? `${recipes} transition recipe${recipes === 1 ? '' : 's'} with cut points and match requirements.`
          : 'No transition recipes were produced.',
      action: { label: 'Open transitions', kind: 'jump', target: 'edit#transitions' },
    }),
    durationItem(input, weights),
  ];
}

function durationItem(input: ReadinessInput, weights: Weights): RecreationReadinessItem | null {
  if (weights.duration === null) return null;
  const target = input.project.brief.targetDurationSec;
  return item({
    id: 'delivery.duration',
    phase: 'edit',
    title: 'Target duration',
    importance: weights.duration,
    state: target ? 'ready' : 'needs_input',
    summary: target
      ? `Cutting to ${target}s from a ${Math.round(input.analysis.video.duration)}s reference.`
      : 'No target duration set, so no beat can be marked removable.',
    automaticallyEvaluated: false,
    action: { label: 'Set target duration', kind: 'choose', target: 'brief#duration' },
  });
}

/**
 * Audio, told truthfully.
 *
 * Nothing here was measured — KINEMA analyses picture only — so the row exists
 * to say so in the terms of whatever the user is doing, rather than to report a
 * result. It is a footnote for a picture study and a blocker for a music-led
 * cut, and the same sentence would be wrong for one of them.
 */
function audioItems(input: ReadinessInput, weights: Weights, mode: RecreationMode): Array<RecreationReadinessItem | null> {
  const status = input.project.brief.audio;
  const needsMusic = mode === 'edit' || mode === 'cutdown';

  if (needsMusic && !status) {
    return [
      item({
        id: 'audio.status',
        phase: 'audio',
        title: 'Audio',
        importance: weights.audio,
        state: 'needs_input',
        summary: 'No audio was analysed, and no audio status has been set.',
        reason: 'Cutting to music needs a track decided before pacing can be trusted.',
        automaticallyEvaluated: false,
        action: { label: 'Set audio status', kind: 'choose', target: 'brief#audio' },
      }),
    ];
  }

  return [
    item({
      id: 'audio.status',
      phase: 'audio',
      title: 'Audio',
      importance: weights.audio,
      state: mode === 'study' ? 'optional' : 'warning',
      summary: 'No audio was analysed. Sound-design notes are inferred from visual events only.',
      reason: 'KINEMA reads picture. It does not detect beats, dialogue or music.',
      ...(status ? { evidence: [`You marked audio as: ${status}`] } : {}),
      action: { label: 'Set audio status', kind: 'choose', target: 'brief#audio' },
    }),
  ];
}

function deliveryItems(input: ReadinessInput, weights: Weights): Array<RecreationReadinessItem | null> {
  const stages = input.analysis.blueprint?.storyStages ?? [];
  return [
    item({
      id: 'delivery.export',
      phase: 'delivery',
      title: 'Handoff pack',
      importance: 'recommended',
      state: stages.length > 0 ? 'ready' : 'unavailable',
      summary:
        stages.length > 0
          ? 'Board, cut list, footage checklist and brief can be exported.'
          : 'There is no board to export yet.',
      action: { label: 'Export', kind: 'export', target: 'story#export' },
    }),
    weights.duration === null
      ? null
      : item({
          id: 'delivery.aspect',
          phase: 'delivery',
          title: 'Delivery format',
          importance: 'recommended',
          state: input.project.brief.aspectRatio ? 'ready' : 'needs_input',
          summary: input.project.brief.aspectRatio
            ? `Delivering ${input.project.brief.aspectRatio}.`
            : 'No aspect ratio set, so reframing risk cannot be assessed.',
          automaticallyEvaluated: false,
          action: { label: 'Set aspect ratio', kind: 'choose', target: 'brief#aspect' },
        }),
  ];
}

/**
 * The things only a person can answer.
 *
 * Marked `automaticallyEvaluated: false` throughout, and rendered apart, so a
 * promise never wears the same tick as a measurement.
 */
function confirmationItems(input: ReadinessInput, mode: RecreationMode): Array<RecreationReadinessItem | null> {
  const needed: Confirmable[] =
    mode === 'shoot'
      ? ['location', 'talent', 'equipment']
      : mode === 'edit'
        ? ['footage-captured', 'music-licensed']
        : mode === 'cutdown'
          ? ['delivery-spec']
          : [];

  return needed.map((key) =>
    item({
      id: `confirm.${key}`,
      phase: mode === 'edit' ? 'footage' : 'production',
      title: CONFIRMABLE_LABELS[key],
      importance: 'recommended',
      state: input.project.confirmations[key] ? 'ready' : 'needs_input',
      summary: input.project.confirmations[key] ? 'Confirmed by you.' : 'Not confirmed yet.',
      reason: input.project.confirmations[key] ? undefined : 'KINEMA cannot check this — only you can.',
      automaticallyEvaluated: false,
      action: { label: 'Confirm', kind: 'confirm', target: `brief#${key}` },
    }),
  );
}

// -- Verdict -----------------------------------------------------------------

/**
 * Precedence, in the order the spec requires:
 * corrupted data → missing evidence → required decision → missing plan →
 * recommended confirmation → export.
 */
const ACTION_RANK: Record<string, number> = {
  'analysis.consistency': 0,
  'analysis.events': 1,
  'story.frames': 2,
  'edit.cuts': 3,
  'footage.checklist': 4,
  'production.tier': 5,
  'delivery.duration': 5,
  'audio.status': 5,
  'production.camera': 6,
  'production.lighting': 6,
  'production.equipment': 6,
  'story.approval': 7,
  'delivery.export': 9,
};

function summarise(items: RecreationReadinessItem[], mode: RecreationMode): RecreationReadiness['summary'] {
  const blockers = items.filter((entry) => entry.state === 'blocked' && entry.importance !== 'optional');
  const decisions = items.filter((entry) => entry.state === 'needs_input' && holdsBack(entry));
  const warnings = items.filter((entry) => entry.state === 'warning' && entry.importance !== 'optional');
  const unavailable = items.filter((entry) => entry.state === 'unavailable');

  const critical = decisions.filter((entry) => entry.importance === 'critical' || entry.importance === 'required');

  const verdict: ReadinessVerdict =
    blockers.length > 0
      ? 'blocked'
      : critical.length > 0
        ? 'needs_decisions'
        : mode === 'study'
          ? 'plan_ready'
          : mode === 'shoot'
            ? 'ready_to_shoot'
            : mode === 'edit'
              ? 'ready_to_edit'
              : 'ready_to_deliver';

  const candidates = [...blockers, ...decisions, ...warnings].sort(
    (a, b) => (ACTION_RANK[a.id] ?? 8) - (ACTION_RANK[b.id] ?? 8),
  );
  const next = candidates.find((entry) => entry.action)?.action ?? exportAction(items);

  return {
    verdict,
    headline: headlineFor(verdict, blockers, decisions),
    blockers: blockers.map((entry) => entry.summary),
    decisions: decisions.map((entry) => entry.summary),
    warnings: warnings.map((entry) => entry.summary),
    assumptions: unavailable.map((entry) => entry.reason ?? entry.summary),
    ...(next ? { nextAction: next } : {}),
  };
}

function headlineFor(
  verdict: ReadinessVerdict,
  blockers: RecreationReadinessItem[],
  decisions: RecreationReadinessItem[],
): string {
  if (verdict === 'blocked') {
    const first = blockers[0];
    return first ? first.summary : 'Something critical is missing.';
  }
  if (verdict === 'needs_decisions') {
    const count = decisions.length;
    return `The plan is usable. ${count} decision${count === 1 ? '' : 's'} left before it is complete.`;
  }
  return 'Everything required for this way of working is in place.';
}

function exportAction(items: RecreationReadinessItem[]): ReadinessAction | undefined {
  return items.find((entry) => entry.id === 'delivery.export' && entry.state === 'ready')?.action;
}

/** Before a mode is chosen there is nothing honest to grade against. */
function awaitingMode(input: ReadinessInput): RecreationReadiness {
  const stages = input.analysis.blueprint?.storyStages.length ?? 0;
  return {
    summary: {
      verdict: 'needs_decisions',
      headline: 'Choose what you are doing with this reference, and KINEMA will check what it needs.',
      blockers: [],
      decisions: ['No recreation mode selected.'],
      warnings: [],
      assumptions: [],
      nextAction: { label: 'Choose a mode', kind: 'choose', target: 'brief#mode' },
    },
    items: [
      {
        id: 'brief.mode',
        phase: 'analysis',
        title: 'Recreation mode',
        state: 'needs_input',
        importance: 'critical',
        summary: 'Studying, shooting, editing and cutting down need different things to be ready.',
        reason: 'Grading against a mode you did not pick would report a readiness that is not yours.',
        automaticallyEvaluated: false,
        action: { label: 'Choose a mode', kind: 'choose', target: 'brief#mode' },
      },
      {
        id: 'analysis.summary',
        phase: 'analysis',
        title: 'Analysis',
        state: 'ready',
        importance: 'required',
        summary: `${input.analysis.events.filter((event) => event.role === 'primary').length} events, ${input.analysis.scenes.length} shots, ${stages} story stages.`,
        automaticallyEvaluated: true,
      },
    ],
  };
}

// -- Construction ------------------------------------------------------------

/** Drops the row entirely when the mode has no use for it. */
function item(input: {
  id: string;
  phase: RecreationReadinessItem['phase'];
  title: string;
  importance: ReadinessImportance | null | undefined;
  state: ReadinessState;
  summary: string;
  reason?: string | undefined;
  evidence?: string[];
  dependencies?: string[];
  action?: ReadinessAction;
  automaticallyEvaluated?: boolean;
}): RecreationReadinessItem | null {
  if (input.importance === null || input.importance === undefined) return null;

  // An optional row is reported, never counted. This is the guarantee that a
  // gear suggestion can never outrank a broken board.
  const state = input.importance === 'optional' && input.state !== 'ready' ? 'optional' : input.state;

  return {
    id: input.id,
    phase: input.phase,
    title: input.title,
    state,
    importance: input.importance,
    summary: input.summary,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.evidence?.length ? { evidence: input.evidence } : {}),
    ...(input.dependencies?.length ? { dependencies: input.dependencies } : {}),
    ...(input.action ? { action: input.action } : {}),
    automaticallyEvaluated: input.automaticallyEvaluated ?? true,
  };
}

function planItem(
  id: string,
  title: string,
  importance: ReadinessImportance | null | undefined,
  present: boolean,
  gap: string | undefined,
  target: string,
): RecreationReadinessItem | null {
  return item({
    id,
    phase: 'production',
    title,
    importance,
    state: present ? 'ready' : 'unavailable',
    summary: present ? 'Produced and ready to read.' : 'Not produced.',
    reason: present ? undefined : (gap ?? 'The blueprint did not return this section.'),
    action: present
      ? { label: `Open ${title.toLowerCase()}`, kind: 'jump', target }
      : { label: 'Retry the plan', kind: 'retry', target: target.split('#')[0] ?? 'create' },
  });
}

function findingsReason(findings: ConsistencyFinding[]): string {
  return findings.length === 1
    ? 'One structural problem was found.'
    : `${findings.length} structural problems were found.`;
}
