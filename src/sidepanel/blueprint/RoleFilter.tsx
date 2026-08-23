import { ANALYSIS_ROLES, ROLE_LABELS, type AnalysisRole } from '../../types/motion.ts';

/**
 * Whose read of the analysis this is.
 *
 * A filter over emphasis, not a set of separate screens. The same measurements
 * matter differently to a cinematographer and an editor, and building a screen
 * each would mean maintaining two versions of one truth — so the sections stay
 * identical and only their order and visibility change.
 */
export function RoleFilter({ role, onChange }: { role: AnalysisRole; onChange(role: AnalysisRole): void }) {
  return (
    /**
     * Wraps rather than scrolls.
     *
     * Six roles need about 405px of track and the panel gives them 294px at its
     * narrowest, so two of them — Motion designer and Colourist — sat off the
     * right edge with nothing on screen suggesting they existed. A horizontal
     * scroller only works when something signals that it scrolls; at this size
     * two short rows are simply better than a hidden one.
     */
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Read this analysis as">
      {ANALYSIS_ROLES.map((entry) => (
        <button
          key={entry}
          type="button"
          role="radio"
          aria-checked={role === entry}
          onClick={() => onChange(entry)}
          className={[
            'shrink-0 rounded-pill border px-2 py-0.5 text-2xs transition-colors duration-fast',
            role === entry
              ? 'border-[var(--mi-accent)] bg-[var(--mi-accent-soft)] text-accent'
              : 'border-line text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          {ROLE_LABELS[entry]}
        </button>
      ))}
    </div>
  );
}

/**
 * Which sections each role cares about, in the order they care about them.
 *
 * `all` returns undefined, meaning "leave everything in its natural order" —
 * the default view is not one role's opinion of the others.
 */
export const ROLE_PRIORITY: Partial<Record<AnalysisRole, string[]>> = {
  director: ['intent', 'topThree', 'direction', 'movement', 'composition', 'story', 'shotList', 'difficulty'],
  cinematographer: ['camera', 'lenses', 'stabilization', 'lighting', 'equipment', 'composition', 'shotList', 'shooting'],
  editor: ['editMap', 'cutMap', 'pacing', 'recipes', 'footage', 'workflow', 'priorities', 'sound', 'mistakes'],
  'motion-designer': ['typography', 'movement', 'recipes', 'composition', 'sound'],
  colorist: ['color', 'lighting', 'colorist', 'intent'],
};

/** True when a section should be shown for the selected role. */
export function showsFor(role: AnalysisRole, section: string): boolean {
  const priority = ROLE_PRIORITY[role];
  return !priority || priority.includes(section);
}

/** Lower sorts first. Sections a role did not name keep their natural order. */
export function rankFor(role: AnalysisRole, section: string): number {
  const priority = ROLE_PRIORITY[role];
  if (!priority) return 0;
  const index = priority.indexOf(section);
  return index === -1 ? priority.length : index;
}
