import { describe, expect, it } from 'vitest';
import { heldNote, noteName, usableRange, type Reading } from './range';

/** Readings every 21 ms for `secs` seconds, pitch from `midi(t)`. */
const sing = (secs: number, midi: (t: number) => number | null): Reading[] =>
  Array.from({ length: Math.round(secs / 0.021) }, (_, i) => ({ time: i * 0.021, midi: midi(i * 0.021) }));

describe('noteName', () => {
  it('names notes with their octave', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(43)).toBe('G2');
    expect(noteName(70)).toBe('B♭4');
  });
});

describe('heldNote', () => {
  it('finds a steady note, slightly wavering', () => {
    expect(heldNote(sing(1.2, (t) => 45 + 0.2 * Math.sin(t * 30)))).toBeCloseTo(45, 0);
  });

  it('ignores a slide that has not settled', () => {
    expect(heldNote(sing(1.2, (t) => 55 - 8 * t))).toBeNull();
  });

  it('settles once a slide stops', () => {
    expect(Math.round(heldNote(sing(2, (t) => (t < 1 ? 55 - 8 * t : 47)))!)).toBe(47);
  });

  it('needs the note held long enough, and mostly voiced', () => {
    expect(heldNote(sing(0.4, () => 50))).toBeNull();
    expect(heldNote(sing(1.2, (t) => (Math.floor(t * 20) % 2 ? null : 50)))).toBeNull();
  });
});

describe('usableRange', () => {
  it('widens a range narrower than an octave', () => {
    expect(usableRange({ low: 50, high: 58 })).toEqual({ low: 50, high: 62 });
    expect(usableRange({ low: 50, high: 70 })).toEqual({ low: 50, high: 70 });
  });
});
