/**
 * Pure extension validation — shared by the main process and the tests.
 *
 * These functions read and check `manifest.json` only. They never load, execute
 * or require anything from an extension directory; Chromium's own extension
 * process does the loading. Keeping this logic here (instead of inside the main
 * process) means the validation rules are unit-testable without Electron.
 */

import fs from 'node:fs';
import path from 'node:path';

/** The minimum a directory must satisfy before it is handed to Chromium. */
export interface ManifestRead {
  ok: boolean;
  error?: string;
  manifestVersion?: number;
  name?: string;
  version?: string;
  description?: string;
}

/** Manifest versions Chromium/Electron actually support. */
export const SUPPORTED_MANIFEST_VERSIONS = [2, 3] as const;

/**
 * Read and validate `manifest.json`.
 *
 * Fails closed: anything malformed, missing or unexpected is rejected with a
 * message the teacher can act on. `manifest_version` must be 2 or 3 — those are
 * the only two Chromium implements, and claiming anything else would be a lie.
 */
export function readManifest(dir: string): ManifestRead {
  if (!dir || dir.trim().length === 0) return { ok: false, error: 'No folder selected.' };
  if (!fs.existsSync(dir)) return { ok: false, error: `Folder does not exist: ${dir}` };
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) return { ok: false, error: 'No manifest.json in that folder.' };
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, error: `Cannot read manifest.json: ${String(e)}` };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `manifest.json is not valid JSON: ${String(e)}` };
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return { ok: false, error: 'manifest.json must contain an object.' };
  }
  const m = manifest as Record<string, unknown>;
  const mv = m.manifest_version;
  if (mv !== 2 && mv !== 3) {
    return {
      ok: false,
      error: `manifest_version must be 2 or 3 (found ${JSON.stringify(mv)}). Chromium only implements those two; a different value cannot be made to work by pretending.`,
    };
  }
  if (typeof m.name !== 'string' || m.name.trim().length === 0) return { ok: false, error: 'manifest.json has no "name".' };
  if (typeof m.version !== 'string' || m.version.trim().length === 0) return { ok: false, error: 'manifest.json has no "version".' };
  return {
    ok: true,
    manifestVersion: mv,
    name: m.name.trim().slice(0, 200),
    version: m.version.trim().slice(0, 40),
    description: typeof m.description === 'string' ? m.description.slice(0, 400) : undefined,
  };
}

/**
 * Resolve a user-supplied extension path to a real directory, or `null`.
 *
 * This is not a security boundary — Chromium sandboxes extension processes —
 * it just keeps NUL bytes, empty strings and non-directories out of the
 * persisted list so one bad entry cannot break startup.
 */
export function normalizeExtensionPath(dir: string | undefined | null): string | null {
  if (typeof dir !== 'string') return null;
  const trimmed = dir.trim();
  if (trimmed.length === 0 || trimmed.includes('\0')) return null;
  let resolved: string;
  try {
    resolved = path.resolve(trimmed);
  } catch {
    return null;
  }
  try {
    if (!fs.statSync(resolved).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}

/**
 * Meaningful compatibility note for a manifest version, given what the running
 * Electron actually supports. Juzt reports this rather than claiming a level of
 * support it does not have.
 */
export function manifestCompatibility(manifestVersion: number, chromiumMajorVersion: number): { label: string; detail: string } {
  if (manifestVersion === 2) {
    return {
      label: 'Partially compatible',
      detail:
        'Manifest V2 runs on this Chromium, but Chromium has removed several MV2-only capabilities. Content scripts and basic features work; some chrome.* APIs and background pages are unavailable.',
    };
  }
  if (manifestVersion === 3) {
    return { label: 'Loaded', detail: 'Manifest V3 is the current format and is fully supported by this Chromium.' };
  }
  return { label: 'Unknown', detail: `Chromium ${chromiumMajorVersion} does not implement manifest_version ${manifestVersion}.` };
}
