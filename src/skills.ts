// Shape-pair skills: the unit of learning.
//
// In four-shape notation the two shapes of a melodic move, plus how far apart
// they sit on the staff, always determine the exact interval, in every key
// and in both major and minor. (La up a step to fa is always a half step; fa
// up a step to sol is always a whole step.) So each such move is a skill to
// learn, practised ascending and descending.
//
// Reading a move also depends on where it sits on the staff, so each
// directed pair is learned separately in each band (low, middle, high): a
// placement.

import { shapeOf, staffStepOf, type Key, type Shape } from './music';

/** An interval between two shapes, learned in both directions. */
export interface Unit {
  id: string;
  /** Lower and upper shape. */
  lo: Shape;
  hi: Shape;
  /** Staff steps between them (1 = second, 2 = third, ... 7 = octave). */
  steps: number;
  semitones: number;
  up: string;
  down: string;
}

/** A directed skill id, e.g. "la↑fa1" (la up a second to fa) or "fa↓la1". */
export function skillId(from: Shape, to: Shape, signedSteps: number): string {
  return `${from}${signedSteps > 0 ? '↑' : '↓'}${to}${Math.abs(signedSteps)}`;
}

/** The skill exercised by moving from degree `a` to degree `b`, or null for a repeated note. */
export function skillOf(key: Key, a: number, b: number): string | null {
  return a === b ? null : skillId(shapeOf(a, key.mode), shapeOf(b, key.mode), b - a);
}

const unit = (lo: Shape, hi: Shape, steps: number, semitones: number): Unit => ({
  id: `${lo}-${hi}${steps}`,
  lo,
  hi,
  steps,
  semitones,
  up: skillId(lo, hi, steps),
  down: skillId(hi, lo, -steps),
});

/**
 * The curriculum, in the order pairs are introduced: steps first (starting
 * around the tonic), then the triad's thirds, the cadential fourths and
 * fifths, sixths, and octaves. Tritones (fa up to mi, mi up to fa) are left out.
 */
export const UNITS: Unit[] = [
  // Seconds
  unit('fa', 'sol', 1, 2),
  unit('sol', 'la', 1, 2),
  unit('mi', 'fa', 1, 1),
  unit('la', 'fa', 1, 1),
  unit('la', 'mi', 1, 2),
  // Thirds
  unit('fa', 'la', 2, 4),
  unit('la', 'sol', 2, 3),
  unit('mi', 'sol', 2, 3),
  unit('sol', 'fa', 2, 3),
  unit('la', 'fa', 2, 3),
  unit('sol', 'mi', 2, 4),
  // Fourths and fifths, cadential ones first
  unit('sol', 'fa', 3, 5),
  unit('fa', 'sol', 4, 7),
  unit('fa', 'fa', 3, 5),
  unit('fa', 'fa', 4, 7),
  unit('sol', 'sol', 3, 5),
  unit('la', 'la', 3, 5),
  unit('mi', 'la', 3, 5),
  unit('la', 'mi', 4, 7),
  unit('la', 'sol', 3, 5),
  unit('sol', 'sol', 4, 7),
  unit('la', 'la', 4, 7),
  unit('sol', 'la', 4, 7),
  // Sixths
  unit('fa', 'la', 5, 9),
  unit('la', 'fa', 5, 8),
  unit('sol', 'mi', 5, 9),
  unit('mi', 'sol', 5, 8),
  unit('fa', 'sol', 5, 9),
  unit('sol', 'la', 5, 9),
  // Octaves
  unit('fa', 'fa', 7, 12),
  unit('sol', 'sol', 7, 12),
  unit('la', 'la', 7, 12),
  unit('mi', 'mi', 7, 12),
];

const UNIT_BY_SKILL = new Map(UNITS.flatMap((u) => [[u.up, u], [u.down, u]] as const));

export const unitOfSkill = (skill: string) => UNIT_BY_SKILL.get(skill);

export const INTERVAL_LABELS: Record<number, string> = {
  1: 'half step',
  2: 'whole step',
  3: 'minor third',
  4: 'major third',
  5: 'perfect fourth',
  7: 'perfect fifth',
  8: 'minor sixth',
  9: 'major sixth',
  12: 'octave',
};

/** Staff distance as an interval number, e.g. 1 step → "2nd". */
export const STEP_LABELS: Record<number, string> = { 1: '2nd', 2: '3rd', 3: '4th', 4: '5th', 5: '6th', 7: '8ve' };

/** e.g. "la–fa (half step)"; the interval disambiguates pairs like la–fa a step vs a third. */
export const unitName = (u: Unit) => `${u.lo}–${u.hi} (${INTERVAL_LABELS[u.semitones]})`;

/** e.g. "la ↑ fa · half step" */
export function describeSkill(skill: string): string {
  const u = unitOfSkill(skill);
  if (!u) return skill;
  const [from, to] = skill === u.up ? [u.lo, u.hi] : [u.hi, u.lo];
  return `${from} ${skill === u.up ? '↑' : '↓'} ${to} · ${INTERVAL_LABELS[u.semitones]}`;
}

/** A part of the treble staff. */
export type Band = 'low' | 'mid' | 'high';
export const BANDS: Band[] = ['low', 'mid', 'high'];
export const BAND_NAMES: Record<Band, string> = { low: 'low on the staff', mid: 'mid-staff', high: 'high on the staff' };

/**
 * The band a move sits in, by the midpoint of its two notes: low is below G4
 * (the second line), high from D5 (the fourth line) up.
 */
export function bandOf(key: Key, a: number, b: number): Band {
  const mid = (staffStepOf(key, a) + staffStepOf(key, b)) / 2;
  return mid < 32 ? 'low' : mid < 36 ? 'mid' : 'high';
}

/** A directed skill in one band, e.g. "la↑fa1@high". */
export const placementId = (skill: string, band: Band) => `${skill}@${band}`;

export function splitPlacement(id: string): [string, Band] {
  const at = id.lastIndexOf('@');
  return [id.slice(0, at), id.slice(at + 1) as Band];
}

/** The placement exercised by moving from degree `a` to degree `b`, or null for a repeated note. */
export function placementOf(key: Key, a: number, b: number): string | null {
  const s = skillOf(key, a, b);
  return s && placementId(s, bandOf(key, a, b));
}

/** e.g. "la ↑ fa · half step, high on the staff" */
export function describePlacement(id: string): string {
  const [skill, band] = splitPlacement(id);
  return `${describeSkill(skill)}, ${BAND_NAMES[band]}`;
}
