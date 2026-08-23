import { describe, expect, it } from 'vitest';
import { normalizeProject } from './project.ts';

/**
 * Project records are user-writable data that survives upgrades, so they are
 * validated on read like everything else in `storage/`. An unknown mode reaching
 * the readiness engine would fall through its switch silently.
 */
describe('normalizeProject', () => {
  it('returns an empty record for anything that is not an object', () => {
    expect(normalizeProject('a1', null).mode).toBeUndefined();
    expect(normalizeProject('a1', 'nope').stageEdits).toEqual({});
  });

  it('keeps the analysis id from the caller, never from the stored blob', () => {
    // Trusting a stored id would let one record masquerade as another's.
    expect(normalizeProject('a1', { analysisId: 'somewhere-else' }).analysisId).toBe('a1');
  });

  it('drops a mode it does not recognise', () => {
    expect(normalizeProject('a1', { mode: 'freestyle' }).mode).toBeUndefined();
    expect(normalizeProject('a1', { mode: 'shoot' }).mode).toBe('shoot');
  });

  it('drops a footage state it does not recognise', () => {
    const record = normalizeProject('a1', { footage: { good: 'available', bad: 'maybe' } });
    expect(record.footage).toEqual({ good: 'available' });
  });

  it('keeps only known brief fields and clamps the numbers', () => {
    const record = normalizeProject('a1', {
      brief: { tier: 'creator', targetDurationSec: -5, crewSize: 1e9, injected: 'x' },
    });

    expect(record.brief.tier).toBe('creator');
    expect(record.brief.targetDurationSec).toBeUndefined();
    expect(record.brief.crewSize).toBe(999);
    expect('injected' in record.brief).toBe(false);
  });

  it('drops a fidelity outside the allowed set', () => {
    expect(normalizeProject('a1', { brief: { fidelity: 'exact' } }).brief.fidelity).toBeUndefined();
  });

  it('keeps only boolean confirmations', () => {
    const record = normalizeProject('a1', { confirmations: { location: true, talent: 'yes' } });
    expect(record.confirmations).toEqual({ location: true });
  });

  it('discards a stage edit with nothing usable in it', () => {
    const record = normalizeProject('a1', { stageEdits: { 'stage-1': { name: '   ' }, 'stage-2': { name: 'Cold open' } } });

    expect(record.stageEdits['stage-1']).toBeUndefined();
    expect(record.stageEdits['stage-2']?.name).toBe('Cold open');
  });

  it('never lets a stage edit carry a measured field', () => {
    // The whole point of the split: prose cannot overwrite pixels.
    const record = normalizeProject('a1', { stageEdits: { 'stage-1': { name: 'X', startTime: 99, energy: 1 } } });

    expect(record.stageEdits['stage-1']).toEqual({ name: 'X' });
  });

  it('keeps structure edits as an ordered list', () => {
    const record = normalizeProject('a1', {
      structure: [
        { kind: 'split', stageId: 'stage-1', atTime: 4 },
        { kind: 'merge', stageId: 'stage-2', withStageId: 'stage-3' },
      ],
    });

    expect(record.structure).toHaveLength(2);
    expect(record.structure[0]).toMatchObject({ kind: 'split' });
  });
});
