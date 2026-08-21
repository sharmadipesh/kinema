/**
 * Timecode formatting.
 *
 * Two forms, deliberately: `mm:ss` for durations and axis labels, and
 * `mm:ss.cc` for event timestamps, where the difference between 4.32s and 4.68s
 * is the entire point.
 */

function clampSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function formatClock(seconds: number): string {
  const total = Math.floor(clampSeconds(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * `mm:ss.cc` — the form event timestamps are printed in.
 *
 * Rounded through a single integer centisecond count rather than taking the
 * fractional part directly. `2.4 % 1` is 0.39999999999999997 in binary floating
 * point, so truncating it renders a 2.40s event as 00:02.39 — a product whose
 * entire claim is precise timestamps quietly reporting the wrong one. Carrying
 * through the integer also handles the 9.999 → 00:10.00 boundary correctly.
 */
export function formatPreciseTime(seconds: number): string {
  const centisTotal = Math.round(clampSeconds(seconds) * 100);
  const whole = Math.floor(centisTotal / 100);
  const centis = centisTotal % 100;
  return `${formatClock(whole)}.${String(centis).padStart(2, '0')}`;
}

/** Durations under a second read better in milliseconds. */
export function formatDuration(seconds: number): string {
  const value = clampSeconds(seconds);
  if (value < 1) return `${Math.round(value * 1000)}ms`;
  if (value < 10) return `${value.toFixed(2)}s`;
  return formatClock(value);
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  return days < 7 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}
