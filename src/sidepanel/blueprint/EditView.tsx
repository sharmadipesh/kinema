import type { AnalysisRole, MotionAnalysis, MotionEvent } from '../../types/motion.ts';
import { showsFor } from './RoleFilter.tsx';
import { MotionGraph } from './MotionGraph.tsx';
import { formatClock, formatPreciseTime } from '../../utils/time.ts';
import { Bullets, Numbered, Section } from './parts.tsx';
import { Unavailable } from './StoryView.tsx';

/**
 * Edit: what an editor receiving this footage tomorrow would need.
 *
 * The measured half — edit map, cut map, pacing, footage checklist, sound
 * opportunities — is arithmetic over the timeline and always present. The
 * written half is judgement and may be absent, in which case its section simply
 * does not appear rather than showing an empty heading.
 */
/**
 * Speed changes, with the phases an editor would have to rebuild.
 *
 * Only rendered when speed events were actually detected — a ramp guide on an
 * edit containing no ramps is noise, and an editor stops reading a panel that
 * contains noise. The structure comes from the measured velocity curve, so the
 * phase boundaries are where the movement really changes rather than a generic
 * normal → fast → normal template.
 */
function SpeedRamps({ events, onSeek }: { events: MotionEvent[]; onSeek(time: number): void }) {
  return (
    <Section title="Speed changes">
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="rounded-sm border border-line bg-surface-raised px-2 py-1.5">
            <button
              type="button"
              onClick={() => onSeek(event.startTime)}
              className="flex w-full items-baseline gap-2 text-left"
            >
              <span className="tabular shrink-0 text-2xs text-accent">
                {formatPreciseTime(event.startTime)}
                {event.endTime !== undefined ? ` → ${formatPreciseTime(event.endTime)}` : ''}
              </span>
              <span className="truncate text-xs font-medium text-ink">{event.title}</span>
            </button>

            {event.evidence?.motionCurve?.length ? (
              <div className="mt-1.5">
                <MotionGraph
                  curve={event.evidence.motionCurve}
                  {...(event.timing?.boundary !== undefined ? { boundaryTime: event.timing.boundary } : {})}
                />
              </div>
            ) : null}

            <p className="mt-1 text-2xs leading-relaxed text-ink-muted">{event.description}</p>
            {event.recreationHint ? (
              <p className="mt-1 text-2xs leading-relaxed text-ink-subtle">{event.recreationHint}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function EditView({
  analysis,
  role,
  onSeek,
}: {
  analysis: MotionAnalysis;
  role: AnalysisRole;
  onSeek(time: number): void;
}) {
  const toolkit = analysis.blueprint?.editorToolkit;
  const speedEvents = analysis.events.filter(
    (event) => event.role === 'primary' && event.category === 'speed',
  );

  if (!toolkit) {
    return (
      <Unavailable
        title="Editor toolkit unavailable"
        body="The toolkit is built from the shot structure and event list. Neither was produced for this analysis."
      />
    );
  }

  return (
    <div className="space-y-4">
      {showsFor(role, 'editMap') && toolkit.editMap.length > 0 ? (
        <Section
          title="Edit map"
          copy={toolkit.editMap.map((entry) => `${formatClock(entry.startTime)}–${formatClock(entry.endTime)} ${entry.label}: ${entry.note}`)}
        >
          <ol className="space-y-1">
            {toolkit.editMap.map((entry) => (
              <li key={entry.startTime}>
                <button
                  type="button"
                  onClick={() => onSeek(entry.startTime)}
                  className="w-full rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-[var(--mi-hover)]"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="tabular shrink-0 text-2xs text-accent">
                      {formatClock(entry.startTime)}–{formatClock(entry.endTime)}
                    </span>
                    <span className="text-xs font-medium text-ink">{entry.label}</span>
                  </span>
                  <span className="mt-0.5 block text-2xs text-ink-subtle">{entry.note}</span>
                </button>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {showsFor(role, 'cutMap') && toolkit.cutMap.length > 0 ? (
        <Section
          title="Cut map"
          copy={toolkit.cutMap.map((cut) => `${formatPreciseTime(cut.time)} ${cut.label}`)}
        >
          <ol className="space-y-0.5">
            {toolkit.cutMap.map((cut) => (
              <li key={`${cut.time}-${cut.type}`}>
                <button
                  type="button"
                  onClick={() => onSeek(cut.time)}
                  className="flex w-full items-baseline gap-2 rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-[var(--mi-hover)]"
                >
                  <span className="tabular shrink-0 text-2xs text-accent">{formatPreciseTime(cut.time)}</span>
                  <span className="truncate text-xs text-ink-muted">{cut.label}</span>
                </button>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {showsFor(role, 'pacing') && toolkit.pacing.length > 0 ? (
        <Section title="Pacing">
          <dl className="space-y-1.5">
            {toolkit.pacing.map((entry) => (
              <div key={entry.section}>
                <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{entry.section}</dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">{entry.description}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {speedEvents.length > 0 ? <SpeedRamps events={speedEvents} onSeek={onSeek} /> : null}

      {showsFor(role, 'recipes') && toolkit.transitionRecipes.length > 0 ? (
        <Section title="Transition recipes">
          <ul className="space-y-2">
            {toolkit.transitionRecipes.map((recipe) => (
              <li key={recipe.name} className="rounded-sm border border-line bg-surface-raised px-2 py-1.5">
                <p className="text-xs font-medium text-ink">{recipe.name}</p>
                {recipe.sourceFootage.length > 0 ? (
                  <>
                    <p className="mt-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Shoot</p>
                    <Bullets items={recipe.sourceFootage} />
                  </>
                ) : null}
                <p className="mt-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Cut point</p>
                <p className="mt-0.5 text-2xs text-ink-muted">{recipe.cutPoint}</p>
                <p className="mt-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Match</p>
                <p className="mt-0.5 text-2xs text-ink-muted">{recipe.editRequirement}</p>
                {recipe.post ? (
                  <>
                    <p className="mt-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Post</p>
                    <p className="mt-0.5 text-2xs text-ink-muted">{recipe.post}</p>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {showsFor(role, 'footage') && toolkit.footageChecklist.length > 0 ? (
        <Section title="Footage checklist" copy={toolkit.footageChecklist.map((item) => `- [ ] ${item}`)}>
          <ul className="mt-1 space-y-1">
            {toolkit.footageChecklist.map((item) => (
              <li key={item} className="flex gap-1.5 text-xs leading-relaxed text-ink-muted">
                <span aria-hidden="true" className="mt-[3px] h-[9px] w-[9px] shrink-0 rounded-[2px] border border-line-strong" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {showsFor(role, 'workflow') && toolkit.workflow.length > 0 ? (
        <Section title="Workflow" copy={toolkit.workflow.map((step, index) => `${index + 1}. ${step}`)}>
          <Numbered items={toolkit.workflow} />
        </Section>
      ) : null}

      {showsFor(role, 'priorities') && toolkit.priorities.length > 0 ? (
        <Section title="Get these right">
          <Numbered items={toolkit.priorities} />
        </Section>
      ) : null}

      {showsFor(role, 'typography') && toolkit.typographyNotes.length > 0 ? (
        <Section title="Typography">
          <Bullets items={toolkit.typographyNotes} />
        </Section>
      ) : null}

      {showsFor(role, 'colorist') && toolkit.coloristNotes.length > 0 ? (
        <Section title="Colourist notes">
          <Bullets items={toolkit.coloristNotes} />
        </Section>
      ) : null}

      {showsFor(role, 'sound') && toolkit.soundOpportunities.length > 0 ? (
        <Section title="Sound design opportunities">
          <ul className="space-y-0.5">
            {toolkit.soundOpportunities.map((entry) => (
              <li key={`${entry.time}-${entry.event}`}>
                <button
                  type="button"
                  onClick={() => onSeek(entry.time)}
                  className="flex w-full items-baseline gap-2 rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-[var(--mi-hover)]"
                >
                  <span className="tabular shrink-0 text-2xs text-accent">{formatPreciseTime(entry.time)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{entry.suggestion}</span>
                </button>
              </li>
            ))}
          </ul>
          {/*
            Suggestions, not findings. KINEMA analyses picture only; claiming
            these sounds are present would be inventing a whole modality.
          */}
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-subtle">
            Suggested placements based on the visual events. No audio was analysed.
          </p>
        </Section>
      ) : null}

      {showsFor(role, 'mistakes') && toolkit.mistakes.length > 0 ? (
        <Section title="Mistakes to avoid">
          <Bullets items={toolkit.mistakes} />
        </Section>
      ) : null}
    </div>
  );
}
