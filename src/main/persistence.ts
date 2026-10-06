import fs from 'node:fs';
import path from 'node:path';
import { stateFile } from './paths';

/**
 * Tiny atomic JSON store.
 *
 * Writes are debounced and coalesced per file (whiteboards can be edited while
 * a class runs — we must never write on every pointer move), and `flushAllSync`
 * runs on quit so nothing is lost on the way out.
 */

interface Entry<T> {
  data: T;
  timer: NodeJS.Timeout | null;
  dirty: boolean;
}

const entries = new Map<string, Entry<unknown>>();
const DEBOUNCE_MS = 450;

function readFileSafe<T>(file: string): T | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeAtomic(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    // A failed save must never take the app down; surface it in diagnostics only.
    process.emitWarning(`Juzt: could not save ${file}: ${String(err)}`);
  }
}

export function loadState<T>(name: string, fallback: T): T {
  const file = stateFile(name);
  const disk = readFileSafe<T>(file);
  const entry: Entry<T> = { data: disk ?? fallback, timer: null, dirty: false };
  entries.set(name, entry as Entry<unknown>);
  return entry.data;
}

export function getState<T>(name: string): T | undefined {
  return entries.get(name)?.data as T | undefined;
}

export function setState<T>(name: string, data: T, opts: { immediate?: boolean } = {}): void {
  const entry = entries.get(name) as Entry<T> | undefined;
  if (!entry) {
    const fresh: Entry<T> = { data, timer: null, dirty: true };
    entries.set(name, fresh as Entry<unknown>);
    if (opts.immediate) {
      writeAtomic(stateFile(name), data);
      fresh.dirty = false;
    } else {
      fresh.timer = setTimeout(() => {
        writeAtomic(stateFile(name), fresh.data);
        fresh.dirty = false;
        fresh.timer = null;
      }, DEBOUNCE_MS);
      fresh.timer.unref?.();
    }
    return;
  }
  entry.data = data;
  entry.dirty = true;
  if (opts.immediate) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    writeAtomic(stateFile(name), data);
    entry.dirty = false;
    return;
  }
  if (entry.timer) return; // already scheduled — coalesce
  entry.timer = setTimeout(() => {
    const e = entries.get(name) as Entry<T> | undefined;
    if (!e) return;
    e.timer = null;
    if (!e.dirty) return;
    writeAtomic(stateFile(name), e.data);
    e.dirty = false;
  }, DEBOUNCE_MS);
  entry.timer.unref?.();
}

/** Flush every pending write synchronously (quit path). */
export function flushAllSync(): void {
  for (const [name, entry] of entries) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.dirty) writeAtomic(stateFile(name), entry.data);
    entry.timer = null;
    entry.dirty = false;
  }
}

export function deleteStateFile(name: string): void {
  try {
    fs.rmSync(stateFile(name), { force: true });
  } catch {
    /* ignore */
  }
  entries.delete(name);
}
