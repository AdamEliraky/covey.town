/*
 * Tiny in-memory event log used by the screen-share test build (task 3 / stories 1-2).
 * Every client keeps its own log so testers can record what each client saw.
 * The log is also mirrored to the browser console with a [ScreenShareTest] prefix.
 */

export type ScreenShareLogEntry = {
  time: string;
  message: string;
};

type Listener = (entries: ScreenShareLogEntry[]) => void;

const MAX_ENTRIES = 200;
let entries: ScreenShareLogEntry[] = [];
const listeners = new Set<Listener>();

export function logScreenShareEvent(message: string): void {
  const entry = { time: new Date().toISOString().substring(11, 23), message };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  // eslint-disable-next-line no-console
  console.log(`[ScreenShareTest] ${entry.time} ${message}`);
  listeners.forEach(listener => listener(entries));
}

export function getScreenShareLog(): ScreenShareLogEntry[] {
  return entries;
}

export function clearScreenShareLog(): void {
  entries = [];
  listeners.forEach(listener => listener(entries));
}

export function subscribeToScreenShareLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isScreenShareTestEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SCREENSHARE_TEST === 'true';
}
