import type { VoiceRange } from './range';
import { UNITS } from './skills';
import { freshProgress, type Progress } from './teacher';

const PROGRESS_KEY = 'sightread.progress.v2';
const SETTINGS_KEY = 'sightread.settings.v1';

export interface Settings {
  guide: boolean;
  metronome: boolean;
  /** The singer's comfortable range, once found. */
  range: VoiceRange | null;
  /** Sing-it mode: grade by listening through the microphone. */
  mic: boolean;
  /** Tonic pitch class (0 = C) to practise in, or null to vary the key. */
  tonic: number | null;
}

const DEFAULT_SETTINGS: Settings = { guide: false, metronome: true, range: null, mic: false, tonic: null };

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode etc.): progress just won't persist.
  }
}

export function loadProgress(): Progress {
  const saved = read<Progress | (Omit<Progress, 'version'> & { version: 2 })>(PROGRESS_KEY);
  // Version 2 kept one box per directed pair, not per band of the staff. Keep
  // the place in the curriculum; the boxes start over band by band.
  const migrated = saved?.version === 2 ? { ...saved, version: 3 as const, skills: {} } : saved;
  const p = { ...freshProgress(), ...(migrated?.version === 3 ? migrated : {}) };
  p.introduced = Math.min(Math.max(1, p.introduced), UNITS.length);
  return p;
}

export const saveProgress = (p: Progress) => write(PROGRESS_KEY, p);
export function loadSettings(): Settings {
  const saved: Partial<Settings> & { lowOctave?: boolean } = { ...read<Settings>(SETTINGS_KEY) };
  delete saved.lowOctave; // replaced by the vocal range
  return { ...DEFAULT_SETTINGS, ...saved };
}
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);

export function clearProgress(): void {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // ignore
  }
}
