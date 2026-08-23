import { describe, expect, it } from 'vitest';
import {
  validateGlobalContext,
  validateModelEvents,
  validateReconciliation,
  validateRecreateGuide,
} from './validate-motion.ts';

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'c1',
  observations: { direction: 'left-to-right' },
  interpretation: { type: 'hard_cut', confidence: 0.8, reasoning: 'Frame replaced.' },
  alternatives: [],
  title: 'Hard Cut',
  shortExplanation: 'A cut.',
  effects: [],
  ...overrides,
});

/** Overrides that live inside `interpretation` rather than at the top level. */
const withInterpretation = (patch: Record<string, unknown>) =>
  event({ interpretation: { type: 'hard_cut', confidence: 0.8, reasoning: 'Frame replaced.', ...patch } });

describe('validateModelEvents', () => {
  it('accepts a well-formed response', () => {
    const result = validateModelEvents({ events: [event()] });
    expect(result.ok).toBe(true);
  });

  it('rejects anything that is not an object', () => {
    expect(validateModelEvents(null).ok).toBe(false);
    expect(validateModelEvents('{}').ok).toBe(false);
    expect(validateModelEvents(42).ok).toBe(false);
  });

  it('rejects a response with no usable events', () => {
    expect(validateModelEvents({ events: [] }).ok).toBe(false);
    expect(validateModelEvents({ events: [{ nonsense: true }] }).ok).toBe(false);
  });

  it('downgrades an unknown event type instead of dropping the observation', () => {
    const result = validateModelEvents({ events: [withInterpretation({ type: 'quantum_wipe' })] });
    expect(result.ok && result.value[0]?.type).toBe('other');
  });

  it('recovers a percentage-shaped confidence', () => {
    // A model answering 86 rather than 0.86 is common and recoverable.
    const result = validateModelEvents({ events: [withInterpretation({ confidence: 86 })] });
    expect(result.ok && result.value[0]?.confidence).toBe(0.86);
  });

  it('clamps a nonsense confidence into range', () => {
    const high = validateModelEvents({ events: [withInterpretation({ confidence: 900 })] });
    const negative = validateModelEvents({ events: [withInterpretation({ confidence: -3 })] });
    expect(high.ok && high.value[0]?.confidence).toBe(1);
    expect(negative.ok && negative.value[0]?.confidence).toBe(0);
  });

  it('substitutes a mid confidence when the field is missing entirely', () => {
    const result = validateModelEvents({ events: [withInterpretation({ confidence: 'very sure' })] });
    expect(result.ok && result.value[0]?.confidence).toBe(0.5);
  });

  it('cleans and caps the effects list', () => {
    const result = validateModelEvents({
      events: [event({ effects: ['  Motion blur ', '', 42, 'Scale', 'a', 'b', 'c', 'd', 'e'] })],
    });
    expect(result.ok && result.value[0]?.effects).toEqual(['Motion blur', 'Scale', 'a', 'b', 'c', 'd']);
  });

  it('skips malformed events but keeps the good ones', () => {
    const result = validateModelEvents({
      events: [event(), { eventId: '', title: 'x' }, event({ eventId: 'c2' })],
    });
    expect(result.ok && result.value).toHaveLength(2);
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

describe('validateGlobalContext', () => {
  const context = (overrides: Record<string, unknown> = {}) => ({
    summary: 'Fast cutting with direction-matched joins.',
    format: 'social',
    motionCharacter: 'Handheld, rightward.',
    typographyUse: null,
    transitionStyle: 'Mostly straight cuts.',
    colorTreatment: null,
    ...overrides,
  });

  it('accepts a well-formed context and drops the nulls', () => {
    const result = validateGlobalContext(context());
    expect(result.ok && result.value.format).toBe('social');
    expect(result.ok && result.value).not.toHaveProperty('typographyUse');
  });

  it('rejects a context with no summary', () => {
    expect(validateGlobalContext(context({ summary: '   ' })).ok).toBe(false);
    expect(validateGlobalContext(null).ok).toBe(false);
  });

  it('treats a model saying "N/A" as saying nothing', () => {
    // Rendering these verbatim would put the word "unknown" in the product's
    // own voice, where an absent field renders as silence.
    const result = validateGlobalContext(context({ typographyUse: 'N/A', colorTreatment: 'none' }));
    expect(result.ok && result.value).not.toHaveProperty('typographyUse');
    expect(result.ok && result.value).not.toHaveProperty('colorTreatment');
  });
});

describe('validateReconciliation', () => {
  it('accepts corrections and DNA notes', () => {
    const result = validateReconciliation({
      summary: 'An eighteen-second edit built on hard cuts.',
      corrections: [{ eventId: 'c1', newType: 'match_cut', reason: 'One of six identical joins.' }],
      relationships: [{ eventId: 'c1', relatedIds: ['c2', 'c3'], reason: 'Three identically built joins.' }],
      motifs: ['Direction-matched joins'],
      dnaNotes: { pacing: '11 shots across 18s.', cuts: 'Seven hard cuts.' },
    });
    expect(result.ok && result.value.corrections).toHaveLength(1);
    expect(result.ok && result.value.dnaNotes.pacing).toContain('11 shots');
    expect(result.ok && result.value.relationships[0]?.relatedIds).toEqual(['c2', 'c3']);
    expect(result.ok && result.value.motifs).toEqual(['Direction-matched joins']);
  });

  it('drops a correction with no stated reason', () => {
    // An unexplained overwrite of a classification that was at least grounded
    // in frames is strictly worse than leaving it alone.
    const result = validateReconciliation({
      summary: 'x',
      corrections: [{ eventId: 'c1', newType: 'match_cut' }, { eventId: 'c2', reason: 'why' }],
      dnaNotes: {},
    });
    expect(result.ok && result.value.corrections).toHaveLength(0);
  });

  it('drops a correction naming an unknown event type', () => {
    const result = validateReconciliation({
      summary: 'x',
      corrections: [{ eventId: 'c1', newType: 'teleport', reason: 'because' }],
      dnaNotes: {},
    });
    expect(result.ok && result.value.corrections).toHaveLength(0);
  });

  it('accepts an empty corrections list as the normal answer', () => {
    const result = validateReconciliation({ summary: 'A clean analysis.', corrections: [], dnaNotes: {} });
    expect(result.ok).toBe(true);
  });
});

describe('validateModelEvents — structural guards', () => {
  const base = {
    eventId: 'c1',
    observations: { direction: 'left-to-right' },
    interpretation: { type: 'hard_cut', confidence: 0.8, reasoning: 'Frame replaced.' },
    alternatives: [],
    title: 'Hard Cut',
    shortExplanation: 'A cut.',
    effects: [],
  };

  it('keeps only the first answer for a repeated event id', () => {
    // Two classifications competing for one timestamp is not extra information.
    const result = validateModelEvents({
      events: [base, { ...base, title: 'Whip Pan', interpretation: { type: 'whip_pan', confidence: 0.9, reasoning: 'x' } }],
    });
    expect(result.ok && result.value).toHaveLength(1);
    expect(result.ok && result.value[0]?.title).toBe('Hard Cut');
  });

  it('drops an event with no short explanation, since the card needs one', () => {
    const result = validateModelEvents({ events: [{ ...base, shortExplanation: '  ' }] });
    expect(result.ok).toBe(false);
  });

  it('separates observations from interpretation', () => {
    const result = validateModelEvents({ events: [base] });
    expect(result.ok && result.value[0]?.observations.direction).toBe('left-to-right');
    expect(result.ok && result.value[0]?.type).toBe('hard_cut');
  });

  it('drops an alternative identical to the chosen type', () => {
    // Not an alternative, and it would wrongly depress the margin term.
    const result = validateModelEvents({
      events: [{ ...base, alternatives: [{ type: 'hard_cut', confidence: 0.7, reasoning: 'same' }] }],
    });
    expect(result.ok && result.value[0]?.alternatives).toHaveLength(0);
  });

  it('drops an alternative with no reasoning', () => {
    const result = validateModelEvents({
      events: [{ ...base, alternatives: [{ type: 'whip_pan', confidence: 0.7 }] }],
    });
    expect(result.ok && result.value[0]?.alternatives).toHaveLength(0);
  });

  it('keeps a genuine rival reading', () => {
    const result = validateModelEvents({
      events: [{ ...base, alternatives: [{ type: 'whip_pan', confidence: 0.6, reasoning: 'If the smear is real.' }] }],
    });
    expect(result.ok && result.value[0]?.alternatives[0]?.type).toBe('whip_pan');
  });

  it('rejects an unknown continuity kind rather than inventing one', () => {
    const result = validateModelEvents({ events: [{ ...base, continuity: { kind: 'vibes-matched', note: 'x' } }] });
    expect(result.ok && result.value[0]?.continuity?.kind).toBeUndefined();
  });

  it('drops observation bands outside the known vocabulary', () => {
    const result = validateModelEvents({
      events: [{ ...base, observations: { horizontalMotion: 'catastrophic', blurProgression: 'increasing' } }],
    });
    expect(result.ok && result.value[0]?.observations.horizontalMotion).toBeUndefined();
    expect(result.ok && result.value[0]?.observations.blurProgression).toBe('increasing');
  });
});
