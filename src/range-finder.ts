// The range finder: before lessons start, find the notes the singer can
// comfortably reach, by ear through the microphone or by picking a part.

import type { Sound } from './audio';
import { heldNote, noteName, PARTS, rangeName, MIN_SPAN, type Reading, type VoiceRange } from './range';

type Step = 'intro' | 'low' | 'high' | 'review';

export interface RangeFinderOptions {
  sound: Sound;
  /** Open the microphone; resolves to an error message, or null once listening. */
  openMic: () => Promise<string | null>;
  /** The range found so far, to start from when adjusting. */
  current: VoiceRange | null;
  /** Called with the chosen range, or null if the singer skipped. */
  onDone: (range: VoiceRange | null) => void;
}

export class RangeFinder {
  private step: Step = 'intro';
  private readings: Reading[] = [];
  private hearing: number | null = null;
  private low: number | null = null;
  private high: number | null = null;
  private note = '';

  constructor(
    private el: HTMLElement,
    private opts: RangeFinderOptions,
  ) {
    if (opts.current) [this.low, this.high] = [opts.current.low, opts.current.high];
    el.addEventListener('click', this.onClick);
    this.render();
  }

  close(): void {
    this.el.removeEventListener('click', this.onClick);
    this.el.replaceChildren();
  }

  /** Feed a microphone reading. */
  hear(r: Reading): void {
    if (this.step !== 'low' && this.step !== 'high') return;
    this.readings.push(r);
    while (this.readings.length && this.readings[0].time < r.time - 2) this.readings.shift();
    this.hearing = r.midi;
    const held = heldNote(this.readings);
    if (held !== null) {
      const n = Math.round(held);
      if (this.step === 'low') this.low = this.low === null ? n : Math.min(this.low, n);
      else this.high = this.high === null ? n : Math.max(this.high, n);
    }
    this.renderLive();
  }

  private go(step: Step): void {
    this.step = step;
    this.readings = [];
    this.hearing = null;
    if (step === 'low') this.low = null;
    if (step === 'high') this.high = null;
    if (step === 'review') {
      const [lo, hi] = [Math.min(this.low!, this.high!), Math.max(this.low!, this.high!)];
      [this.low, this.high] = [lo, Math.max(hi, lo + 1)];
    }
    this.render();
  }

  private play(midi: number): void {
    const s = this.opts.sound;
    s.reset();
    s.tone(midi, s.now + 0.05, 1.2);
  }

  private onClick = async (e: Event) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    const act = b.dataset.act!;
    const arg = Number(b.dataset.arg);
    if (act === 'measure') {
      this.note = '';
      const err = await this.opts.openMic();
      if (err) {
        this.note = `Couldn't open the microphone (${err}). Pick your part instead.`;
        this.render();
      } else this.go('low');
    } else if (act === 'part') {
      [this.low, this.high] = [PARTS[arg].range.low, PARTS[arg].range.high];
      this.go('review');
    } else if (act === 'next') {
      this.go(this.step === 'low' ? 'high' : 'review');
    } else if (act === 'back') {
      this.go('intro');
    } else if (act === 'nudge-low') {
      this.low = Math.min(this.low! + arg, this.high! - 1);
      this.render();
    } else if (act === 'nudge-high') {
      this.high = Math.max(this.high! + arg, this.low! + 1);
      this.render();
    } else if (act === 'play') {
      this.play(arg);
    } else if (act === 'use') {
      this.opts.onDone({ low: this.low!, high: this.high! });
    } else if (act === 'skip') {
      this.opts.onDone(null);
    }
  };

  private render(): void {
    const btn = (label: string, act: string, arg: number | string = '', cls = '') =>
      `<button data-act="${act}" data-arg="${arg}" class="${cls}">${label}</button>`;
    const note = this.note ? `<p class="muted">${this.note}</p>` : '';
    let body = '';
    if (this.step === 'intro') {
      body = `
        <h2>Find your range</h2>
        <p>Every exercise will sound where you can sing it. Sing your lowest and highest comfortable notes into the microphone, or pick your part.</p>
        <div class="row">${btn('Measure with the microphone', 'measure', '', 'primary')}</div>
        <div class="row">${PARTS.map((p, i) => btn(`${p.name} <span class="muted">${rangeName(p.range)}</span>`, 'part', i)).join('')}</div>
        ${note}
        <div class="row">${btn(this.opts.current ? 'Keep my current range' : 'Skip for now', 'skip', '', 'subtle')}</div>`;
    } else if (this.step === 'low' || this.step === 'high') {
      const low = this.step === 'low';
      const found = low ? this.low : this.high;
      body = `
        <h2>${low ? 'Your lowest note' : 'Your highest note'}</h2>
        <p>Sing “ah” and slide ${low ? 'down' : 'up'} to the ${low ? 'lowest' : 'highest'} note you can sing comfortably, without ${low ? 'growling' : 'straining'}. Hold it for a moment.</p>
        <p class="live">Hearing <b data-live="hearing">…</b> · ${low ? 'Lowest' : 'Highest'} held <b data-live="found">–</b></p>
        <div class="row">${btn(low ? 'That’s my lowest' : 'That’s my highest', 'next', '', 'primary')}${btn('Back', 'back', '', 'subtle')}</div>`;
      this.el.innerHTML = `<div class="range-card">${body}</div>`;
      this.renderLive();
      this.el.querySelector<HTMLButtonElement>('[data-act="next"]')!.disabled = found === null;
      return;
    } else {
      const lo = this.low!;
      const hi = this.high!;
      const span = hi - lo;
      const nudges = (which: 'low' | 'high', midi: number) =>
        `${btn('−', `nudge-${which}`, -1)}<b class="pitch">${noteName(midi)}</b>${btn('+', `nudge-${which}`, 1)}${btn('▶', 'play', midi, 'subtle')}`;
      body = `
        <h2>Your range: ${noteName(lo)}–${noteName(hi)}</h2>
        <p>${Math.floor(span / 12) ? `${Math.floor(span / 12)} octave${span >= 24 ? 's' : ''}` : ''}${span % 12 ? `${span >= 12 ? ' and ' : ''}${span % 12} semitone${span % 12 > 1 ? 's' : ''}` : ''}. Play each end to check it, and nudge it if it doesn't feel right.</p>
        ${span < MIN_SPAN ? `<p class="muted">That's less than an octave. Lessons still need one, so sing any note above ${noteName(hi)} an octave lower.</p>` : ''}
        <div class="row nudge"><span class="label">Lowest</span>${nudges('low', lo)}</div>
        <div class="row nudge"><span class="label">Highest</span>${nudges('high', hi)}</div>
        <div class="row">${btn('Use this range', 'use', '', 'primary')}${btn('Start over', 'back', '', 'subtle')}</div>`;
    }
    this.el.innerHTML = `<div class="range-card">${body}</div>`;
  }

  /** Update just the live readouts while listening, so the buttons don't flicker. */
  private renderLive(): void {
    const found = this.step === 'low' ? this.low : this.high;
    const set = (k: string, v: string) => {
      const el = this.el.querySelector(`[data-live="${k}"]`);
      if (el) el.textContent = v;
    };
    set('hearing', this.hearing === null ? '…' : noteName(this.hearing));
    set('found', found === null ? '–' : noteName(found));
    const next = this.el.querySelector<HTMLButtonElement>('[data-act="next"]');
    if (next) next.disabled = found === null;
  }
}
