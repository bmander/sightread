// SVG rendering of a shape-note exercise on a treble staff.
//
// The clef, key and time signature sit in a fixed header on the left. Notes,
// barlines and syllables live in a separate <g> so the play screen can slide
// them past a fixed playhead (guitar-hero style) by changing one transform.

import type { Exercise } from './generator';
import { degreeOfMidi, midiOf, SIGNATURE_STEPS, shapeOf, staffStepOf, type Shape } from './music';
import { foldToward } from './scoring';

const NS = 'http://www.w3.org/2000/svg';
const HALF = 6; // vertical distance between adjacent staff steps
const TOP = 46; // y of the top staff line (F5)
const TOP_STEP = 38; // F5
const BOTTOM_STEP = 30; // E4
const HW = 7.5; // notehead half-width
const HH = 5.5; // notehead half-height
const STEM = 34;
const ACC_SPACING = 13; // horizontal gap between key-signature accidentals
const HEIGHT = 172;
const SYL_Y = 160;

const yOf = (step: number) => TOP + (TOP_STEP - step) * HALF;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export interface Score {
  svg: SVGSVGElement;
  /** Scrolling content; translate this horizontally to move the music. */
  track: SVGGElement;
  /** Layer under the notes for the sung-pitch trace. */
  trace: SVGGElement;
  notes: SVGGElement[];
  headerWidth: number;
  pxPerBeat: number;
}

/** Width of the fixed clef / key / time-signature header. */
export const headerWidthOf = (ex: Exercise) => 84 + ex.key.signature.count * ACC_SPACING;

export interface RenderOptions {
  pxPerBeat: number;
  width: number;
  showSyllables: boolean;
  playheadX?: number;
}

export function renderScore(ex: Exercise, opts: RenderOptions): Score {
  const { pxPerBeat, width } = opts;
  const svg = el('svg', { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, class: 'score' });
  const sig = ex.key.signature;
  const headerWidth = headerWidthOf(ex);
  const tsX = headerWidth - 22;

  // Staff lines span the full width.
  for (let i = 0; i < 5; i++) {
    const y = yOf(BOTTOM_STEP + i * 2);
    el('line', { x1: 0, x2: width, y1: y, y2: y, class: 'staff-line' }, svg);
  }

  // Scrolling track, clipped so it disappears under the header.
  const clipId = `clip-${Math.random().toString(36).slice(2)}`;
  const clip = el('clipPath', { id: clipId }, el('defs', {}, svg));
  el('rect', { x: headerWidth, y: 0, width: width - headerWidth, height: HEIGHT }, clip);
  const viewport = el('g', { 'clip-path': `url(#${clipId})` }, svg);
  const track = el('g', { class: 'track' }, viewport);

  // Fixed header: clef, key signature, time signature.
  el('rect', { x: 0, y: 0, width: headerWidth, height: HEIGHT, class: 'header-bg' }, svg);
  for (let i = 0; i < 5; i++) {
    const y = yOf(BOTTOM_STEP + i * 2);
    el('line', { x1: 0, x2: headerWidth, y1: y, y2: y, class: 'staff-line' }, svg);
  }
  const clef = el('text', { x: 4, y: yOf(BOTTOM_STEP) + 2, class: 'clef' }, svg);
  clef.textContent = '𝄞';
  SIGNATURE_STEPS[sig.type].slice(0, sig.count).forEach((s, i) => {
    // Flats: nudge up so the bowl, not the glyph's centre, sits on the line/space.
    const acc = el('text', { x: 50 + i * ACC_SPACING, y: yOf(s) - (sig.type === 'flat' ? 4 : 0), class: 'accidental' }, svg);
    acc.textContent = sig.type === 'sharp' ? '♯' : '♭';
  });
  for (const [txt, y] of [[ex.meter, yOf(36)], [4, yOf(32)]] as const) {
    const t = el('text', { x: tsX, y, class: 'timesig' }, svg);
    t.textContent = String(txt);
  }

  // Barlines (drawn just before each downbeat) and the final double bar.
  const x = (beat: number) => beat * pxPerBeat;
  for (let b = ex.meter; b < ex.totalBeats; b += ex.meter) {
    const bx = x(b) - Math.min(16, pxPerBeat * 0.45);
    el('line', { x1: bx, x2: bx, y1: yOf(TOP_STEP), y2: yOf(BOTTOM_STEP), class: 'barline' }, track);
  }
  const endX = x(ex.totalBeats) - Math.min(10, pxPerBeat * 0.3);
  el('line', { x1: endX - 5, x2: endX - 5, y1: yOf(TOP_STEP), y2: yOf(BOTTOM_STEP), class: 'barline' }, track);
  el('rect', { x: endX - 1, y: yOf(TOP_STEP), width: 4, height: yOf(BOTTOM_STEP) - yOf(TOP_STEP), class: 'final-bar' }, track);

  const trace = el('g', { class: 'trace-layer' }, track);
  const notes = ex.notes.map((n, i) => {
    const g = el('g', { class: 'note', 'data-i': i }, track);
    drawNote(g, x(n.start), staffStepOf(ex.key, n.degree), shapeOf(n.degree, ex.key.mode), n.beats);
    if (opts.showSyllables) {
      const t = el('text', { x: x(n.start), y: SYL_Y, class: 'syl' }, g);
      t.textContent = shapeOf(n.degree, ex.key.mode);
    }
    return g;
  });

  if (opts.playheadX !== undefined) {
    el('line', { x1: opts.playheadX, x2: opts.playheadX, y1: 8, y2: HEIGHT - 26, class: 'playhead' }, svg);
  }

  return { svg, track, trace, notes, headerWidth, pxPerBeat };
}

function drawNote(g: SVGGElement, cx: number, step: number, shape: Shape, beats: number) {
  const cy = yOf(step);

  // Ledger lines above and below the staff.
  for (let s = BOTTOM_STEP - 2; s >= step; s -= 2) ledger(g, cx, yOf(s));
  for (let s = TOP_STEP + 2; s <= step; s += 2) ledger(g, cx, yOf(s));

  // Transparent hit area so notes are easy to click when grading.
  el('rect', { x: cx - 12, y: cy - 40, width: 24, height: 80, class: 'hit-area' }, g);

  const hollow = beats >= 2;
  const up = step < 34; // below the middle line: stem up
  const cls = `head ${hollow ? 'hollow' : 'filled'}`;

  switch (shape) {
    case 'fa': // right triangle, vertical edge on the stem side
      el('polygon', {
        points: up
          ? `${cx - HW},${cy + HH} ${cx + HW},${cy - HH} ${cx + HW},${cy + HH}`
          : `${cx - HW},${cy - HH} ${cx + HW},${cy - HH} ${cx - HW},${cy + HH}`,
        class: cls,
      }, g);
      break;
    case 'sol':
      el('ellipse', { cx, cy, rx: HW, ry: HH, transform: `rotate(-20 ${cx} ${cy})`, class: cls }, g);
      break;
    case 'la':
      el('rect', { x: cx - HW + 0.5, y: cy - HH + 0.5, width: 2 * HW - 1, height: 2 * HH - 1, class: cls }, g);
      break;
    case 'mi':
      el('polygon', { points: `${cx - HW},${cy} ${cx},${cy - HH - 1} ${cx + HW},${cy} ${cx},${cy + HH + 1}`, class: cls }, g);
      break;
  }

  if (beats < 4) {
    const sx = up ? cx + HW - 0.6 : cx - HW + 0.6;
    const y0 = up ? cy - (shape === 'fa' ? HH : 0) : cy + (shape === 'fa' ? HH : 0);
    const tip = up ? cy - STEM : cy + STEM;
    el('line', { x1: sx, x2: sx, y1: y0, y2: tip, class: 'stem' }, g);
    if (beats === 0.5) {
      const v = up ? 1 : -1; // flags hang toward the notehead
      const d = `M${sx},${tip} C${sx + 1},${tip + 8 * v} ${sx + 11},${tip + 10 * v} ${sx + 8},${tip + 23 * v} ` +
        `C${sx + 9},${tip + 14 * v} ${sx + 3},${tip + 12 * v} ${sx},${tip + 10 * v} Z`;
      el('path', { d, class: 'flag' }, g);
    }
  }

  if (beats === 3 || beats === 1.5) {
    const onLine = step % 2 === 0;
    el('circle', { cx: cx + HW + 5, cy: onLine ? cy - HALF / 2 - 1 : cy, r: 2, class: 'dot' }, g);
  }
}

function ledger(g: SVGGElement, cx: number, y: number) {
  el('line', { x1: cx - HW - 4, x2: cx + HW + 4, y1: y, y2: y, class: 'staff-line' }, g);
}

/**
 * Draws the singer's pitch as a line on the staff. Each point is folded into
 * the octave of the note being sung at that moment, so a bass singing the
 * tenor line an octave down still traces through the noteheads.
 */
export class PitchTrace {
  private line: SVGPolylineElement | null = null;
  private points = '';
  private lastBeat = -Infinity;

  constructor(private score: Score, private ex: Exercise) {}

  add(beat: number, midi: number | null): void {
    if (midi === null) {
      this.line = null;
      return;
    }
    const { ex } = this;
    const note = ex.notes.findLast((n) => n.start <= beat) ?? ex.notes[0];
    const target = midiOf(ex.key, note.degree);
    const step = staffStepOf(ex.key, degreeOfMidi(ex.key, foldToward(midi, target)));
    const y = Math.max(4, Math.min(HEIGHT - 30, yOf(step)));
    const x = beat * this.score.pxPerBeat;
    if (!this.line || beat - this.lastBeat > 0.2) {
      this.line = el('polyline', { class: 'trace' }, this.score.trace);
      this.points = '';
    }
    this.points += `${x.toFixed(1)},${y.toFixed(1)} `;
    this.line.setAttribute('points', this.points);
    this.lastBeat = beat;
  }
}
