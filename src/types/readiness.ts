/**
 * Recreation readiness.
 *
 * The thing this replaces was a nine-row existence check that counted present
 * sections and reported `9/9` over an analysis that had a declared gap, no
 * frame for two of its stages, and no live video to seek. Every one of those is
 * a reason someone cannot recreate the video, and none of them moved the
 * number — because the number only ever asked "did a section come back".
 *
 * Four separate questions replace it, and they are separate because their
 * answers legitimately differ:
 *
 *   1. Is the analysis trustworthy enough to use?
 *   2. Is the plan ready to shoot?
 *   3. Is the editorial plan ready to cut?
 *   4. Is this ready to hand off?
 *
 * A percentage cannot express that, and worse, it lets eight satisfied rows
 * bury the one that makes the whole thing impossible. So the verdict is a word,
 * the blocker is named, and there is exactly one recommended next action.
 */

export type ReadinessState =
  /** Satisfied, and checked against real data. */
  | 'ready'
  /** Usable, but the user has to choose or confirm something. */
  | 'needs_input'
  /** Usable with a caveat that should be read before relying on it. */
  | 'warning'
  /** A critical prerequisite is missing or inconsistent. */
  | 'blocked'
  /** Not needed for the chosen way of working. */
  | 'optional'
  /** Genuinely not produced, and not something the user can fix here. */
  | 'unavailable';

export type ReadinessPhase = 'analysis' | 'story' | 'production' | 'footage' | 'edit' | 'audio' | 'delivery';

export const PHASE_LABELS: Record<ReadinessPhase, string> = {
  analysis: 'Analysis integrity',
  story: 'Story board',
  production: 'Production plan',
  footage: 'Footage',
  edit: 'Edit plan',
  audio: 'Audio',
  delivery: 'Delivery',
};

export type ReadinessImportance = 'critical' | 'required' | 'recommended' | 'optional';

export type ReadinessActionKind =
  | 'jump'
  | 'choose'
  | 'retry'
  | 'detect-video'
  | 'select-frame'
  | 'confirm'
  | 'export';

export interface ReadinessAction {
  label: string;
  kind: ReadinessActionKind;
  /**
   * Where the action lands. A tab name alone was the old behaviour and it was
   * not enough — being dropped at the top of Create with no idea which of nine
   * sections was the problem is barely better than no action at all. Targets
   * are `tab#section` so the view can scroll to and highlight the row.
   */
  target?: string;
}

export interface RecreationReadinessItem {
  id: string;
  phase: ReadinessPhase;
  title: string;
  state: ReadinessState;
  importance: ReadinessImportance;
  summary: string;
  /** Why it is in this state, when the summary alone would not explain it. */
  reason?: string;
  evidence?: string[];
  dependencies?: string[];
  action?: ReadinessAction;
  /**
   * False for anything the user asserted rather than the product measured.
   *
   * Rendered differently on purpose: "location secured" is a promise and "five
   * cuts measured" is a measurement, and one tick for both would flatten the
   * difference exactly where it matters most.
   */
  automaticallyEvaluated: boolean;
}

export type ReadinessVerdict =
  | 'blocked'
  | 'needs_decisions'
  | 'plan_ready'
  | 'ready_to_shoot'
  | 'ready_to_edit'
  | 'ready_to_deliver';

export const VERDICT_LABELS: Record<ReadinessVerdict, string> = {
  blocked: 'Blocked',
  needs_decisions: 'Needs decisions',
  plan_ready: 'Plan ready',
  ready_to_shoot: 'Ready to shoot',
  ready_to_edit: 'Ready to edit',
  ready_to_deliver: 'Ready to deliver',
};

export interface RecreationReadinessSummary {
  verdict: ReadinessVerdict;
  headline: string;
  blockers: string[];
  decisions: string[];
  warnings: string[];
  assumptions: string[];
  nextAction?: ReadinessAction;
}

export interface RecreationReadiness {
  summary: RecreationReadinessSummary;
  items: RecreationReadinessItem[];
}

/** Whether a state holds a verdict back. `optional` never does. */
export function holdsBack(item: RecreationReadinessItem): boolean {
  if (item.importance === 'optional' || item.state === 'optional') return false;
  return item.state === 'blocked' || item.state === 'needs_input';
}
