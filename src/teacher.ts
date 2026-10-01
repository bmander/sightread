// The adaptive teacher.
//
// The curriculum is the ordered list of shape pairs in skills.ts. Each new
// pair is introduced with a short drill built around it, then joins the
// "songs": exercises that use only pairs already introduced, weighted toward
// pairs that are new, due for review, or often missed. Every directed pair
// (la↑fa and fa↓la are separate) has its own Leitner box in each band of the
// staff it can reach (a placement): a clean exercise moves it up a box once
// it is due, a miss drops it back. Each lesson is laid out around the
// placement most in need, so practice moves around the staff. The next pair
// is introduced only once every placement of every pair is stable and recent
// songs are going well. Rhythm, meter, length and tempo unlock with the
// number of pairs learned.

import { generateExercise, pick, type Exercise, type GenParams, type RhythmCellId, type Rng } from './generator';
import { keyFor, KEYS, midiOf, shapeOf, SHAPES, type Key, type Mode, type Shape } from './music';
import { usableRange, type VoiceRange } from './range';
import {
  BAND_NAMES,
  bandOf,
  describePlacement,
  INTERVAL_LABELS,
  placementId,
  placementOf,
  skillOf,
  splitPlacement,
  unitName,
  UNITS,
  unitOfSkill,
  type Band,
  type Unit,
} from './skills';

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
  version: 3;
  /** How many of UNITS have been introduced. */
  introduced: number;
  /** Passing drills still needed on the newest pair before songs. */
  drillsLeft: number;
  drillTries: number;
  /** By placement id (see skills.ts). */
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
/** A placement counts as learned (and its syllables stop being printed) from this box up. */
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
    version: 3,
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
export const boxOf = (p: Progress, placement: string) => p.skills[placement]?.box ?? 0;
const isYoung = (p: Progress, placement: string) => boxOf(p, placement) < STABLE_BOX;

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
  /** The band of the staff the lesson is centred on. */
  band: Band;
  /** The tonic degree the exercise is centred on, for pitching the key. */
  home: number;
  /** Octaves to sound the written notes up (or down, if negative) to suit the singer. */
  shift: number;
  /** Per note: print its syllable. */
  syllables: boolean[];
  /** Per note: arrived at via the newest pair, while it is still being learned. */
  focus: boolean[];
  tempo: number;
  title: string;
  blurb: string;
}

/** Lowest and highest staff steps used: two ledger lines either side of the staff (A3 to C6). */
const STAFF_LO = 26;
const STAFF_HI = 42;

/** The learner's choices that shape lessons: a fixed key (or null to vary it) and their vocal range, if known. */
export interface Setup {
  tonic: number | null;
  range: VoiceRange | null;
}

const ANY: Setup = { tonic: null, range: null };

const modesFor = (introduced: number): Mode[] => (introduced >= MINOR_AT ? ['major', 'minor'] : ['major']);

function keysFor(tonic: number | null, modes: Mode[]): Key[] {
  return tonic === null ? KEYS.filter((k) => modes.includes(k.mode)) : modes.map((m) => keyFor(tonic, m));
}

/**
 * One way to lay out an exercise: a key, the tonic it is centred on, the
 * degrees it may use (within the staff window, and the singer's range if
 * known, else about an octave and a half around that tonic), the octaves to
 * shift it by to sound in that range, and the placements a melody there can
 * reach.
 */
interface Layout {
  key: Key;
  home: number;
  range: [number, number];
  shift: number;
  placements: Set<string>;
}

/**
 * The degree windows within `base` that fit the singer's range when sounded
 * some octaves up or down, each with that shift (centring the window in the
 * range when several shifts give the same window). Each contains `home`.
 */
function fitsFor(key: Key, home: number, base: [number, number], voice: VoiceRange | null) {
  if (!voice) return [{ range: base, shift: 0 }];
  const { low, high } = usableRange(voice);
  const centre = (low + high) / 2;
  const best = new Map<string, { range: [number, number]; shift: number; off: number }>();
  const h = midiOf(key, home);
  for (let shift = Math.ceil((low - h) / 12); shift <= Math.floor((high - h) / 12); shift++) {
    const fits = (d: number) => midiOf(key, d) + 12 * shift >= low && midiOf(key, d) + 12 * shift <= high;
    let [a, b] = [home, home];
    while (a > base[0] && fits(a - 1)) a--;
    while (b < base[1] && fits(b + 1)) b++;
    const off = Math.abs((midiOf(key, a) + midiOf(key, b)) / 2 + 12 * shift - centre);
    const prev = best.get(`${a},${b}`);
    if (!prev || off < prev.off) best.set(`${a},${b}`, { range: [a, b], shift, off });
  }
  return [...best.values()];
}

/** Placements a melody in `range` can reach: those joined to a tonic by known moves, so it can get there and back. */
function reachable(key: Key, range: [number, number], skills: Set<string>): Set<string> {
  const tonics = [-14, -7, 0, 7, 14].filter((t) => t >= range[0] && t <= range[1]);
  const linked = new Set(tonics);
  const placements = new Set<string>();
  for (let todo = [...tonics]; todo.length; ) {
    const a = todo.pop()!;
    for (let b = range[0]; b <= range[1]; b++) {
      const s = skillOf(key, a, b);
      if (!s || !skills.has(s)) continue;
      placements.add(placementOf(key, a, b)!).add(placementOf(key, b, a)!);
      if (!linked.has(b)) todo.push(b), linked.add(b);
    }
  }
  return placements;
}

function layoutsFor(skills: Set<string>, keys: Key[], voice: VoiceRange | null): Layout[] {
  return keys.flatMap((key) => {
    const [lo, hi] = [STAFF_LO - key.tonicStep, STAFF_HI - key.tonicStep];
    return [-14, -7, 0, 7, 14]
      .filter((home) => home >= lo && home <= hi)
      .flatMap((home) =>
        fitsFor(key, home, voice ? [lo, hi] : [Math.max(home - 5, lo), Math.min(home + 9, hi)], voice).map(({ range, shift }) => ({
          key,
          home,
          range,
          shift,
          placements: reachable(key, range, skills),
        })),
      );
  });
}

/** Every placement of the introduced pairs that lessons can reach with this setup. */
export function placementsInPlay(p: Progress, setup: Setup): Set<string> {
  const layouts = layoutsFor(knownSkills(p), keysFor(setup.tonic, modesFor(p.introduced)), setup.range);
  return new Set(layouts.flatMap((l) => [...l.placements]));
}

/** Placements in play that are not yet stable; the next pair waits for these. */
export const unsolidPlacements = (p: Progress, setup: Setup) =>
  [...placementsInPlay(p, setup)].filter((id) => isYoung(p, id));

/** A layout that reaches `target`, in minor about a third of the time when both modes can. */
function pickLayout(rng: Rng, layouts: Layout[], target: string): Layout {
  const fits = layouts.filter((l) => l.placements.has(target));
  const minor = fits.filter((l) => l.key.mode === 'minor');
  const major = fits.filter((l) => l.key.mode === 'major');
  return pick(rng, minor.length && (!major.length || rng() < 0.35) ? minor : major);
}

/** How much a placement wants practice: new, shaky, due or often missed. */
function need(p: Progress, id: string): number {
  const st = p.skills[id];
  let w = st && st.box > 0 ? (st.box === 1 ? 1.6 : 1) : 2.5;
  if (!st || p.sung >= st.due) w *= 1.8; // due for review
  return w * (1 + 1.5 * missRate(st));
}

/** Placement ids of each move in an exercise (null for repeated notes and the first note). */
export function movesOf(ex: Exercise): (string | null)[] {
  return ex.notes.map((n, i) => (i ? placementOf(ex.key, ex.notes[i - 1].degree, n.degree) : null));
}

/** Plan the next exercise: a drill on the newest pair, or a song. */
export function planLesson(p: Progress, rng: Rng, setup: Setup = ANY): Lesson {
  const { tonic, range: voice } = setup;
  const newest = newestUnit(p);
  const isNewest = (id: string | null) => id !== null && unitOfSkill(splitPlacement(id)[0]) === newest;
  const stage = stageFor(p.introduced);
  const tempo = Math.round(stage.tempo * p.tempoFactor);
  const allowed = knownSkills(p);
  const young = (id: string | null) => id !== null && isYoung(p, id);

  // Drill the newest pair where it is weakest, in a major key, unless it can't be sung in this setup.
  let drillLayouts = layoutsFor(allowed, keysFor(tonic, ['major']), voice);
  const reached = (l: Layout) => [...l.placements].some(isNewest);
  if (!drillLayouts.some(reached)) drillLayouts = layoutsFor(allowed, keysFor(tonic, modesFor(p.introduced)), voice);
  const options = [...new Set(drillLayouts.flatMap((l) => [...l.placements].filter(isNewest)))];
  if (p.drillsLeft > 0 && options.length) {
    const layouts = drillLayouts;
    const lowest = Math.min(...options.map((id) => boxOf(p, id)));
    const target = pick(rng, options.filter((id) => boxOf(p, id) === lowest));
    const layout = pickLayout(rng, layouts, target);
    const params: GenParams = {
      key: layout.key,
      range: layout.range,
      allowed,
      weight: (s, a, b) => {
        const id = placementId(s, bandOf(layout.key, a, b));
        return id === target ? 12 : isNewest(id) ? 4 : 0.6;
      },
      starts: [layout.home],
      rhythms: ['q', 'h'],
      meters: [4],
      measures: 3,
    };
    // Keep the candidate that features the new pair, in the target band, most often.
    let best: Exercise | null = null;
    let bestScore = -1;
    for (let i = 0; i < 12; i++) {
      const ex = generateExercise(params, rng);
      const moves = movesOf(ex);
      const score = 3 * moves.filter((id) => id === target).length + moves.filter(isNewest).length;
      if (score > bestScore) [best, bestScore] = [ex, score];
    }
    const moves = movesOf(best!);
    const band = splitPlacement(target)[1];
    return {
      kind: 'drill',
      exercise: best!,
      unit: newest,
      band,
      home: layout.home,
      shift: layout.shift,
      syllables: moves.map(() => true),
      focus: moves.map(isNewest),
      tempo: Math.min(tempo, stage.tempo),
      title: `New pair: ${unitName(newest)}`,
      blurb: `${unitBlurb(newest)} This drill sits ${BAND_NAMES[band]}.`,
    };
  }

  // Centre the song on the placement most in need, then favour needy placements throughout.
  const layouts = layoutsFor(allowed, keysFor(tonic, modesFor(p.introduced)), voice);
  const inPlay = [...new Set(layouts.flatMap((l) => [...l.placements]))];
  const target = inPlay.length ? pick(rng, inPlay, inPlay.map((id) => need(p, id) ** 2)) : null;
  const layout = target ? pickLayout(rng, layouts, target) : pick(rng, layouts);
  const params: GenParams = {
    key: layout.key,
    range: layout.range,
    allowed,
    weight: (s, a, b) => {
      const id = placementId(s, bandOf(layout.key, a, b));
      return need(p, id) * (isNewest(id) ? 2 : 1) * (id === target ? 4 : 1);
    },
    starts: p.introduced >= 6 ? [0, 2, 4, -3].map((d) => layout.home + d) : [layout.home],
    ...stage,
  };
  let exercise = generateExercise(params, rng);
  for (let i = 0; target && i < 5 && !movesOf(exercise).includes(target); i++) exercise = generateExercise(params, rng);
  const moves = movesOf(exercise);
  const syllables = moves.map((into, i) => young(into) || young(moves[i + 1] ?? null));
  const band = target ? splitPlacement(target)[1] : bandOf(layout.key, layout.home, layout.home);
  return {
    kind: 'song',
    exercise,
    unit: null,
    band,
    home: layout.home,
    shift: layout.shift,
    syllables,
    focus: moves.map((id) => isNewest(id) && young(id)),
    tempo,
    title: `Song · ${p.introduced} ${p.introduced === 1 ? 'pair' : 'pairs'}`,
    blurb:
      (syllables.some(Boolean)
        ? 'Built from the pairs you know. Syllables are printed only where a pair is still new to that part of the staff.'
        : 'Built from the pairs you know. Read the shapes alone.') + ` This one sits ${BAND_NAMES[band]}.`,
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
 * move is credited to its placement when the note it arrives at was right.
 * `setup` decides the placements in play.
 * Returns a new Progress (the input is not mutated).
 */
export function applyResult(prev: Progress, lesson: Lesson, correct: boolean[], setup: Setup = ANY): Outcome {
  const p: Progress = structuredClone(prev);
  const ex = lesson.exercise;
  const score = correct.filter(Boolean).length / correct.length;
  p.sung++;

  ex.notes.forEach((n, i) => p.shapes[shapeOf(n.degree, ex.key.mode)][correct[i] ? 'hit' : 'miss']++);

  // Tally each move, then update each placement's box once for this exercise.
  const seen = new Map<string, Tally>();
  movesOf(ex).forEach((s, i) => {
    if (!s || !unitOfSkill(splitPlacement(s)[0])) return;
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

    const unsolid = unsolidPlacements(p, setup).length;
    const recent = p.recent.slice(-WINDOW);
    const ready = p.introduced < UNITS.length && unsolid === 0 && recent.length >= WINDOW && avg(recent) >= INTRODUCE_AT;

    if (ready) {
      change = 'introduce';
      p.introduced++;
      p.drillTries = 0;
      p.recent = [];
      const u = newestUnit(p);
      const singable = [...placementsInPlay(p, setup)].some((id) => unitOfSkill(splitPlacement(id)[0]) === u);
      p.drillsLeft = singable ? DRILLS_PER_UNIT : 0;
      parts.push(
        singable
          ? `Well sung! New pair: ${unitName(u)}. ${unitBlurb(u)}`
          : `Well sung! The next pair, ${unitName(u)}, doesn't fit your range in this key yet, so on we go.`,
      );
    } else {
      parts.push(score === 1 ? 'Clean!' : score >= 0.75 ? 'Good.' : 'That one was tricky; slowing down a little.');
      const weak = weakestPlacement(p);
      if (weak) parts.push(`${describePlacement(weak)} is your weak spot, so you'll see it more.`);
      else if (unsolid && p.introduced < UNITS.length)
        parts.push(`${unsolid} ${unsolid === 1 ? 'placement' : 'placements'} on the staff to make solid before the next pair.`);
    }
  }

  return { progress: p, score, change, message: parts.join(' ') };
}

/** The placement of a known pair (with enough data) that is missed most, if it's missed often. */
export function weakestPlacement(p: Progress): string | null {
  const known = knownSkills(p);
  let worst: string | null = null;
  let worstRate = 0.25;
  for (const [id, t] of Object.entries(p.skills)) {
    if (!known.has(splitPlacement(id)[0]) || t.hit + t.miss < 4) continue;
    const rate = t.miss / (t.hit + t.miss);
    if (rate > worstRate) [worst, worstRate] = [id, rate];
  }
  return worst;
}
