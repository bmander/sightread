# Sightread

A sight-singing trainer for four-shape (Sacred Harp) notation. Shape notes
scroll past a playhead in time with a metronome and you sing them. Afterwards
you mark the notes you missed. An adaptive teacher uses those marks to choose
the next exercise.

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
- `src/main.ts`: the game loop (pitch the key → count in → scroll → self-grade).

Progress is stored in `localStorage`.
