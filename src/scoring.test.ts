import { describe, expect, it } from 'vitest';
import type { Exercise } from './generator';
import { KEYS, midiOf } from './music';
import { foldToward, scoreExercise, type PitchFrame } from './scoring';

const key = KEYS.find((k) => k.name === 'G major')!;
const ex: Exercise = {
  key,
  meter: 4,
  totalBeats: 8,
  notes: [
    { degree: 0, start: 0, beats: 1 },
    { degree: 1, start: 1, beats: 1 },
    { degree: 2, start: 2, beats: 2 },
    { degree: 1, start: 4, beats: 0.5 },
    { degree: 0, start: 4.5, beats: 3.5 },
  ],
};

/** 60 frames per beat, singing `pitchOf(note)` for each note. */
function sing(pitchOf: (i: number, target: number) => number | null): PitchFrame[] {
  const frames: PitchFrame[] = [];
  for (let b = 0; b < ex.totalBeats; b += 1 / 60) {
    const i = ex.notes.findIndex((n) => b >= n.start && b < n.start + n.beats);
    frames.push({ beat: b, midi: pitchOf(i, midiOf(key, ex.notes[i].degree)) });
  }
  return frames;
}

const correct = (frames: PitchFrame[]) => scoreExercise(ex, frames).verdicts.map((v) => v.correct);

describe('scoreExercise', () => {
  it('passes accurate singing', () => {
    expect(correct(sing((_, t) => t))).toEqual([true, true, true, true, true]);
  });

  it('accepts any octave', () => {
    expect(correct(sing((i, t) => t + (i % 2 ? -12 : -24)))).toEqual([true, true, true, true, true]);
  });

  it('forgives a consistently flat singer', () => {
    const { verdicts, offsetCents } = scoreExercise(ex, sing((_, t) => t - 0.4));
    expect(offsetCents).toBeCloseTo(-40);
    expect(verdicts.every((v) => v.correct)).toBe(true);
  });

  it('marks a wrong note and a silent note as missed', () => {
    const frames = sing((i, t) => (i === 2 ? t + 1 : i === 3 ? null : t));
    expect(correct(frames)).toEqual([true, true, false, false, true]);
    const v = scoreExercise(ex, frames).verdicts;
    expect(v[2].cents).toBeCloseTo(100);
    expect(v[3].cents).toBeNull();
  });

  it('ignores a scoop into the note', () => {
    // First 20% of each note is a semitone flat, then settles.
    const frames = sing((_, t) => t).map((f) => {
      const n = ex.notes.find((n) => f.beat >= n.start && f.beat < n.start + n.beats)!;
      return f.beat < n.start + 0.2 * n.beats ? { ...f, midi: f.midi! - 1 } : f;
    });
    expect(correct(frames).every(Boolean)).toBe(true);
  });

  it('folds toward the nearest octave', () => {
    expect(foldToward(55.2, 67)).toBeCloseTo(67.2);
    expect(foldToward(73, 67)).toBe(61);
  });
});

describe('degreeOfMidi', () => {
  it('inverts midiOf for every key', async () => {
    const { degreeOfMidi } = await import('./music');
    for (const k of KEYS) for (let d = -7; d <= 9; d++) expect(degreeOfMidi(k, midiOf(k, d))).toBeCloseTo(d);
  });
});
