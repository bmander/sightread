import { describe, expect, it } from 'vitest';
import { detectPitch, freqToMidi } from './pitch';

const SR = 48000;

/** A voice-like tone: fundamental plus decaying harmonics, with a little noise. */
function tone(freq: number, n = 2048, noise = 0.02, seed = 1): Float32Array {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * freq * h * t) / h ** 1.3;
    buf[i] = 0.3 * v + noise * rand();
  }
  return buf;
}

describe('detectPitch', () => {
  it.each([82.4, 110, 146.8, 196, 261.6, 349.2, 440, 587.3, 784])('finds %f Hz within 10 cents', (f) => {
    const est = detectPitch(tone(f), SR);
    expect(est).not.toBeNull();
    expect(Math.abs(1200 * Math.log2(est!.freq / f))).toBeLessThan(10);
    expect(est!.clarity).toBeGreaterThan(0.8);
  });

  it('does not jump an octave when the fundamental is weak', () => {
    const f = 220;
    const buf = new Float32Array(2048);
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR;
      buf[i] = 0.05 * Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t) + 0.2 * Math.sin(2 * Math.PI * 3 * f * t);
    }
    const est = detectPitch(buf, SR)!;
    expect(Math.abs(1200 * Math.log2(est.freq / f))).toBeLessThan(10);
  });

  it('returns null for silence and for noise', () => {
    expect(detectPitch(new Float32Array(2048), SR)).toBeNull();
    let s = 7;
    const noise = Float32Array.from({ length: 2048 }, () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
    expect(detectPitch(noise, SR)).toBeNull();
  });

  it('converts frequency to MIDI', () => {
    expect(freqToMidi(440)).toBeCloseTo(69);
    expect(freqToMidi(261.63)).toBeCloseTo(60, 2);
  });
});
