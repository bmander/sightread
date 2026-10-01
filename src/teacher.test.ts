import { describe, expect, it } from 'vitest';
import { makeRng } from './generator';
import { midiOf, staffStepOf } from './music';
import { PARTS } from './range';
import { BANDS, placementId, skillOf, UNITS } from './skills';
import {
  applyResult,
  boxOf,
  freshProgress,
  knownSkills,
  movesOf,
  placementsInPlay,
  planLesson,
  STABLE_BOX,
  type Progress,
} from './teacher';

/** Sing `n` lessons, grading each note with `grade`. */
function practise(p: Progress, n: number, grade: (lessonIndex: number, noteIndex: number) => boolean, seed = 1) {
  const kinds: string[] = [];
  for (let i = 0; i < n; i++) {
    const lesson = planLesson(p, makeRng(seed * 1000 + i));
    kinds.push(lesson.kind);
    p = applyResult(p, lesson, lesson.exercise.notes.map((_, j) => grade(i, j))).progress;
  }
  return { p, kinds };
}

describe('planLesson', () => {
  it('starts with a drill on fa–sol', () => {
    const lesson = planLesson(freshProgress(), makeRng(1));
    expect(lesson.kind).toBe('drill');
    expect(lesson.unit!.id).toBe(UNITS[0].id);
    expect(lesson.syllables.every(Boolean)).toBe(true);
    expect(lesson.focus.filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  it('songs use only introduced pairs', () => {
    const p = { ...freshProgress(), introduced: 7, drillsLeft: 0 };
    const known = knownSkills(p);
    for (let seed = 1; seed <= 50; seed++) {
      const { exercise: ex, kind } = planLesson(p, makeRng(seed));
      expect(kind).toBe('song');
      ex.notes.forEach((n, i) => {
        const s = i ? skillOf(ex.key, ex.notes[i - 1].degree, n.degree) : null;
        if (s) expect(known.has(s)).toBe(true);
      });
    }
  });

  it('keeps every key within two ledger lines of the staff', () => {
    const p = { ...freshProgress(), introduced: UNITS.length, drillsLeft: 0 };
    for (let pc = 0; pc < 12; pc++) {
      for (let seed = 1; seed <= 15; seed++) {
        const { exercise: ex } = planLesson(p, makeRng(seed), { tonic: pc, range: null });
        for (const n of ex.notes) {
          const step = staffStepOf(ex.key, n.degree);
          expect(step).toBeGreaterThanOrEqual(26); // A3
          expect(step).toBeLessThanOrEqual(42); // C6
        }
      }
    }
  });

  it("sounds every note within the singer's range", () => {
    const p = { ...freshProgress(), introduced: UNITS.length, drillsLeft: 0 };
    for (const range of [...PARTS.map((part) => part.range), { low: 50, high: 63 }]) {
      for (const tonic of [null, 0, 6, 11]) {
        for (let seed = 1; seed <= 15; seed++) {
          const lesson = planLesson(p, makeRng(seed), { tonic, range });
          for (const n of lesson.exercise.notes) {
            const midi = midiOf(lesson.exercise.key, n.degree) + 12 * lesson.shift;
            expect(midi).toBeGreaterThanOrEqual(range.low);
            expect(midi).toBeLessThanOrEqual(range.high);
          }
        }
      }
    }
  });

  it('skips the drill for a pair that cannot be sung in the range and key', () => {
    const faOctave = UNITS.findIndex((u) => u.lo === 'fa' && u.hi === 'fa' && u.steps === 7);
    const p = { ...freshProgress(), introduced: faOctave + 1 };
    // D3–D4 holds no C–C or F–F octave.
    const lesson = planLesson(p, makeRng(1), { tonic: 0, range: { low: 50, high: 62 } });
    expect(lesson.kind).toBe('song');
  });

  it('prints syllables only where a pair is still being learned in that part of the staff', () => {
    const p = { ...freshProgress(), introduced: 3, drillsLeft: 0 };
    const inPlay = [...placementsInPlay(p, { tonic: null, range: null })];
    for (const id of inPlay) p.skills[id] = { box: 4, due: 99, hit: 9, miss: 0 };
    expect(planLesson(p, makeRng(5)).syllables.some(Boolean)).toBe(false);
    const weak = inPlay.find((id) => id.startsWith(`${UNITS[2].up}@`))!;
    p.skills[weak].box = 0;
    let found = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const lesson = planLesson(p, makeRng(seed));
      movesOf(lesson.exercise).forEach((id, i) => {
        if (id === weak) expect(lesson.syllables[i]).toBe(true), found++;
      });
    }
    expect(found).toBeGreaterThan(0);
  });

  it('moves lessons around the staff', () => {
    const p = { ...freshProgress(), introduced: 7, drillsLeft: 0 };
    const bands = new Set(Array.from({ length: 30 }, (_, seed) => planLesson(p, makeRng(seed)).band));
    expect(bands).toEqual(new Set(BANDS));
  });
});

describe('applyResult', () => {
  it('drills, then songs, then introduces the next pair for a strong singer', () => {
    const { p, kinds } = practise(freshProgress(), 12, () => true);
    expect(kinds.slice(0, 3)).toEqual(['drill', 'drill', 'song']);
    expect(p.introduced).toBeGreaterThan(1);
    expect(kinds.filter((k) => k === 'drill').length).toBeGreaterThanOrEqual(4); // drills for the new pair too
  });

  it('keeps introducing pairs across a long run, and every pair gets practised across the staff', () => {
    const { p } = practise(freshProgress(), 250, () => true);
    expect(p.introduced).toBeGreaterThan(15);
    for (const u of UNITS.slice(0, p.introduced - 1)) {
      for (const s of [u.up, u.down]) {
        const solid = BANDS.filter((b) => boxOf(p, placementId(s, b)) >= STABLE_BOX);
        expect(solid.length, s).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('holds the next pair until every placement on the staff is solid', () => {
    const p: Progress = { ...freshProgress(), introduced: 2, drillsLeft: 0, recent: [1, 1, 1], sung: 50 };
    const inPlay = [...placementsInPlay(p, { tonic: null, range: null })];
    for (const id of inPlay) p.skills[id] = { box: 3, due: 0, hit: 9, miss: 0 };
    const lesson = planLesson(p, makeRng(3));
    const perfect = lesson.exercise.notes.map(() => true);
    expect(applyResult(p, lesson, perfect).progress.introduced).toBe(3);
    const shaky = inPlay.find((id) => !movesOf(lesson.exercise).includes(id))!;
    p.skills[shaky].box = 0;
    expect(applyResult(p, lesson, perfect).progress.introduced).toBe(2);
  });

  it('does not introduce new pairs for a struggling singer', () => {
    const { p } = practise(freshProgress(), 40, (_, j) => j % 2 === 0);
    expect(p.introduced).toBe(1);
    expect(p.tempoFactor).toBeLessThan(1);
  });

  it('moves a skill up a box only when due, and drops it on a miss', () => {
    let p: Progress = { ...freshProgress(), drillsLeft: 0 };
    const lesson = planLesson(p, makeRng(2));
    const s = movesOf(lesson.exercise).find(Boolean)!;
    const ok = lesson.exercise.notes.map(() => true);
    p = applyResult(p, lesson, ok).progress;
    expect(boxOf(p, s)).toBe(1);
    p = applyResult(p, lesson, ok).progress; // reviewed before it was due
    expect(boxOf(p, s)).toBe(1);
    p = applyResult(p, lesson, ok).progress; // now due
    expect(boxOf(p, s)).toBe(2);
    p = applyResult(p, lesson, lesson.exercise.notes.map(() => false)).progress;
    expect(boxOf(p, s)).toBe(0);
  });

  it('does not mutate its input', () => {
    const p = freshProgress();
    const lesson = planLesson(p, makeRng(1));
    applyResult(p, lesson, lesson.exercise.notes.map(() => true));
    expect(p).toEqual(freshProgress());
  });
});
