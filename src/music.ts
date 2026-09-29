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

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
/** Position of each natural letter on the circle of fifths, relative to C. */
const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5];

/** Tonic pitch classes offered to the learner, labelled with their usual spellings. */
export const TONICS: { pc: number; label: string }[] = [
  { pc: 0, label: 'C' }, { pc: 1, label: 'D♭ / C♯' }, { pc: 2, label: 'D' }, { pc: 3, label: 'E♭' },
  { pc: 4, label: 'E' }, { pc: 5, label: 'F' }, { pc: 6, label: 'F♯' }, { pc: 7, label: 'G' },
  { pc: 8, label: 'A♭ / G♯' }, { pc: 9, label: 'A' }, { pc: 10, label: 'B♭' }, { pc: 11, label: 'B' },
];

/**
 * Build the key with tonic pitch class `pc` in `mode`, spelled with the
 * fewest accidentals (D♭ major but C♯ minor). The tonic sits between C4 and
 * B4 so exercises stay on and around the treble staff.
 */
export function keyFor(pc: number, mode: Mode): Key {
  pc = mod(pc, 12);
  let best: { letter: number; acc: number; sig: number } | null = null;
  for (let letter = 0; letter < 7; letter++) {
    for (const acc of [-1, 0, 1]) {
      if (mod(LETTER_PC[letter] + acc, 12) !== pc) continue;
      // Sharps (+) or flats (-) in the signature; minor shares its relative major's.
      const sig = LETTER_FIFTHS[letter] + 7 * acc - (mode === 'minor' ? 3 : 0);
      // On a tie (F♯/G♭ major, D♯/E♭ minor) prefer sharps in major, flats in minor.
      const better =
        !best || Math.abs(sig) < Math.abs(best.sig) || (Math.abs(sig) === Math.abs(best.sig) && (mode === 'major' ? sig > 0 : sig < 0));
      if (better) best = { letter, acc, sig };
    }
  }
  const { letter, acc, sig } = best!;
  const tonicMidi = 60 + pc;
  // The letter's octave can differ from the pitch's at the C/B boundary (e.g. C♭4 = B3).
  const octave = 4 + Math.round((tonicMidi - (60 + LETTER_PC[letter] + acc)) / 12);
  return {
    name: `${LETTERS[letter]}${acc > 0 ? '♯' : acc < 0 ? '♭' : ''} ${mode}`,
    mode,
    tonicMidi,
    tonicStep: step(letter, octave),
    signature: { type: sig < 0 ? 'flat' : 'sharp', count: Math.abs(sig) },
  };
}

/** Keys used when the learner lets the key vary: the ones common in the tunebook. */
export const KEYS: Key[] = [
  ...[0, 2, 5, 7, 9].map((pc) => keyFor(pc, 'major')), // C D F G A
  ...[9, 2, 4, 7].map((pc) => keyFor(pc, 'minor')), // A D E G
];

/** Treble-clef staff steps where key-signature accidentals are drawn, in order. */
export const SIGNATURE_STEPS = {
  sharp: [step(3, 5), step(0, 5), step(4, 5), step(1, 5), step(5, 4), step(2, 5), step(6, 4)], // F C G D A E B
  flat: [step(6, 4), step(2, 5), step(5, 4), step(1, 5), step(4, 4), step(0, 5), step(3, 4)], // B E A D G C F
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
