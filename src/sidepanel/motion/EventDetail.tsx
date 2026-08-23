import { useEffect, useState } from 'react';
import { BackIcon, PlayIcon } from '../../components/Icons.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Chip } from '../../components/ui/Chip.tsx';
import type { EvidenceFrame } from '../../types/analysis.ts';
import { DEBUG } from '../../config.ts';
import {
  CATEGORY_LABELS,
  CONTINUITY_LABELS,
  DIRECTION_LABELS,
  EVENT_TYPE_LABELS,
  type MotionEvent,
  type RecreateGuide,
  type RecreatePlatform,
} from '../../types/motion.ts';
import { formatDuration, formatPreciseTime } from '../../utils/time.ts';
import { MotionGraph } from '../blueprint/MotionGraph.tsx';
import { Filmstrip } from './Filmstrip.tsx';
import { Progression } from './Progression.tsx';
import { RecreatePanel } from './RecreatePanel.tsx';

/**
 * One event, in full.
 *
 * The ordering is the argument: what happened, then when, then how it moved,
 * then the frames themselves, then why the product thinks so, then why the
 * technique works, and only then how to do it yourself. A reader who distrusts
 * the classification can stop after the filmstrip and still have got something
 * true out of the product — which is the property that makes the rest of it
 * worth reading.
 */
export function EventDetail({
  event,
  secondaries,
  frames,
  onBack,
  onJump,
  onSeek,
  onRecreate,
}: {
  event: MotionEvent;
  secondaries: MotionEvent[];
  frames: EvidenceFrame[];
  onBack(): void;
  onJump(): Promise<boolean>;
  onSeek(time: number): void;
  onRecreate(platform: RecreatePlatform): Promise<RecreateGuide>;
}) {
  const [jumpFailed, setJumpFailed] = useState(false);
  useEffect(() => setJumpFailed(false), [event.id]);

  const span = event.endTime !== undefined ? event.endTime - event.startTime : null;
  const evidence = event.evidence;

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
        <p className="tabular text-xs font-medium text-accent">
          {formatPreciseTime(event.startTime)}
          {event.endTime !== undefined ? ` → ${formatPreciseTime(event.endTime)}` : ''}
        </p>
        <h2 className="mt-0.5 text-md font-semibold leading-snug text-ink">{event.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {event.explanations?.detailed ?? event.description}
        </p>
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
        <Chip tone={event.certainty === 'detected' ? 'accent' : event.certainty === 'likely' ? 'default' : 'caution'}>
          {event.certainty === 'detected' ? 'Measured' : event.certainty === 'likely' ? 'Likely' : 'Possible'}
        </Chip>
        <Chip>{Math.round(event.confidence * 100)}%</Chip>
      </div>
      {jumpFailed ? (
        <p role="status" className="text-2xs text-critical">
          The video did not respond to that jump. It may have been replaced or removed.
        </p>
      ) : null}

      {/* Timing. Every value approximate, and marked so — the sampler resolves
          to tens of milliseconds, not to frames. */}
      <dl className="space-y-1">
        <Row label="Type" value={EVENT_TYPE_LABELS[event.type]} />
        <Row label="Category" value={CATEGORY_LABELS[event.category]} />
        {event.timing?.peak !== undefined ? (
          <Row label="Peak movement" value={formatPreciseTime(event.timing.peak)} />
        ) : null}
        {event.timing?.boundary !== undefined ? (
          <Row label="Change lands" value={formatPreciseTime(event.timing.boundary)} />
        ) : event.peakTime !== undefined ? (
          <Row label="Peak" value={formatPreciseTime(event.peakTime)} />
        ) : null}
        {span !== null ? <Row label="Duration" value={`~${formatDuration(span)}`} /> : null}
        {event.direction ? <Row label="Direction" value={DIRECTION_LABELS[event.direction]} /> : null}
        {event.motion?.speed ? <Row label="Speed" value={capitalise(event.motion.speed)} /> : null}
        {event.motion?.magnitude ? <Row label="Intensity" value={capitalise(event.motion.magnitude)} /> : null}
        {evidence?.motionContinues !== undefined ? (
          <Row label="After the change" value={evidence.motionContinues ? 'Movement continues' : 'Movement stops'} />
        ) : null}
      </dl>

      {event.observation ? <Progression observation={event.observation} /> : null}

      {event.evidence?.motionCurve?.length ? (
        <MotionGraph
          curve={event.evidence.motionCurve}
          {...(event.timing?.boundary !== undefined ? { boundaryTime: event.timing.boundary } : {})}
        />
      ) : null}

      <Filmstrip frames={frames} {...(event.peakTime !== undefined ? { peakTime: event.peakTime } : {})} onSeek={onSeek} />

      {event.continuity ? (
        <Section title="Across the cut">
          {event.continuity.measured ? (
            <p className="flex items-baseline gap-1.5 text-xs leading-relaxed text-ink">
              <Chip tone="accent">Measured</Chip>
              {CONTINUITY_LABELS[event.continuity.measured]}
            </p>
          ) : null}
          {/* Kept separate on purpose: a matched subject is beyond anything the
              pixel measurements can see, so it is the model's reading and says
              so rather than borrowing the authority of a measurement. */}
          {event.continuity.interpreted ? (
            <p className="mt-1 flex items-baseline gap-1.5 text-xs leading-relaxed text-ink-muted">
              <Chip>Inferred</Chip>
              {CONTINUITY_LABELS[event.continuity.interpreted]}
            </p>
          ) : null}
          {event.continuity.note ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{event.continuity.note}</p>
          ) : null}
        </Section>
      ) : null}

      {event.transition ? (
        <Section title="How the join is built">
          <dl className="space-y-1.5">
            {event.transition.outgoingBehavior ? <Prose label="Outgoing" value={event.transition.outgoingBehavior} /> : null}
            {event.transition.transitionMoment ? <Prose label="At the join" value={event.transition.transitionMoment} /> : null}
            {event.transition.incomingBehavior ? <Prose label="Incoming" value={event.transition.incomingBehavior} /> : null}
          </dl>
        </Section>
      ) : null}

      {event.typography?.textDetected ? (
        <Section title="Typography">
          {event.typography.content ? (
            <p className="mb-1.5 text-sm font-medium text-ink">“{event.typography.content}”</p>
          ) : null}
          <dl className="space-y-1.5">
            {event.typography.animationType ? <Prose label="Animation" value={event.typography.animationType} /> : null}
            {event.typography.entrance ? <Prose label="Entrance" value={event.typography.entrance} /> : null}
            {event.typography.exit ? <Prose label="Exit" value={event.typography.exit} /> : null}
          </dl>
        </Section>
      ) : null}

      {event.camera ? (
        <Section title="Camera">
          <dl className="space-y-1.5">
            {event.camera.movement ? <Prose label="Movement" value={event.camera.movement} /> : null}
            {event.camera.intensity ? <Prose label="Intensity" value={capitalise(event.camera.intensity)} /> : null}
            {/* Named rather than resolved: an optical zoom, a digital scale and
                a physical push are indistinguishable in pixels. */}
            {event.camera.ambiguity ? <Prose label="Cannot be told apart" value={event.camera.ambiguity} /> : null}
          </dl>
        </Section>
      ) : null}

      {event.effects?.length ? (
        <Section title="Observed effects">
          <div className="flex flex-wrap gap-1">
            {event.effects.map((effect) => (
              <Chip key={effect}>{effect}</Chip>
            ))}
          </div>
        </Section>
      ) : null}

      {event.whyDetected ? (
        <Section title="Why this was detected">
          <p className="text-xs leading-relaxed text-ink-muted">{event.whyDetected}</p>
        </Section>
      ) : null}

      {event.whyItWorks ? (
        <Section title="Why it works">
          <p className="text-xs leading-relaxed text-ink">{event.whyItWorks}</p>
        </Section>
      ) : null}

      {secondaries.length > 0 ? (
        <Section title="Also measured here">
          <ul className="space-y-1">
            {secondaries.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-muted">{entry.title}</span>
                <span className="tabular text-2xs text-ink-subtle">{formatPreciseTime(entry.startTime)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* Measurements, kept apart from the interpretation above them and shown
          only where they were actually computed. */}
      {evidence ? (
        <Section title="Measured signals">
          <dl className="space-y-1">
            {evidence.visualChangeScore !== undefined ? (
              <Signal label="Frame difference" value={evidence.visualChangeScore.toFixed(3)} />
            ) : null}
            {evidence.histogramDistance !== undefined ? (
              <Signal label="Tonal shift" value={evidence.histogramDistance.toFixed(3)} />
            ) : null}
            {evidence.colorChange !== undefined ? (
              <Signal label="Colour shift" value={evidence.colorChange.toFixed(3)} />
            ) : null}
            {evidence.motionMagnitude !== undefined ? (
              <Signal label="Motion magnitude" value={`${(evidence.motionMagnitude * 100).toFixed(1)}% of frame width`} />
            ) : null}
            {evidence.detailLoss !== undefined ? (
              <Signal label="Detail lost" value={`${(evidence.detailLoss * 100).toFixed(0)}%`} />
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
        </Section>
      ) : null}

      {/*
        Development only. `DEBUG` is a build-time constant, so this whole block
        — and the diagnostics it reads — is dead code in a production bundle and
        is removed entirely. Confidence that cannot be taken apart is a number
        the team cannot improve.
      */}
      {DEBUG && event.diagnostics ? (
        <details className="rounded-md border border-dashed border-line px-2.5 py-2">
          <summary className="cursor-pointer text-2xs font-semibold uppercase tracking-wide text-caution">
            Inspector (dev)
          </summary>
          <dl className="mt-2 space-y-1">
            <Signal label="Candidate kind" value={event.diagnostics.candidateKind} />
            <Signal label="Candidate strength" value={event.diagnostics.candidateStrength.toFixed(3)} />
            <Signal label="Candidate quality" value={event.diagnostics.candidateQuality.toFixed(3)} />
            <Signal label="Model confidence" value={event.diagnostics.confidence.modelConfidence.toFixed(3)} />
            <Signal label="Claim agreement" value={event.diagnostics.confidence.claimAgreement.toFixed(3)} />
            <Signal label="Hypothesis margin" value={event.diagnostics.confidence.hypothesisMargin.toFixed(3)} />
            <Signal label="Evidence ceiling" value={event.diagnostics.confidence.evidenceCeiling.toFixed(3)} />
            <Signal label="Final" value={event.diagnostics.confidence.final.toFixed(3)} />
            <Signal label="Merged from" value={event.diagnostics.mergedFrom.join(', ') || 'nothing'} />
            <Signal label="Fine samples" value={String(event.diagnostics.sampleTimes.length)} />
          </dl>

          {event.diagnostics.hypotheses.length > 0 ? (
            <div className="mt-2 border-t border-line pt-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Alternatives considered</p>
              <ul className="mt-1 space-y-1">
                {event.diagnostics.hypotheses.map((entry) => (
                  <li key={entry.type} className="text-2xs text-ink-muted">
                    <span className="tabular text-ink-subtle">{Math.round(entry.confidence * 100)}%</span>{' '}
                    {EVENT_TYPE_LABELS[entry.type]} — {entry.reasoning}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {event.claimChecks?.length ? (
            <div className="mt-2 border-t border-line pt-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Claim checks</p>
              <ul className="mt-1 space-y-1">
                {event.claimChecks.map((check) => (
                  <li key={check.field} className="text-2xs">
                    <span
                      className={
                        check.verdict === 'contradicts'
                          ? 'text-critical'
                          : check.verdict === 'agrees'
                            ? 'text-positive'
                            : 'text-ink-subtle'
                      }
                    >
                      {check.verdict}
                    </span>{' '}
                    <span className="text-ink-muted">
                      {check.field}: claimed “{check.claimed}”, measured {check.measured}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </details>
      ) : null}

      <RecreatePanel onRequest={onRecreate} {...(event.recreationHint ? { hint: event.recreationHint } : {})} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-xs font-medium text-ink">{value}</dd>
    </div>
  );
}

function Prose({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">{value}</dd>
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

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
