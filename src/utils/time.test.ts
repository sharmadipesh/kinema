import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatPreciseTime, relativeTime } from './time.ts';

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(32)).toBe('00:32');
    expect(formatClock(95)).toBe('01:35');
  });

  it('adds an hours field only when needed', () => {
    expect(formatClock(3661)).toBe('1:01:01');
  });

  it('treats a missing or infinite duration as zero rather than printing NaN', () => {
    expect(formatClock(Number.NaN)).toBe('00:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('00:00');
    expect(formatClock(-5)).toBe('00:00');
  });
});

describe('formatPreciseTime', () => {
  it('keeps the centiseconds that distinguish one event from the next', () => {
    expect(formatPreciseTime(4.32)).toBe('00:04.32');
    expect(formatPreciseTime(12.409)).toBe('00:12.41');
  });

  it('does not lose a centisecond to binary floating point', () => {
    // 2.4 % 1 is 0.39999999999999997, so truncating renders 00:02.39 — the
    // wrong timestamp, in the one place this product claims precision.
    expect(formatPreciseTime(2.4)).toBe('00:02.40');
    expect(formatPreciseTime(7.8)).toBe('00:07.80');
    expect(formatPreciseTime(18.9)).toBe('00:18.90');
    expect(formatPreciseTime(24.7)).toBe('00:24.70');
  });

  it('carries correctly across a second boundary', () => {
    expect(formatPreciseTime(9.999)).toBe('00:10.00');
    expect(formatPreciseTime(59.999)).toBe('01:00.00');
  });
});

describe('formatDuration', () => {
  it('uses milliseconds below a second, where transitions live', () => {
    expect(formatDuration(0.36)).toBe('360ms');
    expect(formatDuration(0.045)).toBe('45ms');
  });

  it('uses seconds and then a clock as it grows', () => {
    expect(formatDuration(1.5)).toBe('1.50s');
    expect(formatDuration(75)).toBe('01:15');
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);
  it('describes recent times in words', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 24 * 3_600_000, now)).toBe('yesterday');
    expect(relativeTime(now - 3 * 24 * 3_600_000, now)).toBe('3d ago');
  });
});
