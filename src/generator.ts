// Procedural exercise generator.
//
// Rhythm: each measure is filled with rhythm "cells"; the last measure is a
// single held tonic. Melody: a weighted random walk over scale degrees that
// favours steps, recovers from leaps, avoids tritones, and is steered so it
// can always land on the tonic at the end. Interval weights can be scaled by
// the learner's weaknesses so the teacher serves more of what they miss.

import { KEYS, midiOf, type Key, type Mode } from './music';

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

function pick<T>(rng: Rng, items: T[], weights: number[]): T {
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
  mode: Mode | 'either';
  /** Lowest and highest scale degree allowed. */
  range: [number, number];
  /** Allowed interval sizes in scale steps (0 = repeat, 1 = step, 2 = third, ...). */
  intervals: number[];
  /** An interval size to feature more often (the level's new material). */
  focus?: number;
  rhythms: RhythmCellId[];
  meters: number[];
  measures: number;
  startOnTonic: boolean;
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

/** Multiplier on how often an interval size is chosen (1 = neutral). */
export type IntervalWeighting = (size: number) => number;

const BASE_INTERVAL_WEIGHT: Record<number, number> = { 0: 0.5, 1: 4, 2: 2, 3: 1.2, 4: 1, 5: 0.6, 6: 0.1, 7: 0.5 };

export function generateRhythm(p: GenParams, meter: number, rng: Rng): number[] {
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

export function generateDegrees(
  count: number,
  p: GenParams,
  key: Key,
  rng: Rng,
  weighting: IntervalWeighting = () => 1,
): number[] {
  const [lo, hi] = p.range;
  const tonics = [-7, 0, 7].filter((t) => t >= lo && t <= hi);
  const maxLeap = Math.max(...p.intervals);
  const canReachTonic = (d: number, notesLeft: number) =>
    tonics.some((t) => Math.abs(d - t) <= notesLeft * maxLeap && (notesLeft > 0 || d === t));

  for (let attempt = 0; attempt < 200; attempt++) {
    const starts = p.startOnTonic ? [0] : [0, 2, 4, 7].filter((d) => d >= lo && d <= hi);
    const degrees = [pick(rng, starts, starts.map((d) => (d === 0 ? 2 : 1)))];
    let ok = true;

    for (let i = 1; i < count; i++) {
      const prev = degrees[i - 1];
      const prevMove = i >= 2 ? prev - degrees[i - 2] : 0;
      const notesLeft = count - 1 - i;
      const options: number[] = [];
      const weights: number[] = [];

      for (const size of p.intervals) {
        for (const dir of size === 0 ? [0] : [1, -1]) {
          const d = prev + dir * size;
          if (d < lo || d > hi || !canReachTonic(d, notesLeft)) continue;
          if (Math.abs(midiOf(key, d) - midiOf(key, prev)) % 12 === 6) continue; // no tritones

          let w = (BASE_INTERVAL_WEIGHT[size] ?? 0.3) * weighting(size);
          if (size === p.focus) w *= 1.8;
          // After a leap, strongly prefer stepping back the other way.
          if (Math.abs(prevMove) >= 3) {
            if (size === 1 && Math.sign(dir) === -Math.sign(prevMove)) w *= 3;
            else if (size >= 2 && Math.sign(dir) === Math.sign(prevMove)) w *= 0.15;
          }
          if (size === 0 && prevMove === 0 && i >= 2) w *= 0.2; // avoid long runs of repeats
          // Near the end, lean toward the tonic.
          if (notesLeft <= 2) {
            const dist = Math.min(...tonics.map((t) => Math.abs(d - t)));
            w *= dist <= notesLeft ? 2 : 0.5;
          }
          options.push(d);
          weights.push(w);
        }
      }

      if (!options.length) {
        ok = false;
        break;
      }
      degrees.push(pick(rng, options, weights));
    }
    if (ok) return degrees;
  }

  // Fallback (shouldn't happen with sane params): a simple descent to the tonic.
  return Array.from({ length: count }, (_, i) => Math.max(0, Math.min(hi, count - 1 - i)));
}

export function generateExercise(p: GenParams, rng: Rng, weighting?: IntervalWeighting): Exercise {
  const keys = KEYS.filter((k) => p.mode === 'either' || k.mode === p.mode);
  const key = keys[Math.floor(rng() * keys.length)];
  const meter = p.meters[Math.floor(rng() * p.meters.length)];
  const durations = generateRhythm(p, meter, rng);
  const degrees = generateDegrees(durations.length, p, key, rng, weighting);

  let t = 0;
  const notes = durations.map((beats, i) => {
    const note = { degree: degrees[i], start: t, beats };
    t += beats;
    return note;
  });
  return { key, meter, notes, totalBeats: t };
}
