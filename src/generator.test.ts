import { describe, expect, it } from 'vitest';
import { generateExercise, makeRng, type GenParams } from './generator';
import { keyFor, KEYS } from './music';
import { skillOf, UNITS } from './skills';

const skillsOf = (n: number) => new Set(UNITS.slice(0, n).flatMap((u) => [u.up, u.down]));

const params = (over: Partial<GenParams> = {}): GenParams => ({
  key: keyFor(7, 'major'),
  range: [-4, 8],
  allowed: skillsOf(5),
  starts: [0, 2, 4],
  rhythms: ['q', 'h', 'ee'],
  meters: [4, 3],
  measures: 5,
  ...over,
});

describe('generateExercise', () => {
  it('only uses allowed skills, fills its measures, and ends on the tonic', () => {
    for (const n of [1, 2, 5, 11, 20, UNITS.length]) {
      for (const key of KEYS) {
        for (let seed = 1; seed <= 25; seed++) {
          const p = params({ key, allowed: skillsOf(n) });
          const ex = generateExercise(p, makeRng(seed * 31 + n));
          expect(ex.totalBeats).toBe(ex.meter * p.measures);
          expect(ex.notes.at(-1)!.beats).toBe(ex.meter);
          ex.notes.forEach((note, i) => {
            expect(note.degree).toBeGreaterThanOrEqual(-4);
            expect(note.degree).toBeLessThanOrEqual(8);
            if (i) {
              const s = skillOf(key, ex.notes[i - 1].degree, note.degree);
              if (s) expect(p.allowed.has(s), `${s} with ${n} units`).toBe(true);
            }
          });
          expect(((ex.notes.at(-1)!.degree % 7) + 7) % 7).toBe(0);
        }
      }
    }
  });

  it('with only fa–sol known, moves between fa and sol', () => {
    const ex = generateExercise(params({ allowed: skillsOf(1), starts: [0] }), makeRng(3));
    expect(new Set(ex.notes.map((n) => n.degree))).toEqual(new Set([0, 1]));
  });

  it('is deterministic for a given seed', () => {
    expect(generateExercise(params(), makeRng(42))).toEqual(generateExercise(params(), makeRng(42)));
  });

  it('follows skill weights', () => {
    const target = UNITS[3]; // la–fa half step
    const count = (weight?: (s: string) => number) => {
      let hits = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const ex = generateExercise(params({ weight }), makeRng(seed));
        ex.notes.forEach((n, i) => {
          const s = i && skillOf(ex.key, ex.notes[i - 1].degree, n.degree);
          if (s === target.up || s === target.down) hits++;
        });
      }
      return hits;
    };
    expect(count((s) => (s === target.up || s === target.down ? 5 : 1))).toBeGreaterThan(count() * 1.5);
  });
});
