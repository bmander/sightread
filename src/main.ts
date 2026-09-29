import './style.css';
import { Sound } from './audio';
import { applyResult, effectiveTempo, LEVELS, PROMOTE_AT, WINDOW, weakestInterval, weightingFor, type Progress } from './curriculum';
import { generateExercise, makeRng, type Exercise } from './generator';
import { Mic, type MicReading } from './mic';
import { degreeOfMidi, INTERVAL_NAMES, midiOf, mod, SHAPES, shapeOf, TONICS } from './music';
import { headerWidthOf, PitchTrace, renderScore, type Score } from './render';
import { judgeNote, scoreExercise, tuningOffset, type NoteVerdict, type PitchFrame } from './scoring';
import { clearProgress, loadProgress, loadSettings, saveProgress, saveSettings, type Settings } from './store';

type Phase = 'idle' | 'running' | 'review';

// Sacred Harp beat patterns: the hand goes down, then up.
const HAND: Record<number, string[]> = { 2: ['↓', '↑'], 3: ['↓', '↓', '↑'], 4: ['↓', '↓', '↑', '↑'] };
const PX_PER_BEAT = 80;
/** Distance from the end of the staff header to the playhead while scrolling. */
const PLAYHEAD_GAP = 90;
const INTRO_SECONDS = 2.2;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

class App {
  progress: Progress = loadProgress();
  settings: Settings = loadSettings();
  sound = new Sound();
  phase: Phase = 'idle';
  exercise!: Exercise;
  tempo = 60;
  score!: Score;
  missed: boolean[] = [];
  /** False once the learner has heard the answer (guide tones, retry). */
  scored = true;
  run: { exStart: number; spb: number; introEnd: number; countIn: number } | null = null;
  playbackTimer = 0;
  seed = Date.now() >>> 0;
  mic = new Mic();
  /** Pitches heard during the current run, in exercise beats. */
  frames: PitchFrame[] = [];
  trace: PitchTrace | null = null;
  /** Microphone grading for the last run, if it was listened to. */
  verdicts: NoteVerdict[] | null = null;
  offsetCents = 0;

  constructor() {
    this.mic.onReading = this.onMicReading;
    this.bindSettings();
    this.bindKeys();
    $('#level-select').addEventListener('change', (e) => {
      this.progress.level = Number((e.target as HTMLSelectElement).value);
      this.progress.tempoFactor = 1;
      saveProgress(this.progress);
      this.teacher(`Level ${this.progress.level + 1}: ${LEVELS[this.progress.level].title}.`);
      this.newExercise();
      (e.target as HTMLSelectElement).blur(); // hand the keyboard back to the shortcuts
    });
    const keySel = $<HTMLSelectElement>('#key-select');
    keySel.replaceChildren(
      new Option('Vary', ''),
      ...TONICS.map(({ pc, label }) => new Option(label, String(pc), false, pc === this.settings.tonic)),
    );
    keySel.addEventListener('change', () => {
      this.settings.tonic = keySel.value === '' ? null : Number(keySel.value);
      saveSettings(this.settings);
      const label = TONICS.find((t) => t.pc === this.settings.tonic)?.label;
      this.teacher(label ? `Singing on ${label} from now on, major or minor as the level calls for.` : 'The key will vary from exercise to exercise.');
      this.newExercise();
      keySel.blur();
    });
    $('#score-wrap').addEventListener('click', (e) => {
      if (this.phase !== 'review') return;
      const g = (e.target as Element).closest('.note');
      if (!g) return;
      const i = Number(g.getAttribute('data-i'));
      this.missed[i] = !this.missed[i];
      g.classList.toggle('missed', this.missed[i]);
      this.updateReviewTally();
    });
    window.addEventListener('resize', () => this.draw());
    this.teacher(
      this.progress.exercisesSung
        ? `Welcome back. You're on level ${this.progress.level + 1}: ${LEVELS[this.progress.level].title}.`
        : 'Welcome to the singing school. Press Start, listen to the key being pitched, then sing each shape as it crosses the line.',
    );
    this.newExercise();
  }

  get level() {
    return LEVELS[this.progress.level];
  }

  /** MIDI pitch to sound for a scale degree, honouring the low-octave setting. */
  soundingMidi(degree: number): number {
    return midiOf(this.exercise.key, degree) - (this.settings.lowOctave ? 12 : 0);
  }

  newExercise() {
    this.stopAudio();
    this.exercise = generateExercise(this.level, makeRng(this.seed++), {
      weighting: weightingFor(this.progress),
      tonic: this.settings.tonic,
    });
    this.tempo = effectiveTempo(this.progress);
    this.scored = true;
    this.frames = [];
    this.verdicts = null;
    this.setPhase('idle');
  }

  // ---- phases -------------------------------------------------------------

  setPhase(phase: Phase) {
    this.phase = phase;
    document.body.dataset.phase = phase;
    this.draw();
    this.renderControls();
    this.renderInfo();
    this.renderPanels();
    $('#hand').textContent = '';
    $('#status').textContent =
      phase === 'idle'
        ? 'Look it over, then press Start (space).'
        : phase === 'review'
          ? this.verdicts
            ? `Graded by ear${Math.abs(this.offsetCents) >= 10 ? ` (allowing for your key being ${Math.abs(Math.round(this.offsetCents))}¢ ${this.offsetCents > 0 ? 'sharp' : 'flat'})` : ''}. Click any note the microphone got wrong, then Submit (enter).`
            : 'Click any notes you missed, then Submit (enter). Use Play back (P) to check yourself.'
          : '';
  }

  async start() {
    if (this.settings.mic && !this.mic.active) await this.enableMic();
    if (this.phase !== 'idle') return;
    const sound = this.sound;
    sound.reset();
    const ex = this.exercise;
    const spb = 60 / this.tempo;
    const t0 = sound.now + 0.15;
    const countIn = ex.meter;

    // Pitch the key the way a keyer would: tonic, third, fifth, then the chord.
    [0, 2, 4].forEach((d, i) => sound.tone(this.soundingMidi(d), t0 + i * 0.4, 0.4));
    [0, 2, 4].forEach((d) => sound.tone(this.soundingMidi(d), t0 + 1.2, 0.9, 0.12));

    const introEnd = t0 + INTRO_SECONDS;
    const exStart = introEnd + countIn * spb;
    for (let b = -countIn; b < ex.totalBeats; b++) {
      if (this.settings.metronome || b < 0) sound.click(exStart + b * spb, mod(b, ex.meter) === 0);
    }
    if (this.settings.guide) {
      this.scored = false;
      for (const n of ex.notes) sound.tone(this.soundingMidi(n.degree), exStart + n.start * spb, n.beats * spb, 0.16);
    }

    this.run = { exStart, spb, introEnd, countIn };
    this.frames = [];
    this.verdicts = null;
    this.setPhase('running');
    this.trace = this.mic.active ? new PitchTrace(this.score, ex) : null;
    requestAnimationFrame(this.frame);
  }

  frame = () => {
    const run = this.run;
    if (this.phase !== 'running' || !run) return;
    const now = this.sound.now;
    const beat = (now - run.exStart) / run.spb;
    const ex = this.exercise;

    this.scrollTo(Math.max(beat, -run.countIn));
    ex.notes.forEach((n, i) => {
      const g = this.score.notes[i];
      const done = beat >= n.start + n.beats;
      g.classList.toggle('active', beat >= n.start && !done);
      if (done && !g.classList.contains('passed')) {
        g.classList.add('passed');
        if (this.trace) {
          const v = judgeNote(ex, n, this.frames, tuningOffset(ex, this.frames));
          g.classList.add(v.correct ? 'hit' : 'miss');
        }
      }
    });

    const hand = $('#hand');
    const status = $('#status');
    if (now < run.introEnd) {
      status.textContent = `Pitching the key: ${ex.key.name}…`;
    } else {
      const b = Math.floor(beat);
      const glyph = HAND[ex.meter][mod(b, ex.meter)];
      if (hand.dataset.beat !== String(b)) {
        hand.dataset.beat = String(b);
        hand.textContent = glyph;
        hand.classList.remove('pulse');
        void hand.offsetWidth; // restart the CSS animation
        hand.classList.add('pulse');
      }
      status.textContent = beat < 0 ? `Count-in… ${b + run.countIn + 1}` : '';
    }

    if (beat > ex.totalBeats + 0.25) {
      this.enterReview();
      return;
    }
    requestAnimationFrame(this.frame);
  };

  enterReview() {
    this.run = null;
    if (this.trace) {
      const { verdicts, offsetCents } = scoreExercise(this.exercise, this.frames);
      this.verdicts = verdicts;
      this.offsetCents = offsetCents;
      this.missed = verdicts.map((v) => !v.correct);
    } else {
      this.verdicts = null;
      this.missed = this.exercise.notes.map(() => false);
    }
    this.trace = null;
    this.setPhase('review');
  }

  submit(allMissed = false) {
    if (allMissed) this.missed = this.missed.map(() => true);
    if (!this.scored) {
      this.teacher('Practice run, not counted. Here is a fresh one.');
      this.newExercise();
      return;
    }
    const outcome = applyResult(
      this.progress,
      this.exercise,
      this.missed.map((m) => !m),
    );
    this.progress = outcome.progress;
    saveProgress(this.progress);
    this.teacher(`${Math.round(outcome.score * 100)}% · ${outcome.message}`, outcome.change);
    this.newExercise();
  }

  retry() {
    this.scored = false;
    this.stopAudio();
    this.setPhase('idle');
  }

  playback() {
    this.stopAudio();
    const sound = this.sound;
    sound.reset();
    const ex = this.exercise;
    const spb = 60 / this.tempo;
    const t0 = sound.now + 0.1;
    for (const n of ex.notes) sound.tone(this.soundingMidi(n.degree), t0 + n.start * spb, n.beats * spb);

    const tick = () => {
      const beat = (sound.now - t0) / spb;
      ex.notes.forEach((n, i) => this.score.notes[i].classList.toggle('playing', beat >= n.start && beat < n.start + n.beats));
      if (beat <= ex.totalBeats) this.playbackTimer = requestAnimationFrame(tick);
    };
    this.playbackTimer = requestAnimationFrame(tick);
  }

  stopAudio() {
    this.sound.stop();
    cancelAnimationFrame(this.playbackTimer);
    this.run = null;
    this.score?.notes.forEach((g) => g.classList.remove('playing'));
  }

  // ---- drawing ------------------------------------------------------------

  draw() {
    if (!this.exercise) return;
    const wrap = $('#score-wrap');
    const width = wrap.clientWidth;
    const ex = this.exercise;
    const showSyllables = this.level.showSyllables;

    const header = headerWidthOf(ex);

    if (this.phase === 'review') {
      // Whole exercise at once, compressed to fit if possible.
      const lead = header + 20;
      const ppb = Math.max(40, Math.min(PX_PER_BEAT, (width - lead - 30) / ex.totalBeats));
      const w = Math.max(width, lead + ex.totalBeats * ppb + 30);
      this.score = renderScore(ex, { pxPerBeat: ppb, width: w, showSyllables });
      this.score.track.setAttribute('transform', `translate(${lead},0)`);
      this.score.notes.forEach((g, i) => g.classList.toggle('missed', this.missed[i]));
      if (this.verdicts) {
        this.replayTrace();
        this.verdicts.forEach((v, i) => {
          const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          t.textContent = v.cents === null ? 'not heard' : `${v.cents > 0 ? '+' : ''}${Math.round(v.cents)}¢`;
          this.score.notes[i].appendChild(t);
        });
      }
    } else {
      this.score = renderScore(ex, { pxPerBeat: PX_PER_BEAT, width, showSyllables, playheadX: header + PLAYHEAD_GAP });
      this.scrollTo(-ex.meter);
      if (this.phase === 'running' && this.trace) this.trace = this.replayTrace(); // resized mid-run
    }
    wrap.replaceChildren(this.score.svg);
  }

  /** Draw the pitches heard so far onto the current score. */
  replayTrace(): PitchTrace {
    const trace = new PitchTrace(this.score, this.exercise);
    for (const f of this.frames) trace.add(f.beat, f.midi);
    return trace;
  }

  scrollTo(beat: number) {
    const playheadX = this.score.headerWidth + PLAYHEAD_GAP;
    this.score.track.setAttribute('transform', `translate(${playheadX - beat * this.score.pxPerBeat},0)`);
  }

  renderControls() {
    const c = $('#controls');
    c.replaceChildren();
    const btn = (label: string, key: string, fn: () => void, primary = false) => {
      const b = document.createElement('button');
      b.innerHTML = `${label} <kbd>${key}</kbd>`;
      if (primary) b.className = 'primary';
      b.addEventListener('click', fn);
      c.appendChild(b);
    };
    if (this.phase === 'idle') {
      btn('Start', 'space', () => void this.start(), true);
      btn('New exercise', 'N', () => this.newExercise());
    } else if (this.phase === 'running') {
      btn('Stop', 'esc', () => this.retry());
    } else {
      btn(this.scored ? 'Submit' : 'Next', 'enter', () => this.submit(), true);
      btn('Play back', 'P', () => this.playback());
      btn('I got lost', 'L', () => this.submit(true));
      btn('Sing it again', 'R', () => this.retry());
      const tally = document.createElement('span');
      tally.id = 'tally';
      c.appendChild(tally);
      this.updateReviewTally();
    }
  }

  updateReviewTally() {
    const t = document.getElementById('tally');
    if (!t) return;
    const n = this.missed.length;
    const right = this.missed.filter((m) => !m).length;
    t.textContent = this.scored ? `${right}/${n} correct` : 'practice run: not counted';
  }

  renderInfo() {
    const lvl = this.level;
    $('#lesson-title').textContent = `Level ${this.progress.level + 1} · ${lvl.title}`;
    $('#lesson-blurb').textContent = lvl.blurb;
    const ex = this.exercise;
    $('#meta').textContent = `${ex.key.name} · ${ex.meter}/4 · ♩ = ${this.tempo}${this.scored ? '' : ' · practice'}`;

    const sel = $<HTMLSelectElement>('#level-select');
    sel.replaceChildren(
      ...LEVELS.slice(0, this.progress.maxLevel + 1).map((l, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${i + 1}. ${l.title}`;
        o.selected = i === this.progress.level;
        return o;
      }),
    );
    sel.disabled = this.phase === 'running';
    $<HTMLSelectElement>('#key-select').disabled = this.phase === 'running';
  }

  renderPanels() {
    const p = this.progress;
    const recent = (p.history[p.level] ?? []).slice(-WINDOW);
    const bars = Array.from({ length: WINDOW }, (_, i) => {
      const s = recent[i];
      if (s === undefined) return '<span class="bar empty"></span>';
      return `<span class="bar ${s >= PROMOTE_AT ? 'good' : ''}" style="--h:${Math.max(6, s * 100)}%" title="${Math.round(s * 100)}%"></span>`;
    }).join('');
    $('#progress-panel').innerHTML = `
      <h3>Progress</h3>
      <div class="ladder">${LEVELS.map((_, i) => `<span class="rung ${i < p.level ? 'done' : i === p.level ? 'here' : ''}"></span>`).join('')}</div>
      <div class="recent"><div class="bars">${bars}</div>
        <p>Last ${WINDOW} at this level. Average ${Math.round(PROMOTE_AT * 100)}% or better to move up.</p></div>
      <p class="muted">${p.exercisesSung} exercises sung · tempo ×${p.tempoFactor.toFixed(2)}</p>`;

    const rows = (entries: [string, { hit: number; miss: number } | undefined][]) =>
      entries
        .filter(([, t]) => t && t.hit + t.miss > 0)
        .map(([name, t]) => {
          const n = t!.hit + t!.miss;
          const acc = t!.hit / n;
          return `<tr><td>${name}</td><td class="meter"><span style="--w:${acc * 100}%" class="${acc < 0.75 ? 'weak' : ''}"></span></td><td>${Math.round(acc * 100)}%</td><td class="muted">${n}</td></tr>`;
        })
        .join('');
    const intervalRows = rows(
      Object.keys(INTERVAL_NAMES)
        .map(Number)
        .map((s) => [INTERVAL_NAMES[s], p.intervals[s]]),
    );
    const shapeRows = rows(SHAPES.map((s) => [s, p.shapes[s]]));
    const weak = weakestInterval(p);
    $('#stats-panel').innerHTML = intervalRows
      ? `<h3>What you're singing</h3>
         <table>${intervalRows}</table><table>${shapeRows}</table>
         <p class="muted">${weak === null ? 'No weak spots yet, so you get an even mix.' : `The teacher is serving extra ${INTERVAL_NAMES[weak]}.`}</p>`
      : `<h3>What you're singing</h3><p class="muted">Accuracy by interval and shape will show up here as you go.</p>`;
  }

  // ---- microphone ---------------------------------------------------------

  async enableMic(): Promise<boolean> {
    try {
      await this.mic.start(this.sound.context);
    } catch (err) {
      this.settings.mic = false;
      saveSettings(this.settings);
      $<HTMLInputElement>('#set-mic').checked = false;
      this.teacher(`Couldn't open the microphone (${(err as Error).message || err}). Sing-it mode is off; you can grade yourself instead.`);
      this.updateMicReadout(null);
      return false;
    }
    return true;
  }

  onMicReading = (reading: MicReading) => {
    const run = this.run;
    if (run && this.phase === 'running' && this.trace) {
      const beat = (reading.time - run.exStart) / run.spb;
      if (beat >= -0.5 && beat <= this.exercise.totalBeats + 0.25) {
        this.frames.push({ beat, midi: reading.midi });
        this.trace.add(beat, reading.midi);
      }
    }
    this.updateMicReadout(reading.midi);
  };

  /** Live "what am I singing" readout, relative to the current key. */
  updateMicReadout(midi: number | null) {
    const el = $('#mic-readout');
    if (!this.settings.mic) {
      el.textContent = '';
      return;
    }
    if (!this.mic.active) {
      el.textContent = '🎤 starts with Start';
      return;
    }
    if (midi === null) {
      el.textContent = '🎤 …';
      return;
    }
    const key = this.exercise.key;
    const d = Math.round(degreeOfMidi(key, midi));
    const cents = Math.round(100 * (midi - midiOf(key, d)));
    el.textContent = `🎤 ${shapeOf(d, key.mode)} ${cents >= 0 ? '+' : '−'}${Math.abs(cents)}¢`;
  }

  teacher(msg: string, change: 'promote' | 'demote' | 'stay' = 'stay') {
    const t = $('#teacher');
    t.textContent = msg;
    t.dataset.change = change;
  }

  // ---- input --------------------------------------------------------------

  bindSettings() {
    for (const k of ['guide', 'metronome', 'lowOctave'] as const) {
      const box = $<HTMLInputElement>(`#set-${k}`);
      box.checked = this.settings[k];
      box.addEventListener('change', () => {
        this.settings[k] = box.checked;
        saveSettings(this.settings);
      });
    }
    const micBox = $<HTMLInputElement>('#set-mic');
    micBox.checked = this.settings.mic;
    micBox.addEventListener('change', async () => {
      this.settings.mic = micBox.checked;
      saveSettings(this.settings);
      if (micBox.checked) {
        if (await this.enableMic()) this.teacher('Listening. Sing a note to check the microphone hears you. Headphones help keep the metronome out of the mic.');
      } else {
        this.mic.stop();
        this.updateMicReadout(null);
      }
    });
    this.updateMicReadout(null);
    $('#reset').addEventListener('click', () => {
      if (!confirm('Erase all progress and start from level 1?')) return;
      clearProgress();
      this.progress = loadProgress();
      this.teacher('Progress cleared. Back to the beginning.');
      this.newExercise();
    });
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof Element && e.target.closest('select, input'))) return;
      const k = e.key.toLowerCase();
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (this.phase === 'idle') {
        if (k === ' ') act(() => void this.start());
        else if (k === 'n') act(() => this.newExercise());
      } else if (this.phase === 'running') {
        if (k === 'escape') act(() => this.retry());
      } else {
        if (k === 'enter') act(() => this.submit());
        else if (k === 'p') act(() => this.playback());
        else if (k === 'l') act(() => this.submit(true));
        else if (k === 'r') act(() => this.retry());
      }
    });
  }
}

const app = new App();
// Handy for poking at state from the console during development.
if (import.meta.env.DEV) Object.assign(window, { app });
