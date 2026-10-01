// Procedural exercise generator.
//
// Rhythm: each measure is filled with rhythm "cells"; the last measure is a
// single held tonic. Melody: a weighted random walk over scale degrees in
// which every move must be a shape-pair skill the learner has been
// introduced to (repeated notes are always allowed). A reachability table is
// built first so the walk can never paint itself into a corner: every choice
// still leaves a way to land on the tonic at the end.

import type { Key } from './music';
import { skillOf } from './skills';

export type Rng = () => number;

/** Deterministic PRNG (mulberry32) so exercises are reproducible from a seed. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: T[], weights: number[] = items.map(() => 1)): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

export type RhythmCellId = 'q' | 'h' | 'dh' | 'w' | 'ee' | 'dqe';

const RHYTHM_CELLS: Record<RhythmCellId, { beats: number[]; weight: number }> = {
  q: { beats: [1], weight: 5 },
  h: { beats: [2], weight: 2 },
  dh: { beats: [3], weight: 1 },
  w: { beats: [4], weight: 0.5 },
  ee: { beats: [0.5, 0.5], weight: 2 },
  dqe: { beats: [1.5, 0.5], weight: 1.5 },
};

export interface GenParams {
  key: Key;
  /** Lowest and highest scale degree allowed. */
  range: [number, number];
  /** Skill ids (see skills.ts) the melody may use. */
  allowed: ReadonlySet<string>;
  /** Relative preference for a move from degree `from` to `to` exercising `skill` (1 = neutral). */
  weight?: (skill: string, from: number, to: number) => number;
  /** Degrees the melody may start on, the first weighted double; a tonic is used if none can end on one. */
  starts: number[];
  rhythms: RhythmCellId[];
  meters: number[];
  measures: number;
}

export interface Note {
  degree: number;
  /** Onset, in beats from the start of the exercise. */
  start: number;
  beats: number;
}

export interface Exercise {
  key: Key;
  meter: number;
  notes: Note[];
  totalBeats: number;
}

// Preference by size of move in staff steps, before skill weighting.
const SIZE_WEIGHT: Record<number, number> = { 0: 0.5, 1: 4, 2: 2, 3: 1.2, 4: 1, 5: 0.6, 7: 0.5 };

function generateRhythm(p: GenParams, meter: number, rng: Rng): number[] {
  const durations: number[] = [];
  for (let m = 0; m < p.measures - 1; m++) {
    let pos = 0;
    while (pos < meter) {
      const fits = p.rhythms.filter((id) => {
        const len = RHYTHM_CELLS[id].beats.reduce((a, b) => a + b, 0);
        if (pos + len > meter) return false;
        // In 4/4, keep halves on beats 1 or 3 and wholes on beat 1, for readability.
        if (meter === 4 && len === 2 && pos % 2 !== 0) return false;
        if (len === 4 && pos !== 0) return false;
        if (len === 3 && pos !== 0) return false;
        return true;
      });
      const id = fits.length ? pick(rng, fits, fits.map((f) => RHYTHM_CELLS[f].weight)) : 'q';
      for (const b of RHYTHM_CELLS[id].beats) durations.push(b);
      pos += RHYTHM_CELLS[id].beats.reduce((a, b) => a + b, 0);
    }
  }
  durations.push(meter); // final held note fills the last measure
  return durations;
}

function generateDegrees(count: number, p: GenParams, rng: Rng): number[] {
  const { key, allowed } = p;
  const weight = p.weight ?? (() => 1);
  const [lo, hi] = p.range;
  const degrees = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const tonics = new Set([-14, -7, 0, 7, 14].filter((t) => t >= lo && t <= hi));

  // Legal next degrees from each degree: a repeat, or any allowed skill.
  const moves = new Map(
    degrees.map((d) => [d, degrees.filter((e) => e === d || allowed.has(skillOf(key, d, e)!))]),
  );
  // reach[k]: degrees from which a tonic can be reached in exactly k moves.
  const reach: Set<number>[] = [tonics];
  for (let k = 1; k < count; k++) {
    reach.push(new Set(degrees.filter((d) => moves.get(d)!.some((e) => reach[k - 1].has(e)))));
  }

  let starts = [...new Set(p.starts)].filter((d) => reach[count - 1].has(d));
  if (!starts.length) starts = [...tonics];
  const melody = [pick(rng, starts, starts.map((d) => (d === p.starts[0] ? 2 : 1)))];

  for (let i = 1; i < count; i++) {
    const prev = melody[i - 1];
    const prevMove = i >= 2 ? prev - melody[i - 2] : 0;
    const left = count - 1 - i;
    const options = moves.get(prev)!.filter((e) => reach[left].has(e));
    const weights = options.map((d) => {
      const size = Math.abs(d - prev);
      let w = (SIZE_WEIGHT[size] ?? 0.3) * (size ? weight(skillOf(key, prev, d)!, prev, d) : 1);
      // After a leap, prefer stepping back the other way.
      if (Math.abs(prevMove) >= 3) {
        if (size === 1 && Math.sign(d - prev) === -Math.sign(prevMove)) w *= 3;
        else if (size >= 2 && Math.sign(d - prev) === Math.sign(prevMove)) w *= 0.15;
      }
      if (size === 0 && prevMove === 0 && i >= 2) w *= 0.2; // avoid long runs of repeats
      // Near the end, lean toward the tonic.
      if (left <= 2) {
        const dist = Math.min(...[...tonics].map((t) => Math.abs(d - t)));
        w *= dist <= left ? 2 : 0.5;
      }
      return w;
    });
    melody.push(pick(rng, options, weights));
  }
  return melody;
}

export function generateExercise(p: GenParams, rng: Rng): Exercise {
  const meter = pick(rng, p.meters);
  const durations = generateRhythm(p, meter, rng);
  const degrees = generateDegrees(durations.length, p, rng);

  let t = 0;
  const notes = durations.map((beats, i) => {
    const note = { degree: degrees[i], start: t, beats };
    t += beats;
    return note;
  });
  return { key: p.key, meter, notes, totalBeats: t };
}
