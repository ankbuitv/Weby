/**
 * Extension manager.
 *
 * Hard rules encoded here:
 *  - Extensions load through `session.loadExtension` ONLY. No Chrome Web Store,
 *    no scraping, no downloading, no fake store. Officially supported path is
 *    Load Unpacked from a directory the teacher already has on disk.
 *  - Extensions load into the SAME persistent session as website tabs so their
 *    storage and content scripts actually work. Juzt's own privileged pages and
 *    the preload bridge stay in the default session and are unreachable from
 *    extension code.
 *  - Never execute arbitrary Node code from an extension directory. Juzt only
 *    reads `manifest.json`, validates it, and hands the path to Chromium.
 *  - One broken extension must never take Juzt down: every load is isolated and
 *    its failure recorded privately.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, session } from 'electron';
import { readManifest, normalizeExtensionPath, manifestCompatibility } from '../shared/extensions';
import type { ExtensionRecord } from '../shared/types';

export { readManifest, normalizeExtensionPath, manifestCompatibility };
export type { ManifestRead } from '../shared/extensions';

type Session = Electron.Session;

export interface ExtensionView {
  id: string;
  path: string;
  name: string;
  version: string;
  manifestVersion: number;
  description?: string;
  enabled: boolean;
  status: ExtensionRecord['status'];
  error?: string;
  addedAt: number;
}

export class ExtensionManager {
  /** In-memory mirror of the persisted records. */
  private records: ExtensionRecord[] = [];
  private readonly session: Session;

  constructor(partition: string) {
    // Same partition as website tabs: `persist:juzt`.
    this.session = session.fromPartition(partition);
  }

  list(): ExtensionView[] {
    return this.records.map((r) => ({ ...r }));
  }

  /** Extensions actually loaded by Chromium in this session. */
  loaded(): string[] {
    try {
      return this.session.extensions.getAllExtensions().map((e) => e.id);
    } catch {
      return [];
    }
  }

  /** Teacher asked to add an unpacked extension directory. */
  async addDirectory(dir: string): Promise<ExtensionView | { error: string }> {
    const resolved = normalizeExtensionPath(dir);
    if (!resolved) return { error: 'Pick a folder that exists and contains manifest.json.' };
    const read = readManifest(resolved);
    if (!read.ok) return { error: read.error ?? 'Invalid manifest.' };
    if (this.records.some((r) => r.path === resolved)) return { error: 'That folder is already in the list.' };

    const id = `${path.basename(resolved)}-${Date.now().toString(36)}`;
    const record: ExtensionRecord = {
      id,
      path: resolved,
      name: read.name ?? path.basename(resolved),
      version: read.version ?? '0',
      manifestVersion: read.manifestVersion ?? 0,
      description: read.description,
      enabled: true,
      status: 'unknown',
      addedAt: Date.now(),
    };
    const loaded = await this.load(record);
    this.records = [...this.records, record];
    return { ...record };
  }

  /** Load one record into the session. Never throws. */
  private async load(record: ExtensionRecord): Promise<ExtensionRecord> {
    try {
      if (typeof this.session.extensions?.loadExtension !== 'function') {
        record.status = 'failed';
        record.error = 'This Chromium build does not expose the extensions API.';
        return record;
      }
      const ext = await this.session.extensions.loadExtension(record.path, { allowFileAccess: false });
      record.id = ext.id;
      record.status = 'loaded';
      record.error = undefined;
    } catch (err) {
      record.status = 'failed';
      record.error = String(err instanceof Error ? err.message : err);
    }
    return record;
  }

  async enable(id: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record || record.enabled) return;
    record.enabled = true;
    if (!this.loaded().includes(record.id)) await this.load(record);
    else record.status = 'loaded';
  }

  async disable(id: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return;
    record.enabled = false;
    record.status = 'disabled';
    try {
      this.session.extensions.removeExtension(record.id);
    } catch {
      /* already gone — nothing to do */
    }
  }

  async reload(id: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return;
    try {
      this.session.extensions.removeExtension(record.id);
    } catch {
      /* not loaded */
    }
    if (record.enabled) await this.load(record);
  }

  remove(id: string): void {
    const record = this.records.find((r) => r.id === id);
    if (!record) return;
    try {
      this.session.extensions.removeExtension(record.id);
    } catch {
      /* already gone */
    }
    this.records = this.records.filter((r) => r.id !== id);
  }

  /** Drop every extension out of the session (Safe Mode / "disable all"). */
  unloadAll(): void {
    for (const record of this.records) {
      try {
        this.session.extensions.removeExtension(record.id);
      } catch {
        /* already gone */
      }
      if (record.status !== 'failed') record.status = 'disabled';
    }
  }

  /**
   * Startup: reload every approved extension that still exists on disk.
   * A folder that has moved, or one that now fails to load, is reported and
   * skipped — it never blocks Juzt from starting.
   */
  async restore(records: ExtensionRecord[], opts: { extensionsEnabled: boolean }): Promise<void> {
    this.records = records.map((r) => ({ ...r }));
    for (const record of this.records) {
      if (!opts.extensionsEnabled || !record.enabled) {
        record.status = opts.extensionsEnabled ? 'disabled' : 'disabled';
        continue;
      }
      if (!fs.existsSync(record.path)) {
        record.status = 'failed';
        record.error = `Folder no longer exists: ${record.path}`;
        continue;
      }
      await this.load(record);
    }
  }

  persist(): ExtensionRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  /** Folder picker for Load Unpacked. */
  async pickDirectory(parent: Electron.BaseWindow): Promise<string | null> {
    const result = await dialog.showOpenDialog(parent, {
      title: 'Load unpacked extension',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  }

  /** Where the app looks for extensions by default, for the UI hint. */
  static suggestedFolder(): string {
    return path.join(app.getPath('userData'), 'extensions');
  }
}
