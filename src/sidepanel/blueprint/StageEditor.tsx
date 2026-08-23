import { useState } from 'react';
import type { EvidenceFrame } from '../../types/analysis.ts';
import type { StoryStage } from '../../types/motion.ts';
import { editedFields, type StageEdit } from '../../types/project.ts';
import { formatClock } from '../../utils/time.ts';

/**
 * Correcting the machine.
 *
 * The board is generated from measurement plus a model's reading of a handful
 * of frames, and it will sometimes be wrong in ways only the person watching
 * can see — the wrong frame chosen for a beat, a stage named for the shape of
 * its energy curve rather than what is happening in it. A read-only board makes
 * that permanent.
 *
 * One rule runs through all of it: **measured values are not editable.** Start
 * and end times, shot counts and energy came from pixels, and nothing here can
 * overwrite them with prose. Splitting and merging do change ranges, and those
 * go through a boundary that has to be a real time inside the stage.
 */
export function StageEditor({
  stage,
  edit,
  frames,
  canSplit,
  canMerge,
  onEdit,
  onReset,
  onSplit,
  onMerge,
  onClose,
}: {
  stage: StoryStage;
  edit: StageEdit | undefined;
  /** Frames belonging to this analysis, offered as replacements. */
  frames: EvidenceFrame[];
  canSplit: boolean;
  canMerge: boolean;
  onEdit(patch: Partial<StageEdit>): void;
  onReset(field: keyof StageEdit): void;
  onSplit(atTime: number): void;
  onMerge(): void;
  onClose(): void;
}) {
  const [picking, setPicking] = useState(false);
  const [confirmingSplit, setConfirmingSplit] = useState(false);
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const touched = editedFields(edit);

  // Only frames inside or adjacent to the stage are worth offering: a frame
  // from the other end of the video is never the right representative image.
  const nearby = frames
    .filter((frame) => frame.time >= stage.startTime - 1 && frame.time <= stage.endTime + 1)
    .sort((a, b) => a.time - b.time);

  const midpoint = Number(((stage.startTime + stage.endTime) / 2).toFixed(2));

  return (
    <div className="rounded-md border border-line-strong bg-surface-sunken p-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Edit stage</h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xs px-1.5 py-0.5 text-2xs text-ink-subtle transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
        >
          Done
        </button>
      </div>

      {touched.length > 0 ? (
        <p className="mt-1 text-2xs text-ink-subtle">
          Edited by you: {touched.join(', ')}. Measured timings are unchanged.
        </p>
      ) : null}

      <Field label="Name" edited={Boolean(edit?.name)} onReset={() => onReset('name')}>
        <input
          type="text"
          defaultValue={stage.name}
          aria-label="Stage name"
          onBlur={(pointer) => {
            const next = pointer.currentTarget.value.trim();
            if (next && next !== stage.name) onEdit({ name: next });
          }}
          className="w-full rounded-xs border border-line bg-surface px-1.5 py-1 text-xs text-ink focus:border-[var(--mi-accent)] focus:outline-none"
        />
      </Field>

      <Field label="Purpose" edited={Boolean(edit?.purpose)} onReset={() => onReset('purpose')}>
        <textarea
          defaultValue={stage.purpose ?? ''}
          aria-label="Stage purpose"
          rows={2}
          onBlur={(pointer) => onEdit({ purpose: pointer.currentTarget.value.trim() || undefined })}
          className="mi-scroll w-full resize-none rounded-xs border border-line bg-surface px-1.5 py-1 text-xs leading-relaxed text-ink focus:border-[var(--mi-accent)] focus:outline-none"
        />
      </Field>

      <Field label="Your note" edited={Boolean(edit?.note)} onReset={() => onReset('note')}>
        <textarea
          defaultValue={edit?.note ?? ''}
          aria-label="Editor note"
          rows={2}
          placeholder="Anything the analysis missed"
          onBlur={(pointer) => onEdit({ note: pointer.currentTarget.value.trim() || undefined })}
          className="mi-scroll w-full resize-none rounded-xs border border-line bg-surface px-1.5 py-1 text-xs leading-relaxed text-ink placeholder:text-ink-subtle focus:border-[var(--mi-accent)] focus:outline-none"
        />
      </Field>

      <div className="mt-2 border-t border-line pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs text-ink-muted">Reference frame</span>
          <div className="flex gap-1">
            {edit?.referenceFrameId ? (
              <button
                type="button"
                onClick={() => onReset('referenceFrameId')}
                className="rounded-xs px-1.5 py-0.5 text-2xs text-ink-subtle transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
              >
                Reset
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPicking((current) => !current)}
              aria-expanded={picking}
              disabled={nearby.length === 0}
              className="rounded-xs border border-line px-1.5 py-0.5 text-2xs text-ink-muted transition-colors hover:bg-[var(--mi-hover)] hover:text-ink disabled:opacity-40"
            >
              {nearby.length === 0 ? 'No frames captured' : picking ? 'Close' : 'Choose'}
            </button>
          </div>
        </div>

        {picking ? (
          <div className="mi-scroll-x mt-1.5 flex gap-1 pb-1">
            {nearby.map((frame) => {
              const chosen = (edit?.referenceFrameId ?? stage.referenceFrameId) === frame.id;
              return (
                <button
                  key={frame.id}
                  type="button"
                  onClick={() => {
                    onEdit({ referenceFrameId: frame.id });
                    setPicking(false);
                  }}
                  aria-label={`Use the frame at ${formatClock(frame.time)}`}
                  aria-pressed={chosen}
                  className={[
                    'shrink-0 overflow-hidden rounded-xs border transition-colors',
                    chosen ? 'border-[var(--mi-accent)]' : 'border-line hover:border-line-strong',
                  ].join(' ')}
                >
                  <img src={frame.dataUrl} alt="" className="h-12 w-[68px] object-cover" loading="lazy" />
                  <span className="tabular block px-1 py-0.5 text-[9px] text-ink-subtle">
                    {formatClock(frame.time)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={edit?.approved ?? false}
            onChange={(pointer) => onEdit({ approved: pointer.currentTarget.checked || undefined })}
            className="h-3 w-3 accent-[var(--mi-accent)]"
          />
          <span className="text-2xs text-ink-muted">Approved</span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={edit?.optional ?? false}
            onChange={(pointer) => onEdit({ optional: pointer.currentTarget.checked || undefined })}
            className="h-3 w-3 accent-[var(--mi-accent)]"
          />
          <span className="text-2xs text-ink-muted">Optional for a cutdown</span>
        </label>
      </div>

      {/*
        Structure changes are confirmed rather than immediate. A split
        recalculates the edit map and pacing, and anything already copied or
        exported from this board stops matching it.
      */}
      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
        {canSplit ? (
          confirmingSplit ? (
            <Confirm
              question={`Split at ${formatClock(midpoint)}?`}
              detail="The edit map and pacing are rebuilt. Exports already taken will not match."
              onConfirm={() => {
                onSplit(midpoint);
                setConfirmingSplit(false);
              }}
              onCancel={() => setConfirmingSplit(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingSplit(true)}
              className="rounded-xs border border-line px-1.5 py-0.5 text-2xs text-ink-muted transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
            >
              Split here
            </button>
          )
        ) : null}

        {canMerge ? (
          confirmingMerge ? (
            <Confirm
              question="Merge with the next stage?"
              detail="Both beats become one. The edit map and pacing are rebuilt."
              onConfirm={() => {
                onMerge();
                setConfirmingMerge(false);
              }}
              onCancel={() => setConfirmingMerge(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingMerge(true)}
              className="rounded-xs border border-line px-1.5 py-0.5 text-2xs text-ink-muted transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
            >
              Merge with next
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  edited,
  onReset,
  children,
}: {
  label: string;
  edited: boolean;
  onReset(): void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xs text-ink-muted">{label}</span>
        {edited ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded-xs px-1 py-0.5 text-2xs text-ink-subtle transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
          >
            Reset
          </button>
        ) : null}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Confirm({
  question,
  detail,
  onConfirm,
  onCancel,
}: {
  question: string;
  detail: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div className="w-full rounded-sm border border-caution/40 bg-surface px-2 py-1.5">
      <p className="text-2xs font-medium text-ink">{question}</p>
      <p className="mt-0.5 text-2xs leading-relaxed text-ink-subtle">{detail}</p>
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-xs bg-surface-inverse px-2 py-0.5 text-2xs font-medium text-ink-inverse"
        >
          Yes, do it
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xs border border-line px-2 py-0.5 text-2xs text-ink-muted transition-colors hover:bg-[var(--mi-hover)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
