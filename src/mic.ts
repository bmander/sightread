// Microphone input. An AudioWorklet taps the mic on the audio thread and posts
// overlapping sample windows with their audio-clock timestamps, so pitch data
// keeps flowing even when animation frames are slow or paused. Each window is
// run through the pitch detector as it arrives.

import { detectPitch, freqToMidi } from './pitch';

export interface MicReading {
  /** Audio-clock time the analysed window is centred on. */
  time: number;
  midi: number | null;
}

const WINDOW = 2048;
const HOP = 1024; // ~21 ms at 48 kHz

const WORKLET = `
class PitchTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(${WINDOW});
    this.filled = 0;
    this.sinceHop = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this.buf.copyWithin(0, ch.length);
    this.buf.set(ch, this.buf.length - ch.length);
    this.filled = Math.min(this.buf.length, this.filled + ch.length);
    this.sinceHop += ch.length;
    if (this.sinceHop >= ${HOP} && this.filled === this.buf.length) {
      this.sinceHop = 0;
      const end = currentTime + ch.length / sampleRate;
      this.port.postMessage({ centre: end - this.buf.length / 2 / sampleRate, samples: this.buf.slice() });
    }
    return true;
  }
}
registerProcessor('pitch-tap', PitchTap);
`;

export class Mic {
  onReading: (r: MicReading) => void = () => {};
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: Promise<void> | null = null;
  private static loaded = new WeakSet<AudioContext>();

  get active(): boolean {
    return this.node !== null;
  }

  /** Open the mic. Safe to call repeatedly; concurrent calls share one request. */
  start(ctx: AudioContext): Promise<void> {
    if (this.active) return Promise.resolve();
    this.pending ??= this.open(ctx).finally(() => (this.pending = null));
    return this.pending;
  }

  private async open(ctx: AudioContext): Promise<void> {
    if (!Mic.loaded.has(ctx)) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      Mic.loaded.add(ctx);
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation keeps the metronome and pitch tones out of the
      // signal; noise suppression and AGC would distort a sustained voice.
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    const node = new AudioWorkletNode(ctx, 'pitch-tap');
    node.port.onmessage = (e: MessageEvent<{ centre: number; samples: Float32Array }>) => {
      const est = detectPitch(e.data.samples, ctx.sampleRate);
      this.onReading({
        time: e.data.centre - (ctx.baseLatency || 0),
        midi: est && est.clarity > 0.8 ? freqToMidi(est.freq) : null,
      });
    };
    // The worklet must be pulled by the graph to run; route it to a muted gain.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaStreamSource(this.stream).connect(node).connect(mute).connect(ctx.destination);
    this.node = node;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.port.close();
    this.node?.disconnect();
    this.stream = null;
    this.node = null;
  }
}
