// Turn a stream of detected pitches into per-note right/wrong verdicts.
//
// Singers pick their own octave (men usually an octave below the written
// tenor), so pitches are compared by pitch class: each frame is folded into
// the octave nearest the target. A singer who holds a steady but slightly
// sharp or flat key is not penalised: a global tuning offset (the median
// deviation, capped) is subtracted before judging each note.

import type { Exercise, Note } from './generator';
import { midiOf } from './music';

export interface PitchFrame {
  /** Time in beats from the start of the exercise. */
  beat: number;
  /** Detected pitch as a fractional MIDI number, or null when unvoiced. */
  midi: number | null;
}

export interface NoteVerdict {
  correct: boolean;
  /** Median deviation from the target in cents (after tuning offset), or null if not heard. */
  cents: number | null;
  /** Fraction of the judged window where a pitch was detected. */
  voiced: number;
}

export const TOLERANCE_CENTS = 50;
export const MAX_OFFSET_CENTS = 60;
const MIN_VOICED = 0.3;
const MIN_IN_TUNE = 0.5;

/** Fold `midi` into the octave nearest `target`. */
export function foldToward(midi: number, target: number): number {
  return midi - 12 * Math.round((midi - target) / 12);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The part of a note that is judged: skip the first quarter (attack, scoops,
 * input latency) and the last tenth (moving on to the next note).
 */
function judgedWindow(n: Note): [number, number] {
  return [n.start + Math.min(0.25 * n.beats, 0.5), n.start + n.beats - 0.1 * n.beats];
}

function deviations(ex: Exercise, n: Note, frames: PitchFrame[]) {
  const [from, to] = judgedWindow(n);
  const target = midiOf(ex.key, n.degree);
  const inWindow = frames.filter((f) => f.beat >= from && f.beat < to);
  const devs = inWindow.filter((f) => f.midi !== null).map((f) => 100 * (foldToward(f.midi!, target) - target));
  return { devs, total: inWindow.length };
}

export function judgeNote(ex: Exercise, n: Note, frames: PitchFrame[], offsetCents = 0): NoteVerdict {
  const { devs, total } = deviations(ex, n, frames);
  if (!total || !devs.length) return { correct: false, cents: null, voiced: 0 };
  const voiced = devs.length / total;
  const adjusted = devs.map((c) => c - offsetCents);
  const inTune = adjusted.filter((c) => Math.abs(c) <= TOLERANCE_CENTS).length / devs.length;
  return {
    correct: voiced >= MIN_VOICED && inTune >= MIN_IN_TUNE,
    cents: median(adjusted),
    voiced,
  };
}

/** Estimate the singer's overall tuning offset in cents, capped at ±MAX_OFFSET_CENTS. */
export function tuningOffset(ex: Exercise, frames: PitchFrame[]): number {
  const perNote = ex.notes
    .map((n) => deviations(ex, n, frames).devs)
    .filter((d) => d.length)
    .map(median)
    // A note sung a whole step off shouldn't drag the key estimate.
    .filter((c) => Math.abs(c) <= 150);
  if (!perNote.length) return 0;
  return Math.max(-MAX_OFFSET_CENTS, Math.min(MAX_OFFSET_CENTS, median(perNote)));
}

export function scoreExercise(ex: Exercise, frames: PitchFrame[]): { verdicts: NoteVerdict[]; offsetCents: number } {
  const offsetCents = tuningOffset(ex, frames);
  return { verdicts: ex.notes.map((n) => judgeNote(ex, n, frames, offsetCents)), offsetCents };
}
