import { describe, expect, it } from 'vitest';
import { isTerminal } from './session-registry.ts';

describe('isTerminal', () => {
  it('treats completed, cancelled and failed as final', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
  });

  it('treats every working stage as non-final', () => {
    for (const stage of ['preparing', 'coarse_sampling', 'ai_analysis', 'reconciling', 'building_timeline'] as const) {
      expect(isTerminal(stage)).toBe(false);
    }
  });
});
