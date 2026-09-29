import { describe, expect, it } from 'vitest';
import { KEYS, keyFor, midiOf, mod, SIGNATURE_STEPS, staffStepOf, TONICS, type Mode } from './music';

const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

/** Pitch class a staff step sounds at under the key's signature. */
function spelledPc(step: number, key: ReturnType<typeof keyFor>): number {
  const letter = mod(step, 7);
  const { type, count } = key.signature;
  const altered = SIGNATURE_STEPS[type].slice(0, count).map((s) => mod(s, 7));
  return mod(LETTER_PC[letter] + (altered.includes(letter) ? (type === 'sharp' ? 1 : -1) : 0), 12);
}

describe('keyFor', () => {
  for (const mode of ['major', 'minor'] as Mode[]) {
    for (const { pc, label } of TONICS) {
      it(`${label} ${mode}: signature spells the scale`, () => {
        const key = keyFor(pc, mode);
        expect(mod(key.tonicMidi, 12)).toBe(pc);
        expect(key.tonicMidi).toBeGreaterThanOrEqual(60);
        expect(key.tonicMidi).toBeLessThan(72);
        expect(key.signature.count).toBeLessThanOrEqual(6);
        for (let d = -4; d <= 8; d++) {
          expect(spelledPc(staffStepOf(key, d), key)).toBe(mod(midiOf(key, d), 12));
        }
      });
    }
  }

  it('uses conventional spellings', () => {
    const names = (mode: Mode) => TONICS.map(({ pc }) => keyFor(pc, mode).name.split(' ')[0]);
    expect(names('major')).toEqual(['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']);
    expect(names('minor')).toEqual(['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']);
  });

  it('keeps the curated random keys', () => {
    expect(KEYS.map((k) => k.name)).toEqual(['C major', 'D major', 'F major', 'G major', 'A major', 'A minor', 'D minor', 'E minor', 'G minor']);
  });
});
