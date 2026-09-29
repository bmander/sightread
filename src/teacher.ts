// The adaptive teacher.
//
// The curriculum is the ordered list of shape pairs in skills.ts. Each new
// pair is introduced with a short drill built around it, then joins the
// "songs": exercises that use only pairs already introduced, weighted toward
// pairs that are new, due for review, or often missed. Every directed pair
// (la↑fa and fa↓la are separate) has its own Leitner box: a clean exercise
// moves it up a box once it is due, a miss drops it back. The next pair is
// introduced once the newest is stable and recent songs are going well.
// Rhythm, meter, length and tempo unlock with the number of pairs learned.

import { generateExercise, pick, type Exercise, type GenParams, type RhythmCellId, type Rng } from './generator';
import { keyFor, KEYS, shapeOf, SHAPES, type Key, type Mode, type Shape } from './music';
import { describeSkill, INTERVAL_LABELS, skillOf, unitName, UNITS, unitOfSkill, type Unit } from './skills';

export interface Tally {
  hit: number;
  miss: number;
}

export interface SkillState extends Tally {
  /** Leitner box: 0 = new or shaky ... 5 = solid. */
  box: number;
  /** Value of Progress.sung at which this skill is next due for review. */
  due: number;
}

export interface Progress {
  version: 2;
  /** How many of UNITS have been introduced. */
  introduced: number;
  /** Passing drills still needed on the newest pair before songs. */
  drillsLeft: number;
  drillTries: number;
  skills: Record<string, SkillState>;
  shapes: Record<Shape, Tally>;
  /** Exercises sung so far; the clock for spaced review. */
  sung: number;
  tempoFactor: number;
  /** Recent song scores (0..1) since the newest pair was introduced. */
  recent: number[];
}

/** Exercises to wait before reviewing a skill again, by box. */
const BOX_INTERVALS = [1, 2, 4, 8, 16, 32];
const MAX_BOX = BOX_INTERVALS.length - 1;
/** A pair counts as learned (and its syllables stop being printed) from this box up. */
export const STABLE_BOX = 2;
/** Share of a skill's moves in one exercise that must be right to pass it, or below which it fails. */
const SKILL_PASS = 0.75;
const SKILL_FAIL = 0.5;
const DRILLS_PER_UNIT = 2;
const MAX_DRILL_TRIES = 4;
const DRILL_PASS = 0.7;
export const INTRODUCE_AT = 0.8;
export const WINDOW = 3;
/** Minor-mode songs appear once this many pairs are known (enough to sing around la). */
const MINOR_AT = 8;
const TEMPO_MIN = 0.8;
const TEMPO_MAX = 1.25;

export function freshProgress(): Progress {
  return {
    version: 2,
    introduced: 1,
    drillsLeft: DRILLS_PER_UNIT,
    drillTries: 0,
    skills: {},
    shapes: Object.fromEntries(SHAPES.map((s) => [s, { hit: 0, miss: 0 }])) as Record<Shape, Tally>,
    sung: 0,
    tempoFactor: 1,
    recent: [],
  };
}

export const newestUnit = (p: Progress) => UNITS[p.introduced - 1];
export const boxOf = (p: Progress, skill: string) => p.skills[skill]?.box ?? 0;
const isYoung = (p: Progress, skill: string) => boxOf(p, skill) < STABLE_BOX;

export function knownSkills(p: Progress): Set<string> {
  return new Set(UNITS.slice(0, p.introduced).flatMap((u) => [u.up, u.down]));
}

interface Stage {
  rhythms: RhythmCellId[];
  meters: number[];
  measures: number;
  tempo: number;
}

/** Rhythm, meter, length and tempo, unlocked by the number of pairs introduced. */
export function stageFor(introduced: number): Stage {
  if (introduced < 3) return { rhythms: ['q'], meters: [4], measures: 3, tempo: 60 };
  if (introduced < 6) return { rhythms: ['q', 'h'], meters: [4], measures: 4, tempo: 60 };
  if (introduced < 10) return { rhythms: ['q', 'h', 'dh'], meters: [4, 3], measures: 4, tempo: 63 };
  if (introduced < 16) return { rhythms: ['q', 'h', 'dh', 'ee'], meters: [4, 3, 2], measures: 5, tempo: 66 };
  if (introduced < 24) return { rhythms: ['q', 'h', 'dh', 'ee', 'dqe'], meters: [4, 3, 2], measures: 6, tempo: 72 };
  return { rhythms: ['q', 'h', 'dh', 'w', 'ee', 'dqe'], meters: [4, 3, 2], measures: 8, tempo: 80 };
}

/** Miss rate, smoothed toward a 15% prior so a couple of misses don't dominate. */
function missRate(t: Tally | undefined): number {
  const prior = 4;
  return ((t?.miss ?? 0) + prior * 0.15) / ((t?.hit ?? 0) + (t?.miss ?? 0) + prior);
}

const STEP_NAMES: Record<number, string> = { 1: 'a step', 2: 'a third', 3: 'a fourth', 4: 'a fifth', 5: 'a sixth', 7: 'an octave' };
const SHAPE_NAMES: Record<Shape, string> = { fa: 'triangle', sol: 'oval', la: 'square', mi: 'diamond' };

export function unitBlurb(u: Unit): string {
  const label = INTERVAL_LABELS[u.semitones];
  const shapes = u.lo === u.hi ? `the ${SHAPE_NAMES[u.lo]} to itself` : `${SHAPE_NAMES[u.lo]} to ${SHAPE_NAMES[u.hi]}`;
  return (
    `${cap(u.lo)} up ${STEP_NAMES[u.steps]} to ${u.hi} (${shapes}) is always a ${label}, in any key; ` +
    `${u.hi} down to ${u.lo} is the same ${label} going down.`
  );
}

export interface Lesson {
  kind: 'drill' | 'song';
  exercise: Exercise;
  /** The pair being drilled, for drills. */
  unit: Unit | null;
  /** Per note: print its syllable. */
  syllables: boolean[];
  /** Per note: arrived at via the newest pair, while it is still being learned. */
  focus: boolean[];
  tempo: number;
  title: string;
  blurb: string;
}

/**
 * Degrees available in a key: about an octave and a half around the tonic,
 * trimmed so no note needs more than two ledger lines (A3 to C6).
 */
function rangeFor(key: Key): [number, number] {
  const A3 = 26;
  const C6 = 42;
  return [Math.max(-5, A3 - key.tonicStep), Math.min(9, C6 - key.tonicStep)];
}

function pickKey(rng: Rng, tonic: number | null, allowMinor: boolean): Key {
  const mode: Mode = allowMinor && rng() < 0.35 ? 'minor' : 'major';
  return tonic === null ? pick(rng, KEYS.filter((k) => k.mode === mode)) : keyFor(tonic, mode);
}

/** Skill ids of each move in an exercise (null for repeated notes and the first note). */
function movesOf(ex: Exercise): (string | null)[] {
  return ex.notes.map((n, i) => (i ? skillOf(ex.key, ex.notes[i - 1].degree, n.degree) : null));
}

/** Plan the next exercise: a drill on the newest pair, or a song. */
export function planLesson(p: Progress, rng: Rng, tonic: number | null = null): Lesson {
  const newest = newestUnit(p);
  const isNewest = (s: string | null) => s === newest.up || s === newest.down;
  const stage = stageFor(p.introduced);
  const tempo = Math.round(stage.tempo * p.tempoFactor);
  const allowed = knownSkills(p);

  if (p.drillsLeft > 0) {
    const key = pickKey(rng, tonic, false);
    const params: GenParams = {
      key,
      range: rangeFor(key),
      allowed,
      weight: (s) => (isNewest(s) ? 12 : 0.6),
      starts: [0],
      rhythms: ['q', 'h'],
      meters: [4],
      measures: 3,
    };
    // Keep the candidate that features the new pair most often.
    let best: Exercise | null = null;
    let bestCount = -1;
    for (let i = 0; i < 12; i++) {
      const ex = generateExercise(params, rng);
      const count = movesOf(ex).filter(isNewest).length;
      if (count > bestCount) [best, bestCount] = [ex, count];
    }
    const moves = movesOf(best!);
    return {
      kind: 'drill',
      exercise: best!,
      unit: newest,
      syllables: moves.map(() => true),
      focus: moves.map(isNewest),
      tempo: Math.min(tempo, stage.tempo),
      title: `New pair: ${unitName(newest)}`,
      blurb: unitBlurb(newest),
    };
  }

  const key = pickKey(rng, tonic, p.introduced >= MINOR_AT);
  const exercise = generateExercise(
    {
      key,
      range: rangeFor(key),
      allowed,
      weight: (s) => {
        const st = p.skills[s];
        let w = st && st.box > 0 ? (st.box === 1 ? 1.6 : 1) : 2.5;
        if (!st || p.sung >= st.due) w *= 1.8; // due for review
        if (isNewest(s)) w *= 2;
        return w * (1 + 1.5 * missRate(st));
      },
      starts: p.introduced >= 6 ? [0, 2, 4, -3] : [0],
      ...stage,
    },
    rng,
  );
  const moves = movesOf(exercise);
  const young = (s: string | null) => s !== null && isYoung(p, s);
  const syllables = moves.map((into, i) => young(into) || young(moves[i + 1] ?? null));
  return {
    kind: 'song',
    exercise,
    unit: null,
    syllables,
    focus: moves.map((s) => isNewest(s) && young(s)),
    tempo,
    title: `Song · ${p.introduced} ${p.introduced === 1 ? 'pair' : 'pairs'}`,
    blurb: syllables.some(Boolean)
      ? 'Built from the pairs you know. Syllables are printed only for pairs you are still learning.'
      : 'Built from the pairs you know. Read the shapes alone.',
  };
}

export interface Outcome {
  progress: Progress;
  score: number;
  change: 'introduce' | 'stay';
  message: string;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Apply a graded lesson. `correct[i]` is whether note i was sung right; a
 * move is credited to its skill when the note it arrives at was right.
 * Returns a new Progress (the input is not mutated).
 */
export function applyResult(prev: Progress, lesson: Lesson, correct: boolean[]): Outcome {
  const p: Progress = structuredClone(prev);
  const ex = lesson.exercise;
  const score = correct.filter(Boolean).length / correct.length;
  p.sung++;

  ex.notes.forEach((n, i) => p.shapes[shapeOf(n.degree, ex.key.mode)][correct[i] ? 'hit' : 'miss']++);

  // Tally each move, then update each skill's box once for this exercise.
  const seen = new Map<string, Tally>();
  movesOf(ex).forEach((s, i) => {
    if (!s || !unitOfSkill(s)) return;
    const key = correct[i] ? 'hit' : 'miss';
    (p.skills[s] ??= { box: 0, due: 0, hit: 0, miss: 0 })[key]++;
    (seen.get(s) ?? seen.set(s, { hit: 0, miss: 0 }).get(s)!)[key]++;
  });
  for (const [s, t] of seen) {
    const st = p.skills[s];
    const rate = t.hit / (t.hit + t.miss);
    if (rate >= SKILL_PASS) {
      if (st.box > 0 && p.sung < st.due) continue; // reviewed early: keep the schedule
      st.box = Math.min(MAX_BOX, st.box + 1);
    } else if (rate < SKILL_FAIL) {
      st.box = Math.max(0, st.box - 2);
    } else {
      st.due = p.sung + 1; // shaky: hold the box, review again soon
      continue;
    }
    st.due = p.sung + BOX_INTERVALS[st.box];
  }

  const parts: string[] = [];
  let change: Outcome['change'] = 'stay';
  const newest = newestUnit(p);

  if (lesson.kind === 'drill') {
    p.drillTries++;
    if (score >= DRILL_PASS) p.drillsLeft--;
    if (p.drillTries >= MAX_DRILL_TRIES) p.drillsLeft = 0;
    parts.push(
      p.drillsLeft === 0
        ? `Now let's use ${unitName(newest)} in songs.`
        : score >= DRILL_PASS
          ? 'Good. Once more.'
          : `Let's try that again. Listen for the ${INTERVAL_LABELS[newest.semitones]}.`,
    );
  } else {
    p.recent.push(score);
    if (p.recent.length > 5) p.recent.shift();
    if (score >= 0.95) p.tempoFactor = Math.min(TEMPO_MAX, p.tempoFactor + 0.05);
    else if (score < 0.7) p.tempoFactor = Math.max(TEMPO_MIN, p.tempoFactor - 0.05);

    const known = [...knownSkills(p)];
    const shaky = known.filter((s) => p.skills[s] && boxOf(p, s) === 0).length;
    const recent = p.recent.slice(-WINDOW);
    const ready =
      p.introduced < UNITS.length &&
      [newest.up, newest.down].every((s) => boxOf(p, s) >= STABLE_BOX) &&
      recent.length >= WINDOW &&
      avg(recent) >= INTRODUCE_AT &&
      shaky <= Math.max(1, Math.floor(0.15 * known.length));

    if (ready) {
      change = 'introduce';
      p.introduced++;
      p.drillsLeft = DRILLS_PER_UNIT;
      p.drillTries = 0;
      p.recent = [];
      const u = newestUnit(p);
      parts.push(`Well sung! New pair: ${unitName(u)}. ${unitBlurb(u)}`);
    } else {
      parts.push(score === 1 ? 'Clean!' : score >= 0.75 ? 'Good.' : 'That one was tricky; slowing down a little.');
      const weak = weakestSkill(p);
      if (weak) parts.push(`${describeSkill(weak)} is your weak spot, so you'll see it more.`);
    }
  }

  return { progress: p, score, change, message: parts.join(' ') };
}

/** The known skill (with enough data) that is missed most, if it's missed often. */
export function weakestSkill(p: Progress): string | null {
  let worst: string | null = null;
  let worstRate = 0.25;
  for (const s of knownSkills(p)) {
    const t = p.skills[s];
    if (!t || t.hit + t.miss < 4) continue;
    const rate = t.miss / (t.hit + t.miss);
    if (rate > worstRate) [worst, worstRate] = [s, rate];
  }
  return worst;
}
