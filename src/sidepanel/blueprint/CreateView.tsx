import { Chip } from '../../components/ui/Chip.tsx';
import type { AnalysisRole, GearItem, GearPriority, MotionAnalysis, ProductionComplexity } from '../../types/motion.ts';
import { showsFor } from './RoleFilter.tsx';
import { Unavailable } from './StoryView.tsx';
import { Section, CopyButton, Numbered, Bullets } from './parts.tsx';

/**
 * Create: everything needed to shoot something in this language.
 *
 * Ordered the way a production actually decides — intent, then direction, then
 * what to point at it. Equipment comes last because gear chosen before the
 * requirements are understood is how a kit list ends up as "camera, tripod,
 * lights".
 */
export function CreateView({ analysis, role }: { analysis: MotionAnalysis; role: AnalysisRole }) {
  const blueprint = analysis.blueprint;

  if (!blueprint) {
    return (
      <Unavailable
        title="Creative direction unavailable"
        body="The production blueprint runs after motion interpretation. It was not produced for this analysis."
      />
    );
  }

  const gone = blueprint.unavailable;

  return (
    <div className="space-y-4">
      {showsFor(role, 'intent') && blueprint.creativeIntent ? (
        <Section title="Creative intent">
          <div className="flex flex-wrap gap-1">
            {blueprint.creativeIntent.labels.map((label) => (
              <Chip key={label} tone="accent">
                {label}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{blueprint.creativeIntent.why}</p>
          {/* Interpretation, and labelled as such — a mood is not a measurement. */}
          <p className="mt-1 text-2xs text-ink-subtle">An interpretation of the visual language, not a measurement.</p>
        </Section>
      ) : null}

      {showsFor(role, 'topThree') && blueprint.topThree.length > 0 ? (
        <section className="rounded-md border border-[var(--mi-accent)] bg-[var(--mi-accent-soft)] p-2.5">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-accent">If you only copy three things</h3>
          <ol className="mt-1.5 space-y-1.5">
            {blueprint.topThree.map((item, index) => (
              <li key={item} className="flex gap-2 text-xs leading-relaxed text-ink">
                <span className="tabular w-4 shrink-0 text-accent">{String(index + 1).padStart(2, '0')}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {showsFor(role, 'direction') && blueprint.creativeDirection.length > 0 ? (
        <Section title="Creative direction" copy={blueprint.creativeDirection}>
          <Bullets items={blueprint.creativeDirection} />
        </Section>
      ) : null}

      {showsFor(role, 'movement') && blueprint.movementLanguage.length > 0 ? (
        <Section title="Movement language">
          <Numbered items={blueprint.movementLanguage} />
        </Section>
      ) : null}

      {showsFor(role, 'composition') && blueprint.composition.length > 0 ? (
        <Section title="Composition">
          <Bullets items={blueprint.composition} />
        </Section>
      ) : null}

      {showsFor(role, 'shooting') && blueprint.shootingDirection.length > 0 ? (
        <Section title="How to shoot this" copy={blueprint.shootingDirection}>
          <Numbered items={blueprint.shootingDirection} />
        </Section>
      ) : null}

      {showsFor(role, 'shotList') && blueprint.shotList.length > 0 ? (
        <Section
          title="Shot list"
          copy={blueprint.shotList.map(
            (shot) => `${shot.index}. ${shot.shot}${shot.direction ? ` (${shot.direction})` : ''} — ${shot.durationTarget} — ${shot.use}`,
          )}
        >
          <ol className="space-y-1.5">
            {blueprint.shotList.map((shot) => (
              <li key={shot.index} className="rounded-sm border border-line bg-surface-raised px-2 py-1.5">
                <p className="text-xs font-medium text-ink">
                  <span className="tabular mr-1.5 text-ink-subtle">{String(shot.index).padStart(2, '0')}</span>
                  {shot.shot}
                </p>
                <p className="mt-0.5 text-2xs text-ink-subtle">
                  {shot.direction ? `${shot.direction} · ` : ''}
                  {shot.durationTarget} · {shot.use}
                </p>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {showsFor(role, 'camera') && blueprint.camera ? (
        <Section title="Camera plan">
          <p className="text-2xs text-ink-subtle">Priority: {blueprint.camera.priority}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{blueprint.camera.why}</p>

          <h4 className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Capabilities that matter</h4>
          <Bullets items={blueprint.camera.capabilities} />

          {blueprint.camera.suitableTypes.length > 0 ? (
            <>
              <h4 className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Suitable classes</h4>
              <div className="mt-1 flex flex-wrap gap-1">
                {blueprint.camera.suitableTypes.map((type) => (
                  <Chip key={type}>{type}</Chip>
                ))}
              </div>
            </>
          ) : null}

          {blueprint.camera.tiers.map((tier) => (
            <div key={tier.tier} className="mt-2 rounded-sm border border-line bg-surface-raised px-2 py-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-accent">{tier.tier}</p>
              <p className="mt-0.5 text-xs text-ink">{tier.setup.join(' + ')}</p>
              <p className="mt-0.5 text-2xs text-ink-subtle">Best for {tier.bestFor}</p>
            </div>
          ))}

          {blueprint.camera.frameRates.length > 0 ? (
            <>
              <h4 className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Frame rate</h4>
              <dl className="mt-1 space-y-1">
                {blueprint.camera.frameRates.map((entry) => (
                  <div key={entry.rate} className="flex items-baseline justify-between gap-3">
                    <dt className="tabular shrink-0 text-xs text-ink">{entry.rate}</dt>
                    <dd className="text-right text-2xs text-ink-muted">{entry.use}</dd>
                  </div>
                ))}
              </dl>
              {/* Recommendations, never a claim about the source footage. */}
              <p className="mt-1 text-2xs text-ink-subtle">
                Recommendations for reproducing this look — not what the reference was shot at.
              </p>
            </>
          ) : null}

          {blueprint.camera.settingsNotes.length > 0 ? (
            <>
              <h4 className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Settings</h4>
              <Bullets items={blueprint.camera.settingsNotes} />
            </>
          ) : null}
        </Section>
      ) : null}

      {showsFor(role, 'lenses') && blueprint.lenses ? (
        <Section title="Lens plan">
          <p className="text-xs leading-relaxed text-ink-muted">{blueprint.lenses.character}</p>
          <dl className="mt-1.5 space-y-1">
            {blueprint.lenses.ranges.map((entry) => (
              <div key={entry.range}>
                <dt className="text-xs font-medium text-ink">{entry.range}</dt>
                <dd className="text-2xs text-ink-muted">{entry.use}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-subtle">{blueprint.lenses.caveat}</p>
        </Section>
      ) : null}

      {showsFor(role, 'stabilization') && blueprint.stabilization ? (
        <Section title="Stabilisation">
          <ul className="space-y-1.5">
            {blueprint.stabilization.items.map((item) => (
              <li key={item.tool}>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-xs font-medium text-ink">{item.tool}</span>
                  <PriorityChip priority={item.priority} />
                </p>
                <p className="mt-0.5 text-2xs leading-relaxed text-ink-muted">{item.why}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {showsFor(role, 'equipment') && blueprint.equipment.length > 0 ? (
        <Section
          title="Production gear"
          copy={blueprint.equipment.map((item) => `${item.name} (${item.priority}) — ${item.why}`)}
        >
          <GearList items={blueprint.equipment} />
        </Section>
      ) : null}

      {showsFor(role, 'lighting') && blueprint.lighting ? (
        <Section title="Lighting">
          <div className="flex flex-wrap gap-1">
            {blueprint.lighting.character.map((entry) => (
              <Chip key={entry}>{entry}</Chip>
            ))}
          </div>
          {blueprint.lighting.setup.length > 0 ? (
            <>
              <h4 className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Suggested setup</h4>
              <Bullets items={blueprint.lighting.setup} />
            </>
          ) : null}
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-subtle">{blueprint.lighting.caveat}</p>
        </Section>
      ) : null}

      {showsFor(role, 'color') && blueprint.color ? (
        <Section title="Colour">
          {blueprint.color.palette.length > 0 ? (
            <>
              <div className="flex gap-1">
                {blueprint.color.palette.map((swatch) => (
                  <div key={swatch.hex} className="min-w-0 flex-1">
                    <div
                      className="h-9 w-full rounded-xs border border-line"
                      style={{ backgroundColor: swatch.hex }}
                      title={`${swatch.hex} · ${swatch.role}`}
                    />
                    <p className="tabular mt-1 truncate text-2xs text-ink-subtle">{swatch.hex}</p>
                  </div>
                ))}
              </div>
              {/* The one part of a moodboard that can be checked against the
                  footage: these were counted, not described. */}
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-subtle">
                Extracted by counting pixels across the sampled frames — representative, not the production's exact
                values.
              </p>
            </>
          ) : null}
          {blueprint.color.direction.length > 0 ? (
            <>
              <h4 className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Direction</h4>
              <Bullets items={blueprint.color.direction} />
            </>
          ) : null}
          {blueprint.color.guidance.length > 0 ? (
            <>
              <h4 className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Grading</h4>
              <Bullets items={blueprint.color.guidance} />
            </>
          ) : null}
        </Section>
      ) : null}

      {showsFor(role, 'difficulty') && blueprint.difficulty ? (
        <Section title="Difficulty">
          <p className="flex items-baseline gap-1.5">
            <Chip tone={blueprint.difficulty.level === 'advanced' ? 'caution' : 'default'}>
              {blueprint.difficulty.level}
            </Chip>
            <span className="text-xs text-ink-muted">{blueprint.difficulty.why}</span>
          </p>
        </Section>
      ) : null}

      {showsFor(role, 'difficulty') && blueprint.complexity ? (
        <Section title="Production complexity">
          <ComplexityRows complexity={blueprint.complexity} />
          {blueprint.complexity.note ? (
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-muted">{blueprint.complexity.note}</p>
          ) : null}
        </Section>
      ) : null}

      {blueprint.avoid.length > 0 ? (
        <Section title="Avoid">
          <Bullets items={blueprint.avoid} />
        </Section>
      ) : null}

      {/*
        A section KINEMA could not fill says so, with the reason. Silently
        omitting it makes the feature look broken, which is worse than an
        honest gap.
      */}
      {gone.length > 0 ? (
        <section className="rounded-md border border-dashed border-line px-2.5 py-2">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Not enough evidence for</h3>
          <ul className="mt-1 space-y-1">
            {gone.map((entry) => (
              <li key={entry.section} className="text-2xs leading-relaxed text-ink-muted">
                <span className="text-ink">{entry.section}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Four axes rather than one score.
 *
 * "Advanced" hides which part is hard, and a creator deciding whether to
 * attempt something needs to know whether the cost is crew, light, movement or
 * post — those have very different answers.
 */
function ComplexityRows({ complexity }: { complexity: ProductionComplexity }) {
  const rows: Array<[string, 'low' | 'moderate' | 'high']> = [
    ['Crew', complexity.crew],
    ['Lighting', complexity.lighting],
    ['Camera movement', complexity.cameraMovement],
    ['Post-production', complexity.post],
  ];
  const filled = { low: 1, moderate: 2, high: 3 } as const;

  return (
    <dl className="space-y-1">
      {rows.map(([label, level]) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <dt className="text-xs text-ink-muted">{label}</dt>
          <dd className="flex items-center gap-1.5">
            <span className="flex gap-[2px]" aria-hidden="true">
              {[1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={[
                    'h-[9px] w-[10px] rounded-[1px]',
                    step <= filled[level] ? 'bg-accent' : 'bg-[var(--mi-track)]',
                  ].join(' ')}
                />
              ))}
            </span>
            <span className="w-14 text-right text-2xs capitalize text-ink">{level}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

const PRIORITY_TONE: Record<GearPriority, 'accent' | 'default' | 'caution'> = {
  required: 'accent',
  recommended: 'default',
  optional: 'default',
};

function PriorityChip({ priority }: { priority: GearPriority }) {
  return <Chip tone={PRIORITY_TONE[priority]}>{priority}</Chip>;
}

/** Grouped by category so a kit list reads like one. */
function GearList({ items }: { items: GearItem[] }) {
  const grouped = new Map<string, GearItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.category);
    if (existing) existing.push(item);
    else grouped.set(item.category, [item]);
  }

  return (
    <div className="space-y-2">
      {[...grouped.entries()].map(([category, entries]) => (
        <div key={category}>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{category}</h4>
          <ul className="mt-1 space-y-1.5">
            {entries.map((item) => (
              <li key={item.name} className="rounded-sm border border-line bg-surface-raised px-2 py-1.5">
                <p className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 text-xs font-medium text-ink">{item.name}</span>
                  <PriorityChip priority={item.priority} />
                </p>
                <p className="mt-0.5 text-2xs leading-relaxed text-ink-muted">{item.why}</p>
                {item.alternatives?.length ? (
                  <p className="mt-0.5 text-2xs text-ink-subtle">Instead: {item.alternatives.join(' · ')}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export { CopyButton };
