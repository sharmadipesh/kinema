import { useCallback, useEffect, useState } from 'react';
import type { EvidenceFrame } from '../../types/analysis.ts';
import type { EnergyPoint, MotionAnalysis, StoryStage } from '../../types/motion.ts';
import { formatClock } from '../../utils/time.ts';
import { Chip } from '../../components/ui/Chip.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { copyText } from '../../utils/clipboard.ts';
import { resolveStageFrame, stageFrameNotice, type StageFrame } from './story-frames.ts';
import { boardToMarkdown, stageToMarkdown } from './story-markdown.ts';
import { StageEditor } from './StageEditor.tsx';
import { editedFields, type ProjectRecord, type StageEdit, type StageStructureEdit } from '../../types/project.ts';
import { ExportMenu } from './ExportMenu.tsx';

/**
 * The Story board: how the edit's energy evolves from open to close.
 *
 * Distinct from a moodboard, which answers "what should this look like". This
 * answers "how should it change over time" — and the stages come from where the
 * measured energy curve actually turns, not from a hook/build/peak template
 * imposed on every video. A fifteen-second loop with one beat gets one stage
 * and says so.
 *
 * Two presentations of one set of stages rather than two reports. **Flow** is
 * the reading view; **Contact sheet** is the scanning view, which is what an
 * editor actually wants once they know the piece and are looking for a beat.
 * Neither invents data the other does not have.
 */

type Board = 'flow' | 'sheet';

export function StoryView({
  analysis,
  frames,
  title,
  canSeek,
  onSeek,
  project,
  onEditStage,
  onResetStage,
  onStructure,
}: {
  analysis: MotionAnalysis;
  frames: EvidenceFrame[];
  /** Used as the board heading in the Markdown export. */
  title: string;
  /**
   * Whether a live video is bound and can actually be moved.
   *
   * False for a history entry, where the source may be long gone. The board
   * then presents stages as content rather than as controls, instead of
   * offering a jump and reporting a failure the user never caused.
   */
  canSeek: boolean;
  onSeek(time: number): void;
  /** The user's layer. Absent in read-only contexts such as a preview. */
  project?: ProjectRecord;
  onEditStage?(stageId: string, patch: Partial<StageEdit>): void;
  onResetStage?(stageId: string, field: keyof StageEdit): void;
  onStructure?(edit: StageStructureEdit): void;
}) {
  const [board, setBoard] = useState<Board>('flow');
  const [editing, setEditing] = useState<string | null>(null);
  const stages = analysis.blueprint?.storyStages ?? [];
  const energy = analysis.energy ?? [];

  if (stages.length === 0) {
    return (
      <Unavailable
        title="Story arc unavailable"
        body="KINEMA needs a measurable energy curve across several shots to segment a story arc. This video did not provide one."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Segmented<Board>
          label="Story board layout"
          value={board}
          onChange={setBoard}
          options={[
            { value: 'flow', label: 'Flow' },
            { value: 'sheet', label: 'Contact sheet', count: stages.length },
          ]}
        />
        {project ? (
          <ExportMenu analysis={analysis} project={project} frames={frames} title={title} />
        ) : (
          <CopyButton label="Copy board" text={() => boardToMarkdown(analysis, title)} done="Board copied" />
        )}
      </div>

      {energy.length > 0 ? <EnergyMap energy={energy} duration={analysis.video.duration} /> : null}

      {board === 'flow' ? (
        <section aria-label="Story stages" className="space-y-2">
          {stages.map((stage, index) => (
            <StageCard
              key={stage.id}
              stage={stage}
              resolved={resolveStageFrame(stage, frames)}
              isLast={index === stages.length - 1}
              canSeek={canSeek}
              onSeek={onSeek}
              edited={editedFields(project?.stageEdits[stage.id])}
              approved={project?.stageEdits[stage.id]?.approved ?? false}
              {...(onEditStage
                ? {
                    editor: {
                      open: editing === stage.id,
                      onToggle: () => setEditing((current) => (current === stage.id ? null : stage.id)),
                      frames,
                      edit: project?.stageEdits[stage.id],
                      canSplit: stage.endTime - stage.startTime > 2.4,
                      canMerge: index < stages.length - 1,
                      onEdit: (patch: Partial<StageEdit>) => onEditStage(stage.id, patch),
                      onReset: (field: keyof StageEdit) => onResetStage?.(stage.id, field),
                      onSplit: (atTime: number) => onStructure?.({ kind: 'split', stageId: stage.id, atTime }),
                      onMerge: () => {
                        const next = stages[index + 1];
                        if (next) onStructure?.({ kind: 'merge', stageId: stage.id, withStageId: next.id });
                      },
                    },
                  }
                : {})}
            />
          ))}
        </section>
      ) : (
        <ContactSheet stages={stages} frames={frames} canSeek={canSeek} onSeek={onSeek} />
      )}

      {analysis.blueprint?.moodboardKeywords.length ? (
        <section>
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
            Search these for references
          </h3>
          <div className="flex flex-wrap gap-1">
            {analysis.blueprint.moodboardKeywords.map((keyword) => (
              <Chip key={keyword}>{keyword}</Chip>
            ))}
          </div>
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-subtle">
            Paste into Pinterest, Are.na, Behance or an image search. KINEMA did not search anything — these are terms
            derived from the analysis.
          </p>
        </section>
      ) : null}

      {analysis.blueprint?.referencesToCollect.length ? (
        <section>
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
            Imagery to collect
          </h3>
          <ol className="space-y-1.5">
            {analysis.blueprint.referencesToCollect.map((reference, index) => (
              <li key={reference} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
                <span className="tabular w-4 shrink-0 text-ink-subtle">{String(index + 1).padStart(2, '0')}</span>
                <span>{reference}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Energy across the running time.
 *
 * Bars rather than a smooth curve, for the same reason the DNA meters are
 * segmented: the underlying value is a weighted blend of four measurements, and
 * a smooth line implies a resolution it does not have.
 */
function EnergyMap({ energy, duration }: { energy: EnergyPoint[]; duration: number }) {
  const peak = Math.max(...energy.map((point) => point.value), 0.001);

  return (
    <section aria-label="Visual energy">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Visual energy</h3>
      <div className="flex h-14 items-end gap-[2px]" role="img" aria-label="Energy across the video">
        {energy.map((point) => (
          <div
            key={point.startTime}
            className="flex-1 rounded-t-[1px] bg-accent"
            style={{ height: `${Math.max(6, (point.value / peak) * 100)}%`, opacity: 0.4 + (point.value / peak) * 0.6 }}
            title={`${formatClock(point.startTime)} · ${Math.round(point.value * 100)}%`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-2xs tabular text-ink-subtle">
        <span>{formatClock(0)}</span>
        <span>{formatClock(duration)}</span>
      </div>
      <p className="mt-1 text-2xs leading-relaxed text-ink-subtle">
        Blended from cut density, movement, transition density and change intensity — all measured.
      </p>
    </section>
  );
}

/**
 * The scanning view.
 *
 * Frame, stage, range, and the one line that says what the beat is for. An
 * editor who already knows the piece is looking for a beat, not reading a
 * document, and the flow view makes them scroll past eight rows of prose per
 * stage to do it.
 */
function ContactSheet({
  stages,
  frames,
  canSeek,
  onSeek,
}: {
  stages: StoryStage[];
  frames: EvidenceFrame[];
  canSeek: boolean;
  onSeek(time: number): void;
}) {
  return (
    <section aria-label="Contact sheet" className="grid grid-cols-2 gap-1.5">
      {stages.map((stage) => {
        const resolved = resolveStageFrame(stage, frames);
        const time = stage.referenceTime ?? stage.startTime;

        return (
          <article
            key={stage.id}
            className={`relative overflow-hidden rounded-md border border-line bg-surface-raised ${canSeek ? 'hover:bg-[var(--mi-hover)]' : ''}`}
          >
            <StageThumb resolved={resolved} stage={stage} className="aspect-video w-full" />
            <div className="mt-1 px-1.5 pb-1.5">
              <div className="flex items-baseline gap-1">
                <span className="tabular text-2xs text-ink-subtle">{String(stage.index).padStart(2, '0')}</span>
                {/* Outside the seek control, so heading navigation reaches it. */}
                <h3 className="truncate text-xs font-medium text-ink">{stage.name}</h3>
              </div>
              <span className="tabular mt-0.5 block text-2xs text-accent">
                {formatClock(stage.startTime)} – {formatClock(stage.endTime)}
              </span>
              {stage.purpose ? (
                <span className="mt-0.5 line-clamp-2 block text-2xs leading-relaxed text-ink-subtle">
                  {stage.purpose}
                </span>
              ) : null}
            </div>
            {canSeek ? (
              <button
                type="button"
                onClick={() => onSeek(time)}
                aria-label={`Jump to ${stage.name}, ${formatClock(stage.startTime)}`}
                className="absolute inset-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--mi-accent)]"
              />
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

/**
 * The stage image, or an honest account of why there is not one.
 *
 * The placeholder carries text rather than being an empty grey box: "no frame"
 * and "the frame was evicted" are different facts, and a blank rectangle
 * asserts neither while looking like a rendering bug.
 */
function StageThumb({
  resolved,
  stage,
  className,
}: {
  resolved: StageFrame;
  stage: StoryStage;
  className: string;
}) {
  const notice = stageFrameNotice(resolved);

  if (resolved.kind === 'exact' || resolved.kind === 'nearby') {
    return (
      <span className="relative block">
        <img
          src={resolved.frame.dataUrl}
          // Named, not decorative. This image is the stage's primary evidence,
          // and `alt=""` told every screen reader it carried nothing.
          alt={`Reference frame for ${stage.name} at ${formatClock(resolved.frame.time)}`}
          loading="lazy"
          decoding="async"
          className={`${className} shrink-0 border-line object-cover`}
        />
        {resolved.kind === 'nearby' ? (
          <span className="absolute bottom-0 left-0 right-0 bg-[rgba(0,0,0,0.62)] px-1 py-0.5 text-[9px] leading-tight text-ink">
            {notice}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center bg-surface-sunken px-1 text-center text-[9px] leading-tight text-ink-subtle`}
    >
      {notice}
    </span>
  );
}

interface StageEditorBinding {
  open: boolean;
  onToggle(): void;
  frames: EvidenceFrame[];
  edit: StageEdit | undefined;
  canSplit: boolean;
  canMerge: boolean;
  onEdit(patch: Partial<StageEdit>): void;
  onReset(field: keyof StageEdit): void;
  onSplit(atTime: number): void;
  onMerge(): void;
}

function StageCard({
  stage,
  resolved,
  isLast,
  canSeek,
  onSeek,
  edited,
  approved,
  editor,
}: {
  stage: StoryStage;
  resolved: StageFrame;
  isLast: boolean;
  canSeek: boolean;
  onSeek(time: number): void;
  edited: string[];
  approved: boolean;
  /** Absent when the board is read-only. */
  editor?: StageEditorBinding;
}) {
  const rows: Array<[string, string | undefined]> = [
    ['Purpose', stage.purpose],
    ['Mood', stage.mood],
    ['Composition', stage.composition],
    ['Camera', stage.camera],
    ['Movement', stage.movement],
    ['Lighting', stage.lighting],
    ['Colour', stage.color],
    ['Typography', stage.typography],
  ];
  const time = stage.referenceTime ?? stage.startTime;

  /**
   * The heading sits outside the seek control, not inside it.
   *
   * A heading nested in a `<button>` is not reliably exposed as a heading, and
   * heading navigation is the main way a screen-reader user moves through a
   * board of stages. The click target is preserved by stretching an overlay
   * button across the header instead — the whole row still seeks, and the
   * per-stage Copy below stays reachable because the overlay is scoped to the
   * header rather than the whole card.
   */
  return (
    <div>
      <article className="overflow-hidden rounded-md border border-line bg-surface-raised">
        <div className={`relative flex w-full gap-2.5 p-2 ${canSeek ? 'hover:bg-[var(--mi-hover)]' : ''}`}>
          <StageThumb resolved={resolved} stage={stage} className="h-14 w-[84px] rounded-xs border" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="tabular text-2xs text-ink-subtle">{String(stage.index).padStart(2, '0')}</span>
              <h3 className="text-sm font-medium text-ink">{stage.name}</h3>
            </div>
            <span className="tabular mt-0.5 block text-2xs text-accent">
              {formatClock(stage.startTime)} – {formatClock(stage.endTime)}
            </span>
            <span className="mt-0.5 block text-2xs text-ink-subtle">
              {stage.shotCount} shot{stage.shotCount === 1 ? '' : 's'}
              {stage.averageShot > 0 ? ` · avg ${stage.averageShot.toFixed(2)}s` : ''} · energy{' '}
              {Math.round(stage.energy * 100)}%
            </span>
          </div>
          {canSeek ? (
            <button
              type="button"
              onClick={() => onSeek(time)}
              aria-label={`Jump to ${stage.name}, ${formatClock(stage.startTime)}`}
              className="absolute inset-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--mi-accent)]"
            />
          ) : null}
        </div>

        {rows.some(([, value]) => value) ? (
          <dl className="space-y-1.5 border-t border-line px-2.5 py-2">
            {rows.map(([label, value]) =>
              value ? (
                <div key={label}>
                  <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : null}

        {stage.shotSuggestion ? (
          <div className="border-t border-line px-2.5 py-2">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Frame concept</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink">{stage.shotSuggestion}</p>
          </div>
        ) : null}

        {stage.keywords?.length ? (
          <div className="flex flex-wrap gap-1 border-t border-line px-2.5 py-2">
            {stage.keywords.map((keyword) => (
              <Chip key={keyword}>{keyword}</Chip>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-1 border-t border-line px-1.5 py-1">
          {/* Provenance, stated rather than implied: a hand-edited beat should
              never be mistaken for one the analysis produced. */}
          {approved ? <span className="mr-auto text-2xs text-accent">Approved</span> : null}
          {edited.length > 0 ? (
            <span className={`text-2xs text-ink-subtle ${approved ? '' : 'mr-auto'}`}>Edited: {edited.join(', ')}</span>
          ) : null}
          {editor ? (
            <button
              type="button"
              onClick={editor.onToggle}
              aria-expanded={editor.open}
              className="rounded-xs px-1.5 py-0.5 text-2xs text-ink-subtle transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
            >
              {editor.open ? 'Close' : 'Edit'}
            </button>
          ) : null}
          <CopyButton label="Copy stage" text={() => stageToMarkdown(stage)} done="Stage copied" />
        </div>

        {editor?.open ? (
          <div className="border-t border-line p-1.5">
            <StageEditor
              stage={stage}
              edit={editor.edit}
              frames={editor.frames}
              canSplit={editor.canSplit}
              canMerge={editor.canMerge}
              onEdit={editor.onEdit}
              onReset={editor.onReset}
              onSplit={editor.onSplit}
              onMerge={editor.onMerge}
              onClose={editor.onToggle}
            />
          </div>
        ) : null}
      </article>

      {!isLast ? (
        <div aria-hidden="true" className="flex justify-center py-1 text-ink-subtle">
          ↓
        </div>
      ) : null}
    </div>
  );
}

/**
 * Copy, with the outcome actually reported.
 *
 * `navigator.clipboard` fails silently in more situations than it succeeds in
 * unusual ones — a denied permission, a document that lost focus — and a button
 * that looks identical whether or not it worked is worse than no button.
 */
function CopyButton({ label, text, done }: { label: string; text(): string; done: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const onClick = useCallback(() => {
    void copyText(text()).then((ok) => setState(ok ? 'copied' : 'failed'));
  }, [text]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xs px-1.5 py-0.5 text-2xs text-ink-subtle transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
    >
      <span aria-live="polite">{state === 'copied' ? done : state === 'failed' ? 'Copy failed' : label}</span>
    </button>
  );
}

export function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-line px-3 py-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}

/** Loads the frames a Story or Create view needs, straight from IndexedDB. */
export function useAnalysisFrames(analysisId: string | null): EvidenceFrame[] {
  const [frames, setFrames] = useState<EvidenceFrame[]>([]);

  useEffect(() => {
    if (!analysisId) {
      setFrames([]);
      return undefined;
    }
    let cancelled = false;
    void chrome.runtime
      .sendMessage({ type: 'mi:read-frames', analysisId })
      .then((response: { ok: boolean; data?: EvidenceFrame[] }) => {
        if (!cancelled && response?.ok && response.data) setFrames(response.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  return frames;
}
