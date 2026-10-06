/**
 * Development diagnostics.
 *
 * Disabled in packaged builds unless the teacher turns it on explicitly, and it
 * is *local only*: nothing is uploaded anywhere, there is no telemetry, and the
 * overlay is rendered by the PREP renderer (never on LIVE).
 */

import { app, ipcMain, webContents } from 'electron';
import { CH } from '../shared/ipc';
import type { DiagStats } from '../shared/types';

interface Counters {
  boundsApplied: number;
  boundsSkipped: number;
  focusRestoreMs?: number;
  presentedWebContents: number;
  liveWebContents: number;
  activeTabKind?: string;
  backgroundViews: number;
}

const counters: Counters = {
  boundsApplied: 0,
  boundsSkipped: 0,
  presentedWebContents: 0,
  liveWebContents: 0,
  backgroundViews: 0,
};

let enabled = false;

export function diagnosticsEnabled(): boolean {
  return enabled;
}

export function setDiagnostics(on: boolean): void {
  enabled = on || !app.isPackaged || process.env.JUZT_DIAG === '1';
}

export function countBounds(applied: boolean): void {
  if (applied) counters.boundsApplied += 1;
  else counters.boundsSkipped += 1;
}

export function noteFocusRestore(ms: number): void {
  counters.focusRestoreMs = Math.round(ms);
}

export function noteViewCounts(patch: Partial<Counters>): void {
  Object.assign(counters, patch);
}

export function snapshot(renderer: Partial<DiagStats> = {}): DiagStats {
  return {
    fps: renderer.fps ?? 0,
    worstFrameMs: renderer.worstFrameMs ?? 0,
    longTasks: renderer.longTasks ?? 0,
    longestTaskMs: renderer.longestTaskMs ?? 0,
    boundsApplied: counters.boundsApplied,
    boundsSkipped: counters.boundsSkipped,
    focusRestoreMs: counters.focusRestoreMs,
    presentedWebContents: counters.presentedWebContents,
    liveWebContents: counters.liveWebContents,
    activeTabKind: counters.activeTabKind,
    heapMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
    backgroundViews: counters.backgroundViews,
    ...renderer,
  };
}

export function webContentsCount(): number {
  return webContents.getAllWebContents().length;
}

export function registerDiagnosticsIpc(): void {
  ipcMain.handle(CH.DIAG_REPORT, (_e, sample: Partial<DiagStats>) => {
    if (!enabled) return false;
    noteViewCounts({ liveWebContents: webContentsCount() });
    return true;
  });
}
