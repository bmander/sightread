import { describe, expect, it } from 'vitest';
import { applyResult, freshProgress, LEVELS, weightingFor } from './curriculum';
import { generateExercise, makeRng } from './generator';

const ex = generateExercise(LEVELS[0], makeRng(1));
const all = (v: boolean) => ex.notes.map(() => v);

describe('applyResult', () => {
  it('promotes after three strong exercises', () => {
    let p = freshProgress();
    const changes = [];
    for (let i = 0; i < 3; i++) {
      const o = applyResult(p, ex, all(true));
      changes.push(o.change);
      p = o.progress;
    }
    expect(changes).toEqual(['stay', 'stay', 'promote']);
    expect(p.level).toBe(1);
    expect(p.maxLevel).toBe(1);
    expect(p.tempoFactor).toBe(1);
  });

  it('demotes after three weak exercises, but never below level 1', () => {
    let p = { ...freshProgress(), level: 2, maxLevel: 2 };
    for (let i = 0; i < 3; i++) p = applyResult(p, ex, all(false)).progress;
    expect(p.level).toBe(1);
    expect(p.maxLevel).toBe(2);

    let q = freshProgress();
    for (let i = 0; i < 5; i++) q = applyResult(q, ex, all(false)).progress;
    expect(q.level).toBe(0);
  });

  it('nudges tempo and tracks interval stats without mutating input', () => {
    const p = freshProgress();
    const o = applyResult(p, ex, all(false));
    expect(o.progress.tempoFactor).toBeLessThan(1);
    expect(p.tempoFactor).toBe(1);
    expect(o.progress.intervals[1].miss).toBe(ex.notes.length - 1);
    expect(weightingFor(o.progress)(1)).toBeGreaterThan(weightingFor(p)(1));
  });
});
