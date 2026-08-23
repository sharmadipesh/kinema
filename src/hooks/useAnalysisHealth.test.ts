import { describe, expect, it } from 'vitest';
import { formatElapsed } from './useAnalysisHealth.ts';

describe('formatElapsed', () => {
  it('uses bare seconds below a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(42_000)).toBe('42s');
    expect(formatElapsed(59_999)).toBe('59s');
  });

  it('switches to minutes and pads the seconds', () => {
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(84_000)).toBe('1m 24s');
    expect(formatElapsed(605_000)).toBe('10m 05s');
  });
});
