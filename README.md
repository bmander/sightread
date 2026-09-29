# Sightread

A sight-singing trainer for four-shape (Sacred Harp) notation. Shape notes
scroll past a playhead in time with a metronome and you sing them. In sing-it
mode the microphone grades each note. Otherwise you mark the notes you missed
yourself. An adaptive teacher uses those marks to choose the next exercise.

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

## How it works

- `src/music.ts`: shapes, keys, and the mapping from scale degree to pitch and staff position.
- `src/generator.ts`: seeded procedural exercises. Melodies are a weighted walk
  that favours steps, recovers after leaps, avoids tritones, and ends on the tonic.
  Weak intervals are weighted up.
- `src/curriculum.ts`: the level ladder and adaptation rules. The last 3 scores
  at a level must average ≥ 90% to promote, < 50% demotes, and tempo is nudged
  ±5% within a level.
- `src/render.ts`: SVG staff with shaped noteheads (fa ◢, sol ●, la ■, mi ◆).
- `src/pitch.ts`: YIN pitch detection. `src/mic.ts` taps the mic with an AudioWorklet
  so every ~21 ms window is analysed, even when animation frames stall.
- `src/scoring.ts`: per-note verdicts. Pitches are compared by pitch class, so any
  octave counts. The judged window skips each note's attack. A steady tuning offset
  (up to ±60¢) is forgiven. A note passes when ≥ 50% of its voiced frames are
  within ±50¢.
- `src/main.ts`: the game loop (pitch the key → count in → scroll → self-grade).

Progress is stored in `localStorage`.
