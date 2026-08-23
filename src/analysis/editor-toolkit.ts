import {
  CATEGORY_LABELS,
  DIRECTION_LABELS,
  EVENT_TYPE_LABELS,
  type EditRhythm,
  type EditorToolkit,
  type EnergyPoint,
  type MotionEvent,
  type Scene,
  type StoryStage,
} from '../types/motion.ts';
import { formatClock, formatDuration } from '../utils/time.ts';

/**
 * The parts of the editor toolkit that are arithmetic rather than opinion.
 *
 * A cut map, an edit map and a pacing breakdown are all restatements of data
 * already measured, and asking a model to produce them would be paying for a
 * worse copy of numbers we hold — plus every entry would then need checking
 * against the timeline it was supposed to describe. The model's contribution is
 * the judgement layer: workflow, priorities, mistakes, transition recipes.
 */

export function deriveEditMap(stages: StoryStage[], energy: EnergyPoint[]): EditorToolkit['editMap'] {
  return stages.map((stage) => {
    const inside = energy.filter((point) => point.startTime >= stage.startTime && point.endTime <= stage.endTime);
    const cuts = inside.reduce((sum, point) => sum + point.cuts, 0);
    const note =
      stage.shotCount === 0
        ? 'A single held shot.'
        : `${stage.shotCount} shot${stage.shotCount === 1 ? '' : 's'}, averaging ${stage.averageShot.toFixed(2)}s${
            cuts > 0 ? ` · ${cuts} cut${cuts === 1 ? '' : 's'}` : ''
          }.`;
    return { startTime: stage.startTime, endTime: stage.endTime, label: stage.name, note };
  });
}

/**
 * Every join, in order, with the kind of join it is.
 *
 * Secondary events are excluded: a whip pan's constituent camera run is not a
 * separate cut, and listing it would make the map disagree with the timeline.
 */
export function deriveCutMap(events: MotionEvent[]): EditorToolkit['cutMap'] {
  return events
    .filter((event) => event.role === 'primary' && (event.category === 'cut' || event.category === 'transition'))
    .sort((a, b) => a.startTime - b.startTime)
    .map((event) => ({
      time: event.startTime,
      type: event.type,
      label: event.direction
        ? `${EVENT_TYPE_LABELS[event.type]} · ${DIRECTION_LABELS[event.direction]}`
        : EVENT_TYPE_LABELS[event.type],
    }));
}

/** Pacing per story stage, described relative to this video's own range. */
export function derivePacing(stages: StoryStage[], rhythm?: EditRhythm): EditorToolkit['pacing'] {
  if (stages.length === 0) return [];
  const shots = stages.map((stage) => stage.averageShot).filter((value) => value > 0);
  const fastest = Math.min(...shots, Number.POSITIVE_INFINITY);
  const slowest = Math.max(...shots, 0);

  return stages.map((stage) => {
    const band =
      stage.averageShot <= 0
        ? 'Held'
        : shots.length < 2
          ? 'Steady'
          : stage.averageShot <= fastest * 1.15
            ? 'Very fast'
            : stage.averageShot >= slowest * 0.85
              ? 'Slower'
              : 'Fast';
    const reference = rhythm ? ` against a ${rhythm.averageShot.toFixed(2)}s average` : '';
    return {
      section: `${stage.name} · ${formatClock(stage.startTime)}–${formatClock(stage.endTime)}`,
      description:
        stage.averageShot > 0
          ? `${band}. Shots run about ${formatDuration(stage.averageShot)}${reference}.`
          : `${band}. No cuts inside this stretch.`,
    };
  });
}

/**
 * What production has to capture for the joins to be cuttable.
 *
 * Derived from the transitions that actually occur — a checklist that lists
 * whip-pan handles for an edit containing no whip pans is noise, and the editor
 * stops reading checklists that contain noise.
 */
export function deriveFootageChecklist(events: MotionEvent[], scenes: Scene[]): string[] {
  const primary = events.filter((event) => event.role === 'primary');
  const list: string[] = [];

  const has = (type: string): boolean => primary.some((event) => event.type === type);
  const category = (name: string): boolean => primary.some((event) => event.category === name);

  if (scenes.length > 2) list.push('Enough distinct setups to cover every shot in the edit.');
  if (has('whip_pan') || has('camera_pan')) {
    list.push('Lateral camera passes with movement running past the intended cut, not stopping on it.');
  }
  if (has('push_in') || has('zoom_in') || has('pull_out') || has('zoom_out')) {
    list.push('Push-in and pull-out versions of key shots, started before and held after the move.');
  }
  if (category('transition')) list.push('Extra movement handles at both ends of any shot feeding a transition.');
  if (category('text')) list.push('Clean frames with room for type, free of busy detail behind the text area.');
  if (has('match_cut') || has('cut_on_motion')) {
    list.push('Matching subject placement and screen direction across shots intended to cut together.');
  }
  if (primary.some((event) => event.evidence?.motionContinues)) {
    list.push('Incoming shots that already carry movement, so the cut lands mid-motion.');
  }
  list.push('A static alternative of each key setup, for edit flexibility.');

  return list;
}

/** Suggested only — no audio was analysed, and the copy says so in the UI. */
export function deriveSoundOpportunities(events: MotionEvent[]): EditorToolkit['soundOpportunities'] {
  const suggestion = (event: MotionEvent): string | null => {
    switch (event.category) {
      case 'transition':
        return event.direction ? 'Directional whoosh following the movement' : 'Short whoosh across the join';
      case 'cut':
        return 'Transient hit on the frame of the cut';
      case 'camera':
        return event.motion?.scaleChange === 'closer' ? 'Short riser into the push' : 'Low movement bed';
      case 'text':
        return 'Light tick or swell as the type lands';
      case 'effect':
        return 'Impact or sweetener on the flash';
      default:
        return null;
    }
  };

  return events
    .filter((event) => event.role === 'primary')
    .flatMap((event) => {
      const idea = suggestion(event);
      return idea
        ? [{ time: event.startTime, event: `${EVENT_TYPE_LABELS[event.type]} · ${CATEGORY_LABELS[event.category]}`, suggestion: idea }]
        : [];
    })
    .slice(0, 12);
}
