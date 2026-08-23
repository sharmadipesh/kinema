import { useEffect, useState } from 'react';
import type { AnalysisSession } from '../types/motion.ts';

/**
 * How long the run has been going, and whether it has stopped moving.
 *
 * The panel cannot ask the service worker whether it is alive — a suspended
 * worker leaves its port open and its heartbeat answering, so the only honest
 * signal available is silence. Comparing `lastProgressAt` against the panel's
 * own clock is therefore the whole mechanism, and it works precisely because
 * the thing being watched is not the thing doing the watching.
 *
 * Two thresholds, because "slow" and "stopped" are different claims and only
 * one of them should alarm anyone. A single model call can legitimately run for
 * a minute; nothing legitimately runs for four without reporting a stage.
 */

const PATIENCE_MS = 25_000;
const STALL_MS = 150_000;

export type HealthState = 'idle' | 'working' | 'slow' | 'stalled';

export interface AnalysisHealth {
  state: HealthState;
  /** Milliseconds since the run began. */
  elapsedMs: number;
  /** Milliseconds since the pipeline last reported movement. */
  sinceProgressMs: number;
}

export function useAnalysisHealth(session: AnalysisSession | null, running: boolean): AnalysisHealth {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return undefined;
    // One second is the coarsest tick that still reads as a live timer.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!session || !running) return { state: 'idle', elapsedMs: 0, sinceProgressMs: 0 };

  const elapsedMs = Math.max(0, now - session.startedAt);
  const sinceProgressMs = Math.max(0, now - session.lastProgressAt);

  const state: HealthState =
    sinceProgressMs > STALL_MS ? 'stalled' : sinceProgressMs > PATIENCE_MS ? 'slow' : 'working';

  return { state, elapsedMs, sinceProgressMs };
}

/** `1m 24s`. Seconds alone below a minute; never a fake countdown. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
}
