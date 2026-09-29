import { describe, expect, it } from 'vitest';
import { makeRng } from './generator';
import { staffStepOf } from './music';
import { skillOf, UNITS } from './skills';
import { applyResult, boxOf, freshProgress, knownSkills, planLesson, STABLE_BOX, type Progress } from './teacher';

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
        const { exercise: ex } = planLesson(p, makeRng(seed), pc);
        for (const n of ex.notes) {
          const step = staffStepOf(ex.key, n.degree);
          expect(step).toBeGreaterThanOrEqual(26); // A3
          expect(step).toBeLessThanOrEqual(42); // C6
        }
      }
    }
  });

  it('prints syllables only around pairs still being learned', () => {
    const p = { ...freshProgress(), introduced: 3, drillsLeft: 0 };
    for (const u of UNITS.slice(0, 3)) for (const s of [u.up, u.down]) p.skills[s] = { box: 4, due: 99, hit: 9, miss: 0 };
    expect(planLesson(p, makeRng(5)).syllables.some(Boolean)).toBe(false);
    p.skills[UNITS[2].up].box = 0;
    const lesson = planLesson(p, makeRng(5));
    const moves = lesson.exercise.notes.map((n, i) => (i ? skillOf(lesson.exercise.key, lesson.exercise.notes[i - 1].degree, n.degree) : null));
    moves.forEach((s, i) => {
      if (s === UNITS[2].up) expect(lesson.syllables[i]).toBe(true);
    });
  });
});

describe('applyResult', () => {
  it('drills, then songs, then introduces the next pair for a strong singer', () => {
    const { p, kinds } = practise(freshProgress(), 12, () => true);
    expect(kinds.slice(0, 3)).toEqual(['drill', 'drill', 'song']);
    expect(p.introduced).toBeGreaterThan(1);
    expect(kinds.filter((k) => k === 'drill').length).toBeGreaterThanOrEqual(4); // drills for the new pair too
  });

  it('keeps introducing pairs across a long run, and every introduced pair gets practised', () => {
    const { p } = practise(freshProgress(), 250, () => true);
    expect(p.introduced).toBeGreaterThan(20);
    for (const u of UNITS.slice(0, p.introduced - 1)) {
      expect(boxOf(p, u.up), u.up).toBeGreaterThanOrEqual(STABLE_BOX);
      expect(boxOf(p, u.down), u.down).toBeGreaterThanOrEqual(STABLE_BOX);
    }
  });

  it('does not introduce new pairs for a struggling singer', () => {
    const { p } = practise(freshProgress(), 40, (_, j) => j % 2 === 0);
    expect(p.introduced).toBe(1);
    expect(p.tempoFactor).toBeLessThan(1);
  });

  it('moves a skill up a box only when due, and drops it on a miss', () => {
    let p: Progress = { ...freshProgress(), drillsLeft: 0 };
    const lesson = planLesson(p, makeRng(2));
    const s = UNITS[0].up;
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
