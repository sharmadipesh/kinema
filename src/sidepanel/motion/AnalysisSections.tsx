import { Chip } from '../../components/ui/Chip.tsx';
import { COVERAGE_LABELS } from '../../analysis/coverage.ts';
import {
  CATEGORY_LABELS,
  DIRECTION_LABELS,
  type AnalysisCoverage,
  type CoverageLevel,
  type EditRhythm,
  type MotionCategory,
  type MotionEvent,
  type MotionProfile,
  type ProductionBlueprint,
  type Scene,
} from '../../types/motion.ts';
import { formatClock, formatDuration, formatPreciseTime } from '../../utils/time.ts';

/**
 * The derived sections: shots, rhythm, movement, and what joins the shots.
 *
 * All four are arithmetic over measurements — nothing here was asked of a
 * model. They are collapsed by default because the timeline is the product and
 * these are the supporting argument, not competitors for the same attention.
 */

export function ScenesSection({ scenes, onSeek }: { scenes: Scene[]; onSeek(time: number): void }) {
  if (scenes.length < 2) return null;

  return (
    <Collapsible title="Shots" count={scenes.length}>
      <ol className="space-y-1">
        {scenes.map((scene) => (
          <li key={scene.id}>
            <button
              type="button"
              onClick={() => onSeek(scene.startTime)}
              className="flex w-full items-baseline gap-2 rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-[var(--mi-hover)]"
            >
              <span className="w-5 shrink-0 tabular text-2xs text-ink-subtle">{scene.index}</span>
              <span className="tabular text-2xs text-accent">{formatClock(scene.startTime)}</span>
              <span className="tabular text-2xs text-ink-muted">{formatDuration(scene.duration)}</span>
              <span className="ml-auto truncate text-2xs text-ink-subtle">
                {scene.dominantDirection
                  ? DIRECTION_LABELS[scene.dominantDirection]
                  : scene.motionLevel > 0.012
                    ? 'movement'
                    : 'static'}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Collapsible>
  );
}

export function RhythmSection({ rhythm, note }: { rhythm?: EditRhythm; note?: string }) {
  if (!rhythm) return null;

  const rows = [
    { label: 'Shots', value: String(rhythm.shotCount) },
    { label: 'Average shot', value: `${rhythm.averageShot.toFixed(2)}s` },
    { label: 'Shortest', value: `${rhythm.shortestShot.toFixed(2)}s` },
    { label: 'Longest', value: `${rhythm.longestShot.toFixed(2)}s` },
    { label: 'Cut frequency', value: `${rhythm.cutsPerMinute.toFixed(0)}/min · ${rhythm.density}` },
    ...(rhythm.fastestSectionStart !== undefined && rhythm.fastestSectionEnd !== undefined
      ? [
          {
            label: 'Densest section',
            value: `${formatClock(rhythm.fastestSectionStart)} – ${formatClock(rhythm.fastestSectionEnd)}`,
          },
        ]
      : []),
  ];

  return (
    <Collapsible title="Edit rhythm">
      <StatRows rows={rows} />
      {note ? <p className="mt-2 text-xs leading-relaxed text-ink-muted">{note}</p> : null}
    </Collapsible>
  );
}

export function MotionProfileSection({ profile }: { profile: MotionProfile }) {
  const measured =
    profile.translationEvents + profile.zoomEvents + profile.blurEvents + profile.rapidMotionEvents;
  if (measured === 0) return null;

  const rows = [
    ...(profile.dominantDirection
      ? [{ label: 'Dominant movement', value: DIRECTION_LABELS[profile.dominantDirection] }]
      : []),
    { label: 'Shots with movement', value: `${Math.round(profile.cameraMotionShare * 100)}%` },
    { label: 'Translations', value: String(profile.translationEvents) },
    { label: 'Zoom-like', value: String(profile.zoomEvents) },
    { label: 'Showing smear', value: String(profile.blurEvents) },
    ...(profile.rapidMotionEvents > 0
      ? [{ label: 'Beyond measurable speed', value: String(profile.rapidMotionEvents) }]
      : []),
  ];

  return (
    <Collapsible title="Motion profile">
      <StatRows rows={rows} />
    </Collapsible>
  );
}

export function TransitionsSection({
  events,
  activeCategory,
  onFilter,
}: {
  events: MotionEvent[];
  activeCategory: MotionCategory | null;
  onFilter(category: MotionCategory | null): void;
}) {
  const joins = events.filter((event) => event.role === 'primary' && (event.category === 'cut' || event.category === 'transition'));
  if (joins.length === 0) return null;

  const byType = new Map<string, { label: string; count: number; category: MotionCategory }>();
  for (const event of joins) {
    const key = event.type;
    const existing = byType.get(key);
    if (existing) existing.count += 1;
    else byType.set(key, { label: event.title.replace(/^(likely|possible)\s+/i, ''), count: 1, category: event.category });
  }

  return (
    <Collapsible title="Transitions" count={joins.length}>
      <ul className="space-y-0.5">
        {[...byType.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([type, entry]) => (
            <li key={type}>
              <button
                type="button"
                onClick={() => onFilter(activeCategory === entry.category ? null : entry.category)}
                aria-pressed={activeCategory === entry.category}
                className={[
                  'flex w-full items-baseline justify-between gap-2 rounded-xs px-1.5 py-1 text-left transition-colors',
                  activeCategory === entry.category ? 'bg-[var(--mi-accent-soft)]' : 'hover:bg-[var(--mi-hover)]',
                ].join(' ')}
              >
                <span className="truncate text-xs capitalize text-ink">{entry.label}</span>
                <span className="tabular text-2xs text-ink-subtle">{entry.count}</span>
              </button>
            </li>
          ))}
      </ul>
      <p className="mt-1.5 px-1.5 text-2xs text-ink-subtle">
        {CATEGORY_LABELS.cut} and {CATEGORY_LABELS.transition.toLowerCase()} only. Select one to filter the list.
      </p>
    </Collapsible>
  );
}

export function TypographySection({ events, onOpen }: { events: MotionEvent[]; onOpen(event: MotionEvent): void }) {
  const text = events.filter((event) => event.role === 'primary' && event.typography?.textDetected);
  if (text.length === 0) return null;

  return (
    <Collapsible title="Typography" count={text.length}>
      <ul className="space-y-1.5">
        {text.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => onOpen(event)}
              className="w-full rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-[var(--mi-hover)]"
            >
              <span className="flex items-baseline gap-2">
                <span className="tabular text-2xs text-accent">{formatPreciseTime(event.startTime)}</span>
                {event.typography?.content ? (
                  <span className="truncate text-xs font-medium text-ink">“{event.typography.content}”</span>
                ) : (
                  <span className="truncate text-xs text-ink-muted">Text</span>
                )}
              </span>
              {event.typography?.animationType ? (
                <span className="mt-0.5 block truncate text-2xs text-ink-subtle">{event.typography.animationType}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

/**
 * What the analysis managed to cover.
 *
 * Per-area rather than a single accuracy figure, because accuracy would require
 * knowing the right answer and any number here would be read as measured
 * however it were captioned. An area that could not be analysed says so.
 */
export function CoverageSection({
  coverage,
  unavailable = [],
}: {
  coverage?: AnalysisCoverage;
  /**
   * Sections the blueprint could not fill, and why.
   *
   * Surfaced here rather than only in Create, which is where they used to live
   * and where they were unreachable in the one state that produces them: a
   * failed blueprint empties exactly the fields the Create tab needs to appear,
   * so the tab was hidden and the explanation went with it. Overview is always
   * present, so a reason shown here is a reason the user can actually find.
   */
  unavailable?: ProductionBlueprint['unavailable'];
}) {
  if (!coverage && unavailable.length === 0) return null;

  const rows: Array<[string, CoverageLevel]> = coverage
    ? [
        ['Scenes', coverage.scenes],
        ['Transitions', coverage.transitions],
        ['Camera motion', coverage.cameraMotion],
        ['Typography', coverage.typography],
        ['Frame access', coverage.frameAccess],
      ]
    : [];

  return (
    <Collapsible title="Analysis coverage" badge={unavailable.length > 0 ? `${unavailable.length} gap${unavailable.length === 1 ? '' : 's'}` : undefined}>
      <dl className="space-y-1">
        {rows.map(([label, level]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd
              className={[
                'text-xs font-medium',
                level === 'complete' ? 'text-accent' : level === 'unavailable' ? 'text-caution' : 'text-ink',
              ].join(' ')}
            >
              {COVERAGE_LABELS[level]}
            </dd>
          </div>
        ))}
      </dl>
      {coverage && coverage.notes.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {coverage.notes.map((note) => (
            <li key={note} className="text-2xs leading-relaxed text-ink-subtle">
              {note}
            </li>
          ))}
        </ul>
      ) : null}

      {unavailable.length > 0 ? (
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-2xs font-medium uppercase tracking-wide text-caution">Not produced</p>
          <dl className="mt-1 space-y-1.5">
            {unavailable.map((entry) => (
              <div key={entry.section}>
                <dt className="text-2xs font-medium text-ink-muted">{entry.section}</dt>
                <dd className="text-2xs leading-relaxed text-ink-subtle">{entry.reason}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Collapsible>
  );
}

// -- Shared -------------------------------------------------------------------

function Collapsible({
  title,
  count,
  badge,
  children,
}: {
  title: string;
  count?: number;
  /** A worded chip, for states a bare number cannot express. */
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-md border border-line bg-surface-raised">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle marker:hidden">
        {title}
        {count !== undefined ? <Chip>{count}</Chip> : null}
        {badge ? <Chip>{badge}</Chip> : null}
        <span aria-hidden="true" className="ml-auto text-ink-subtle">
          ▾
        </span>
      </summary>
      <div className="border-t border-line px-2 py-2">{children}</div>
    </details>
  );
}

function StatRows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="space-y-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-ink-muted">{row.label}</dt>
          <dd className="tabular text-xs font-medium text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
