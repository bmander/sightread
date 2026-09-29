import { describe, expect, it } from 'vitest';
import { LEVELS } from './curriculum';
import { generateExercise, makeRng } from './generator';
import { midiOf } from './music';

describe('generateExercise', () => {
  LEVELS.forEach((level, li) => {
    it(`level ${li + 1} (${level.title}) obeys its parameters`, () => {
      for (let seed = 1; seed <= 200; seed++) {
        const ex = generateExercise(level, makeRng(seed * 7919 + li));
        const { notes, meter, key } = ex;

        // Rhythm: measures add up, last note fills the final measure.
        expect(ex.totalBeats).toBe(meter * level.measures);
        expect(notes.at(-1)!.beats).toBe(meter);
        expect(level.meters).toContain(meter);

        // Melody: in range, allowed intervals only, no tritones, ends on a tonic.
        for (const n of notes) {
          expect(n.degree).toBeGreaterThanOrEqual(level.range[0]);
          expect(n.degree).toBeLessThanOrEqual(level.range[1]);
        }
        for (let i = 1; i < notes.length; i++) {
          const a = notes[i - 1].degree;
          const b = notes[i].degree;
          expect(level.intervals).toContain(Math.abs(b - a));
          expect(Math.abs(midiOf(key, b) - midiOf(key, a)) % 12).not.toBe(6);
        }
        expect(((notes.at(-1)!.degree % 7) + 7) % 7).toBe(0);
        if (level.startOnTonic) expect(notes[0].degree).toBe(0);
        if (level.mode !== 'either') expect(key.mode).toBe(level.mode);
      }
    });
  });

  it('uses the chosen tonic, with the mode still set by the level', () => {
    for (const [li, pc] of [[0, 5], [6, 10], [8, 1]]) {
      for (let seed = 1; seed <= 20; seed++) {
        const { key } = generateExercise(LEVELS[li], makeRng(seed), { tonic: pc });
        expect(key.tonicMidi % 12).toBe(pc);
        if (LEVELS[li].mode !== 'either') expect(key.mode).toBe(LEVELS[li].mode);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = generateExercise(LEVELS[5], makeRng(42));
    const b = generateExercise(LEVELS[5], makeRng(42));
    expect(a).toEqual(b);
  });

  it('serves weak intervals more often when weighted', () => {
    const count = (w?: (s: number) => number) => {
      let thirds = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const { notes } = generateExercise(LEVELS[3], makeRng(seed), { weighting: w });
        for (let i = 1; i < notes.length; i++) if (Math.abs(notes[i].degree - notes[i - 1].degree) === 2) thirds++;
      }
      return thirds;
    };
    expect(count((s) => (s === 2 ? 2.5 : 1))).toBeGreaterThan(count() * 1.3);
  });
});
