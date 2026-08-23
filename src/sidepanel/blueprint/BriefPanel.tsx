import { Segmented } from '../../components/ui/Segmented.tsx';
import {
  CONFIRMABLE_LABELS,
  RECREATION_MODES,
  RECREATION_MODE_DESCRIPTIONS,
  RECREATION_MODE_LABELS,
  type AudioStatus,
  type Confirmable,
  type Fidelity,
  type FootageStatus,
  type ProductionTier,
  type ProjectBrief,
  type ProjectRecord,
  type RecreationMode,
} from '../../types/project.ts';

/**
 * What the user is doing, and under what constraints.
 *
 * The readiness engine cannot be truthful without this, so it is asked for
 * rather than assumed — and every field except the mode is optional, because an
 * unanswered field is a decision the engine surfaces, not an error to block on.
 * Someone studying a reference is never asked for a crew size.
 *
 * No mode is preselected. Defaulting to "Plan a shoot" would grade the analysis
 * against requirements the user never chose and report a readiness that is not
 * theirs.
 */
export function BriefPanel({
  project,
  onMode,
  onBrief,
  onConfirm,
}: {
  project: ProjectRecord;
  onMode(mode: RecreationMode): void;
  onBrief(patch: Partial<ProjectBrief>): void;
  onConfirm(key: Confirmable, value: boolean): void;
}) {
  const { mode, brief } = project;
  const needed = confirmablesFor(mode);

  return (
    <div className="space-y-3.5">
      <section id="brief-mode" aria-labelledby="brief-mode-heading">
        <h3 id="brief-mode-heading" className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
          What are you doing?
        </h3>
        <p className="mt-1 text-2xs leading-relaxed text-ink-subtle">
          Different work needs different things to be ready. KINEMA checks against whichever you pick.
        </p>
        <div role="radiogroup" aria-label="Recreation mode" className="mt-1.5 space-y-1">
          {RECREATION_MODES.map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={mode === entry}
              onClick={() => onMode(entry)}
              className={[
                'w-full rounded-sm border px-2 py-1.5 text-left transition-colors',
                mode === entry
                  ? 'border-[var(--mi-accent)] bg-[var(--mi-accent-soft)]'
                  : 'border-line hover:bg-[var(--mi-hover)]',
              ].join(' ')}
            >
              <span className={`block text-xs font-medium ${mode === entry ? 'text-accent' : 'text-ink'}`}>
                {RECREATION_MODE_LABELS[entry]}
              </span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-ink-subtle">
                {RECREATION_MODE_DESCRIPTIONS[entry]}
              </span>
            </button>
          ))}
        </div>
      </section>

      {mode ? (
        <>
          <section id="brief-tier" aria-label="Production constraints" className="space-y-2">
            <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Constraints</h3>
            <p className="text-2xs leading-relaxed text-ink-subtle">
              All optional. Anything left blank is reported as an open decision, never as a failure.
            </p>

            <Choice<ProductionTier>
              id="tier"
              label="Production tier"
              value={brief.tier}
              options={[
                { value: 'lean', label: 'Lean' },
                { value: 'creator', label: 'Creator' },
                { value: 'professional', label: 'Pro' },
              ]}
              onChange={(tier) => onBrief({ tier })}
            />

            <Choice<Fidelity>
              id="fidelity"
              label="Fidelity"
              value={brief.fidelity}
              options={[
                { value: 'close', label: 'Close recreation' },
                { value: 'inspired', label: 'Inspired by' },
              ]}
              onChange={(fidelity) => onBrief({ fidelity })}
            />

            <Choice<FootageStatus>
              id="footage"
              label="Footage"
              value={brief.footage}
              options={[
                { value: 'not-shot', label: 'Not shot' },
                { value: 'shooting', label: 'Shooting' },
                { value: 'available', label: 'Have it' },
              ]}
              onChange={(footage) => onBrief({ footage })}
            />

            {/*
              Audio is asked about rather than detected. KINEMA reads picture
              only, so the honest thing is to let the user say where audio
              stands and to weigh that answer by what they are doing.
            */}
            <Choice<AudioStatus>
              id="audio"
              label="Audio"
              value={brief.audio}
              options={[
                { value: 'none', label: 'None yet' },
                { value: 'reference-only', label: 'Reference only' },
                { value: 'music-selected', label: 'Track chosen' },
              ]}
              onChange={(audio) => onBrief({ audio })}
            />

            <div className="flex flex-wrap gap-1.5">
              <TextField
                id="aspect"
                label="Aspect"
                placeholder="9:16"
                value={brief.aspectRatio ?? ''}
                onCommit={(aspectRatio) => onBrief({ aspectRatio })}
              />
              <TextField
                id="duration"
                label="Target"
                placeholder="30s"
                value={brief.targetDurationSec ? String(brief.targetDurationSec) : ''}
                onCommit={(value) => {
                  const seconds = Number.parseInt(value.replace(/[^0-9]/g, ''), 10);
                  onBrief({ targetDurationSec: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined });
                }}
              />
              <TextField
                id="platform"
                label="Platform"
                placeholder="Instagram"
                value={brief.platform ?? ''}
                onCommit={(platform) => onBrief({ platform })}
              />
            </div>
          </section>

          {needed.length > 0 ? (
            <section aria-label="Manual confirmations">
              <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Confirm yourself</h3>
              {/*
                Held apart from everything derived. These are promises, not
                measurements, and one tick for both would put "location secured"
                and "five cuts measured" in the same visual sentence.
              */}
              <p className="mt-1 text-2xs leading-relaxed text-ink-subtle">
                KINEMA cannot check any of these. They are recorded as your answer.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {needed.map((key) => (
                  <li key={key}>
                    <label
                      id={`brief-${key}`}
                      className="flex cursor-pointer items-center gap-2 rounded-xs px-1.5 py-1 transition-colors hover:bg-[var(--mi-hover)]"
                    >
                      <input
                        type="checkbox"
                        checked={project.confirmations[key] ?? false}
                        onChange={(pointer) => onConfirm(key, pointer.currentTarget.checked)}
                        className="h-3 w-3 shrink-0 accent-[var(--mi-accent)]"
                      />
                      <span className="text-xs text-ink-muted">{CONFIRMABLE_LABELS[key]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Which promises matter for this kind of work. */
function confirmablesFor(mode: RecreationMode | undefined): Confirmable[] {
  switch (mode) {
    case 'shoot':
      return ['location', 'talent', 'equipment'];
    case 'edit':
      return ['footage-captured', 'music-licensed'];
    case 'cutdown':
      return ['delivery-spec'];
    default:
      return [];
  }
}

function Choice<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T | undefined;
  options: Array<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  return (
    <div id={`brief-${id}`} className="flex flex-wrap items-center justify-between gap-1.5">
      <span className="text-xs text-ink-muted">{label}</span>
      <Segmented<T>
        label={label}
        // Segmented needs a value; an unset field shows nothing selected via a
        // sentinel that matches no option.
        value={value ?? ('' as T)}
        options={options}
        onChange={onChange}
        wrap
      />
    </div>
  );
}

/**
 * Commits on blur and on Enter, not per keystroke.
 *
 * Every change writes to storage and re-derives readiness; doing that on each
 * character would rewrite the record a dozen times for one aspect ratio.
 */
function TextField({
  id,
  label,
  placeholder,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onCommit(value: string): void;
}) {
  return (
    <label id={`brief-${id}`} className="flex items-center gap-1.5">
      <span className="text-2xs text-ink-subtle">{label}</span>
      <input
        type="text"
        defaultValue={value}
        placeholder={placeholder}
        aria-label={label}
        onBlur={(pointer) => onCommit(pointer.currentTarget.value)}
        onKeyDown={(pointer) => {
          if (pointer.key === 'Enter') pointer.currentTarget.blur();
        }}
        className="w-[72px] rounded-xs border border-line bg-surface px-1.5 py-0.5 text-2xs text-ink placeholder:text-ink-subtle focus:border-[var(--mi-accent)] focus:outline-none"
      />
    </label>
  );
}
