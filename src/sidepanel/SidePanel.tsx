import { useCallback, useEffect, useState } from 'react';
import { MotionIcon } from '../components/Icons.tsx';
import { EXTENSION_VERSION } from '../config.ts';
import { useBackground } from '../hooks/useBackground.ts';
import { useTheme } from '../hooks/useTheme.ts';
import { checkConnection } from '../services/transport/openai-transport.ts';
import { onCredentialsChanged } from '../storage/credentials.ts';
import { onSettingsChanged, readSettings, writeSettings } from '../storage/settings.ts';
import type { FriendlyError, Settings } from '../types/domain.ts';
import type { PanelResponse, PanelState } from '../types/messages.ts';
import { unknownError } from '../utils/errors.ts';
import { AnalyzeScreen } from './AnalyzeScreen.tsx';
import { HistoryScreen } from './HistoryScreen.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';

type View = 'analyze' | 'history' | 'settings';

const EMPTY_STATE: PanelState = { session: null, analysis: null, source: null, error: null };

export function SidePanel() {
  const { request, subscribe } = useBackground();
  const [view, setView] = useState<View>('analyze');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<PanelState>(EMPTY_STATE);
  const [connection, setConnection] = useState<{ ready: boolean; problem?: FriendlyError } | null>(null);

  useTheme(settings?.theme);

  const refreshConnection = useCallback(() => {
    // A rejection here must not leave the panel with no status at all — that
    // reads as "everything is fine" when it may be anything but.
    void checkConnection()
      .catch(() => ({ ready: false, problem: unknownError() }))
      .then(setConnection);
  }, []);

  useEffect(() => {
    void readSettings().then(setSettings);
    refreshConnection();
    const stopSettings = onSettingsChanged(setSettings);
    const stopCredentials = onCredentialsChanged(refreshConnection);
    return () => {
      stopSettings();
      stopCredentials();
    };
  }, [refreshConnection]);

  // The service worker is the source of truth for session state, so the panel
  // adopts whatever it finds on connect — reopening the panel mid-analysis
  // shows the run still going, not a blank screen.
  useEffect(() => {
    void request<PanelResponse & { for: 'panel:get-state' }>({ type: 'panel:get-state' })
      .then((response) => setState(response.state))
      .catch(() => undefined);
  }, [request]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'event:state') setState(event.state);
      }),
    [subscribe],
  );

  const update = useCallback(async (patch: Partial<Settings>) => {
    // Optimistic: a settings panel should never feel like it is waiting on disk.
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setSettings(await writeSettings(patch));
  }, []);

  const needsSetup = Boolean(connection && !connection.ready);

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="shrink-0 border-b border-line px-3.5 pb-2 pt-3.5">
        <div className="mb-2.5 flex items-baseline gap-1.5">
          <MotionIcon size={13} className="self-center text-accent" />
          <h1 className="text-md font-semibold tracking-tight text-ink">Motion Inspector</h1>
          <span className="tabular text-2xs text-ink-subtle">v{EXTENSION_VERSION}</span>
        </div>

        <nav className="flex gap-0.5" aria-label="Sections">
          <Tab active={view === 'analyze'} onClick={() => setView('analyze')}>
            Analyze
          </Tab>
          <Tab active={view === 'history'} onClick={() => setView('history')}>
            History
          </Tab>
          <Tab active={view === 'settings'} onClick={() => setView('settings')} flag={needsSetup}>
            Settings
          </Tab>
        </nav>
      </header>

      <main className="mi-scroll min-h-0 flex-1">
        {view === 'analyze' ? (
          <AnalyzeScreen
            request={request}
            subscribe={subscribe}
            session={state.session}
            analysis={state.analysis}
            error={state.error}
            connectionReady={connection?.ready ?? false}
            onOpenSettings={() => setView('settings')}
          />
        ) : view === 'history' ? (
          <HistoryScreen
            onOpen={(item) => {
              // The service worker adopts the stored analysis and pushes the
              // resulting snapshot back; the panel only has to change view.
              void request({ type: 'panel:load-history', itemId: item.id })
                .then(() => setView('analyze'))
                .catch(() => undefined);
            }}
          />
        ) : settings ? (
          <SettingsPanel settings={settings} onChange={update} onConnectionChange={refreshConnection} />
        ) : null}
      </main>

      {/*
        The footer states what actually happens, not what sounds best. Frames
        are sent to OpenAI during an analysis; saying "your video stays local"
        would be true of the file and false of the thing that matters.
      */}
      <footer className="shrink-0 border-t border-line px-3.5 py-2.5 text-2xs leading-relaxed text-ink-subtle">
        Videos are analysed only when you choose to. Sampled frames are sent to OpenAI with your own API key; the video
        file never is.
      </footer>
    </div>
  );
}

function Tab({
  active,
  flag,
  onClick,
  children,
}: {
  active: boolean;
  flag?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={[
        'relative rounded-sm px-2 py-1 text-sm font-medium transition-colors duration-fast',
        active ? 'bg-[var(--mi-hover)] text-ink' : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {children}
      {flag ? (
        <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-pill bg-critical" />
      ) : null}
    </button>
  );
}
