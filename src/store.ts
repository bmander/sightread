import { freshProgress, LEVELS, type Progress } from './curriculum';

const PROGRESS_KEY = 'sightread.progress.v1';
const SETTINGS_KEY = 'sightread.settings.v1';

export interface Settings {
  guide: boolean;
  metronome: boolean;
  lowOctave: boolean;
  /** Sing-it mode: grade by listening through the microphone. */
  mic: boolean;
  /** Tonic pitch class (0 = C) to practise in, or null to vary the key. */
  tonic: number | null;
}

const DEFAULT_SETTINGS: Settings = { guide: false, metronome: true, lowOctave: false, mic: false, tonic: null };

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
  const saved = read<Progress>(PROGRESS_KEY);
  const p = { ...freshProgress(), ...(saved?.version === 1 ? saved : {}) };
  p.level = Math.min(Math.max(0, p.level), LEVELS.length - 1);
  p.maxLevel = Math.min(Math.max(p.level, p.maxLevel), LEVELS.length - 1);
  return p;
}

export const saveProgress = (p: Progress) => write(PROGRESS_KEY, p);
export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Settings>(SETTINGS_KEY) });
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);

export function clearProgress(): void {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // ignore
  }
}
