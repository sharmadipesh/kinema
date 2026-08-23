import { APP_NAME } from '../config.ts';
import { Segmented } from '../components/ui/Segmented.tsx';
import { clearFrames } from '../storage/frame-store.ts';
import { clearHistory } from '../storage/history.ts';
import type { Settings, ThemePreference } from '../types/domain.ts';
import { ApiKeyField } from './ApiKeyField.tsx';

export function SettingsPanel({
  settings,
  onChange,
  onConnectionChange,
}: {
  settings: Settings;
  onChange(patch: Partial<Settings>): void;
  onConnectionChange(): void;
}) {
  return (
    <div className="space-y-5 px-3.5 pb-5 pt-2">
      <Section title="Connection" description={`${APP_NAME} uses your own OpenAI key. There is no server.`}>
        <ApiKeyField onChanged={onConnectionChange} />
      </Section>

      <Section
        title="Analysis"
        description="How densely the video is sampled before anything is sent to the model."
      >
        <Field label="Sampling">
          <Segmented<Settings['samplingRate']>
            label="Sampling rate"
            value={settings.samplingRate}
            options={[
              { value: 'economy', label: 'Economy', description: 'Fewer frames, cheaper, less precise' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'thorough', label: 'Thorough', description: 'More frames, slower, more precise timestamps' },
            ]}
            onChange={(samplingRate) => onChange({ samplingRate })}
          />
        </Field>
        <p className="text-2xs leading-relaxed text-ink-subtle">
          Higher rates place timestamps more precisely and catch shorter transitions. They also take longer and read
          more frames — the number of frames sent to the model is capped either way.
        </p>
      </Section>

      <Section title="Behaviour">
        <Toggle
          label="Warn before scrubbing"
          description="Analysing a video playing in a tab steps through it, so you will see it move. Warn me first."
          checked={settings.warnBeforeScrub}
          onChange={(warnBeforeScrub) => onChange({ warnBeforeScrub })}
        />
        <Toggle
          label="Save analysis history"
          description="Keep completed analyses on this device so you can reopen them. Videos are never stored."
          checked={settings.saveHistory}
          onChange={(saveHistory) => onChange({ saveHistory })}
        />
      </Section>

      <Section title="Appearance">
        <Field label="Theme">
          <Segmented<ThemePreference>
            label="Theme"
            value={settings.theme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Auto' },
            ]}
            onChange={(theme) => onChange({ theme })}
          />
        </Field>
      </Section>

      <Section title="Data" description={`Everything ${APP_NAME} keeps lives on this device.`}>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              void clearHistory();
              void clearFrames();
            }}
            className="rounded-sm border border-line bg-surface-raised px-2 py-1 text-xs text-ink transition-colors hover:bg-[var(--mi-hover)]"
          >
            Clear history and frames
          </button>
        </div>
        <p className="text-2xs leading-relaxed text-ink-subtle">
          Analyses are stored locally and never leave this device. During an analysis, a small number of sampled frames
          are sent to OpenAI using your key — the video file itself never is.
        </p>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{title}</h2>
      {description ? <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{description}</p> : null}
      <div className="mt-2 space-y-1.5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
    </div>
  );
}

/**
 * A real checkbox, visually restyled. Using a native input keeps keyboard
 * behaviour, the accessibility tree and form semantics correct for free.
 */
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md py-1.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-subtle">{description}</span>
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={[
            'block h-[18px] w-8 rounded-pill border transition-colors duration-fast ease-standard',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
            checked ? 'border-transparent bg-accent' : 'border-line-strong bg-surface-sunken',
          ].join(' ')}
        />
        <span
          aria-hidden="true"
          className={[
            'absolute left-0.5 top-0.5 block h-3.5 w-3.5 rounded-pill bg-surface shadow-sm',
            'transition-transform duration-fast ease-standard',
            checked ? 'translate-x-[14px]' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
    </label>
  );
}
