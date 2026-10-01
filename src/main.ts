import './style.css';
import { Sound } from './audio';
import { makeRng, type Exercise } from './generator';
import { Mic, type MicReading } from './mic';
import { degreeOfMidi, midiOf, mod, SHAPES, shapeOf, TONICS, type Shape } from './music';
import { rangeName, type VoiceRange } from './range';
import { RangeFinder } from './range-finder';
import { headerWidthOf, PitchTrace, renderScore, type Score } from './render';
import { judgeNote, scoreExercise, tuningOffset, type NoteVerdict, type PitchFrame } from './scoring';
import { BANDS, describePlacement, placementId, STEP_LABELS, unitName, UNITS } from './skills';
import { clearProgress, loadProgress, loadSettings, saveProgress, saveSettings, type Settings } from './store';
import {
  applyResult,
  boxOf,
  INTRODUCE_AT,
  newestUnit,
  planLesson,
  STABLE_BOX,
  placementsInPlay,
  weakestPlacement,
  WINDOW,
  type Lesson,
  type Progress,
} from './teacher';

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
  lesson!: Lesson;
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
  /** The range finder, while it is open. */
  finder: RangeFinder | null = null;

  constructor() {
    this.mic.onReading = this.onMicReading;
    this.bindSettings();
    this.bindKeys();
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
      keySel.blur(); // hand the keyboard back to the shortcuts
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
    const newest = newestUnit(this.progress);
    this.teacher(
      this.progress.sung
        ? `Welcome back. You know ${this.progress.introduced} of ${UNITS.length} pairs; the newest is ${unitName(newest)}.`
        : 'Welcome to the singing school. Each pair of shapes is always the same interval, so we learn them one pair at a time. ' +
            'Press Start, listen to the key being pitched, then sing each shape as it crosses the line.',
    );
    this.newExercise();
    if (!this.settings.range) this.openRangeFinder();
  }

  /** MIDI pitch to sound for a scale degree, in the octave that suits the singer's range. */
  soundingMidi(degree: number): number {
    return midiOf(this.exercise.key, degree) + 12 * this.lesson.shift;
  }

  // ---- vocal range --------------------------------------------------------

  openRangeFinder() {
    if (this.finder) return;
    this.stopAudio();
    if (this.phase === 'running') this.setPhase('idle');
    document.body.dataset.range = 'open';
    this.finder = new RangeFinder($('#range'), {
      sound: this.sound,
      openMic: async () => {
        try {
          await this.mic.start(this.sound.context);
          return null;
        } catch (err) {
          return (err as Error).message || String(err);
        }
      },
      current: this.settings.range,
      onDone: (range) => this.closeRangeFinder(range),
    });
  }

  closeRangeFinder(range: VoiceRange | null) {
    this.finder?.close();
    this.finder = null;
    delete document.body.dataset.range;
    this.sound.stop();
    if (!this.settings.mic) this.mic.stop();
    this.renderRange();
    if (!range) return;
    this.settings.range = range;
    saveSettings(this.settings);
    this.renderRange();
    this.teacher(`Your range is ${rangeName(range)}. Every exercise will sound within it.`);
    this.newExercise();
  }

  renderRange() {
    const r = this.settings.range;
    $('#range-name').textContent = r ? rangeName(r) : 'not set';
  }

  newExercise() {
    this.stopAudio();
    this.lesson = planLesson(this.progress, makeRng(this.seed++), this.settings);
    this.exercise = this.lesson.exercise;
    this.tempo = this.lesson.tempo;
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
    const chord = [0, 2, 4].map((d) => this.lesson.home + d);
    chord.forEach((d, i) => sound.tone(this.soundingMidi(d), t0 + i * 0.4, 0.4));
    chord.forEach((d) => sound.tone(this.soundingMidi(d), t0 + 1.2, 0.9, 0.12));

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
      this.lesson,
      this.missed.map((m) => !m),
      this.settings,
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
    const { syllables, focus } = this.lesson;

    const header = headerWidthOf(ex);

    if (this.phase === 'review') {
      // Whole exercise at once, compressed to fit if possible.
      const lead = header + 20;
      const ppb = Math.max(40, Math.min(PX_PER_BEAT, (width - lead - 30) / ex.totalBeats));
      const w = Math.max(width, lead + ex.totalBeats * ppb + 30);
      this.score = renderScore(ex, { pxPerBeat: ppb, width: w, syllables, focus });
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
      this.score = renderScore(ex, { pxPerBeat: PX_PER_BEAT, width, syllables, focus, playheadX: header + PLAYHEAD_GAP });
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
    const { title, blurb } = this.lesson;
    $('#lesson-title').textContent = title;
    $('#lesson-blurb').textContent = blurb;
    const ex = this.exercise;
    $('#meta').textContent = `${ex.key.name} · ${ex.meter}/4 · ♩ = ${this.tempo}${this.scored ? '' : ' · practice'}`;
    $('#pairs-count').textContent = `Pairs ${this.progress.introduced} / ${UNITS.length}`;
    $<HTMLSelectElement>('#key-select').disabled = this.phase === 'running';
  }

  renderPanels() {
    const p = this.progress;
    const recent = p.recent.slice(-WINDOW);
    const bars = Array.from({ length: WINDOW }, (_, i) => {
      const s = recent[i];
      if (s === undefined) return '<span class="bar empty"></span>';
      return `<span class="bar ${s >= INTRODUCE_AT ? 'good' : ''}" style="--h:${Math.max(6, s * 100)}%" title="${Math.round(s * 100)}%"></span>`;
    }).join('');
    const inPlay = placementsInPlay(p, this.settings);
    const placementsOf = (i: number) =>
      [UNITS[i].up, UNITS[i].down].flatMap((s) => BANDS.map((b) => placementId(s, b)).filter((id) => inPlay.has(id)));
    const learned = (i: number) => placementsOf(i).every((id) => boxOf(p, id) >= STABLE_BOX);
    const unsolid = [...inPlay].filter((id) => boxOf(p, id) < STABLE_BOX).length;
    const newest = newestUnit(p);
    $('#progress-panel').innerHTML = `
      <h3>Progress</h3>
      <div class="ladder">${UNITS.map((_, i) => `<span class="rung ${i >= p.introduced ? '' : learned(i) ? 'done' : 'here'}"></span>`).join('')}</div>
      ${
        p.drillsLeft > 0
          ? `<p>Drilling the new pair <b>${unitName(newest)}</b>.</p>`
          : `<div class="recent"><div class="bars">${bars}</div>
             <p>${unsolid ? `Make every pair solid all over the staff (<b>${unsolid}</b> ${unsolid === 1 ? 'placement' : 'placements'} to go) and average` : 'Average'} ${Math.round(INTRODUCE_AT * 100)}% over ${WINDOW} songs to meet the next pair.</p></div>`
      }
      <p class="muted">${p.sung} exercises sung · tempo ×${p.tempoFactor.toFixed(2)}</p>`;

    // Every pair on a grid of lower shape × upper shape, one chip per staff distance. Introduced
    // chips show the strength of each direction (columns) in each band of the staff (rows, high
    // at the top); the next one is outlined, later ones are faint.
    const strength = (id: string) =>
      inPlay.has(id)
        ? `<i title="${describePlacement(id)}" style="--w:${(boxOf(p, id) / 5) * 100}%"></i>`
        : '<i class="off"></i>';
    const strengths = (i: number) => {
      const { up, down } = UNITS[i];
      const rows = [...BANDS].reverse().flatMap((b) => [strength(placementId(up, b)), strength(placementId(down, b))]);
      return `<span class="bands"><span>↑</span><span>↓</span>${rows.join('')}</span>`;
    };
    const chip = (i: number) => {
      const u = UNITS[i];
      const cls = i > p.introduced ? 'locked' : i === p.introduced ? 'next' : i === p.introduced - 1 ? 'new' : '';
      const body = i < p.introduced ? strengths(i) : '';
      return `<div class="chip ${cls}" title="${unitName(u)}${cls === 'next' ? ' · next' : ''}"><b>${STEP_LABELS[u.steps]}</b>${body}</div>`;
    };
    const cell = (lo: Shape, hi: Shape) => {
      const chips = UNITS.map((u, i) => ({ u, i }))
        .filter(({ u }) => u.lo === lo && u.hi === hi)
        .sort((a, b) => a.u.steps - b.u.steps)
        .map(({ i }) => chip(i));
      return `<div class="cell">${chips.join('') || '<span class="muted">·</span>'}</div>`;
    };
    const grid = [
      '<span class="axis">lower ╲ upper</span>',
      ...SHAPES.map((hi) => `<span class="axis">${hi}</span>`),
      ...SHAPES.flatMap((lo) => [`<span class="axis">${lo}</span>`, ...SHAPES.map((hi) => cell(lo, hi))]),
    ].join('');
    const shapeRows = SHAPES.filter((s) => p.shapes[s].hit + p.shapes[s].miss > 0)
      .map((s) => {
        const t = p.shapes[s];
        const acc = t.hit / (t.hit + t.miss);
        return `<tr><td>${s}</td><td class="meter"><span style="--w:${acc * 100}%" class="${acc < 0.75 ? 'weak' : ''}"></span></td><td>${Math.round(acc * 100)}%</td></tr>`;
      })
      .join('');
    const weak = weakestPlacement(p);
    $('#stats-panel').innerHTML = `
      <h3>Pairs</h3>
      <div class="pair-grid">${grid}</div>
      ${shapeRows ? `<table>${shapeRows}</table>` : ''}
      <p class="muted">${weak ? `The teacher is serving extra ${describePlacement(weak)}.` : 'Each chip has a bar for each direction (↑ ↓) in each part of the staff, high to low. Bars fill as they get solid.'}</p>`;
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
    if (this.finder) {
      this.finder.hear(reading);
      return;
    }
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

  teacher(msg: string, change: 'introduce' | 'stay' = 'stay') {
    const t = $('#teacher');
    t.textContent = msg;
    t.dataset.change = change;
  }

  // ---- input --------------------------------------------------------------

  bindSettings() {
    for (const k of ['guide', 'metronome'] as const) {
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
    this.renderRange();
    $('#find-range').addEventListener('click', () => this.openRangeFinder());
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
      if (this.finder || e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof Element && e.target.closest('select, input'))) return;
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
