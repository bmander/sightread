// Monophonic pitch detection using the YIN algorithm
// (de Cheveigné & Kawahara, 2002), tuned for the singing voice.

export interface PitchEstimate {
  freq: number;
  /** 0..1; how periodic the frame is (1 - YIN's aperiodicity). */
  clarity: number;
}

export interface DetectOptions {
  minHz?: number;
  maxHz?: number;
  /** YIN absolute threshold; lower is stricter. */
  threshold?: number;
  /** Frames quieter than this RMS are treated as silence. */
  minRms?: number;
}

export function detectPitch(buf: Float32Array, sampleRate: number, opts: DetectOptions = {}): PitchEstimate | null {
  const { minHz = 70, maxHz = 1000, threshold = 0.15, minRms = 0.006 } = opts;

  let sq = 0;
  for (let i = 0; i < buf.length; i++) sq += buf[i] * buf[i];
  if (Math.sqrt(sq / buf.length) < minRms) return null;

  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(buf.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const width = buf.length - maxTau;

  // Difference function, then cumulative mean normalisation.
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // First dip below threshold, followed down to its local minimum.
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // Parabolic interpolation for sub-sample accuracy.
  let better = tau;
  if (tau > 1 && tau < maxTau) {
    const a = d[tau - 1];
    const b = d[tau];
    const c = d[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) better = tau + (a - c) / (2 * denom);
  }
  return { freq: sampleRate / better, clarity: 1 - d[tau] };
}

export const freqToMidi = (freq: number) => 69 + 12 * Math.log2(freq / 440);
