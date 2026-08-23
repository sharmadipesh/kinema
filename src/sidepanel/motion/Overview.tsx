import { Meter } from '../../components/ui/Meter.tsx';
import { DNA_TRAITS, type MotionAnalysis } from '../../types/motion.ts';
import { formatClock } from '../../utils/time.ts';

const TRAIT_LABELS: Record<(typeof DNA_TRAITS)[number], string> = {
  pacing: 'Pacing',
  cuts: 'Cuts',
  motion: 'Motion',
  text: 'Text',
  transitions: 'Transitions',
  effects: 'Effects',
};

export function Overview({ analysis }: { analysis: MotionAnalysis }) {
  const { overview, video, editingDNA, stats } = analysis;

  const counts = [
    { label: 'Scene changes', value: overview.sceneChanges },
    { label: 'Transitions', value: overview.transitions },
    { label: 'Camera moves', value: overview.cameraMovements },
    { label: 'Text', value: overview.textAnimations },
  ];

  return (
    <section className="space-y-3" aria-label="Overview">
      <p className="text-sm leading-relaxed text-ink">{overview.summary}</p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {counts.map((entry) => (
          <div key={entry.label} className="flex items-baseline justify-between border-b border-line pb-1">
            <dt className="text-xs text-ink-muted">{entry.label}</dt>
            <dd className="tabular text-sm font-medium text-ink">{entry.value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
          Editing DNA
          <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-subtle/70">tap a row for why</span>
        </h3>
        {DNA_TRAITS.map((trait) => (
          <Meter
            key={trait}
            label={TRAIT_LABELS[trait]}
            value={editingDNA[trait].value}
            caption={editingDNA[trait].label}
            {...(editingDNA[trait].why ? { why: editingDNA[trait].why } : {})}
          />
        ))}
      </div>

      {/*
        Stated plainly rather than hidden. The product sampled a fraction of the
        video and showed the model a fraction of that — a user comparing this
        against their own frame-by-frame scrub deserves to know the resolution
        of what they are reading.
      */}
      <p className="text-2xs leading-relaxed text-ink-subtle">
        {stats.coarseFrames + stats.mediumFrames + stats.fineFrames} frames measured across{' '}
        {formatClock(video.duration)} · {stats.clusters} moments examined · {stats.framesSentToModel} frames interpreted
        {stats.modelCalls > 0 ? ` in ${stats.modelCalls} passes` : ''}
        {video.fps ? ` · ${video.fps.toFixed(1)} fps measured` : ''}
      </p>
    </section>
  );
}
