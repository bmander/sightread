// Minimal Web Audio synth: sung-ish tones and metronome clicks, all scheduled
// ahead on the audio clock. Each run gets its own bus so it can be cut off.

export class Sound {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;

  get now(): number {
    return this.context.currentTime;
  }

  get context(): AudioContext {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Stop anything scheduled on the previous bus and start a fresh one. */
  reset(): void {
    this.stop();
    this.bus = this.context.createGain();
    this.bus.connect(this.context.destination);
  }

  stop(): void {
    this.bus?.disconnect();
    this.bus = null;
  }

  tone(midi: number, when: number, dur: number, vol = 0.22): void {
    if (!this.bus) this.reset();
    const ctx = this.context;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const env = ctx.createGain();
    const end = when + Math.max(0.08, dur - 0.04);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(vol, when + 0.03);
    env.gain.linearRampToValueAtTime(vol * 0.7, when + 0.2);
    env.gain.setValueAtTime(vol * 0.7, end);
    env.gain.linearRampToValueAtTime(0, end + 0.08);
    env.connect(this.bus!);

    for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 2, 0.25]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * mult;
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(when);
      osc.stop(end + 0.1);
    }
  }

  click(when: number, accent: boolean): void {
    if (!this.bus) this.reset();
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1100;
    env.gain.setValueAtTime(accent ? 0.3 : 0.18, when);
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(env).connect(this.bus!);
    osc.start(when);
    osc.stop(when + 0.06);
  }
}
