import { useEffect, useState } from 'react';
import { BackIcon, PlayIcon } from '../../components/Icons.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Chip } from '../../components/ui/Chip.tsx';
import type { EvidenceFrame } from '../../types/analysis.ts';
import {
  CATEGORY_LABELS,
  DIRECTION_LABELS,
  EVENT_TYPE_LABELS,
  type MotionEvent,
  type RecreateGuide,
  type RecreatePlatform,
} from '../../types/motion.ts';
import { formatDuration, formatPreciseTime } from '../../utils/time.ts';
import { EvidenceFrames } from './EvidenceFrames.tsx';
import { RecreatePanel } from './RecreatePanel.tsx';

/**
 * One event, in full.
 *
 * The ordering is the argument: what was measured, then what it looked like,
 * then what the model made of it, then how to do it yourself. A reader who
 * distrusts the classification can stop after the frames and still have got
 * something true out of the product.
 */
export function EventDetail({
  event,
  frames,
  onBack,
  onJump,
  onRecreate,
}: {
  event: MotionEvent;
  frames: EvidenceFrame[];
  onBack(): void;
  onJump(): Promise<boolean>;
  onRecreate(platform: RecreatePlatform): Promise<RecreateGuide>;
}) {
  const [jumpFailed, setJumpFailed] = useState(false);
  useEffect(() => setJumpFailed(false), [event.id]);

  const span = event.endTime !== undefined ? event.endTime - event.startTime : null;
  const evidence = event.evidence;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Type', value: EVENT_TYPE_LABELS[event.type] },
    { label: 'Category', value: CATEGORY_LABELS[event.category] },
    // Reported as approximate because it is: the span is the width of the
    // window that stayed elevated, at the fine pass's sampling interval.
    ...(span !== null ? [{ label: 'Duration', value: `~${formatDuration(span)}` }] : []),
    ...(event.direction ? [{ label: 'Direction', value: DIRECTION_LABELS[event.direction] }] : []),
    { label: 'Confidence', value: `${Math.round(event.confidence * 100)}%` },
  ];

  return (
    <div className="space-y-3.5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded-xs py-0.5 text-xs text-ink-muted transition-colors hover:text-ink"
      >
        <BackIcon size={12} />
        All events
      </button>

      <header>
        <p className="tabular text-xs font-medium text-accent">{formatPreciseTime(event.startTime)}</p>
        <h2 className="mt-0.5 text-md font-semibold leading-snug text-ink">{event.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{event.description}</p>
      </header>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="primary"
          size="sm"
          icon={<PlayIcon size={9} />}
          onClick={() => {
            setJumpFailed(false);
            void onJump().then((ok) => setJumpFailed(!ok));
          }}
        >
          Jump to timestamp
        </Button>
        <Chip tone={event.certainty === 'detected' ? 'accent' : 'default'}>
          {event.certainty === 'detected' ? 'Measured' : 'Inferred'}
        </Chip>
      </div>
      {jumpFailed ? (
        <p role="status" className="text-2xs text-critical">
          The video did not respond to that jump. It may have been replaced or removed.
        </p>
      ) : null}

      <dl className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-line pb-1">
            <dt className="text-xs text-ink-muted">{row.label}</dt>
            <dd className="text-xs font-medium text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>

      {event.effects?.length ? (
        <section>
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Observed effects</h3>
          <div className="flex flex-wrap gap-1">
            {event.effects.map((effect) => (
              <Chip key={effect}>{effect}</Chip>
            ))}
          </div>
        </section>
      ) : null}

      <EvidenceFrames frames={frames} />

      {/*
        Measurements, kept apart from the interpretation above them and shown
        only where they were actually computed. A zero here would read as a
        fact; an absent row reads as what it is.
      */}
      {evidence ? (
        <section>
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Measured signals</h3>
          <dl className="space-y-1">
            {evidence.visualChangeScore !== undefined ? (
              <Signal label="Frame difference" value={evidence.visualChangeScore.toFixed(3)} />
            ) : null}
            {evidence.histogramDistance !== undefined ? (
              <Signal label="Tonal shift" value={evidence.histogramDistance.toFixed(3)} />
            ) : null}
            {evidence.motionMagnitude !== undefined ? (
              <Signal
                label="Motion magnitude"
                value={`${(evidence.motionMagnitude * 100).toFixed(1)}% of frame width`}
              />
            ) : null}
            {evidence.luminanceChange !== undefined ? (
              <Signal
                label="Brightness change"
                value={`${evidence.luminanceChange > 0 ? '+' : ''}${(evidence.luminanceChange * 100).toFixed(0)}%`}
              />
            ) : null}
            {evidence.sampleIntervalSec !== undefined ? (
              <Signal label="Sample interval" value={formatDuration(evidence.sampleIntervalSec)} />
            ) : null}
          </dl>
        </section>
      ) : null}

      <RecreatePanel onRequest={onRecreate} />
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-2xs text-ink-subtle">{label}</dt>
      <dd className="tabular text-2xs text-ink-muted">{value}</dd>
    </div>
  );
}
