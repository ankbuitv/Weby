import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS, Settings, Scene } from '../shared/types';

function getUserDir(): string {
  return app.getPath('userData');
}

function getSettingsPath(): string {
  return path.join(getUserDir(), 'settings.json');
}

function getScenesPath(): string {
  return path.join(getUserDir(), 'scenes.json');
}

function safeReadJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return { ...fallback, ...parsed } as T;
    return fallback;
  } catch (err) {
    console.warn('Failed to read', filePath, err);
    return fallback;
  }
}

function safeWriteJson(filePath: string, data: unknown): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.warn('Failed to write', filePath, err);
  }
}

export function loadSettings(): Settings {
  return safeReadJson<Settings>(getSettingsPath(), { ...DEFAULT_SETTINGS });
}

export function saveSettings(settings: Settings): void {
  safeWriteJson(getSettingsPath(), settings);
}

export function loadScenes(): Scene[] {
  return safeReadJson<Scene[]>(getScenesPath(), []);
}

export function saveScenes(scenes: Scene[]): void {
  safeWriteJson(getScenesPath(), scenes);
}
