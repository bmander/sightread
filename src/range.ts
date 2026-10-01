// The singer's vocal range, and finding it by ear.
//
// Exercises are written on the treble staff but sounded in whatever octave
// suits the singer, so every note the teacher asks for lies within this range.

export interface VoiceRange {
  /** Lowest and highest comfortable MIDI notes. */
  low: number;
  high: number;
}

/** Typical comfortable ranges for the four Sacred Harp parts, highest first. */
export const PARTS: { name: string; range: VoiceRange }[] = [
  { name: 'Treble', range: { low: 60, high: 79 } }, // C4–G5
  { name: 'Alto', range: { low: 53, high: 72 } }, // F3–C5
  { name: 'Tenor', range: { low: 48, high: 67 } }, // C3–G4
  { name: 'Bass', range: { low: 41, high: 60 } }, // F2–C4
];

/** Lessons need at least an octave to fit their octave leaps. */
export const MIN_SPAN = 12;

/** The range lessons are planned in: widened upward to at least an octave. */
export const usableRange = (r: VoiceRange): VoiceRange => ({ low: r.low, high: Math.max(r.high, r.low + MIN_SPAN) });

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** e.g. 57 → "A3" */
export const noteName = (midi: number) => `${NAMES[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;

/** e.g. "G2–E4" */
export const rangeName = (r: VoiceRange) => `${noteName(r.low)}–${noteName(r.high)}`;

export interface Reading {
  time: number;
  midi: number | null;
}

/** How long a note must be held, in seconds, to count. */
const HOLD = 0.8;

/**
 * The note being held at the end of `readings`, or null: over the last
 * HOLD seconds, mostly voiced and nearly all within a semitone band.
 */
export function heldNote(readings: Reading[]): number | null {
  if (!readings.length) return null;
  const end = readings[readings.length - 1].time;
  if (readings[0].time > end - HOLD * 0.9) return null; // not listening long enough yet
  const recent = readings.filter((r) => r.time >= end - HOLD);
  const voiced = recent.flatMap((r) => (r.midi === null ? [] : [r.midi]));
  if (voiced.length < 10 || voiced.length < 0.75 * recent.length) return null;
  const sorted = [...voiced].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const steady = voiced.filter((m) => Math.abs(m - median) <= 0.5).length;
  return steady >= 0.85 * voiced.length ? median : null;
}
