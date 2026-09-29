import { describe, expect, it } from 'vitest';
import { keyFor, midiOf, shapeOf, SHAPES, type Mode } from './music';
import { skillOf, UNITS, unitOfSkill } from './skills';

const MODES: Mode[] = ['major', 'minor'];

describe('UNITS', () => {
  it('has unique ids and skills', () => {
    const skills = UNITS.flatMap((u) => [u.up, u.down]);
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length);
    expect(new Set(skills).size).toBe(skills.length);
  });

  it('gives every unit one exact interval, in every degree position and both modes', () => {
    for (const mode of MODES) {
      const key = keyFor(0, mode);
      for (let a = -7; a <= 7; a++) {
        for (let b = a - 7; b <= a + 7; b++) {
          const u = unitOfSkill(skillOf(key, a, b) ?? '');
          if (u) expect(Math.abs(midiOf(key, b) - midiOf(key, a))).toBe(u.semitones);
        }
      }
    }
  });

  it('covers every shape move up to an octave except tritones', () => {
    const key = keyFor(0, 'major');
    for (let a = 0; a < 7; a++) {
      for (const steps of [1, 2, 3, 4, 5, 7]) {
        const tritone = Math.abs(midiOf(key, a + steps) - midiOf(key, a)) === 6;
        const up = skillOf(key, a, a + steps)!;
        expect(unitOfSkill(up) === undefined, `${up}`).toBe(tritone);
      }
    }
  });

  it('only uses real shapes', () => {
    for (const u of UNITS) expect(SHAPES).toEqual(expect.arrayContaining([u.lo, u.hi]));
    expect(shapeOf(0, 'minor')).toBe('la');
  });
});
