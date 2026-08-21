import { describe, expect, it } from 'vitest';
import { validateModelAnalysis, validateRecreateGuide } from './validate-motion.ts';

const event = (overrides: Record<string, unknown> = {}) => ({
  candidateId: 'c1',
  type: 'hard_cut',
  title: 'Hard Cut',
  description: 'A cut.',
  confidence: 0.8,
  effects: [],
  ...overrides,
});

describe('validateModelAnalysis', () => {
  it('accepts a well-formed response', () => {
    const result = validateModelAnalysis({ summary: 'Fast edit.', events: [event()] });
    expect(result.ok).toBe(true);
  });

  it('rejects anything that is not an object', () => {
    expect(validateModelAnalysis(null).ok).toBe(false);
    expect(validateModelAnalysis('{}').ok).toBe(false);
    expect(validateModelAnalysis(42).ok).toBe(false);
  });

  it('rejects a response with no usable events', () => {
    expect(validateModelAnalysis({ summary: 'x', events: [] }).ok).toBe(false);
    expect(validateModelAnalysis({ summary: 'x', events: [{ nonsense: true }] }).ok).toBe(false);
  });

  it('downgrades an unknown event type instead of dropping the observation', () => {
    const result = validateModelAnalysis({ summary: 'x', events: [event({ type: 'quantum_wipe' })] });
    expect(result.ok && result.value.events[0]?.type).toBe('other');
  });

  it('recovers a percentage-shaped confidence', () => {
    // A model answering 86 rather than 0.86 is common and recoverable.
    const result = validateModelAnalysis({ summary: 'x', events: [event({ confidence: 86 })] });
    expect(result.ok && result.value.events[0]?.confidence).toBe(0.86);
  });

  it('clamps a nonsense confidence into range', () => {
    const high = validateModelAnalysis({ summary: 'x', events: [event({ confidence: 900 })] });
    const negative = validateModelAnalysis({ summary: 'x', events: [event({ confidence: -3 })] });
    expect(high.ok && high.value.events[0]?.confidence).toBe(1);
    expect(negative.ok && negative.value.events[0]?.confidence).toBe(0);
  });

  it('substitutes a mid confidence when the field is missing entirely', () => {
    const result = validateModelAnalysis({ summary: 'x', events: [event({ confidence: 'very sure' })] });
    expect(result.ok && result.value.events[0]?.confidence).toBe(0.5);
  });

  it('cleans and caps the effects list', () => {
    const result = validateModelAnalysis({
      summary: 'x',
      events: [event({ effects: ['  Motion blur ', '', 42, 'Scale', 'a', 'b', 'c', 'd', 'e'] })],
    });
    expect(result.ok && result.value.events[0]?.effects).toEqual(['Motion blur', 'Scale', 'a', 'b', 'c', 'd']);
  });

  it('skips malformed events but keeps the good ones', () => {
    const result = validateModelAnalysis({
      summary: 'x',
      events: [event(), { candidateId: '', type: 'hard_cut' }, event({ candidateId: 'c2' })],
    });
    expect(result.ok && result.value.events).toHaveLength(2);
  });
});

describe('validateRecreateGuide', () => {
  it('accepts steps and a caveat', () => {
    const result = validateRecreateGuide(
      { platform: 'after-effects', steps: ['Do a thing', 'Do another'], caveat: 'Timing is by eye.' },
      'after-effects',
    );
    expect(result.ok && result.value.steps).toHaveLength(2);
    expect(result.ok && result.value.caveat).toBe('Timing is by eye.');
  });

  it('falls back to the requested platform if the model names another', () => {
    const result = validateRecreateGuide({ platform: 'nonsense', steps: ['x'], caveat: null }, 'gsap');
    expect(result.ok && result.value.platform).toBe('gsap');
  });

  it('rejects a guide with no steps', () => {
    expect(validateRecreateGuide({ platform: 'css', steps: [], caveat: null }, 'css').ok).toBe(false);
    expect(validateRecreateGuide({ platform: 'css', caveat: null }, 'css').ok).toBe(false);
  });

  it('normalises a missing caveat to null rather than undefined', () => {
    const result = validateRecreateGuide({ platform: 'css', steps: ['x'] }, 'css');
    expect(result.ok && result.value.caveat).toBeNull();
  });
});
