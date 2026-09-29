// Core music model for four-shape (fa-sol-la-mi) notation.
//
// Melodies are stored as scale degrees relative to the tonic (0 = tonic,
// 7 = tonic an octave up, -1 = the degree just below the tonic). A Key turns
// degrees into sounding pitches and staff positions.

export type Mode = 'major' | 'minor';
export type Shape = 'fa' | 'sol' | 'la' | 'mi';

export const SHAPES: Shape[] = ['fa', 'sol', 'la', 'mi'];

// In major the tonic is fa; in minor the tonic is la.
const SHAPES_BY_DEGREE: Record<Mode, Shape[]> = {
  major: ['fa', 'sol', 'la', 'fa', 'sol', 'la', 'mi'],
  minor: ['la', 'mi', 'fa', 'sol', 'la', 'fa', 'sol'],
};

const SEMITONES_BY_DEGREE: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface Key {
  name: string;
  mode: Mode;
  tonicMidi: number;
  /** Diatonic staff step of the tonic, counting C0 = 0 (so C4 = 28, E4 = 30). */
  tonicStep: number;
  signature: { type: 'sharp' | 'flat'; count: number };
}

const step = (letter: number, octave: number) => letter + 7 * octave; // letter: C=0 .. B=6

export const KEYS: Key[] = [
  { name: 'C major', mode: 'major', tonicMidi: 60, tonicStep: step(0, 4), signature: { type: 'sharp', count: 0 } },
  { name: 'D major', mode: 'major', tonicMidi: 62, tonicStep: step(1, 4), signature: { type: 'sharp', count: 2 } },
  { name: 'F major', mode: 'major', tonicMidi: 65, tonicStep: step(3, 4), signature: { type: 'flat', count: 1 } },
  { name: 'G major', mode: 'major', tonicMidi: 67, tonicStep: step(4, 4), signature: { type: 'sharp', count: 1 } },
  { name: 'A major', mode: 'major', tonicMidi: 69, tonicStep: step(5, 4), signature: { type: 'sharp', count: 3 } },
  { name: 'A minor', mode: 'minor', tonicMidi: 69, tonicStep: step(5, 4), signature: { type: 'sharp', count: 0 } },
  { name: 'D minor', mode: 'minor', tonicMidi: 62, tonicStep: step(1, 4), signature: { type: 'flat', count: 1 } },
  { name: 'E minor', mode: 'minor', tonicMidi: 64, tonicStep: step(2, 4), signature: { type: 'sharp', count: 1 } },
  { name: 'G minor', mode: 'minor', tonicMidi: 67, tonicStep: step(4, 4), signature: { type: 'flat', count: 2 } },
];

/** Treble-clef staff steps where key-signature accidentals are drawn, in order. */
export const SIGNATURE_STEPS = {
  sharp: [step(3, 5), step(0, 5), step(4, 5)], // F5 C5 G5
  flat: [step(6, 4), step(2, 5)], // B4 E5
};

export function shapeOf(degree: number, mode: Mode): Shape {
  return SHAPES_BY_DEGREE[mode][mod(degree, 7)];
}

export function midiOf(key: Key, degree: number): number {
  return key.tonicMidi + 12 * Math.floor(degree / 7) + SEMITONES_BY_DEGREE[key.mode][mod(degree, 7)];
}

/** Inverse of midiOf, continuous: chromatic pitches land between scale degrees. */
export function degreeOfMidi(key: Key, midi: number): number {
  const rel = midi - key.tonicMidi;
  const octave = Math.floor(rel / 12);
  const r = rel - 12 * octave;
  const s = [...SEMITONES_BY_DEGREE[key.mode], 12];
  let i = 0;
  while (i < 6 && s[i + 1] <= r) i++;
  return 7 * octave + i + (r - s[i]) / (s[i + 1] - s[i]);
}

export function staffStepOf(key: Key, degree: number): number {
  return key.tonicStep + degree;
}

export const INTERVAL_NAMES: Record<number, string> = {
  0: 'repeated notes',
  1: 'steps',
  2: 'thirds',
  3: 'fourths',
  4: 'fifths',
  5: 'sixths',
  6: 'sevenths',
  7: 'octaves',
};
