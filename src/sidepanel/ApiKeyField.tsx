import { useEffect, useState } from 'react';
import { CheckIcon, SpinnerIcon } from '../components/Icons.tsx';
import { Button } from '../components/ui/Button.tsx';
import { OPENAI_ORIGIN_PATTERN } from '../services/model-defaults.ts';
import { requestHostPermission } from '../services/permissions.ts';
import { verifyApiKey } from '../services/transport/openai-transport.ts';
import {
  clearApiKey,
  readCredentialMeta,
  validateKeyFormat,
  writeApiKey,
  type CredentialMeta,
} from '../storage/credentials.ts';

/**
 * Connect an OpenAI API key.
 *
 * Two rules shape this component, both carried over from Visual Prompt because
 * both were learned the hard way:
 *
 *  1. **Nothing is stored until it is proven.** The key is verified with one
 *     real (tiny) request first, so a typo can never become a saved
 *     configuration that fails mysteriously three minutes into an analysis.
 *  2. **The permission request is the first await after the click.** Chrome
 *     only grants host permissions from a user gesture, and an intervening
 *     `await` breaks that chain.
 */

type Phase =
  | { name: 'idle' }
  | { name: 'working'; step: 'permission' | 'verifying' }
  | { name: 'error'; message: string }
  | { name: 'saved' };

export function ApiKeyField({ onChanged }: { onChanged(): void }) {
  const [meta, setMeta] = useState<CredentialMeta | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });

  useEffect(() => {
    void readCredentialMeta().then(setMeta);
  }, []);

  const refresh = async (): Promise<void> => {
    setMeta(await readCredentialMeta());
    onChanged();
  };

  const connect = async (): Promise<void> => {
    const validation = validateKeyFormat(draft);
    if (!validation.ok) {
      setPhase({ name: 'error', message: validation.reason });
      return;
    }

    setPhase({ name: 'working', step: 'permission' });

    // FIRST await after the click — see the note above.
    const granted = await requestHostPermission(OPENAI_ORIGIN_PATTERN.replace('/*', '/'));
    if (!granted) {
      setPhase({ name: 'error', message: 'Chrome permission was not granted, so the key was not saved.' });
      return;
    }

    setPhase({ name: 'working', step: 'verifying' });
    const verified = await verifyApiKey(validation.key);
    if (!verified.ok) {
      setPhase({ name: 'error', message: verified.error.message });
      return;
    }

    await writeApiKey(validation.key, Date.now());
    setDraft('');
    setEditing(false);
    setPhase({ name: 'saved' });
    await refresh();
  };

  const remove = async (): Promise<void> => {
    await clearApiKey();
    setPhase({ name: 'idle' });
    setEditing(false);
    await refresh();
  };

  const busy = phase.name === 'working';
  const showInput = editing || !meta?.present;

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-medium text-ink">OpenAI API key</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
          Stored on this device only, never synced, and sent only to OpenAI. Create one at{' '}
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink underline underline-offset-2"
          >
            platform.openai.com
          </a>
          .
        </p>
      </div>

      {showInput ? (
        <>
          <input
            type="password"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            placeholder="sk-…"
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              if (phase.name === 'error') setPhase({ name: 'idle' });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim()) void connect();
            }}
            className="w-full rounded-sm border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-line-strong focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void connect()}
              disabled={busy || draft.trim().length === 0}
              icon={busy ? <SpinnerIcon size={12} /> : undefined}
            >
              {phase.name === 'working' && phase.step === 'permission'
                ? 'Awaiting permission…'
                : phase.name === 'working'
                  ? 'Verifying…'
                  : 'Connect'}
            </Button>
            {meta?.present ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 rounded-sm border border-line bg-surface-sunken px-2 py-1.5">
          <CheckIcon size={12} className="shrink-0 text-positive" />
          <span className="min-w-0 flex-1 font-mono text-xs text-ink">{meta?.masked}</span>
          <span className="shrink-0 text-2xs text-ink-subtle">{meta?.verifiedAt ? 'verified' : 'unverified'}</span>
        </div>
      )}

      {!showInput ? (
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void remove()}>
            Remove
          </Button>
        </div>
      ) : null}

      {phase.name === 'error' ? (
        <p role="alert" className="text-xs leading-relaxed text-critical">
          {phase.message}
        </p>
      ) : null}
      {phase.name === 'saved' ? <p className="text-xs text-positive">Key verified and saved.</p> : null}
    </section>
  );
}
