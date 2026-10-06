import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * All Juzt state lives under `userData`; media the teacher picked stays where it
 * was (we never copy or delete original files).
 */
export function userDataDir(): string {
  const dir = path.join(app.getPath('userData'), 'state');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function mediaCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function stateFile(name: string): string {
  return path.join(userDataDir(), `${name}.json`);
}

export function isDev(): boolean {
  return !app.isPackaged;
}

export function devServerUrl(): string | null {
  const url = process.env.JUZT_DEV_SERVER;
  return url && /^https?:\/\//.test(url) ? url.replace(/\/$/, '') : null;
}
