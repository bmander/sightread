// The graded curriculum and the adaptive "teacher".
//
// Each level is a set of generator parameters. After every self-graded
// exercise the teacher records per-interval and per-shape accuracy, nudges
// tempo within the level, and promotes or demotes based on recent scores.

import type { Exercise, GenParams, IntervalWeighting } from './generator';
import { INTERVAL_NAMES, SHAPES, shapeOf, type Shape } from './music';

export interface Level extends GenParams {
  title: string;
  blurb: string;
  tempo: number;
  showSyllables: boolean;
}

export const LEVELS: Level[] = [
  {
    title: 'Fa, sol, la',
    blurb: 'The first three notes of the major scale, moving by step. Triangle, oval, square.',
    mode: 'major', range: [0, 2], intervals: [0, 1], rhythms: ['q'], meters: [4],
    measures: 3, tempo: 60, startOnTonic: true, showSyllables: true,
  },
  {
    title: 'Mi below',
    blurb: 'Add mi (the diamond) just under the tonic fa, plus some half notes.',
    mode: 'major', range: [-1, 3], intervals: [0, 1], rhythms: ['q', 'h'], meters: [4],
    measures: 4, tempo: 60, startOnTonic: true, showSyllables: true,
  },
  {
    title: 'Repeats and thirds',
    blurb: 'Skip over a note: fa–la, sol–fa, la–fa. Watch for repeated notes too.',
    mode: 'major', range: [-1, 4], intervals: [0, 1, 2], focus: 2, rhythms: ['q', 'h'], meters: [4],
    measures: 4, tempo: 63, startOnTonic: true, showSyllables: true,
  },
  {
    title: 'The whole octave',
    blurb: 'Step and skip through the full major scale, fa up to fa.',
    mode: 'major', range: [0, 7], intervals: [0, 1, 2], rhythms: ['q', 'h'], meters: [4, 3],
    measures: 4, tempo: 66, startOnTonic: true, showSyllables: true,
  },
  {
    title: 'Without the labels',
    blurb: 'Same material, but read the shapes alone now. No syllables printed.',
    mode: 'major', range: [-3, 7], intervals: [0, 1, 2], rhythms: ['q', 'h', 'dh'], meters: [4, 3],
    measures: 4, tempo: 66, startOnTonic: false, showSyllables: false,
  },
  {
    title: 'Fourths and fifths',
    blurb: 'Leaps along the chord: fa up to fa, fa down to sol. Land by step afterwards.',
    mode: 'major', range: [-3, 7], intervals: [0, 1, 2, 3, 4], focus: 3, rhythms: ['q', 'h', 'dh'], meters: [4, 3],
    measures: 5, tempo: 66, startOnTonic: false, showSyllables: false,
  },
  {
    title: 'Minor: la is home',
    blurb: 'Minor tunes rest on la. Stepwise and thirds, syllables shown again.',
    mode: 'minor', range: [-1, 4], intervals: [0, 1, 2], focus: 2, rhythms: ['q', 'h'], meters: [4, 3],
    measures: 4, tempo: 63, startOnTonic: true, showSyllables: true,
  },
  {
    title: 'Minor leaps',
    blurb: 'Fourths and fifths in minor, labels off.',
    mode: 'minor', range: [-3, 7], intervals: [0, 1, 2, 3, 4], rhythms: ['q', 'h', 'dh'], meters: [4, 3],
    measures: 5, tempo: 66, startOnTonic: false, showSyllables: false,
  },
  {
    title: 'Eighth notes',
    blurb: 'Split the beat. Major or minor, any key.',
    mode: 'either', range: [-3, 7], intervals: [0, 1, 2, 3, 4], rhythms: ['q', 'h', 'ee'], meters: [4, 3, 2],
    measures: 5, tempo: 66, startOnTonic: false, showSyllables: false,
  },
  {
    title: 'Sixths and octaves',
    blurb: 'Wide leaps and dotted rhythms, the kind you find in fuging tunes.',
    mode: 'either', range: [-3, 8], intervals: [0, 1, 2, 3, 4, 5, 7], focus: 5, rhythms: ['q', 'h', 'ee', 'dqe'], meters: [4, 3, 2],
    measures: 6, tempo: 72, startOnTonic: false, showSyllables: false,
  },
  {
    title: 'Full class',
    blurb: 'Everything, longer phrases, at a proper singing tempo.',
    mode: 'either', range: [-4, 8], intervals: [0, 1, 2, 3, 4, 5, 7], rhythms: ['q', 'h', 'dh', 'ee', 'dqe'], meters: [4, 3, 2],
    measures: 8, tempo: 80, startOnTonic: false, showSyllables: false,
  },
];

export interface Tally {
  hit: number;
  miss: number;
}

export interface Progress {
  version: 1;
  level: number; // index into LEVELS
  maxLevel: number;
  tempoFactor: number;
  /** Recent scores (0..1) at each level. */
  history: Record<number, number[]>;
  intervals: Record<number, Tally>;
  shapes: Record<Shape, Tally>;
  exercisesSung: number;
}

export function freshProgress(): Progress {
  return {
    version: 1,
    level: 0,
    maxLevel: 0,
    tempoFactor: 1,
    history: {},
    intervals: {},
    shapes: Object.fromEntries(SHAPES.map((s) => [s, { hit: 0, miss: 0 }])) as Record<Shape, Tally>,
    exercisesSung: 0,
  };
}

export const PROMOTE_AT = 0.9;
export const DEMOTE_BELOW = 0.5;
export const WINDOW = 3;
const TEMPO_MIN = 0.8;
const TEMPO_MAX = 1.25;

/** Miss rate, smoothed toward a 15% prior so a couple of misses don't dominate. */
export function missRate(t: Tally | undefined): number {
  const prior = 4;
  return ((t?.miss ?? 0) + prior * 0.15) / ((t?.hit ?? 0) + (t?.miss ?? 0) + prior);
}

/** Serve weak intervals more often: up to ~2.5x for an interval missed every time. */
export function weightingFor(p: Progress): IntervalWeighting {
  return (size) => 1 + 1.5 * missRate(p.intervals[size]);
}

export function effectiveTempo(p: Progress): number {
  return Math.round(LEVELS[p.level].tempo * p.tempoFactor);
}

export interface Outcome {
  progress: Progress;
  score: number;
  change: 'promote' | 'demote' | 'stay';
  message: string;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Apply a self-graded exercise. `correct[i]` is whether note i was sung right.
 * Returns a new Progress (the input is not mutated).
 */
export function applyResult(prev: Progress, ex: Exercise, correct: boolean[]): Outcome {
  const p: Progress = structuredClone(prev);
  const score = correct.filter(Boolean).length / correct.length;

  ex.notes.forEach((note, i) => {
    const key = correct[i] ? 'hit' : 'miss';
    p.shapes[shapeOf(note.degree, ex.key.mode)][key]++;
    if (i > 0) {
      const size = Math.abs(note.degree - ex.notes[i - 1].degree);
      (p.intervals[size] ??= { hit: 0, miss: 0 })[key]++;
    }
  });
  p.exercisesSung++;

  const hist = (p.history[p.level] ??= []);
  hist.push(score);
  if (hist.length > 10) hist.shift();
  const recent = hist.slice(-WINDOW);

  let change: Outcome['change'] = 'stay';
  const parts: string[] = [];

  if (recent.length >= WINDOW && avg(recent) >= PROMOTE_AT && p.level < LEVELS.length - 1) {
    change = 'promote';
    p.level++;
    p.maxLevel = Math.max(p.maxLevel, p.level);
    p.tempoFactor = 1;
    parts.push(`Well sung! On to level ${p.level + 1}: ${LEVELS[p.level].title}.`, LEVELS[p.level].blurb);
  } else if (recent.length >= WINDOW && avg(recent) < DEMOTE_BELOW && p.level > 0) {
    change = 'demote';
    p.history[p.level] = [];
    p.level--;
    p.tempoFactor = 1;
    parts.push(`Let's step back to level ${p.level + 1} (${LEVELS[p.level].title}) and firm it up.`);
  } else {
    if (score >= 0.95) {
      p.tempoFactor = Math.min(TEMPO_MAX, p.tempoFactor + 0.05);
      parts.push(score === 1 ? 'Clean! Picking up the tempo a little.' : 'Very nice. A touch faster next time.');
    } else if (score >= 0.75) {
      parts.push('Good. Keep going.');
    } else {
      p.tempoFactor = Math.max(TEMPO_MIN, p.tempoFactor - 0.05);
      parts.push("That one was tricky. I'll slow things down a little.");
    }
    const weak = weakestInterval(p);
    if (weak !== null) parts.push(`${cap(INTERVAL_NAMES[weak])} are your weak spot, so you'll see more of them.`);
  }

  return { progress: p, score, change, message: parts.join(' ') };
}

/** The allowed interval (with enough data) that is missed most, if it's missed often. */
export function weakestInterval(p: Progress): number | null {
  let worst: number | null = null;
  let worstRate = 0.25;
  for (const size of LEVELS[p.level].intervals) {
    const t = p.intervals[size];
    if (!t || t.hit + t.miss < 6) continue;
    const rate = t.miss / (t.hit + t.miss);
    if (rate > worstRate) {
      worst = size;
      worstRate = rate;
    }
  }
  return worst;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
