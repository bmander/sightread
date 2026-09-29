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

- `src/music.ts`: shapes, keys (any tonic, spelled with the fewest accidentals), and the
  mapping from scale degree to pitch and staff position. The key can be fixed from the
  header; the level still decides major or minor.
- `src/generator.ts`: seeded procedural exercises. Melodies are a weighted walk
  using only allowed shape pairs, favouring steps and recovering after leaps. A
  reachability table guarantees they end on the tonic.
- `src/skills.ts`: the curriculum, 33 shape pairs. A shape pair plus its staff distance is
  always the same interval (la↑fa a step is always a half step), so each pair is a skill,
  learned ascending and descending.
- `src/teacher.ts`: introduces pairs one at a time with a short drill, then generates
  "songs" from known pairs only, weighted toward new, due, and missed pairs. Each
  directed pair has a Leitner box for spaced review. The next pair arrives when the
  newest is solid and the last 3 songs average ≥ 80%. Rhythm, meter, length, and tempo
  unlock with the number of pairs learned, and syllables are printed only for pairs
  still being learned.
- `src/render.ts`: SVG staff with shaped noteheads (fa ◢, sol ●, la ■, mi ◆).
- `src/pitch.ts`: YIN pitch detection. `src/mic.ts` taps the mic with an AudioWorklet
  so every ~21 ms window is analysed, even when animation frames stall.
- `src/scoring.ts`: per-note verdicts. Pitches are compared by pitch class, so any
  octave counts. The judged window skips each note's attack. A steady tuning offset
  (up to ±60¢) is forgiven. A note passes when ≥ 50% of its voiced frames are
  within ±50¢.
- `src/main.ts`: the game loop (pitch the key → count in → scroll → self-grade).

Progress is stored in `localStorage`.
