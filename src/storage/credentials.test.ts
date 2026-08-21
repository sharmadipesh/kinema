import { describe, expect, it } from 'vitest';
import { maskKey, validateKeyFormat } from './credentials.ts';

describe('validateKeyFormat', () => {
  it('accepts a well-formed key', () => {
    const key = `sk-${'a'.repeat(48)}`;
    expect(validateKeyFormat(key)).toEqual({ ok: true, key });
  });

  it('strips the quotes and newline a terminal paste brings with it', () => {
    // Left alone, a trailing newline makes `Bearer sk-…\n` an illegal header
    // and fetch throws a bare TypeError, which gets reported as a network
    // problem — sending the user to their router over a stray character.
    const key = `sk-${'b'.repeat(48)}`;
    expect(validateKeyFormat(`"${key}"\n`)).toEqual({ ok: true, key });
  });

  it('names the specific problem rather than saying "invalid"', () => {
    expect(validateKeyFormat('')).toMatchObject({ ok: false });
    expect(validateKeyFormat('sess-abcdefghijklmnop')).toMatchObject({ ok: false, reason: expect.stringContaining('session token') });
    expect(validateKeyFormat('pk-abc')).toMatchObject({ ok: false, reason: expect.stringContaining('sk-') });
    expect(validateKeyFormat('sk-short')).toMatchObject({ ok: false, reason: expect.stringContaining('too short') });
    expect(validateKeyFormat(`sk-${'a'.repeat(400)}`)).toMatchObject({ ok: false, reason: expect.stringContaining('too long') });
    expect(validateKeyFormat(`sk-${'a'.repeat(40)}!!`)).toMatchObject({ ok: false, reason: expect.stringContaining('never has') });
  });
});

describe('maskKey', () => {
  it('reveals only the last four characters', () => {
    expect(maskKey(`sk-${'a'.repeat(44)}wxyz`)).toBe('sk-…wxyz');
    expect(maskKey('sk-abc')).toBe('sk-…');
  });
});
